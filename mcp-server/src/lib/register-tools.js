/**
 * Register all LeakSnipe MCP tools (v2 schemas + options).
 */
import {
  MCP_VERSION,
  POSITIONS,
  SITES,
  GAME_TYPES,
  filterProperties,
  includeDetailProperties,
  pickFilterArgs,
  clampLimit,
  clampOffset,
  okList,
  okOne,
  okStats,
  shapeHand,
  shapeHands,
  parseCardPattern,
  buildHandWhere,
  buildHandQuery,
  applyHasMore,
  assertSafeSql,
  ensureLimit,
  expandPlayerAliases,
  computeSessions,
  extractHandMeta,
  validateHandMeta,
  validateHandData,
  dbProxyHeaders,
  dbQuery,
  requireD1,
  d1All,
  d1Run,
  d1First,
  COACHING_SCHEMA,
  getOrComputeAnalytics,
  queryHands,
  proxyLocalMcp,
  HAND_HISTORY_BUCKETS,
  BACKFILL_BATCH_SIZE,
  BACKFILL_MAX_PARSE_BYTES,
  HAND_SUMMARY_COLS,
  DEFAULT_SQL_MAX_ROWS,
} from './core.js';

export { extractHandMeta, HAND_HISTORY_BUCKETS, MCP_VERSION };

