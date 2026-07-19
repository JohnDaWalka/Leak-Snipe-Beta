/**
 * Shared schemas, SQL helpers, response shaping for LeakSnipe MCP v2.
 */

export const MCP_VERSION = '2.0.0';

export const POSITIONS = ['EP', 'MP', 'CO', 'BTN', 'SB', 'BB', 'UTG', 'HJ'];
export const SITES = ['CoinPoker', 'BetACR'];
export const GAME_TYPES = ['NLHE', 'PLO', 'PLO5', 'PLO6', 'Limit', 'Mixed'];
export const ORDER_BY = ['date', 'hero_won', 'pot'];
export const FORMATS = ['summary', 'full'];

/** Default hero alias map (lowercase key → aliases). Extended at runtime via DB. */
export const DEFAULT_HERO_ALIASES = {
  jdwalka: ['jdwalka', 'JohnDaWalka', 'JohnDaWalka'],
  johndawalka: ['JohnDaWalka', 'jdwalka', 'JohnDaWalka'],
  gboss101: ['gboss101', 'Gboss101', 'GBoss101'],
};

export const HAND_SUMMARY_COLS = [
  'hand_id',
  'site',
  'hand_number',
  'date',
  'game_type',
  'is_tournament',
  'tournament_id',
  'buy_in',
  'table_name',
  'max_seats',
  'hero_cards',
  'board_cards',
  'pot',
  'rake',
  'hero_won',
  'hero_position',
];

export const HAND_FULL_COLS = [...HAND_SUMMARY_COLS, 'button_seat', 'raw_text', 'source_file', 'imported_at'];

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;
export const DEFAULT_SQL_MAX_ROWS = 200;
export const ABSOLUTE_SQL_MAX_ROWS = 1000;

export const HAND_HISTORY_BUCKETS = [
  { alias: 'leaksnipe-hand-histories', binding: 'HAND_HISTORY_R2' },
  { alias: 'poker-hand-histories', binding: 'R2_POKER_HH' },
  { alias: 'poker-hands', binding: 'R2_POKER_HANDS' },
];

export const BACKFILL_BATCH_SIZE = 25;
export const BACKFILL_MAX_PARSE_BYTES = 2 * 1024 * 1024;

// ---------- schema fragments ----------

export const filterProperties = {
  site: {
    type: 'string',
    description: `Poker site filter. Common: ${SITES.join(', ')}`,
  },
  game_type: {
    type: 'string',
    description: `Game type. Common: ${GAME_TYPES.join(', ')}`,
  },
  is_tournament: {
    type: 'boolean',
    description: 'true = tournament only, false = cash only',
  },
  position: {
    type: 'string',
    description: 'Hero position',
    enum: POSITIONS,
  },
  hero_cards: {
    type: 'string',
    description: 'Card pattern: QQ, AKs, 76o, AhKd',
  },
  tags: {
    type: 'array',
    items: { type: 'string' },
    description: 'Require hands that have ALL of these tags',
  },
  player: {
    type: 'string',
    description: 'Player name at the table (any seat)',
  },
  date_from: {
    type: 'string',
    description: 'ISO date/time lower bound (inclusive)',
  },
  date_to: {
    type: 'string',
    description: 'ISO date/time upper bound (inclusive)',
  },
  min_profit: {
    type: 'number',
    description: 'Minimum hero_won (chips/tournament units — not always $)',
  },
  max_profit: {
    type: 'number',
    description: 'Maximum hero_won',
  },
  tournament_id: {
    type: 'string',
    description: 'Tournament id filter',
  },
  min_pot: {
    type: 'number',
    description: 'Minimum pot size',
  },
  won: {
    type: 'boolean',
    description: 'true = hero_won > 0, false = hero_won < 0',
  },
  limit: {
    type: 'number',
    description: `Max rows (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`,
    default: DEFAULT_LIMIT,
    minimum: 1,
    maximum: MAX_LIMIT,
  },
  offset: {
    type: 'number',
    description: 'Pagination offset (default 0)',
    default: 0,
    minimum: 0,
  },
  order_by: {
    type: 'string',
    description: 'Sort column',
    enum: ORDER_BY,
    default: 'date',
  },
  order: {
    type: 'string',
    description: 'Sort direction',
    enum: ['asc', 'desc'],
    default: 'desc',
  },
  format: {
    type: 'string',
    description: 'summary omits raw_text/source_file (default). full includes them.',
    enum: FORMATS,
    default: 'summary',
  },
  include_raw: {
    type: 'boolean',
    description: 'Include raw_text + source_file even in summary mode',
    default: false,
  },
};

