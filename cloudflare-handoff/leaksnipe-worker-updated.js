/**
 * HANDOFF FILE — for Cloudflare AI to merge into the deployed "leaksnipe" Worker
 * (the one backing mcp.leaksnipe.win / the phone's "leaksnipe" MCP connector).
 *
 * This is the existing worker's source (pulled via the Workers API) with three
 * changes layered on top. Everything else — tool names, request/response
 * shapes, the McpServer/JSON-RPC scaffolding — is untouched.
 *
 * WHY THIS EXISTS
 * ----------------
 * The 12,000+ hand history objects (~0.6 GB) already live in R2 across three
 * buckets: leaksnipe-hand-histories, poker-hand-histories, poker-hands. But the
 * "leaksnipe-hand-histories" KV namespace that list_hand_histories /
 * search_by_player read from (`meta:*` keys) has never been populated — R2 has
 * the data, nothing indexed it. That's why both tools currently return 0
 * results even though the objects are all there.
 *
 * WHAT CHANGED
 * ------------
 * 1. get_large_hand_history now tries all three R2 buckets in order instead of
 *    just one, since a key could live in any of them.
 * 2. list_hand_histories / search_by_player now read `source_key` / `bucket`
 *    out of the stored metadata when present (falls back to the old
 *    strip-the-prefix behavior for any pre-existing meta: entries), so the
 *    `id` they return is always a valid key you can hand straight to
 *    get_large_hand_history.
 * 3. New tool: backfill_kv_from_r2 — scans all three R2 buckets, parses each
 *    hand's players/game_type/date/stakes, and writes one meta: entry per
 *    object. Paginated (200 objects per bucket per call) so it stays well
 *    inside Worker CPU limits — call it repeatedly, feeding back the
 *    `next_cursors` it returns, until `done: true`.
 *
 * DEPLOYMENT — bindings needed (add the two new R2 bindings; KV binding and
 * the first R2 binding should already exist):
 *
 *   KV:  HAND_HISTORY_KV     -> leaksnipe-hand-histories  (id c13121512b8e4519ae9b3a3a52daeed1)
 *   R2:  HAND_HISTORY_R2     -> leaksnipe-hand-histories   (existing binding, unchanged)
 *   R2:  R2_POKER_HH         -> poker-hand-histories        (NEW — add this binding)
 *   R2:  R2_POKER_HANDS      -> poker-hands                 (NEW — add this binding)
 *   var: BACKFILL_ADMIN_KEY  -> any long random string, used to gate backfill_kv_from_r2
 *
 * RUNNING THE BACKFILL — once deployed, call the MCP tool repeatedly:
 *
 *   POST /mcp
 *   { "jsonrpc": "2.0", "id": 1, "method": "tools/call",
 *     "params": { "name": "backfill_kv_from_r2",
 *                 "arguments": { "admin_key": "<BACKFILL_ADMIN_KEY>", "cursors": {} } } }
 *
 *   Response includes `next_cursors` — pass that object back in as `cursors`
 *   on the next call. Stop when the response's `done` is true. Safe to
 *   re-run: already-indexed keys are skipped (checked via KV existence before
 *   the R2 body is even fetched), so a partial run can always be resumed or
 *   repeated without duplicating work.
 */

class McpServer {
  constructor() {
    this.tools = new Map();
    this.dbBaseUrl = 'https://db.leaksnipe.win';
  }

  registerTool(name, schema, handler) {
    this.tools.set(name, { schema, handler });
  }

  async handleRequest(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/mcp' && request.method === 'POST') {
      const body = await request.json();
      const { jsonrpc, id, method, params } = body;

      if (method === 'initialize') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: 'leaksnipe-mcp', version: '1.2.0' }
          }
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (method === 'tools/list') {
        const toolsList = Array.from(this.tools.entries()).map(([name, t]) => ({
          name, description: t.schema.description,
          inputSchema: { type: 'object', properties: t.schema.properties, required: t.schema.required || [] }
        }));
        return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { tools: toolsList } }),
          { headers: { 'Content-Type': 'application/json' } });
      }

      if (method === 'tools/call') {
        const { name, arguments: args } = params;
        const tool = this.tools.get(name);
        if (!tool) {
          return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Tool not found' } }),
            { headers: { 'Content-Type': 'application/json' } });
        }
        try {
          const result = await tool.handler(args, env);
          return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } }),
            { headers: { 'Content-Type': 'application/json' } });
        } catch (err) {
          return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } }),
            { headers: { 'Content-Type': 'application/json' } });
        }
      }

      return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }),
        { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', server: 'leaksnipe-mcp', version: '1.2.0', db_proxy: this.dbBaseUrl }),
        { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response('LeakSnipe MCP Server v1.2.0 — POST to /mcp', { status: 200 });
  }
}