async function backfillBucket(env, bucketCfg, cursor, batch) {
  const r2 = env[bucketCfg.binding];
  if (!r2) {
    return {
      processed: 0,
      skipped: 0,
      cursor: null,
      done: true,
      error: `Missing binding ${bucketCfg.binding}`,
    };
  }
  const list = await r2.list({ cursor: cursor || undefined, limit: batch || BACKFILL_BATCH_SIZE });
  let processed = 0;
  let skipped = 0;
  for (const obj of list.objects) {
    const kvKey = `meta:${bucketCfg.alias}:${obj.key}`;
    const existing = await env.HAND_HISTORY_KV.get(kvKey);
    if (existing) {
      skipped++;
      continue;
    }
    let meta = null;
    if (obj.size <= BACKFILL_MAX_PARSE_BYTES) {
      const body = await r2.get(obj.key);
      if (body) meta = extractHandMeta(obj.key, await body.text());
    }
    if (!meta) {
      meta = {
        source_key: obj.key,
        game_type: null,
        stakes: null,
        date: null,
        players: [],
        site: null,
        parse_skipped: true,
      };
    }
    meta.size = obj.size;
    meta.bucket = bucketCfg.alias;
    if (Array.isArray(meta.players)) meta.players = meta.players.slice(0, 20);
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

function listFilterProps(extra = {}) {
  return { ...filterProperties, ...extra };
}

export function registerAllTools(server) {
  // ========== UNIFIED HAND QUERY ==========

  server.registerTool(
    'query_hands',
    {
      description:
        'Unified hand search with shared filters. Default format=summary (no raw_text). ' +
        'Filters: site, game_type, is_tournament, position, hero_cards, tags, player, date_from/to, ' +
        'min/max_profit, tournament_id, min_pot, won, order_by, order, limit, offset. ' +
        'Profit values are chip/tournament units, not always USD.',
      properties: listFilterProps(),
      required: [],
    },
    async (args, env) => queryHands(env, pickFilterArgs(args || {}), args || {})
  );

  server.registerTool(
    'get_hand',
    {
      description:
        'Get a single hand by hand_id with optional includes (raw, actions, players, analysis, tags).',
      properties: {
        hand_id: { type: 'string', description: 'Hand id (e.g. CP_108271700034 or ACR_2760551680)' },
        id: { type: 'string', description: 'Alias for hand_id' },
        ...includeDetailProperties,
      },
      required: [],
    },
    async (args, env) => {
      const hand_id = args?.hand_id || args?.id;
      if (!hand_id) throw new Error('hand_id is required');
      const include_raw = Boolean(args.include_raw) || args.format === 'full';
      const cols = include_raw
        ? 'h.*'
        : HAND_SUMMARY_COLS.map((c) => `h.${c}`).join(', ');
      const raw = await dbQuery(env, `SELECT ${cols} FROM hands h WHERE h.hand_id = ? LIMIT 1`, [
        hand_id,
      ]);
      const row = (raw.results || [])[0];
      if (!row) return okOne(null);

      const shaped = shapeHand(row, {
        format: args.format || 'summary',
        include_raw,
      });

      if (args.include_actions) {
        const acts = await dbQuery(
          env,
          'SELECT street, sequence, player, action, amount FROM actions WHERE hand_id = ? ORDER BY sequence ASC',
          [hand_id]
        );
        shaped.actions = acts.results || [];
      }
      if (args.include_players) {
        const pls = await dbQuery(
          env,
          'SELECT seat, name, stack, is_hero FROM players WHERE hand_id = ? ORDER BY seat ASC',
          [hand_id]
        );
        shaped.players = pls.results || [];
      }
      if (args.include_tags) {
        const tags = await dbQuery(
          env,
          'SELECT tag, created_at FROM hand_tags WHERE hand_id = ? ORDER BY tag',
          [hand_id]
        );
        shaped.tags = (tags.results || []).map((t) => t.tag);
        shaped.tag_rows = tags.results || [];
      }
      if (args.include_analysis) {
        const an = await dbQuery(env, 'SELECT * FROM ai_analysis WHERE hand_id = ? LIMIT 1', [
          hand_id,
        ]);
        shaped.analysis = (an.results || [])[0] || null;
      }
      return okOne(shaped);
    }
  );

  // ========== LEGACY HAND TOOLS (shared filters + summary default) ==========

  server.registerTool(
    'get_recent_hands',
    {
      description:
        'Most recent hands. Prefer query_hands for full filters. Default summary (no raw_text).',
      properties: listFilterProps({
        since: { type: 'string', description: 'Alias for date_from' },
      }),
      required: [],
    },
    async (args, env) => {
      const f = pickFilterArgs(args || {});
      if (args?.since && !f.date_from) f.date_from = args.since;
      return queryHands(env, f, args || {});
    }
  );

  server.registerTool(
    'get_hands_by_cards',
    {
      description: 'Hands matching hole-card pattern (QQ, AKs, 76o, AhKd). Summary by default.',
      properties: listFilterProps({
        cards: {
          type: 'string',
          description: 'Card pattern like QQ, AKs, 76o, AhKd',
        },
      }),
      required: ['cards'],
    },
    async (args, env) => {
      const f = pickFilterArgs(args || {});
      f.hero_cards = args.cards;
      return queryHands(env, f, args || {});
    }
  );

  server.registerTool(
    'get_hands_by_position',
    {
      description: 'Recent hands from a hero position. Summary by default.',
      properties: listFilterProps({
        position: {
          type: 'string',
          description: 'Position',
          enum: POSITIONS,
        },
      }),
      required: ['position'],
    },
    async (args, env) => {
      const f = pickFilterArgs(args || {});
      f.position = args.position;
      return queryHands(env, f, args || {});
    }
  );

  server.registerTool(
    'get_biggest_winning_hands',
    {
      description: 'Largest hero_won hands. Summary by default. Chip units may be tournament chips.',
      properties: listFilterProps({
        order_by: { type: 'string', enum: ['hero_won', 'date', 'pot'], default: 'hero_won' },
      }),
      required: [],
    },
    async (args, env) => {
      const f = pickFilterArgs(args || {});
      if (f.won === undefined) f.won = true;
      f.order_by = args?.order_by || 'hero_won';
      f.order = args?.order || 'desc';
      return queryHands(env, f, args || {});
    }
  );

  server.registerTool(
    'search_hands',
    {
      description:
        'Keyword search (e.g. "BTN won QQ", "tournament bluff", tag names). Summary by default. ' +
        'Also accepts the shared structured filters.',
      properties: listFilterProps({
        query: {
          type: 'string',
          description: 'Keywords like "BTN won QQ", "bluff", "NL50"',
        },
      }),
      required: ['query'],
    },
    async (args, env) => {
      const f = pickFilterArgs(args || {});
      const query = args.query || '';
      const terms = query
        .toLowerCase()
        .replace(/[^a-z0-9\s><=-]/g, '')
        .split(/\s+/)
        .filter(Boolean);

      // merge keyword intent into filters
      const extraWhere = [];
      const extraParams = [];
      for (const term of terms) {
        if (['btn', 'sb', 'bb', 'co', 'mp', 'ep', 'utg', 'hj'].includes(term)) {
          f.position = term.toUpperCase();
          continue;
        }
        if (['won', 'win', 'winning'].includes(term)) {
          f.won = true;
          continue;
        }
        if (['lost', 'lose', 'losing'].includes(term)) {
          f.won = false;
          continue;
        }
        if (['tournament', 'tourney', 'mtt'].includes(term)) {
          f.is_tournament = true;
          continue;
        }
        if (['cash', 'ring'].includes(term)) {
          f.is_tournament = false;
          continue;
        }
        const cardPattern = parseCardPattern(term);
        if (cardPattern) {
          f.hero_cards = term;
          continue;
        }
        // site shortcuts
        if (term === 'coinpoker') {
          f.site = 'CoinPoker';
          continue;
        }
        if (term === 'betacr' || term === 'acr') {
          f.site = 'BetACR';
          continue;
        }
        extraWhere.push(
          '(h.hand_id IN (SELECT hand_id FROM hand_tags WHERE LOWER(tag) LIKE ?) OR LOWER(h.source_file) LIKE ? OR LOWER(h.table_name) LIKE ? OR h.hand_number = ?)'
        );
        const likeVal = '%' + term + '%';
        extraParams.push(likeVal, likeVal, likeVal, term);
      }

      const q = buildHandQuery(f, args || {});
      let sql = q.sql;
      let params = q.params;
      if (extraWhere.length) {
        // inject extra AND clauses before ORDER BY
        const orderIdx = sql.toUpperCase().lastIndexOf(' ORDER BY ');
        const head = orderIdx >= 0 ? sql.slice(0, orderIdx) : sql;
        const tail = orderIdx >= 0 ? sql.slice(orderIdx) : '';
        const joiner = /\bWHERE\b/i.test(head) ? ' AND ' : ' WHERE ';
        sql = head + joiner + extraWhere.join(' AND ') + tail;
        // order params are at the end; insert extras before limit/offset
        const limitParams = params.slice(-2);
        const baseParams = params.slice(0, -2);
        params = [...baseParams, ...extraParams, ...limitParams];
      }

      const raw = await dbQuery(env, sql, params);
      const all = raw.results || [];
      const { rows, has_more } = applyHasMore(all, q.limit);
      return okList(shapeHands(rows, q.shapeOpts), {
        limit: q.limit,
        offset: q.offset,
        has_more,
      });
    }
  );

  server.registerTool(
    'tauri_db_hands',
    {
      description: 'Recent hands with filters (alias of query_hands). Summary by default.',
      properties: listFilterProps(),
      required: [],
    },
    async (args, env) => queryHands(env, pickFilterArgs(args || {}), args || {})
  );

  // ========== STATS ==========

  server.registerTool(
    'get_winrate_by_position',
    {
      description:
        'Winrate / profit by hero position. Optional site, date, cash/tour filters. ' +
        'Profit is chip/tournament units, not always USD.',
      properties: {
        site: filterProperties.site,
        game_type: filterProperties.game_type,
        is_tournament: filterProperties.is_tournament,
        date_from: filterProperties.date_from,
        date_to: filterProperties.date_to,
      },
      required: [],
    },
    async (args, env) => {
      const f = pickFilterArgs(args || {});
      const { where, params } = buildHandWhere(f, { tableAlias: 'h' });
      where.push("h.hero_position IS NOT NULL AND h.hero_position != '' AND h.hero_position != '?'");
      // GROUP BY is_tournament even when the caller doesn't filter it — cash
      // dollars and tournament chips must never sum into one total_profit.
      const sql = `
        SELECT
          h.hero_position AS position,
          CASE WHEN h.is_tournament = 1 THEN 'tournament_chips' ELSE 'cash_usd' END AS unit,
          COUNT(*) AS total_hands,
          SUM(CASE WHEN h.hero_won > 0 THEN 1 ELSE 0 END) AS hands_won,
          SUM(h.hero_won) AS total_profit
        FROM hands h
        WHERE ${where.join(' AND ')}
        GROUP BY h.hero_position, unit
        ORDER BY unit, total_profit DESC
      `;
      const raw = await dbQuery(env, sql, params);
      return okStats(raw.results || [], {
        note: 'cash_usd rows are dollars; tournament_chips rows are chips — never sum across units.',
      });
    }
  );

  server.registerTool(
    'get_sessions_winrate',
    {
      description:
        'Dynamically group hands into sessions by inter-hand gap and return session winrate, profit, duration. ' +
        'Computed in the worker (no local MCP dependency). Profit may be tournament chips.',
      properties: {
        site: filterProperties.site,
        gap_minutes: {
          type: 'number',
          description: 'Minutes gap between hands to start a new session (default 30)',
          default: 30,
        },
        limit: {
          type: 'number',
          description: 'Max sessions to return (default 10, max 100)',
          default: 10,
        },
        date_from: filterProperties.date_from,
        date_to: filterProperties.date_to,
        is_tournament: filterProperties.is_tournament,
      },
      required: [],
    },
    async (args, env) => {
      const f = pickFilterArgs(args || {});
      const { where, params } = buildHandWhere(f, { tableAlias: 'h' });
      let sql =
        'SELECT h.hand_id, h.date, h.site, h.hero_won, h.is_tournament, h.hero_position FROM hands h';
      if (where.length) sql += ' WHERE ' + where.join(' AND ');
      sql += ' ORDER BY h.site ASC, h.date ASC';
      // Cap rows scanned for sessionization
      sql += ' LIMIT 50000';

      const raw = await dbQuery(env, sql, params);
      const sessions = computeSessions(raw.results || [], {
        gap_minutes: args?.gap_minutes ?? 30,
        limit: args?.limit ?? 10,
      });
      return okStats(sessions, {
        gap_minutes: args?.gap_minutes ?? 30,
        note: 'Sessions derived from hand timestamps; profit in chip units.',
      });
    }
  );

  server.registerTool(
    'get_stats',
    {
      description:
        'Aggregate stats grouped by position, site, day, or session. Shared filters supported.',
      properties: {
        group_by: {
          type: 'string',
          enum: ['position', 'site', 'day', 'session'],
          description: 'Aggregation dimension (default position)',
          default: 'position',
        },
        ...pickSubset(filterProperties, [
          'site',
          'game_type',
          'is_tournament',
          'date_from',
          'date_to',
          'position',
          'limit',
        ]),
        gap_minutes: {
          type: 'number',
          description: 'For group_by=session (default 30)',
          default: 30,
        },
      },
      required: [],
    },
    async (args, env) => {
      const group_by = args?.group_by || 'position';
      if (group_by === 'session') {
        const f = pickFilterArgs(args || {});
        const { where, params } = buildHandWhere(f, { tableAlias: 'h' });
        let sql =
          'SELECT h.hand_id, h.date, h.site, h.hero_won, h.is_tournament, h.hero_position FROM hands h';
        if (where.length) sql += ' WHERE ' + where.join(' AND ');
        sql += ' ORDER BY h.site ASC, h.date ASC LIMIT 50000';
        const raw = await dbQuery(env, sql, params);
        const sessions = computeSessions(raw.results || [], {
          gap_minutes: args?.gap_minutes ?? 30,
          limit: args?.limit ?? 20,
        });
        return okStats(sessions, { group_by });
      }
      if (group_by === 'site') {
        const f = pickFilterArgs(args || {});
        const { where, params } = buildHandWhere(f, { tableAlias: 'h' });
        const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
        const sql = `
          SELECT h.site AS site,
            COUNT(*) AS total_hands,
            SUM(CASE WHEN h.hero_won > 0 THEN 1 ELSE 0 END) AS hands_won,
            SUM(h.hero_won) AS total_profit
          FROM hands h ${w}
          GROUP BY h.site ORDER BY total_profit DESC`;
        const raw = await dbQuery(env, sql, params);
        return okStats(raw.results || [], { group_by });
      }
      if (group_by === 'day') {
        const f = pickFilterArgs(args || {});
        const { where, params } = buildHandWhere(f, { tableAlias: 'h' });
        const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
        const sql = `
          SELECT substr(h.date, 1, 10) AS day,
            COUNT(*) AS total_hands,
            SUM(CASE WHEN h.hero_won > 0 THEN 1 ELSE 0 END) AS hands_won,
            SUM(h.hero_won) AS total_profit
          FROM hands h ${w}
          GROUP BY substr(h.date, 1, 10)
          ORDER BY day DESC LIMIT ?`;
        const raw = await dbQuery(env, sql, [...params, clampLimit(args?.limit, 30)]);
        return okStats(raw.results || [], { group_by });
      }
      // position default — reuse tool logic
      const f = pickFilterArgs(args || {});
      const { where, params } = buildHandWhere(f, { tableAlias: 'h' });
      where.push("h.hero_position IS NOT NULL AND h.hero_position != '' AND h.hero_position != '?'");
      const sql = `
        SELECT h.hero_position AS position,
          COUNT(*) AS total_hands,
          SUM(CASE WHEN h.hero_won > 0 THEN 1 ELSE 0 END) AS hands_won,
          SUM(h.hero_won) AS total_profit
        FROM hands h WHERE ${where.join(' AND ')}
        GROUP BY h.hero_position ORDER BY total_profit DESC`;
      const raw = await dbQuery(env, sql, params);
      return okStats(raw.results || [], { group_by: 'position' });
    }
  );

  // ========== PLAYER / PROFILE ==========

  server.registerTool(
    'tauri_db_player_stats',
    {
      description:
        'Career HUD stats (VPIP/PFR/AF/WTSD/3-bet + positional breakdown). Resolves hero aliases by default.',
      properties: {
        player: { type: 'string', description: 'Player name or hero alias' },
        resolve_aliases: {
          type: 'boolean',
          description: 'Expand known aliases (jdwalka ↔ JohnDaWalka). Default true.',
          default: true,
        },
      },
      required: ['player'],
    },
    async (args, env) => getPlayerProfile(env, args)
  );

  server.registerTool(
    'get_player_profile',
    {
      description:
        'Full villain/hero profile: player_types row, positional facts, optional recent hands sample.',
      properties: {
        player: { type: 'string' },
        resolve_aliases: { type: 'boolean', default: true },
        include_recent_hands: { type: 'boolean', default: false },
        limit: { type: 'number', default: 5, minimum: 1, maximum: 50 },
      },
      required: ['player'],
    },
    async (args, env) => {
      const profile = await getPlayerProfile(env, args);
      if (!profile.found) return profile;
      if (args?.include_recent_hands) {
        const names = expandPlayerAliases(args.player);
        const inList = names.map(() => 'lower(?)').join(',');
        const raw = await dbQuery(
          env,
          `SELECT ${HAND_SUMMARY_COLS.map((c) => `h.${c}`).join(', ')}
           FROM hands h
           WHERE h.hand_id IN (
             SELECT hand_id FROM players WHERE lower(name) IN (${inList})
           )
           ORDER BY h.date DESC LIMIT ?`,
          [...names, clampLimit(args?.limit, 5)]
        );
        profile.recent_hands = shapeHands(raw.results || [], { format: 'summary' });
      }
      return profile;
    }
  );

  server.registerTool(
    'list_player_types',
    {
      description: 'List players from player_types (HUD labels) with optional filters.',
      properties: {
        site: filterProperties.site,
        auto_type: { type: 'string', description: 'Filter by auto_type label' },
        min_hands: { type: 'number', description: 'Minimum hands sample', default: 0 },
        limit: { type: 'number', default: 50, minimum: 1, maximum: 100 },
        offset: { type: 'number', default: 0 },
      },
      required: [],
    },
    async (args, env) => {
      const where = [];
      const params = [];
      if (args?.site) {
        where.push('LOWER(site) = LOWER(?)');
        params.push(args.site);
      }
      if (args?.auto_type) {
        where.push('LOWER(auto_type) = LOWER(?)');
        params.push(args.auto_type);
      }
      if (args?.min_hands) {
        where.push('hands >= ?');
        params.push(Number(args.min_hands));
      }
      const limit = clampLimit(args?.limit, 50);
      const offset = clampOffset(args?.offset);
      let sql =
        'SELECT name, site, auto_type, manual_type, hands, vpip, pfr, af, fold_cbet, wtsd, three_bet, updated_at FROM player_types';
      if (where.length) sql += ' WHERE ' + where.join(' AND ');
      sql += ' ORDER BY hands DESC LIMIT ? OFFSET ?';
      params.push(limit + 1, offset);
      const raw = await dbQuery(env, sql, params);
      const { rows, has_more } = applyHasMore(raw.results || [], limit);
      return okList(rows, { limit, offset, has_more });
    }
  );

  // ========== TAGS / ANALYSIS / TOURNAMENTS / ACTIONS ==========

  server.registerTool(
    'list_tags',
    {
      description: 'List distinct hand tags with counts.',
      properties: {
        limit: { type: 'number', default: 100, minimum: 1, maximum: 100 },
        prefix: { type: 'string', description: 'Optional tag prefix filter' },
      },
      required: [],
    },
    async (args, env) => {
      const limit = clampLimit(args?.limit, 100);
      const params = [];
      let sql =
        'SELECT tag, COUNT(*) AS hand_count FROM hand_tags';
      if (args?.prefix) {
        sql += ' WHERE LOWER(tag) LIKE ?';
        params.push(String(args.prefix).toLowerCase() + '%');
      }
      sql += ' GROUP BY tag ORDER BY hand_count DESC LIMIT ?';
      params.push(limit);
      const raw = await dbQuery(env, sql, params);
      return okList(raw.results || [], { limit, offset: 0, has_more: false });
    }
  );

  server.registerTool(
    'get_hands_by_tag',
    {
      description: 'Hands that have a given tag. Summary by default.',
      properties: listFilterProps({
        tag: { type: 'string', description: 'Exact tag name' },
      }),
      required: ['tag'],
    },
    async (args, env) => {
      const f = pickFilterArgs(args || {});
      f.tag = args.tag;
      return queryHands(env, f, args || {});
    }
  );

  server.registerTool(
    'list_leaks',
    {
      description:
        'Search ai_analysis rows (mistakes, play_style, EV estimates). Sorted by analyzed_at desc.',
      properties: {
        min_mistakes: { type: 'number', description: 'Minimum mistakes_found', default: 1 },
        play_style: { type: 'string' },
        hand_id: { type: 'string' },
        limit: { type: 'number', default: 20, minimum: 1, maximum: 100 },
        offset: { type: 'number', default: 0 },
        include_raw_response: {
          type: 'boolean',
          description: 'Include full raw_response (large). Default false.',
          default: false,
        },
      },
      required: [],
    },
    async (args, env) => {
      const where = [];
      const params = [];
      if (args?.min_mistakes != null) {
        where.push('mistakes_found >= ?');
        params.push(Number(args.min_mistakes));
      }
      if (args?.play_style) {
        where.push('LOWER(play_style) LIKE ?');
        params.push('%' + String(args.play_style).toLowerCase() + '%');
      }
      if (args?.hand_id) {
        where.push('hand_id = ?');
        params.push(args.hand_id);
      }
      const limit = clampLimit(args?.limit, 20);
      const offset = clampOffset(args?.offset);
      const cols = args?.include_raw_response
        ? '*'
        : 'hand_id, llm_provider, play_style, mistakes_found, tags, summary, ev_estimate, analyzed_at';
      let sql = `SELECT ${cols} FROM ai_analysis`;
      if (where.length) sql += ' WHERE ' + where.join(' AND ');
      sql += ' ORDER BY analyzed_at DESC LIMIT ? OFFSET ?';
      params.push(limit + 1, offset);
      const raw = await dbQuery(env, sql, params);
      const { rows, has_more } = applyHasMore(raw.results || [], limit);
      return okList(rows, { limit, offset, has_more });
    }
  );

  server.registerTool(
    'get_ai_analysis',
    {
      description: 'Get ai_analysis for a single hand_id.',
      properties: {
        hand_id: { type: 'string' },
        include_raw_response: { type: 'boolean', default: false },
      },
      required: ['hand_id'],
    },
    async (args, env) => {
      const cols = args?.include_raw_response
        ? '*'
        : 'hand_id, llm_provider, play_style, mistakes_found, tags, summary, ev_estimate, analyzed_at';
      const raw = await dbQuery(
        env,
        `SELECT ${cols} FROM ai_analysis WHERE hand_id = ? LIMIT 1`,
        [args.hand_id]
      );
      return okOne((raw.results || [])[0] || null);
    }
  );

  server.registerTool(
    'get_hand_actions',
    {
      description: 'Street-by-street actions for a hand_id.',
      properties: {
        hand_id: { type: 'string' },
      },
      required: ['hand_id'],
    },
    async (args, env) => {
      const raw = await dbQuery(
        env,
        'SELECT id, street, sequence, player, action, amount FROM actions WHERE hand_id = ? ORDER BY sequence ASC',
        [args.hand_id]
      );
      return okList(raw.results || [], {
        limit: null,
        offset: 0,
        has_more: false,
      });
    }
  );

  server.registerTool(
    'list_tournaments',
    {
      description:
        'List tournament_summaries (ROI-oriented). Filters: site, min/max buy_in, limit, offset.',
      properties: {
        site: filterProperties.site,
        min_buy_in: { type: 'number' },
        max_buy_in: { type: 'number' },
        limit: { type: 'number', default: 20, minimum: 1, maximum: 100 },
        offset: { type: 'number', default: 0 },
      },
      required: [],
    },
    async (args, env) => {
      const where = [];
      const params = [];
      if (args?.site) {
        where.push('LOWER(site) = LOWER(?)');
        params.push(args.site);
      }
      if (args?.min_buy_in != null) {
        where.push('buy_in_value >= ?');
        params.push(Number(args.min_buy_in));
      }
      if (args?.max_buy_in != null) {
        where.push('buy_in_value <= ?');
        params.push(Number(args.max_buy_in));
      }
      const limit = clampLimit(args?.limit, 20);
      const offset = clampOffset(args?.offset);
      let sql =
        'SELECT tournament_id, site, buy_in_raw, buy_in_value, rake_value, player_count, finish_position, prize, hero_name, imported_at FROM tournament_summaries';
      if (where.length) sql += ' WHERE ' + where.join(' AND ');
      sql += ' ORDER BY imported_at DESC LIMIT ? OFFSET ?';
      params.push(limit + 1, offset);
      const raw = await dbQuery(env, sql, params);
      const { rows, has_more } = applyHasMore(raw.results || [], limit);
      return okList(rows, { limit, offset, has_more });
    }
  );

  // ========== D1 COACHING READS (parity with deployed worker) ==========
  // These 8 tools existed only on the live worker (added outside version
  // control); ported here so a repo deploy no longer removes them. Names,
  // schemas, and response shapes match the deployed versions exactly.

  // Pragmas that only introspect — never accepted in assignment form.
  const D1_SAFE_PRAGMAS = new Set([
    'table_info',
    'table_xinfo',
    'table_list',
    'index_list',
    'index_info',
    'index_xinfo',
    'foreign_key_list',
    'database_list',
    'collation_list',
    'function_list',
    'pragma_list',
    'compile_options',
    'freelist_count',
    'page_count',
    'user_version',
    'application_id',
  ]);

  server.registerTool(
    'list_full_schemas',
    {
      description:
        'List ALL coaching database schemas (local + cloud): tables, columns, unit rules for cash vs chips, and hero aliases. Call this first for deep coaching.',
      properties: {},
      required: [],
    },
    async (_args, env) => {
      let d1_tables = [];
      let catalog = [];
      try {
        if (env.DB) {
          d1_tables = (await d1All(env, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).map((x) => x.name);
          try {
            catalog = await d1All(env, 'SELECT * FROM schema_catalog ORDER BY table_name');
          } catch (_) {}
        }
      } catch (e) {
        d1_tables = { error: e.message };
      }
      return {
        coaching_schema: COACHING_SCHEMA,
        d1_tables,
        schema_catalog: catalog,
        sources: {
          live_desktop: 'https://db.leaksnipe.win/query (tauri_db_* tools)',
          cloud_d1: 'env.DB leaksnipe-hands (d1_* tools)',
          r2_histories: 'HAND_HISTORY_R2 / R2_POKER_* buckets',
        },
      };
    }
  );

  server.registerTool(
    'd1_list_tables',
    {
      description: 'List tables in Cloudflare D1 (leaksnipe-hands) coaching database.',
      properties: {},
      required: [],
    },
    async (_args, env) => {
      const rows = await d1All(env, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
      return { tables: rows.map((x) => x.name) };
    }
  );

  server.registerTool(
    'd1_describe_table',
    {
      description: 'Describe columns for a D1 table (PRAGMA table_info).',
      properties: { table: { type: 'string', description: 'Table name e.g. hands, ai_analysis, coach_memory' } },
      required: ['table'],
    },
    async (args, env) => {
      const table = String(args.table || '').replace(/[^a-zA-Z0-9_]/g, '');
      if (!table) throw new Error('Invalid table');
      const rows = await d1All(env, `PRAGMA table_info(${table})`);
      return { table, columns: rows };
    }
  );

  server.registerTool(
    'd1_query',
    {
      description:
        'Read-only SELECT against Cloudflare D1 coaching DB. Use for offline coaching when desktop tunnel is down. Never mix cash $ with tournament chips — filter is_tournament.',
      properties: {
        sql: { type: 'string', description: 'SELECT or WITH query only' },
        params: { type: 'array', description: 'Bound parameters', items: {} },
      },
      required: ['sql'],
    },
    async (args, env) => {
      const sql = String(args.sql || '').trim();
      const lower = sql.toLowerCase();
      if (!(lower.startsWith('select') || lower.startsWith('with') || lower.startsWith('pragma'))) {
        throw new Error('Only SELECT/WITH/PRAGMA allowed on D1');
      }
      if (lower.startsWith('pragma')) {
        // PRAGMA is not uniformly read-only: writable_schema, journal_mode,
        // foreign_keys etc. mutate state, and even readable pragmas accept an
        // assignment form (PRAGMA user_version = 5). Allow only whitelisted
        // introspection pragmas in bare or call form.
        const m = lower.match(/^pragma\s+(?:\w+\.)?(\w+)\s*(\(|$)/);
        if (!m || !D1_SAFE_PRAGMAS.has(m[1])) {
          throw new Error(
            `Only read-only introspection pragmas are allowed: ${[...D1_SAFE_PRAGMAS].join(', ')}`
          );
        }
      }
      if (/;/.test(sql.replace(/;+\s*$/, ''))) throw new Error('Multiple statements not allowed');
      const stmt = requireD1(env).prepare(sql);
      const r = await ((args.params || []).length ? stmt.bind(...args.params) : stmt).all();
      return { results: r.results || [], meta: r.meta || null };
    }
  );

  server.registerTool(
    'd1_hero_overview',
    {
      description:
        'Hero coaching snapshot from D1: hand counts, cash $ net vs tournament chip net (separated), by site. Heroes: Gboss101 / jdwalka aliases.',
      properties: {
        hero: { type: 'string', description: 'Hero filter: gboss101, jdwalka, or exact name. Empty = all heroes.' },
      },
      required: [],
    },
    async (args, env) => {
      const hero = (args.hero || '').trim().toLowerCase();
      let nameClause = 'p.is_hero = 1';
      const binds = [];
      if (hero.includes('gboss')) {
        nameClause += " AND lower(p.name) LIKE '%gboss101%'";
      } else if (hero.includes('jdwalk') || hero.includes('johnda')) {
        nameClause += " AND (lower(p.name) LIKE '%jdwalka%' OR lower(p.name) LIKE '%johndawalka%')";
      } else if (hero) {
        nameClause += ' AND lower(p.name) = lower(?)';
        binds.push(hero);
      }
      // EXISTS instead of JOIN: a hand with multiple matching player rows
      // (dual-source imports, duplicated exports) must still count once.
      const sql = `
        SELECT
          CASE WHEN h.is_tournament = 1 THEN 'tournament_chips' ELSE 'cash_usd' END AS unit,
          h.site,
          COUNT(*) AS hands,
          ROUND(SUM(h.hero_won), 2) AS net,
          ROUND(AVG(h.hero_won), 2) AS avg_result,
          MIN(h.date) AS first_hand,
          MAX(h.date) AS last_hand
        FROM hands h
        WHERE EXISTS (SELECT 1 FROM players p WHERE p.hand_id = h.hand_id AND ${nameClause})
        GROUP BY unit, h.site
        ORDER BY unit, hands DESC`;
      const rows = await d1All(env, sql, binds);
      return {
        hero: hero || 'all',
        note: 'cash_usd rows are dollars; tournament_chips rows are chips — never add them together',
        breakdown: rows,
      };
    }
  );

  server.registerTool(
    'd1_list_ai_analyses',
    {
      description: 'List stored AI coach analyses (ai_analysis table) for leak review.',
      properties: {
        limit: { type: 'number', default: 20 },
        has_mistakes: { type: 'boolean', description: 'Only hands with mistakes_found > 0' },
      },
      required: [],
    },
    async (args, env) => {
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
      let sql =
        'SELECT hand_id, llm_provider, play_style, mistakes_found, tags, summary, ev_estimate, analyzed_at FROM ai_analysis';
      if (args.has_mistakes) sql += ' WHERE COALESCE(mistakes_found, 0) > 0';
      sql += ' ORDER BY analyzed_at DESC LIMIT ?';
      const rows = await d1All(env, sql, [limit]);
      return { analyses: rows };
    }
  );

  server.registerTool(
    'd1_coach_memory',
    {
      description: 'Read coach_memory dialogue history for a hero (cross-session coaching context).',
      properties: {
        hero: { type: 'string', description: 'Hero name filter' },
        limit: { type: 'number', default: 20 },
      },
      required: [],
    },
    async (args, env) => {
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
      const hero = (args.hero || '').trim();
      let sql = 'SELECT id, hero, kind, user_text, assistant_text, provider, created_at FROM coach_memory';
      const binds = [];
      if (hero) {
        // Substring LIKE doesn't resolve aliases — "jdwalka" is not a
        // substring of "JohnDaWalka", so filtering by one alias silently
        // missed every row stored under another. Match the full alias group.
        const aliases = expandPlayerAliases(hero);
        sql += ` WHERE lower(hero) IN (${aliases.map(() => 'lower(?)').join(',')})`;
        binds.push(...aliases);
      }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      binds.push(limit);
      try {
        const rows = await d1All(env, sql, binds);
        return { memories: rows };
      } catch (e) {
        return { memories: [], error: e.message, hint: 'Run D1 migration 0002_coaching_tables.sql and re-export coach_memory.db' };
      }
    }
  );

  server.registerTool(
    'd1_database_summary',
    {
      description:
        'High-level D1 counts: hands, players, actions, ai_analysis, coach_memory, cash vs tournament split.',
      properties: {},
      required: [],
    },
    async (_args, env) => {
      const counts = {};
      for (const t of ['hands', 'players', 'actions', 'winners', 'hand_tags', 'player_types', 'ai_analysis', 'coach_memory', 'tournament_summaries']) {
        try {
          const row = await d1First(env, `SELECT COUNT(*) AS c FROM ${t}`);
          counts[t] = row?.c ?? 0;
        } catch {
          counts[t] = null;
        }
      }
      let unit_split = [];
      try {
        unit_split = await d1All(
          env,
          `SELECT is_tournament, site, COUNT(*) AS hands,
          ROUND(SUM(hero_won), 2) AS net
          FROM hands GROUP BY is_tournament, site`
        );
      } catch (_) {}
      return { counts, unit_split, note: 'is_tournament=1 nets are chips; is_tournament=0 nets are USD' };
    }
  );

  // ========== CACHED ANALYTICS (desktop-tunnel-backed, KV-cached hourly) ==========
  // Ported from the live worker (existed outside version control). Two of
  // these 500'd on every call: positionStats/threeBetStats/vpip-by-position
  // referenced `p.position`, but position lives on hands.hero_position, not
  // players — there is no players.position column. Fixed here, plus two bugs
  // that would otherwise still be present after the crash was fixed:
  // `actions.street` is stored capitalized ('Preflop'), so the original
  // lowercase 'preflop' comparison never matched anything (silent 0%, not an
  // error); and 'showdown' is not a street value at all — no hand ever has
  // one — so showdown detection is rewritten using the same convention
  // analysis.py's LeakEngine uses: a non-fold River action for that player.

  server.registerTool(
    'get_player_winrate_cached',
    {
      description: 'Get player win rate with KV caching (last N days). Computed once per hour.',
      properties: {
        playerName: { type: 'string', description: 'Player name to check (exact match)' },
        days: { type: 'number', description: 'Number of days to look back', default: 30 },
      },
      required: ['playerName'],
    },
    async (args, env) => {
      const { playerName, days = 30 } = args;
      return getOrComputeAnalytics(env, `winrate:${playerName}:${days}`, async () => {
        const result = await dbQuery(
          env,
          `SELECT
            SUM(CASE WHEN h.hero_won > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS win_rate,
            COUNT(*) AS hands_played,
            SUM(h.hero_won) AS net_profit,
            AVG(h.hero_won) AS avg_win_per_hand
          FROM hands h
          JOIN players p ON p.hand_id = h.hand_id AND p.is_hero = 1
          WHERE p.name = ? AND h.date >= datetime('now', ?)`,
          [playerName, `-${Number(days) || 30} days`]
        );
        return result.results?.[0] || {};
      });
    }
  );

  server.registerTool(
    'get_player_vpip_pfr_by_position_cached',
    {
      description: 'Get VPIP/PFR by position for a player with KV caching. Computed once per hour.',
      properties: {
        playerName: { type: 'string', description: 'Player name to analyze (exact match)' },
        days: { type: 'number', description: 'Number of days to look back', default: 30 },
      },
      required: ['playerName'],
    },
    async (args, env) => {
      const { playerName, days = 30 } = args;
      return getOrComputeAnalytics(env, `vpip_pfr_position:${playerName}:${days}`, async () => {
        const result = await dbQuery(
          env,
          `SELECT
            h.hero_position AS position,
            COUNT(*) AS hands,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM actions a WHERE a.hand_id = h.hand_id AND a.street = 'Preflop'
                AND a.player = p.name AND a.action IN ('call','bet','raise')
            ) THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS vpip_pct,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM actions a WHERE a.hand_id = h.hand_id AND a.street = 'Preflop'
                AND a.player = p.name AND a.action IN ('bet','raise')
            ) THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS pfr_pct
          FROM hands h
          JOIN players p ON p.hand_id = h.hand_id AND p.is_hero = 1
          WHERE p.name = ? AND h.date >= datetime('now', ?) AND h.hero_position IS NOT NULL
            AND h.hero_position != '' AND h.hero_position != '?'
          GROUP BY h.hero_position
          ORDER BY CASE h.hero_position
            WHEN 'UTG' THEN 1 WHEN 'UTG+1' THEN 2 WHEN 'UTG+2' THEN 3 WHEN 'MP' THEN 4
            WHEN 'HJ' THEN 5 WHEN 'CO' THEN 6 WHEN 'BTN' THEN 7 WHEN 'SB' THEN 8
            WHEN 'BB' THEN 9 ELSE 10 END`,
          [playerName, `-${Number(days) || 30} days`]
        );
        return { position_stats: result.results || [] };
      });
    }
  );

  server.registerTool(
    'get_session_stats_cached',
    {
      description: 'Get session-based statistics (win rate, streaks, best/worst sessions) with KV caching.',
      properties: {
        playerName: { type: 'string', description: 'Player name to analyze (exact match)' },
        days: { type: 'number', description: 'Number of days to look back', default: 30 },
        sessionGapHours: { type: 'number', description: 'Hours between hands to define session break', default: 2 },
      },
      required: ['playerName'],
    },
    async (args, env) => {
      const { playerName, days = 30, sessionGapHours = 2 } = args;
      return getOrComputeAnalytics(env, `session_stats:${playerName}:${days}:${sessionGapHours}`, async () => {
        const handsResult = await dbQuery(
          env,
          `SELECT h.hand_id, h.date, h.hero_won, h.is_tournament
          FROM hands h
          JOIN players p ON p.hand_id = h.hand_id AND p.is_hero = 1 AND p.name = ?
          WHERE h.date >= datetime('now', ?)
          ORDER BY h.date ASC`,
          [playerName, `-${Number(days) || 30} days`]
        );
        const hands = handsResult.results || [];
        if (hands.length === 0) {
          return {
            sessions: [],
            summary: {
              total_sessions: 0, total_hands: 0, total_profit: 0, avg_session_profit: 0,
              best_session: null, worst_session: null, current_streak: 0,
              max_win_streak: 0, max_loss_streak: 0,
            },
          };
        }
        const sessions = [];
        let current = { hands: [hands[0]], startTime: new Date(hands[0].date), endTime: new Date(hands[0].date) };
        const gapMs = (Number(sessionGapHours) || 2) * 60 * 60 * 1000;
        for (let i = 1; i < hands.length; i++) {
          const t = new Date(hands[i].date);
          const prev = new Date(hands[i - 1].date);
          if (t - prev <= gapMs) {
            current.hands.push(hands[i]);
            current.endTime = t;
          } else {
            sessions.push(current);
            current = { hands: [hands[i]], startTime: t, endTime: t };
          }
        }
        sessions.push(current);
        const sessionStats = sessions.map((s) => {
          const n = s.hands.length;
          const profit = s.hands.reduce((sum, h) => sum + h.hero_won, 0);
          const winRate = n > 0 ? (s.hands.filter((h) => h.hero_won > 0).length / n) * 100 : 0;
          return {
            sessionId: s.hands[0].hand_id,
            startTime: s.startTime.toISOString(),
            endTime: s.endTime.toISOString(),
            handCount: n,
            totalProfit: profit,
            winRate: Number(winRate.toFixed(2)),
            avgProfitPerHand: n > 0 ? Number((profit / n).toFixed(2)) : 0,
          };
        });
        const totalHands = hands.length;
        const totalProfit = hands.reduce((sum, h) => sum + h.hero_won, 0);
        const overallWinRate = totalHands > 0 ? (hands.filter((h) => h.hero_won > 0).length / totalHands) * 100 : 0;
        let currentStreak = 0, maxWinStreak = 0, maxLossStreak = 0, winStreak = 0, lossStreak = 0;
        for (const h of hands) {
          if (h.hero_won > 0) { winStreak++; lossStreak = 0; maxWinStreak = Math.max(maxWinStreak, winStreak); }
          else if (h.hero_won < 0) { lossStreak++; winStreak = 0; maxLossStreak = Math.max(maxLossStreak, lossStreak); }
          else { winStreak = 0; lossStreak = 0; }
        }
        const last = hands[hands.length - 1];
        currentStreak = last.hero_won > 0 ? winStreak : last.hero_won < 0 ? -lossStreak : 0;
        const bestSession = sessionStats.length
          ? sessionStats.reduce((a, b) => (a.totalProfit > b.totalProfit ? a : b))
          : null;
        const worstSession = sessionStats.length
          ? sessionStats.reduce((a, b) => (a.totalProfit < b.totalProfit ? a : b))
          : null;
        return {
          sessions: sessionStats,
          summary: {
            total_sessions: sessions.length,
            total_hands: totalHands,
            total_profit_chips: totalProfit,
            avg_session_profit_chips: sessionStats.length
              ? Number((sessionStats.reduce((sum, s) => sum + s.totalProfit, 0) / sessionStats.length).toFixed(2))
              : 0,
            overall_win_rate: Number(overallWinRate.toFixed(2)),
            best_session: bestSession,
            worst_session: worstSession,
            current_streak: currentStreak,
            max_win_streak: maxWinStreak,
            max_loss_streak: maxLossStreak,
            note: 'profit fields are chip/tournament units unless every hand in range is cash — check is_tournament per hand for mixed ranges.',
          },
        };
      });
    }
  );

  server.registerTool(
    'get_leak_report_cached',
    {
      description: 'Get a comprehensive leak report for a player with KV caching. Computed once per hour.',
      properties: {
        playerName: { type: 'string', description: 'Player name to analyze (exact match)' },
        days: { type: 'number', description: 'Number of days to look back', default: 30 },
      },
      required: ['playerName'],
    },
    async (args, env) => {
      const { playerName, days = 30 } = args;
      return getOrComputeAnalytics(env, `leak_report:${playerName}:${days}`, async () => {
        const range = `-${Number(days) || 30} days`;
        const basicStats = await dbQuery(
          env,
          `SELECT COUNT(*) AS total_hands,
            SUM(CASE WHEN h.hero_won > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS overall_winrate,
            AVG(h.hero_won) AS avg_profit_per_hand,
            SUM(h.hero_won) AS total_profit
          FROM hands h
          JOIN players p ON p.hand_id = h.hand_id AND p.is_hero = 1 AND p.name = ?
          WHERE h.date >= datetime('now', ?)`,
          [playerName, range]
        );
        const positionStats = await dbQuery(
          env,
          `SELECT
            h.hero_position AS position,
            COUNT(*) AS hands,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM actions a WHERE a.hand_id = h.hand_id AND a.street = 'Preflop'
                AND a.player = p.name AND a.action IN ('call','bet','raise')
            ) THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS vpip_pct,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM actions a WHERE a.hand_id = h.hand_id AND a.street = 'Preflop'
                AND a.player = p.name AND a.action IN ('bet','raise')
            ) THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS pfr_pct
          FROM hands h
          JOIN players p ON p.hand_id = h.hand_id AND p.is_hero = 1 AND p.name = ?
          WHERE h.date >= datetime('now', ?) AND h.hero_position IS NOT NULL
            AND h.hero_position != '' AND h.hero_position != '?'
          GROUP BY h.hero_position`,
          [playerName, range]
        );
        // times_3bet_or_more counts hands where the PLAYER's own preflop raise
        // was itself a re-raise (a prior preflop raise by anyone already
        // existed at a lower sequence) — a 3-bet, 4-bet, etc. The previous
        // version counted total preflop bet/raise actions by anyone in the
        // hand, which measures "the hand saw multiple raises," not the
        // player's own 3-bet frequency.
        const threeBetStats = await dbQuery(
          env,
          `SELECT
            COUNT(*) AS total_hands_preflop,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM actions a2 WHERE a2.hand_id = h.hand_id AND a2.street = 'Preflop'
                AND a2.player = p.name AND a2.action = 'raise'
                AND EXISTS (
                  SELECT 1 FROM actions a3 WHERE a3.hand_id = a2.hand_id AND a3.street = 'Preflop'
                    AND a3.action = 'raise' AND a3.sequence < a2.sequence
                )
            ) THEN 1 ELSE 0 END) AS times_3bet_or_more
          FROM hands h
          JOIN players p ON p.hand_id = h.hand_id AND p.is_hero = 1 AND p.name = ?
          WHERE h.date >= datetime('now', ?)
            AND EXISTS (SELECT 1 FROM actions a1 WHERE a1.hand_id = h.hand_id AND a1.street = 'Preflop' AND a1.player = p.name)`,
          [playerName, range]
        );
        // "Went to showdown" = a non-fold action on the River — same
        // convention analysis.py's LeakEngine uses (there is no 'showdown'
        // street; that comparison in the original never matched anything).
        const showdownStats = await dbQuery(
          env,
          `SELECT
            COUNT(*) AS hands_showdown,
            SUM(CASE WHEN h.hero_won > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS showdown_winrate
          FROM hands h
          JOIN players p ON p.hand_id = h.hand_id AND p.is_hero = 1 AND p.name = ?
          WHERE h.date >= datetime('now', ?)
            AND EXISTS (
              SELECT 1 FROM actions a WHERE a.hand_id = h.hand_id AND a.street = 'River'
                AND a.player = p.name AND a.action != 'fold'
            )`,
          [playerName, range]
        );

        const basic = basicStats.results?.[0] || {};
        const positions = positionStats.results || [];
        const threeBet = threeBetStats.results?.[0] || {};
        const showdown = showdownStats.results?.[0] || {};
        const leaks = [];
        const RANGES = {
          UTG: [8, 18], 'UTG+1': [8, 18], 'UTG+2': [9, 20], MP: [10, 22], HJ: [11, 24],
          CO: [12, 26], BTN: [15, 30], SB: [12, 28], BB: [10, 25],
        };
        positions.forEach((pos) => {
          const vpip = parseFloat(pos.vpip_pct) || 0;
          const pfr = parseFloat(pos.pfr_pct) || 0;
          const [minVPIP, maxVPIP] = RANGES[pos.position] || [10, 30];
          if (vpip > maxVPIP) {
            leaks.push({ type: 'VPIP_TOO_HIGH', position: pos.position, current: vpip.toFixed(1), recommended: maxVPIP, severity: 'HIGH', description: `Playing too many hands from ${pos.position} (VPIP ${vpip}% > ${maxVPIP}% max)` });
          } else if (vpip < minVPIP) {
            leaks.push({ type: 'VPIP_TOO_LOW', position: pos.position, current: vpip.toFixed(1), recommended: minVPIP, severity: 'MEDIUM', description: `Playing too few hands from ${pos.position} (VPIP ${vpip}% < ${minVPIP}% min)` });
          }
          if (vpip > 0) {
            const aggressionPct = (pfr / vpip) * 100;
            if (aggressionPct < 40) {
              leaks.push({ type: 'NOT_AGGRESSIVE_ENOUGH', position: pos.position, current: aggressionPct.toFixed(1), recommended: '60-80', severity: 'MEDIUM', description: `Not aggressive enough from ${pos.position} (PFR/VPIP ratio ${aggressionPct.toFixed(1)}% < 40%)` });
            } else if (aggressionPct > 90) {
              leaks.push({ type: 'TOO_AGGRESSIVE', position: pos.position, current: aggressionPct.toFixed(1), recommended: '60-80', severity: 'LOW', description: `Possibly too aggressive from ${pos.position} (PFR/VPIP ratio ${aggressionPct.toFixed(1)}% > 90%)` });
            }
          }
        });
        const totalHandsPreflop = parseFloat(threeBet.total_hands_preflop) || 0;
        const times3bet = parseFloat(threeBet.times_3bet_or_more) || 0;
        const threeBetPct = totalHandsPreflop > 0 ? (times3bet / totalHandsPreflop) * 100 : 0;
        if (threeBetPct < 3) {
          leaks.push({ type: 'THREE_BET_TOO_LOW', current: threeBetPct.toFixed(2), recommended: '3-8', severity: 'MEDIUM', description: `3-bet frequency too low (${threeBetPct.toFixed(2)}% < 3%)` });
        } else if (threeBetPct > 10) {
          leaks.push({ type: 'THREE_BET_TOO_HIGH', current: threeBetPct.toFixed(2), recommended: '3-8', severity: 'LOW', description: `3-bet frequency possibly too high (${threeBetPct.toFixed(2)}% > 10%)` });
        }
        const showdownWinrate = parseFloat(showdown.showdown_winrate) || 0;
        const handsShowdown = parseFloat(showdown.hands_showdown) || 0;
        if (handsShowdown >= 20) {
          if (showdownWinrate < 45) {
            leaks.push({ type: 'SHOWDOWN_WINRATE_TOO_LOW', current: showdownWinrate.toFixed(1), recommended: '45-55', severity: 'HIGH', description: `Showdown win rate too low (${showdownWinrate.toFixed(1)}% < 45%)` });
          } else if (showdownWinrate > 55) {
            leaks.push({ type: 'SHOWDOWN_WINRATE_TOO_HIGH', current: showdownWinrate.toFixed(1), recommended: '45-55', severity: 'LOW', description: `Showdown win rate suspiciously high (${showdownWinrate.toFixed(1)}% > 55%) - might be running hot` });
          }
        }
        return {
          basic_stats: basic,
          position_stats: positions,
          three_bet_pct: Number(threeBetPct.toFixed(2)),
          showdown_stats: showdown,
          leaks,
          note: 'total_profit/avg_profit_per_hand are chip/tournament units unless every hand in range is cash.',
        };
      });
    }
  );

  // ========== AI MEMORY (cloud D1: leaksnipe-hands) ==========
  // Structured, schema-validated writes to the annotation tables only
  // (ai_analysis, coach_memory, hand_tags). Raw SQL writes stay admin-gated.
  // These land in the cloud D1 copy — the desktop tunnel stays read-only.

  async function d1HandExists(env, hand_id) {
    const rows = await d1All(env, 'SELECT 1 FROM hands WHERE hand_id = ? LIMIT 1', [hand_id]);
    return rows.length > 0;
  }

  server.registerTool(
    'save_ai_analysis',
    {
      description:
        'Persist (upsert) an AI hand review into ai_analysis, keyed by hand_id. ' +
        'Use after analyzing a hand so the review survives the conversation. ' +
        'Overwrites any prior analysis for the same hand_id.',
      properties: {
        hand_id: { type: 'string', description: 'Hand id (e.g. ACR_2760551680)' },
        summary: { type: 'string', description: 'Concise review: key decision points and verdicts' },
        play_style: { type: 'string', description: 'Observed style label (e.g. overly-passive, spewy-3bet)' },
        mistakes_found: { type: 'number', description: 'Count of mistakes identified (0 = clean hand)' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Leak/theme tags (also mirrored into hand_tags for filtering)',
        },
        ev_estimate: { type: 'number', description: 'Estimated EV lost/gained in chips (computed, not guessed)' },
        raw_response: { type: 'string', description: 'Full analysis text (optional, can be large)' },
        llm_provider: { type: 'string', description: 'Provider label for provenance', default: 'mcp' },
        require_hand: {
          type: 'boolean',
          description: 'Reject if hand_id is not in the cloud hands table (default true)',
          default: true,
        },
      },
      required: ['hand_id', 'summary'],
    },
    async (args, env) => {
      const hand_id = String(args.hand_id || '').trim();
      if (!hand_id) throw new Error('hand_id is required');
      if (args.require_hand !== false && !(await d1HandExists(env, hand_id))) {
        throw new Error(
          `Unknown hand_id ${hand_id} in cloud DB. Check the id, or pass require_hand=false to store anyway.`
        );
      }
      const tags = Array.isArray(args.tags) ? args.tags.map(String).filter(Boolean).slice(0, 20) : [];
      const row = {
        llm_provider: String(args.llm_provider || 'mcp'),
        play_style: args.play_style != null ? String(args.play_style) : null,
        mistakes_found: args.mistakes_found != null ? Number(args.mistakes_found) : null,
        tags: tags.length ? tags.join(',') : null,
        summary: String(args.summary),
        ev_estimate: args.ev_estimate != null ? Number(args.ev_estimate) : null,
        raw_response: args.raw_response != null ? String(args.raw_response) : null,
      };
      // update-then-insert: works whether or not hand_id has a UNIQUE constraint
      const upd = await d1Run(
        env,
        `UPDATE ai_analysis SET llm_provider=?, play_style=?, mistakes_found=?, tags=?, summary=?, ev_estimate=?, raw_response=?, analyzed_at=datetime('now') WHERE hand_id=?`,
        [row.llm_provider, row.play_style, row.mistakes_found, row.tags, row.summary, row.ev_estimate, row.raw_response, hand_id]
      );
      let mode = 'updated';
      if (!upd.meta || !upd.meta.changes) {
        await d1Run(
          env,
          `INSERT INTO ai_analysis (hand_id, llm_provider, play_style, mistakes_found, tags, summary, ev_estimate, raw_response, analyzed_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))`,
          [hand_id, row.llm_provider, row.play_style, row.mistakes_found, row.tags, row.summary, row.ev_estimate, row.raw_response]
        );
        mode = 'inserted';
      }
      // mirror tags into hand_tags so query_hands tag filters find this hand
      for (const tag of tags) {
        await d1Run(
          env,
          `INSERT INTO hand_tags (hand_id, tag, created_at) SELECT ?, ?, datetime('now') WHERE NOT EXISTS (SELECT 1 FROM hand_tags WHERE hand_id=? AND LOWER(tag)=LOWER(?))`,
          [hand_id, tag, hand_id, tag]
        );
      }
      return { success: true, mode, hand_id, tags_mirrored: tags.length };
    }
  );

  server.registerTool(
    'save_coach_memory',
    {
      description:
        'Append a durable coaching memory (cross-session). Use for leak findings, adjustments, ' +
        'session takeaways, or villain reads you want remembered next time. ' +
        'Pair with get_coach_memory to recall.',
      properties: {
        hero: { type: 'string', description: 'Hero this memory belongs to (jdwalka or Gboss101; aliases resolve)' },
        kind: {
          type: 'string',
          description: 'Memory type: note | leak | adjustment | session_review | hand_review | villain_read',
          default: 'note',
        },
        user_text: { type: 'string', description: 'What the user said/asked (context for the memory)' },
        assistant_text: { type: 'string', description: 'The finding/advice to remember' },
        provider: { type: 'string', description: 'Provenance label', default: 'mcp' },
      },
      required: ['hero', 'assistant_text'],
    },
    async (args, env) => {
      const hero = String(args.hero || '').trim();
      if (!hero) throw new Error('hero is required');
      const res = await d1Run(
        env,
        `INSERT INTO coach_memory (hero, kind, user_text, assistant_text, provider, created_at) VALUES (?,?,?,?,?,datetime('now'))`,
        [
          hero,
          String(args.kind || 'note'),
          args.user_text != null ? String(args.user_text) : null,
          String(args.assistant_text),
          String(args.provider || 'mcp'),
        ]
      );
      return { success: true, id: res.meta?.last_row_id ?? null, hero, kind: String(args.kind || 'note') };
    }
  );

  server.registerTool(
    'get_coach_memory',
    {
      description:
        'Recall stored coaching memories. Filters: hero (aliases resolve), kind, search text. ' +
        'Newest first. Use at the start of a coaching conversation to load context.',
      properties: {
        hero: { type: 'string', description: 'Hero filter (jdwalka/JohnDaWalka/Gboss101 all match their group)' },
        kind: { type: 'string', description: 'Memory type filter (note, leak, adjustment, …)' },
        search: { type: 'string', description: 'Substring match over user_text and assistant_text' },
        limit: { type: 'number', default: 20, minimum: 1, maximum: 100 },
        offset: { type: 'number', default: 0 },
      },
      required: [],
    },
    async (args, env) => {
      const where = [];
      const params = [];
      if (args?.hero) {
        const aliases = expandPlayerAliases(args.hero).map((a) => a.toLowerCase());
        where.push(`LOWER(hero) IN (${aliases.map(() => '?').join(',')})`);
        params.push(...aliases);
      }
      if (args?.kind) {
        where.push('LOWER(kind) = LOWER(?)');
        params.push(args.kind);
      }
      if (args?.search) {
        where.push('(user_text LIKE ? OR assistant_text LIKE ?)');
        const term = '%' + String(args.search) + '%';
        params.push(term, term);
      }
      const limit = clampLimit(args?.limit, 20);
      const offset = clampOffset(args?.offset);
      let sql = 'SELECT id, hero, kind, user_text, assistant_text, provider, created_at FROM coach_memory';
      if (where.length) sql += ' WHERE ' + where.join(' AND ');
      sql += ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?';
      params.push(limit + 1, offset);
      const rowsAll = await d1All(env, sql, params);
      const { rows, has_more } = applyHasMore(rowsAll, limit);
      return okList(rows, { limit, offset, has_more });
    }
  );

  server.registerTool(
    'add_hand_tag',
    {
      description: 'Tag a hand (e.g. "missed-value", "hero-call", "review-later"). Idempotent.',
      properties: {
        hand_id: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, description: 'One or more tags to add' },
        tag: { type: 'string', description: 'Single tag (alias for tags)' },
      },
      required: ['hand_id'],
    },
    async (args, env) => {
      const hand_id = String(args.hand_id || '').trim();
      if (!hand_id) throw new Error('hand_id is required');
      const tags = [
        ...(Array.isArray(args.tags) ? args.tags : []),
        ...(args.tag ? [args.tag] : []),
      ].map(String).filter(Boolean).slice(0, 20);
      if (!tags.length) throw new Error('Provide tag or tags');
      if (!(await d1HandExists(env, hand_id))) {
        throw new Error(`Unknown hand_id ${hand_id} in cloud DB`);
      }
      let added = 0;
      for (const tag of tags) {
        const res = await d1Run(
          env,
          `INSERT INTO hand_tags (hand_id, tag, created_at) SELECT ?, ?, datetime('now') WHERE NOT EXISTS (SELECT 1 FROM hand_tags WHERE hand_id=? AND LOWER(tag)=LOWER(?))`,
          [hand_id, tag, hand_id, tag]
        );
        if (res.meta?.changes) added++;
      }
      return { success: true, hand_id, added, already_present: tags.length - added };
    }
  );

  server.registerTool(
    'remove_hand_tag',
    {
      description: 'Remove a tag from a hand (case-insensitive).',
      properties: {
        hand_id: { type: 'string' },
        tag: { type: 'string' },
      },
      required: ['hand_id', 'tag'],
    },
    async (args, env) => {
      const res = await d1Run(env, 'DELETE FROM hand_tags WHERE hand_id = ? AND LOWER(tag) = LOWER(?)', [
        String(args.hand_id),
        String(args.tag),
      ]);
      return { success: true, removed: res.meta?.changes ?? 0 };
    }
  );

  // ========== DB ESCAPE HATCHES ==========

  server.registerTool(
    'tauri_db_query',
    {
      description:
        'Run SQL against the Tauri SQLite DB via HTTP proxy. READ-ONLY by default (SELECT/WITH/PRAGMA/EXPLAIN). ' +
        'Writes require allow_write=true and admin_key matching BACKFILL_ADMIN_KEY. Auto LIMIT if missing.',
      properties: {
        sql: { type: 'string', description: 'SQL query string' },
        params: {
          type: 'array',
          description: 'Bound parameters (string|number|null)',
          items: {},
        },
        allow_write: {
          type: 'boolean',
          description: 'Allow non-SELECT statements (requires admin_key)',
          default: false,
        },
        admin_key: {
          type: 'string',
          description: 'Required when allow_write=true',
        },
        max_rows: {
          type: 'number',
          description: `Max rows for SELECT when no LIMIT present (default ${DEFAULT_SQL_MAX_ROWS}, max 1000)`,
          default: DEFAULT_SQL_MAX_ROWS,
        },
      },
      required: ['sql'],
    },
    async (args, env) => {
      const allow_write = Boolean(args?.allow_write);
      if (allow_write) {
        if (!env.BACKFILL_ADMIN_KEY || args.admin_key !== env.BACKFILL_ADMIN_KEY) {
          throw new Error('Unauthorized - admin_key required for allow_write');
        }
      }
      let sql = assertSafeSql(args.sql, { allow_write });
      const isRead = /^(select|with|pragma|explain)/i.test(sql.trim());
      let maxRows = args?.max_rows;
      if (isRead) {
        const lim = ensureLimit(sql, maxRows);
        sql = lim.sql;
        maxRows = lim.maxRows;
      }
      const raw = await dbQuery(env, sql, args.params || []);
      return {
        success: true,
        ...raw,
        max_rows: isRead ? maxRows : null,
        read_only: !allow_write,
      };
    }
  );

  server.registerTool(
    'tauri_db_tables',
    {
      description: 'List all tables in the Tauri SQLite database',
      properties: {},
      required: [],
    },
    async (_args, env) => {
      const raw = await dbQuery(
        env,
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      );
      return okList(raw.results || [], { limit: null, offset: 0, has_more: false });
    }
  );

  server.registerTool(
    'tauri_db_schema',
    {
      description: 'Get schema for a specific table',
      properties: { table: { type: 'string', description: 'Table name' } },
      required: ['table'],
    },
    async (args, env) => {
      const table = String(args.table || '').replace(/[^a-zA-Z0-9_]/g, '');
      if (!table) throw new Error('Invalid table name');
      const raw = await dbQuery(env, `PRAGMA table_info(${table})`);
      return okList(raw.results || [], { limit: null, offset: 0, has_more: false });
    }
  );

  server.registerTool(
    'tauri_db_raw',
    {
      description: 'Send raw HTTP request to Tauri DB endpoint (flexible admin escape hatch)',
      properties: {
        path: { type: 'string', default: '/' },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          default: 'GET',
        },
        body: { type: 'object' },
      },
      required: [],
    },
    async (args, env) => {
      const path = args?.path || '/';
      const method = (args?.method || 'GET').toUpperCase();
      const allowed = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
      if (!allowed.includes(method)) throw new Error('Invalid method');
      const opts = { method, headers: dbProxyHeaders(env) };
      if (args?.body && method !== 'GET') opts.body = JSON.stringify(args.body);
      const resp = await fetch('https://db.leaksnipe.win' + path, opts);
      const text = await resp.text();
      try {
        return { success: true, status: resp.status, data: JSON.parse(text) };
      } catch {
        return { success: true, status: resp.status, text };
      }
    }
  );

  // ========== KV / R2 STORAGE ==========

  server.registerTool(
    'list_hand_histories',
    {
      description: 'List hand history metadata from KV (meta: prefix).',
      properties: {
        limit: { type: 'number', description: 'Max results (default 50, max 100)', default: 50 },
        prefix: { type: 'string', description: 'KV key prefix (default meta:)' },
        cursor: { type: 'string', description: 'Pagination cursor from previous call' },
      },
      required: [],
    },
    async (args, env) => {
      const limit = clampLimit(args?.limit, 50);
      const prefix = args?.prefix || 'meta:';
      const list = await env.HAND_HISTORY_KV.list({
        prefix,
        limit,
        cursor: args?.cursor || undefined,
      });
      const results = list.keys.map((k) => {
        const meta = k.metadata || {};
        return {
          id: meta.source_key || k.name.replace(/^meta:([^:]+:)?/, ''),
          kv_key: k.name,
          bucket: meta.bucket || null,
          ...meta,
        };
      });
      return {
        success: true,
        count: results.length,
        results,
        histories: results, // backward compat
        cursor: list.list_complete ? null : list.cursor,
        has_more: !list.list_complete,
      };
    }
  );

  server.registerTool(
    'get_hand_history',
    {
      description: 'Get a hand history JSON blob by id from KV (hh: prefix).',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async (args, env) => {
      const data = await env.HAND_HISTORY_KV.get('hh:' + args.id);
      if (!data) throw new Error('Hand history not found: ' + args.id);
      return { success: true, id: args.id, data: JSON.parse(data) };
    }
  );

  server.registerTool(
    'search_by_player',
    {
      description: 'Search KV hand-history metadata by player name (case-sensitive match on stored names).',
      properties: {
        player: { type: 'string' },
        limit: { type: 'number', default: 50, minimum: 1, maximum: 100 },
      },
      required: ['player'],
    },
    async (args, env) => {
      const player = args.player;
      const limit = clampLimit(args?.limit, 50);
      const list = await env.HAND_HISTORY_KV.list({ prefix: 'meta:' });
      const matches = [];
      for (const key of list.keys) {
        const meta = key.metadata;
        if (meta && Array.isArray(meta.players) && meta.players.includes(player)) {
          matches.push({
            id: meta.source_key || key.name.replace(/^meta:([^:]+:)?/, ''),
            bucket: meta.bucket || null,
            ...meta,
          });
          if (matches.length >= limit) break;
        }
      }
      return {
        success: true,
        player,
        count: matches.length,
        results: matches,
        histories: matches,
      };
    }
  );

  server.registerTool(
    'upload_hand_history_meta',
    {
      description:
        'Register hand history metadata in KV. Schema aligned with list_hand_histories output.',
      properties: {
        id: { type: 'string', description: 'Source key / id' },
        site: { type: 'string', description: `Common: ${SITES.join(', ')}` },
        game_type: { type: 'string', description: `Common: ${GAME_TYPES.join(', ')}` },
        stakes: { type: 'string' },
        date: { type: 'string', description: 'ISO timestamp' },
        players: { type: 'array', items: { type: 'string' } },
        is_tournament: { type: 'boolean' },
        tournament_id: { type: 'string' },
        hero: { type: 'string' },
        hero_position: { type: 'string', enum: POSITIONS },
        hero_won: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['id'],
    },
    async (args, env) => {
      const meta = validateHandMeta(args);
      const kvKey = 'meta:' + args.id;
      await env.HAND_HISTORY_KV.put(kvKey, JSON.stringify(meta), { metadata: meta });
      return { success: true, id: args.id, meta };
    }
  );

  server.registerTool(
    'store_hand_history',
    {
      description:
        'Store full hand history JSON in KV (hh:{id}). data must be an object; known fields preferred.',
      properties: {
        id: { type: 'string' },
        data: {
          type: 'object',
          description:
            'Hand object. Known keys: hand_id, site, date, game_type, is_tournament, tournament_id, buy_in, table_name, max_seats, hero_cards, board_cards, pot, rake, hero_won, hero_position, raw_text, players, actions/streets, winners',
        },
      },
      required: ['id', 'data'],
    },
    async (args, env) => {
      const { data, unknown_keys, schema_version } = validateHandData(args.data);
      await env.HAND_HISTORY_KV.put('hh:' + args.id, JSON.stringify(data));
      return {
        success: true,
        id: args.id,
        size: JSON.stringify(data).length,
        schema_version,
        unknown_keys,
      };
    }
  );

  server.registerTool(
    'get_large_hand_history',
    {
      description: 'Get large hand history file from R2 (tries all known buckets).',
      properties: {
        key: { type: 'string' },
        max_chars: {
          type: 'number',
          description: 'Truncate content to this many characters (default 5000)',
          default: 5000,
        },
      },
      required: ['key'],
    },
    async (args, env) => {
      const key = args.key;
      const maxChars = Math.min(Math.max(Number(args.max_chars) || 5000, 100), 100000);
      for (const bucketCfg of HAND_HISTORY_BUCKETS) {
        const r2 = env[bucketCfg.binding];
        if (!r2) continue;
        const obj = await r2.get(key);
        if (obj) {
          const text = await obj.text();
          return {
            success: true,
            key,
            bucket: bucketCfg.alias,
            size: obj.size,
            truncated: text.length > maxChars,
            content: text.substring(0, maxChars) + (text.length > maxChars ? '... [truncated]' : ''),
          };
        }
      }
      throw new Error('Object not found in any bucket: ' + key);
    }
  );

  server.registerTool(
    'store_large_hand_history',
    {
      description: 'Store large hand history file in primary R2 bucket (leaksnipe-hand-histories).',
      properties: {
        key: { type: 'string' },
        data: { type: 'string' },
      },
      required: ['key', 'data'],
    },
    async (args, env) => {
      await env.HAND_HISTORY_R2.put(args.key, args.data);
      return { success: true, key: args.key, size: args.data.length };
    }
  );

  server.registerTool(
    'backfill_kv_from_r2',
    {
      description:
        'ADMIN: index R2 hand-history objects into HAND_HISTORY_KV meta: namespace. ' +
        'Paginated — call repeatedly with next_cursors until done=true. Idempotent.',
      properties: {
        admin_key: { type: 'string', description: 'Must match BACKFILL_ADMIN_KEY env var' },
        cursors: {
          type: 'object',
          description: 'Per-bucket cursor object from a previous call',
        },
        batch: {
          type: 'number',
          description: 'Objects per bucket per call (default 25)',
        },
      },
      required: ['admin_key'],
    },
    async (args, env) => {
      const { admin_key, cursors = {} } = args || {};
      if (!env.BACKFILL_ADMIN_KEY || admin_key !== env.BACKFILL_ADMIN_KEY) {
        throw new Error('Unauthorized - admin_key does not match BACKFILL_ADMIN_KEY');
      }
      const results = {};
      let anyRemaining = false;
      const batch = args.batch;
      for (const bucketCfg of HAND_HISTORY_BUCKETS) {
        if (cursors[bucketCfg.alias] === 'DONE') {
          results[bucketCfg.alias] = { processed: 0, skipped: 0, cursor: null, done: true };
          continue;
        }
        const res = await backfillBucket(env, bucketCfg, cursors[bucketCfg.alias], batch);
        results[bucketCfg.alias] = res;
        if (!res.done) anyRemaining = true;
      }
      return {
        success: true,
        done: !anyRemaining,
        results,
        next_cursors: Object.fromEntries(
          Object.entries(results).map(([alias, r]) => [alias, r.done ? 'DONE' : r.cursor])
        ),
      };
    }
  );

  // ========== ADMIN LOCAL PROXIES ==========

  server.registerTool(
    'run_network_command',
    {
      description:
        'ADMIN: run network diagnostics on the local machine via tunnel (ipconfig, ping, tracert, nslookup, netstat, arp, route, getmac).',
      properties: {
        command: {
          type: 'string',
          enum: ['ipconfig', 'ping', 'tracert', 'nslookup', 'netstat', 'arp', 'route', 'getmac'],
          description: 'Network tool to run',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments to pass',
        },
      },
      required: ['command'],
    },
    async (args, env) => proxyLocalMcp(env, 'run_network_command', args)
  );

  server.registerTool(
    'run_cloudflare_command',
    {
      description:
        'ADMIN: run wrangler or cloudflared on the local machine via tunnel.',
      properties: {
        command: {
          type: 'string',
          enum: ['wrangler', 'cloudflared'],
          description: 'CLI to run',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'CLI arguments',
        },
        sub_project: {
          type: 'string',
          enum: ['root', 'mcp-server', 'cloudflare-api', 'poker-daemon-worker'],
          default: 'root',
          description: 'Working directory context',
        },
      },
      required: ['command', 'args'],
    },
    async (args, env) => proxyLocalMcp(env, 'run_cloudflare_command', args)
  );
}

// ---------- helpers local to this module ----------

function pickSubset(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k]) out[k] = obj[k];
  return out;
}

async function getPlayerProfile(env, args = {}) {
  const player = args.player;
  if (!player) throw new Error('player is required');
  const resolve = args.resolve_aliases !== false;
  const names = resolve ? expandPlayerAliases(player) : [player];

  // try each alias against player_types
  let player_row = null;
  let matched_name = player;
  for (const name of names) {
    const career = await dbQuery(
      env,
      'SELECT name, site, auto_type, manual_type, hands, vpip, pfr, af, fold_cbet, wtsd, three_bet, updated_at FROM player_types WHERE lower(name) = lower(?)',
      [name]
    );
    if ((career.results || [])[0]) {
      player_row = career.results[0];
      matched_name = player_row.name;
      break;
    }
  }

  // positional facts across all aliases
  const placeholders = names.map(() => 'lower(?)').join(',');
  const positions = await dbQuery(
    env,
    `SELECT position, COUNT(*) AS hands, SUM(vpip) AS vpip_hands, SUM(pfr) AS pfr_hands
     FROM player_position_facts
     WHERE lower(player) IN (${placeholders})
     GROUP BY position`,
    names
  );
  const by_position = (positions.results || []).map((row) => ({
    position: row.position,
    hands: row.hands,
    vpip: row.hands ? Number(((100 * row.vpip_hands) / row.hands).toFixed(1)) : 0,
    pfr: row.hands ? Number(((100 * row.pfr_hands) / row.hands).toFixed(1)) : 0,
  }));

  if (!player_row && by_position.length === 0) {
    // last resort: any appearance in players table
    const seen = await dbQuery(
      env,
      `SELECT name, COUNT(DISTINCT hand_id) AS hands FROM players WHERE lower(name) IN (${placeholders}) GROUP BY name`,
      names
    );
    if (!(seen.results || []).length) {
      return { success: true, player, found: false, aliases_tried: names };
    }
    return {
      success: true,
      player,
      found: true,
      partial: true,
      aliases_tried: names,
      appearances: seen.results,
      by_position: [],
      note: 'No player_types row; returned table appearances only.',
    };
  }

  return {
    success: true,
    player: matched_name,
    found: true,
    aliases_tried: names,
    ...(player_row || {}),
    by_position,
  };
}
