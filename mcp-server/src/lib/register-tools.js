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
      const sql = `
        SELECT
          h.hero_position AS position,
          COUNT(*) AS total_hands,
          SUM(CASE WHEN h.hero_won > 0 THEN 1 ELSE 0 END) AS hands_won,
          SUM(h.hero_won) AS total_profit
        FROM hands h
        WHERE ${where.join(' AND ')}
        GROUP BY h.hero_position
        ORDER BY total_profit DESC
      `;
      const raw = await dbQuery(env, sql, params);
      return okStats(raw.results || [], {
        note: 'total_profit is in site/tournament chip units, not always USD.',
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