const server = new McpServer();

// All three buckets that hold hand-history JSON objects. `binding` must match
// a wrangler R2 binding name on this worker's env.
const HAND_HISTORY_BUCKETS = [
  { alias: 'leaksnipe-hand-histories', binding: 'HAND_HISTORY_R2' },
  { alias: 'poker-hand-histories', binding: 'R2_POKER_HH' },
  { alias: 'poker-hands', binding: 'R2_POKER_HANDS' },
];

// ===== CLOUDFLARE STORAGE TOOLS =====

server.registerTool('list_hand_histories', {
  description: 'List all hand history metadata from KV',
  properties: { limit: { type: 'number', description: 'Max results' }, prefix: { type: 'string', description: 'Filter prefix' } },
  required: []
}, async (args, env) => {
  const { limit = 50, prefix = '' } = args || {};
  const list = await env.HAND_HISTORY_KV.list({ prefix: prefix || 'meta:', limit });
  return {
    count: list.keys.length,
    histories: list.keys.map(k => {
      const meta = k.metadata || {};
      return {
        id: meta.source_key || k.name.replace('meta:', ''),
        bucket: meta.bucket || null,
        ...meta,
      };
    }),
  };
});

server.registerTool('get_hand_history', {
  description: 'Get a hand history by ID from KV',
  properties: { id: { type: 'string' } },
  required: ['id']
}, async (args, env) => {
  const { id } = args;
  const data = await env.HAND_HISTORY_KV.get('hh:' + id);
  if (!data) throw new Error('Hand history not found: ' + id);
  return JSON.parse(data);
});

server.registerTool('search_by_player', {
  description: 'Search hand histories by player name in KV metadata',
  properties: { player: { type: 'string' } },
  required: ['player']
}, async (args, env) => {
  const { player } = args;
  const list = await env.HAND_HISTORY_KV.list({ prefix: 'meta:' });
  const matches = [];
  for (const key of list.keys) {
    const meta = key.metadata;
    if (meta && Array.isArray(meta.players) && meta.players.includes(player)) {
      matches.push({
        id: meta.source_key || key.name.replace('meta:', ''),
        bucket: meta.bucket || null,
        ...meta,
      });
    }
  }
  return { player, matches: matches.length, histories: matches };
});

server.registerTool('upload_hand_history_meta', {
  description: 'Register hand history metadata in KV',
  properties: { id: { type: 'string' }, game_type: { type: 'string' }, stakes: { type: 'string' }, players: { type: 'array', items: { type: 'string' } }, date: { type: 'string' } },
  required: ['id']
}, async (args, env) => {
  const { id, ...meta } = args;
  await env.HAND_HISTORY_KV.put('meta:' + id, JSON.stringify(meta), { metadata: meta });
  return { success: true, id, message: 'Metadata registered' };
});

server.registerTool('store_hand_history', {
  description: 'Store full hand history data in KV',
  properties: { id: { type: 'string' }, data: { type: 'object' } },
  required: ['id', 'data']
}, async (args, env) => {
  const { id, data } = args;
  await env.HAND_HISTORY_KV.put('hh:' + id, JSON.stringify(data));
  return { success: true, id, size: JSON.stringify(data).length };
});

server.registerTool('get_large_hand_history', {
  description: 'Get large hand history file from R2',
  properties: { key: { type: 'string' } },
  required: ['key']
}, async (args, env) => {
  const { key } = args;
  for (const bucketCfg of HAND_HISTORY_BUCKETS) {
    const r2 = env[bucketCfg.binding];
    if (!r2) continue;
    const obj = await r2.get(key);
    if (obj) {
      const text = await obj.text();
      return {
        key,
        bucket: bucketCfg.alias,
        size: obj.size,
        content: text.substring(0, 5000) + (text.length > 5000 ? '... [truncated]' : ''),
      };
    }
  }
  throw new Error('Object not found in any bucket: ' + key);
});