export const includeDetailProperties = {
  include_raw: { type: 'boolean', description: 'Include raw_text and source_file', default: false },
  include_actions: { type: 'boolean', description: 'Include street actions', default: false },
  include_players: { type: 'boolean', description: 'Include seats/stacks', default: false },
  include_analysis: { type: 'boolean', description: 'Include ai_analysis row', default: false },
  include_tags: { type: 'boolean', description: 'Include hand tags', default: false },
  format: {
    type: 'string',
    enum: FORMATS,
    default: 'summary',
    description: 'summary or full hand row',
  },
};

export function pickFilterArgs(args = {}) {
  const out = {};
  for (const k of Object.keys(filterProperties)) {
    if (args[k] !== undefined && args[k] !== null && args[k] !== '') out[k] = args[k];
  }
  return out;
}

export function clampLimit(limit, fallback = DEFAULT_LIMIT) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

export function clampOffset(offset) {
  const n = Number(offset);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

// ---------- response envelope ----------

export function okList(results, { limit, offset, has_more } = {}) {
  const list = Array.isArray(results) ? results : [];
  return {
    success: true,
    count: list.length,
    results: list,
    limit: limit ?? null,
    offset: offset ?? 0,
    has_more: Boolean(has_more),
  };
}

export function okOne(data) {
  return { success: true, found: data != null, result: data };
}

export function okStats(results, extra = {}) {
  return { success: true, count: Array.isArray(results) ? results.length : 0, results, ...extra };
}

// ---------- hand shaping ----------

export function shapeHand(row, opts = {}) {
  if (!row || typeof row !== 'object') return row;
  const format = opts.format === 'full' ? 'full' : 'summary';
  const includeRaw = Boolean(opts.include_raw) || format === 'full';

  if (format === 'full' && includeRaw) {
    return { ...row };
  }

  const out = {};
  for (const col of HAND_SUMMARY_COLS) {
    if (row[col] !== undefined) out[col] = row[col];
  }
  if (includeRaw) {
    if (row.raw_text !== undefined) out.raw_text = row.raw_text;
    if (row.source_file !== undefined) out.source_file = row.source_file;
    if (row.imported_at !== undefined) out.imported_at = row.imported_at;
  }
  // pass through any enriched fields
  for (const k of ['tags', 'actions', 'players', 'analysis', 'winners']) {
    if (row[k] !== undefined) out[k] = row[k];
  }
  return out;
}

export function shapeHands(rows, opts = {}) {
  return (rows || []).map((r) => shapeHand(r, opts));
}

export function selectColsSql(opts = {}) {
  const format = opts.format === 'full' || opts.include_raw ? 'full' : 'summary';
  const cols = format === 'full' ? HAND_FULL_COLS : HAND_SUMMARY_COLS;
  return cols.map((c) => `h.${c}`).join(', ');
}

// ---------- card pattern ----------

export function parseCardPattern(term) {
  if (!term) return null;
  const t = String(term).toLowerCase().replace(/\s+/g, '');
  // Pocket pairs (e.g. qq)
  if (/^[2-9tjqka]{2}$/.test(t) && t[0] === t[1]) {
    return {
      sql: 'SUBSTR(LOWER(h.hero_cards), 1, 1) = ? AND SUBSTR(LOWER(h.hero_cards), 4, 1) = ?',
      params: [t[0], t[0]],
    };
  }
  // Suited/offsuit (e.g. aks, 76o)
  if (/^[2-9tjqka]{2}[so]$/.test(t)) {
    const r1 = t[0];
    const r2 = t[1];
    const type = t[2];
    const suitCompare = type === 's' ? '=' : '!=';
    return {
      sql: `((SUBSTR(LOWER(h.hero_cards), 1, 1) = ? AND SUBSTR(LOWER(h.hero_cards), 4, 1) = ?) OR (SUBSTR(LOWER(h.hero_cards), 1, 1) = ? AND SUBSTR(LOWER(h.hero_cards), 4, 1) = ?)) AND SUBSTR(h.hero_cards, 2, 1) ${suitCompare} SUBSTR(h.hero_cards, 5, 1)`,
      params: [r1, r2, r2, r1],
    };
  }
  // Ranks combination (e.g. ak, 76)
  if (/^[2-9tjqka]{2}$/.test(t)) {
    const r1 = t[0];
    const r2 = t[1];
    return {
      sql: '((SUBSTR(LOWER(h.hero_cards), 1, 1) = ? AND SUBSTR(LOWER(h.hero_cards), 4, 1) = ?) OR (SUBSTR(LOWER(h.hero_cards), 1, 1) = ? AND SUBSTR(LOWER(h.hero_cards), 4, 1) = ?))',
      params: [r1, r2, r2, r1],
    };
  }
  // Exact cards (e.g. ahkd)
  if (/^[2-9tjqka][cdhs][2-9tjqka][cdhs]$/.test(t)) {
    const c1 = t.slice(0, 2);
    const c2 = t.slice(2, 4);
    return {
      sql: '((SUBSTR(LOWER(h.hero_cards), 1, 2) = ? AND SUBSTR(LOWER(h.hero_cards), 4, 2) = ?) OR (SUBSTR(LOWER(h.hero_cards), 1, 2) = ? AND SUBSTR(LOWER(h.hero_cards), 4, 2) = ?))',
      params: [c1, c2, c2, c1],
    };
  }
  return null;
}

/** Unqualified column version for queries without h. alias */
export function parseCardPatternBare(term) {
  const p = parseCardPattern(term);
  if (!p) return null;
  return {
    sql: p.sql.replaceAll('h.hero_cards', 'hero_cards').replaceAll('h.', ''),
    params: p.params,
  };
}

// ---------- filters → SQL ----------

export function buildHandWhere(filters = {}, { tableAlias = 'h' } = {}) {
  const a = tableAlias ? `${tableAlias}.` : '';
  const where = [];
  const params = [];

  if (filters.site) {
    where.push(`LOWER(${a}site) = LOWER(?)`);
    params.push(filters.site);
  }
  if (filters.game_type) {
    where.push(`UPPER(${a}game_type) = UPPER(?)`);
    params.push(filters.game_type);
  }
  if (filters.is_tournament === true || filters.is_tournament === 1 || filters.is_tournament === 'true') {
    where.push(`${a}is_tournament = 1`);
  } else if (filters.is_tournament === false || filters.is_tournament === 0 || filters.is_tournament === 'false') {
    where.push(`${a}is_tournament = 0`);
  }
  if (filters.position) {
    where.push(`UPPER(${a}hero_position) = UPPER(?)`);
    params.push(filters.position);
  }
  if (filters.hero_cards) {
    const pattern = parseCardPattern(filters.hero_cards);
    if (!pattern) throw new Error('Invalid hero_cards pattern: ' + filters.hero_cards);
    // parseCardPattern uses h.hero_cards — rewrite if needed
    let sql = pattern.sql;
    if (tableAlias !== 'h') {
      sql = sql.replaceAll('h.hero_cards', `${tableAlias}.hero_cards`);
    }
    if (!tableAlias) {
      sql = sql.replaceAll('h.hero_cards', 'hero_cards');
    }
    where.push(`(${sql})`);
    params.push(...pattern.params);
  }
  if (filters.date_from || filters.since) {
    where.push(`${a}date >= ?`);
    params.push(filters.date_from || filters.since);
  }
  if (filters.date_to) {
    where.push(`${a}date <= ?`);
    params.push(filters.date_to);
  }
  if (filters.min_profit != null) {
    where.push(`${a}hero_won >= ?`);
    params.push(Number(filters.min_profit));
  }
  if (filters.max_profit != null) {
    where.push(`${a}hero_won <= ?`);
    params.push(Number(filters.max_profit));
  }
  if (filters.tournament_id) {
    where.push(`${a}tournament_id = ?`);
    params.push(filters.tournament_id);
  }
  if (filters.min_pot != null) {
    where.push(`${a}pot >= ?`);
    params.push(Number(filters.min_pot));
  }
  if (filters.won === true) {
    where.push(`${a}hero_won > 0`);
  } else if (filters.won === false) {
    where.push(`${a}hero_won < 0`);
  }
  if (filters.player) {
    where.push(
      `${a}hand_id IN (SELECT hand_id FROM players WHERE LOWER(name) = LOWER(?))`
    );
    params.push(filters.player);
  }
  if (Array.isArray(filters.tags) && filters.tags.length) {
    for (const tag of filters.tags) {
      where.push(
        `${a}hand_id IN (SELECT hand_id FROM hand_tags WHERE LOWER(tag) = LOWER(?))`
      );
      params.push(tag);
    }
  } else if (typeof filters.tag === 'string' && filters.tag) {
    where.push(
      `${a}hand_id IN (SELECT hand_id FROM hand_tags WHERE LOWER(tag) = LOWER(?))`
    );
    params.push(filters.tag);
  }

  return { where, params };
}

export function buildOrderLimit(filters = {}, { tableAlias = 'h' } = {}) {
  const a = tableAlias ? `${tableAlias}.` : '';
  const orderBy = ORDER_BY.includes(filters.order_by) ? filters.order_by : 'date';
  const order = String(filters.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const limit = clampLimit(filters.limit);
  const offset = clampOffset(filters.offset);
  // fetch one extra to detect has_more
  return {
    orderSql: `ORDER BY ${a}${orderBy} ${order} LIMIT ? OFFSET ?`,
    orderParams: [limit + 1, offset],
    limit,
    offset,
  };
}

export function buildHandQuery(filters = {}, opts = {}) {
  const format = opts.format || filters.format || 'summary';
  const include_raw = opts.include_raw ?? filters.include_raw ?? false;
  const cols =
    format === 'full' || include_raw
      ? HAND_FULL_COLS.map((c) => `h.${c}`).join(', ')
      : HAND_SUMMARY_COLS.map((c) => `h.${c}`).join(', ');

  const { where, params } = buildHandWhere(filters, { tableAlias: 'h' });
  const { orderSql, orderParams, limit, offset } = buildOrderLimit(filters, { tableAlias: 'h' });

  let sql = `SELECT ${cols} FROM hands h`;
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ' + orderSql;

  return {
    sql,
    params: [...params, ...orderParams],
    limit,
    offset,
    shapeOpts: { format, include_raw },
  };
}

export function applyHasMore(rows, limit) {
  const has_more = rows.length > limit;
  const trimmed = has_more ? rows.slice(0, limit) : rows;
  return { rows: trimmed, has_more };
}

// ---------- SQL safety ----------

export function assertSafeSql(sql, { allow_write = false } = {}) {
  if (!sql || typeof sql !== 'string') throw new Error('sql is required');
  let q = sql.trim();
  if (q.endsWith(';')) q = q.slice(0, -1).trim();

  // reject multi-statement
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < q.length; i++) {
    const ch = q[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ';' && !inSingle && !inDouble) {
      throw new Error('Multiple SQL statements are not allowed');
    }
  }

  const lower = q.toLowerCase();
  const isRead =
    lower.startsWith('select') ||
    lower.startsWith('with') ||
    lower.startsWith('pragma') ||
    lower.startsWith('explain');

  if (!isRead) {
    if (!allow_write) {
      throw new Error('Only SELECT / WITH / PRAGMA / EXPLAIN are allowed. Set allow_write=true and provide admin_key for writes.');
    }
    const forbidden = ['attach', 'detach', 'drop table', 'drop index', 'drop view', 'vacuum', 'reindex'];
    for (const f of forbidden) {
      if (lower.includes(f)) throw new Error(`Forbidden SQL keyword: ${f}`);
    }
  }

  return q;
}

export function ensureLimit(sql, maxRows = DEFAULT_SQL_MAX_ROWS) {
  const cap = Math.min(Math.max(1, Number(maxRows) || DEFAULT_SQL_MAX_ROWS), ABSOLUTE_SQL_MAX_ROWS);
  const lower = sql.toLowerCase();
  // rough detection — if LIMIT already present, leave alone
  if (/\blimit\s+\d+/i.test(lower)) return { sql, maxRows: cap };
  return { sql: `${sql} LIMIT ${cap}`, maxRows: cap };
}

// ---------- hero aliases ----------

export function expandPlayerAliases(player, aliasMap = DEFAULT_HERO_ALIASES) {
  if (!player) return [];
  const key = String(player).toLowerCase();
  const fromMap = aliasMap[key] || [];
  const set = new Set([player, ...fromMap]);
  // also reverse-lookup: if player matches any alias value, include the whole group
  for (const [, aliases] of Object.entries(aliasMap)) {
    if (aliases.some((a) => a.toLowerCase() === key)) {
      aliases.forEach((a) => set.add(a));
    }
  }
  return [...set];
}

// ---------- sessions ----------

export function computeSessions(rows, { gap_minutes = 30, limit = 10 } = {}) {
  const gapSeconds = (Number(gap_minutes) || 30) * 60;
  const bySite = new Map();
  for (const r of rows || []) {
    const site = r.site || 'unknown';
    if (!bySite.has(site)) bySite.set(site, []);
    bySite.get(site).push(r);
  }

  const sessions = [];
  for (const [site, siteHands] of bySite.entries()) {
    let current = [];
    let lastTime = null;
    for (const h of siteHands) {
      if (!h.date) continue;
      const t = Date.parse(h.date);
      if (Number.isNaN(t)) continue;
      if (lastTime != null && (t - lastTime) / 1000 > gapSeconds) {
        if (current.length) sessions.push(summarizeSession(site, current));
        current = [];
      }
      current.push({ ...h, _t: t });
      lastTime = t;
    }
    if (current.length) sessions.push(summarizeSession(site, current));
  }

  sessions.sort((a, b) => (a.start_time < b.start_time ? 1 : -1));
  return sessions.slice(0, clampLimit(limit, 10));
}

function summarizeSession(site, sess) {
  const first = sess[0];
  const last = sess[sess.length - 1];
  const hand_count = sess.length;
  const total_won = sess.reduce((s, h) => s + (Number(h.hero_won) || 0), 0);
  const won_hands = sess.filter((h) => Number(h.hero_won) > 0).length;
  const lost_hands = sess.filter((h) => Number(h.hero_won) < 0).length;
  const duration = (last._t - first._t) / 1000;
  const duration_minutes = Math.round((duration / 60) * 10) / 10;
  return {
    site,
    start_time: first.date,
    end_time: last.date,
    hand_count,
    net_profit: Math.round(total_won * 100) / 100,
    won_hands,
    lost_hands,
    winrate_pct: hand_count ? Math.round((won_hands / hand_count) * 1000) / 10 : 0,
    duration_minutes,
    hands_per_hour: duration > 60 ? Math.round((hand_count / (duration / 3600)) * 10) / 10 : hand_count,
    note: 'Profit is in site/tournament chip units, not always USD.',
  };
}

// ---------- meta / R2 ----------

export function extractHandMeta(key, json) {
  let hand;
  try {
    hand = JSON.parse(json);
  } catch {
    return null;
  }
  let players = Array.isArray(hand.players)
    ? hand.players
        .map((p) => (p && (p.name || p.player_name)) || (typeof p === 'string' ? p : null))
        .filter(Boolean)
    : [];
  if (players.length === 0 && typeof hand.raw_text === 'string') {
    const seen = new Set();
    for (const m of hand.raw_text.matchAll(/Seat\s+\d+:\s+(\S+)\s+\(/g)) {
      seen.add(m[1]);
    }
    players = [...seen];
  }
  return {
    source_key: key,
    game_type: hand.game_type || hand.gameType || null,
    stakes: hand.stakes || hand.buy_in || null,
    date: hand.date || hand.hand_date || hand.imported_at || null,
    players,
    site: hand.site || null,
    is_tournament: hand.is_tournament != null ? Boolean(hand.is_tournament) : null,
    tournament_id: hand.tournament_id || null,
    hero: hand.hero || hand.hero_name || null,
    hero_position: hand.hero_position || null,
    hero_won: hand.hero_won != null ? Number(hand.hero_won) : null,
  };
}

export function validateHandMeta(args = {}) {
  if (!args.id || typeof args.id !== 'string') throw new Error('id is required');
  const meta = {
    source_key: args.id,
    game_type: args.game_type ?? null,
    stakes: args.stakes ?? null,
    date: args.date ?? null,
    players: Array.isArray(args.players) ? args.players.map(String).slice(0, 20) : [],
    site: args.site ?? null,
    is_tournament: args.is_tournament != null ? Boolean(args.is_tournament) : null,
    tournament_id: args.tournament_id ?? null,
    hero: args.hero ?? null,
    hero_position: args.hero_position ?? null,
    hero_won: args.hero_won != null ? Number(args.hero_won) : null,
    tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
  };
  // drop undefined tags key if unused
  if (meta.tags === undefined) delete meta.tags;
  return meta;
}

export function validateHandData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('data must be a JSON object');
  }
  // soft schema: encourage known keys, strip nothing (agents may store extras)
  const known = [
    'hand_id', 'site', 'date', 'game_type', 'is_tournament', 'tournament_id',
    'buy_in', 'table_name', 'max_seats', 'hero_cards', 'board_cards', 'pot',
    'rake', 'hero_won', 'hero_position', 'raw_text', 'players', 'actions',
    'streets', 'winners', 'stakes', 'hero', 'hero_name',
  ];
  const unknown = Object.keys(data).filter((k) => !known.includes(k));
  return { data, unknown_keys: unknown, schema_version: 1 };
}

