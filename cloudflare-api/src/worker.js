const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function authorized(request, env) {
  const key = env.LEAKSNIPE_API_KEY;
  if (!key) return false;
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") && header.slice(7) === key;
}

async function handDetail(db, handId) {
  const hand = await db.prepare("SELECT * FROM hands WHERE hand_id = ?").bind(handId).first();
  if (!hand) return null;
  const [players, actions, winners, tags] = await db.batch([
    db.prepare("SELECT seat, name, stack, is_hero FROM players WHERE hand_id = ? ORDER BY seat").bind(handId),
    db.prepare("SELECT street, sequence, player, action, amount FROM actions WHERE hand_id = ? ORDER BY sequence").bind(handId),
    db.prepare("SELECT player_name, amount FROM winners WHERE hand_id = ?").bind(handId),
    db.prepare("SELECT tag FROM hand_tags WHERE hand_id = ? ORDER BY tag").bind(handId),
  ]);
  return {
    ...hand,
    players: players.results,
    actions: actions.results,
    winners: winners.results,
    tags: tags.results.map(({ tag }) => tag),
  };
}

const OPENAPI = {
  openapi: "3.1.0",
  info: { title: "LeakSnipe Hand Database", version: "1.0.0", description: "Private, read-only poker hand database." },
  servers: [{ url: "https://leaksnipe-data-api.gitgoin87.workers.dev" }],
  paths: {
    "/v1/summary": { get: { operationId: "getDatabaseSummary", summary: "Get the overall hand database summary", responses: { "200": { description: "Summary" } } } },
    "/v1/hands": { get: { operationId: "listHands", summary: "List recent hands, optionally filtered by hero name or date", parameters: [{ name: "limit", in: "query", schema: { type: "integer", maximum: 100 } }, { name: "hero", in: "query", schema: { type: "string" } }, { name: "start", in: "query", schema: { type: "string" } }, { name: "end", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Hands" } } } },
    "/v1/hands/{handId}": { get: { operationId: "getHand", summary: "Get one hand with actions and results", parameters: [{ name: "handId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Hand detail" }, "404": { description: "Not found" } } } },
    "/v1/players/{name}": { get: { operationId: "getPlayerStats", summary: "Get HUD statistics for a player", parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Player statistics" }, "404": { description: "Not found" } } } },
  },
  components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
  security: [{ bearerAuth: [] }],
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true });
    if (request.method === "GET" && url.pathname === "/openapi.json") return json(OPENAPI);
    if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

    if (url.pathname === "/v1/summary") {
      const summary = await env.DB.prepare(`SELECT COUNT(*) AS total_hands, COUNT(DISTINCT site) AS sites,
        COUNT(DISTINCT tournament_id) AS tournaments, COALESCE(SUM(hero_won), 0) AS net_result,
        MIN(date) AS first_hand_at, MAX(date) AS last_hand_at FROM hands`).first();
      return json(summary);
    }

    if (url.pathname === "/v1/hands") {
      const limit = integer(url.searchParams.get("limit"), 25, 1, 100);
      const hero = url.searchParams.get("hero")?.trim() || null;
      const start = url.searchParams.get("start")?.trim() || null;
      const end = url.searchParams.get("end")?.trim() || null;
      const result = await env.DB.prepare(`SELECT h.hand_id, h.site, h.date, h.game_type, h.table_name,
          h.hero_cards, h.board_cards, h.hero_won, h.hero_position, h.pot, h.is_tournament
        FROM hands h WHERE (? IS NULL OR EXISTS (SELECT 1 FROM players p WHERE p.hand_id = h.hand_id AND p.is_hero = 1 AND lower(p.name) = lower(?)))
          AND (? IS NULL OR h.date >= ?) AND (? IS NULL OR h.date <= ?)
        ORDER BY h.date DESC LIMIT ?`).bind(hero, hero, start, start, end, end, limit).run();
      return json({ hands: result.results, count: result.results.length });
    }

    const handMatch = url.pathname.match(/^\/v1\/hands\/([^/]+)$/);
    if (handMatch) {
      const hand = await handDetail(env.DB, decodeURIComponent(handMatch[1]));
      return hand ? json(hand) : json({ error: "Hand not found" }, 404);
    }

    const playerMatch = url.pathname.match(/^\/v1\/players\/([^/]+)$/);
    if (playerMatch) {
      const name = decodeURIComponent(playerMatch[1]);
      const player = await env.DB.prepare(`SELECT name, site, auto_type, manual_type, hands, vpip, pfr, af,
        fold_cbet, wtsd, updated_at FROM player_types WHERE lower(name) = lower(?)`).bind(name).first();
      if (!player) return json({ error: "Player not found" }, 404);
      const positions = await env.DB.prepare(`SELECT position, COUNT(*) AS hands, SUM(vpip) AS vpip_hands, SUM(pfr) AS pfr_hands
        FROM player_position_facts WHERE lower(player) = lower(?) GROUP BY position`).bind(name).all();
      return json({ ...player, positions: positions.results.map((row) => ({
        position: row.position, hands: row.hands,
        vpip: row.hands ? Number((100 * row.vpip_hands / row.hands).toFixed(1)) : 0,
        pfr: row.hands ? Number((100 * row.pfr_hands / row.hands).toFixed(1)) : 0,
      })) });
    }
    return json({ error: "Not found" }, 404);
  },
};