server.registerTool('store_large_hand_history', {
  description: 'Store large hand history file in R2',
  properties: { key: { type: 'string' }, data: { type: 'string' } },
  required: ['key', 'data']
}, async (args, env) => {
  const { key, data } = args;
  await env.HAND_HISTORY_R2.put(key, data);
  return { success: true, key, size: data.length };
});

// ===== ADMIN: KV BACKFILL FROM R2 =====

const BACKFILL_BATCH_SIZE = 200;

function extractHandMeta(key, json) {
  let hand;
  try {
    hand = JSON.parse(json);
  } catch {
    return null;
  }
  const players = Array.isArray(hand.players)
    ? hand.players.map((p) => (p && (p.name || p.player_name)) || (typeof p === 'string' ? p : null)).filter(Boolean)
    : [];
  return {
    source_key: key,
    game_type: hand.game_type || hand.gameType || null,
    stakes: hand.stakes || hand.buy_in || null,
    date: hand.date || hand.hand_date || hand.imported_at || null,
    players,
    site: hand.site || null,
  };
}

async function backfillBucket(env, bucketCfg, cursor) {
  const r2 = env[bucketCfg.binding];
  if (!r2) return { processed: 0, skipped: 0, cursor: null, done: true, error: `Missing binding ${bucketCfg.binding}` };
  const list = await r2.list({ cursor: cursor || undefined, limit: BACKFILL_BATCH_SIZE });
  let processed = 0;
  let skipped = 0;
  for (const obj of list.objects) {
    const kvKey = `meta:${bucketCfg.alias}:${obj.key}`;
    const existing = await env.HAND_HISTORY_KV.get(kvKey);
    if (existing) { skipped++; continue; }
    const body = await r2.get(obj.key);
    if (!body) continue;
    const text = await body.text();
    const meta = extractHandMeta(obj.key, text);
    if (!meta) continue;
    meta.bucket = bucketCfg.alias;
    await env.HAND_HISTORY_KV.put(kvKey, JSON.stringify(meta), { metadata: meta });
    processed++;
  }
  return {
    processed,
    skipped,
    cursor: list.truncated ? list.cursor : null,
    done: !list.truncated,
  };
}

server.registerTool('backfill_kv_from_r2', {
  description:
    'ADMIN: index R2 hand-history objects into the HAND_HISTORY_KV meta: namespace so ' +
    'list_hand_histories / search_by_player can find them. Paginated — call repeatedly, ' +
    'feeding the returned next_cursors back in as cursors, until done=true. Idempotent: ' +
    'already-indexed keys are skipped.',
  properties: {
    admin_key: { type: 'string', description: 'Must match the BACKFILL_ADMIN_KEY env var' },
    cursors: { type: 'object', description: 'Per-bucket cursor object from a previous call, e.g. {"poker-hands": "..."}. Omit or {} to start fresh.' },
  },
  required: ['admin_key'],
}, async (args, env) => {
  const { admin_key, cursors = {} } = args || {};
  if (!env.BACKFILL_ADMIN_KEY || admin_key !== env.BACKFILL_ADMIN_KEY) {
    throw new Error('Unauthorized — admin_key does not match BACKFILL_ADMIN_KEY');
  }
  const results = {};
  let anyRemaining = false;
  for (const bucketCfg of HAND_HISTORY_BUCKETS) {
    const result = await backfillBucket(env, bucketCfg, cursors[bucketCfg.alias]);
    results[bucketCfg.alias] = result;
    if (!result.done) anyRemaining = true;
  }
  return {
    done: !anyRemaining,
    results,
    next_cursors: Object.fromEntries(
      Object.entries(results).map(([alias, r]) => [alias, r.cursor])
    ),
  };
});