// ---------- DB proxy ----------

export function dbProxyHeaders(env, extra = {}) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.DB_PROXY_KEY}`,
    'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
    ...extra,
  };
}

export async function dbQuery(env, sql, params = []) {
  const resp = await fetch('https://db.leaksnipe.win/query', {
    method: 'POST',
    headers: dbProxyHeaders(env),
    body: JSON.stringify({ sql, params }),
  });
  if (!resp.ok) {
    throw new Error('DB query failed: ' + resp.status + ' ' + (await resp.text()));
  }
  return resp.json();
}

export async function queryHands(env, filters = {}, opts = {}) {
  const q = buildHandQuery({ ...filters, ...opts }, opts);
  const raw = await dbQuery(env, q.sql, q.params);
  const all = raw.results || raw || [];
  const { rows, has_more } = applyHasMore(all, q.limit);
  return okList(shapeHands(rows, q.shapeOpts), {
    limit: q.limit,
    offset: q.offset,
    has_more,
  });
}

export async function proxyLocalMcp(env, name, args) {
  const resp = await fetch('https://db.leaksnipe.win/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args || {} },
    }),
  });
  if (!resp.ok) throw new Error('Local MCP call failed: ' + resp.status + ' ' + (await resp.text()));
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message);
  return json.result?.content ?? json.result;
}