// ===== TAURI DB PROXY TOOLS =====
// Unchanged from the existing worker — all proxy to https://db.leaksnipe.win/query,
// which now requires a Bearer token (LEAKSNIPE_DB_PROXY_KEY, generated on the
// desktop side and stored in LeakSnipe's .env). Add that same value here as
// env.DB_PROXY_KEY and send it as the Authorization header, e.g.:
//
//   headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DB_PROXY_KEY}` }
//
// on every fetch() call below — without it every tauri_db_* call will now get
// a 401 from the sidecar.

server.registerTool('tauri_db_query', {
  description: 'Send a raw SQL query to the Tauri SQLite database via HTTP proxy',
  properties: { sql: { type: 'string', description: 'SQL query string' }, params: { type: 'array', description: 'Query parameters' } },
  required: ['sql']
}, async (args, env) => {
  const { sql, params = [] } = args;
  const resp = await fetch('https://db.leaksnipe.win/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DB_PROXY_KEY}` },
    body: JSON.stringify({ sql, params })
  });
  if (!resp.ok) throw new Error('DB query failed: ' + resp.status + ' ' + await resp.text());
  return await resp.json();
});

server.registerTool('tauri_db_tables', {
  description: 'List all tables in the Tauri SQLite database',
  properties: {},
  required: []
}, async (args, env) => {
  const resp = await fetch('https://db.leaksnipe.win/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DB_PROXY_KEY}` },
    body: JSON.stringify({ sql: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" })
  });
  if (!resp.ok) throw new Error('DB query failed: ' + resp.status);
  return await resp.json();
});

server.registerTool('tauri_db_schema', {
  description: 'Get schema for a specific table',
  properties: { table: { type: 'string', description: 'Table name' } },
  required: ['table']
}, async (args, env) => {
  const { table } = args;
  const sql = "PRAGMA table_info(" + table + ")";
  const resp = await fetch('https://db.leaksnipe.win/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DB_PROXY_KEY}` },
    body: JSON.stringify({ sql })
  });
  if (!resp.ok) throw new Error('DB query failed: ' + resp.status);
  return await resp.json();
});

server.registerTool('tauri_db_player_stats', {
  description: 'Get HUD stats for a specific player from the Tauri DB',
  properties: { player: { type: 'string' }, limit: { type: 'number' } },
  required: ['player']
}, async (args, env) => {
  const { player, limit = 100 } = args;
  const resp = await fetch('https://db.leaksnipe.win/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DB_PROXY_KEY}` },
    body: JSON.stringify({
      sql: 'SELECT * FROM player_stats WHERE player_name = ? ORDER BY date DESC LIMIT ?',
      params: [player, limit]
    })
  });
  if (!resp.ok) throw new Error('DB query failed: ' + resp.status);
  return await resp.json();
});

server.registerTool('tauri_db_hands', {
  description: 'Get recent hands from the Tauri DB with optional filters',
  properties: { player: { type: 'string' }, game_type: { type: 'string' }, limit: { type: 'number' } },
  required: []
}, async (args, env) => {
  const { player, game_type, limit = 50 } = args || {};
  let sql = 'SELECT * FROM hands WHERE 1=1';
  const params = [];
  if (player) { sql += ' AND (hero_name = ? OR players LIKE ?)'; params.push(player, '%' + player + '%'); }
  if (game_type) { sql += ' AND game_type = ?'; params.push(game_type); }
  sql += ' ORDER BY hand_date DESC LIMIT ?'; params.push(limit);

  const resp = await fetch('https://db.leaksnipe.win/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DB_PROXY_KEY}` },
    body: JSON.stringify({ sql, params })
  });
  if (!resp.ok) throw new Error('DB query failed: ' + resp.status);
  return await resp.json();
});

server.registerTool('tauri_db_raw', {
  description: 'Send raw HTTP request to Tauri DB endpoint (flexible)',
  properties: { path: { type: 'string', default: '/' }, method: { type: 'string', default: 'GET' }, body: { type: 'object' } },
  required: []
}, async (args, env) => {
  const { path = '/', method = 'GET', body } = args || {};
  const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DB_PROXY_KEY}` } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const resp = await fetch('https://db.leaksnipe.win' + path, opts);
  const text = await resp.text();
  try { return { status: resp.status, data: JSON.parse(text) }; } catch { return { status: resp.status, text }; }
});

export default {
  async fetch(request, env) {
    return server.handleRequest(request, env);
  }
};
