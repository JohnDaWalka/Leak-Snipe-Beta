# LeakSnipe MCP connector v2

Version **2.0.0** of the Cloudflare worker (`mcp.leaksnipe.win`) plus aligned local Python servers.

## Goals

1. **Shared filters** on hand/stats tools (`site`, `game_type`, `is_tournament`, `position`, `hero_cards`, `tags`, `player`, date range, profit, pagination).
2. **Response shaping** — default `format=summary` omits `raw_text` / `source_file` to save agent context.
3. **Stable envelope** — `{ success, count, results, limit, offset, has_more }`.
4. **New first-class tools** for tags, AI analysis, tournaments, actions, player profile.
5. **Write-path schemas** for KV meta + hand JSON.
6. **SQL safety** — read-only by default; writes need `allow_write` + `admin_key`.
7. **Hero alias resolution** (`jdwalka` ↔ `JohnDaWalka`).
8. **Fixed `get_sessions_winrate`** — computed in the worker (no broken local `/mcp` proxy).

## New / upgraded tools

| Tool | Notes |
|------|--------|
| `query_hands` | Unified filtered search |
| `get_hand` | Detail with `include_raw/actions/players/analysis/tags` |
| `get_stats` | `group_by`: position \| site \| day \| session |
| `get_player_profile` | HUD + aliases + optional recent hands |
| `list_player_types` | `player_types` table |
| `list_tags` / `get_hands_by_tag` | `hand_tags` |
| `list_leaks` / `get_ai_analysis` | `ai_analysis` |
| `get_hand_actions` | `actions` |
| `list_tournaments` | `tournament_summaries` |

Legacy tools (`get_recent_hands`, `search_hands`, …) keep their names but share filters, summary default, and pagination.

## Shared filter properties

```
site, game_type, is_tournament, position, hero_cards, tags, player,
date_from, date_to, min_profit, max_profit, tournament_id, min_pot, won,
limit (1–100, default 10), offset, order_by, order, format, include_raw
```

Enums where applicable: positions `EP|MP|CO|BTN|SB|BB|UTG|HJ`, sites `CoinPoker|BetACR`.

## SQL tool

`tauri_db_query`:

- Default: `SELECT` / `WITH` / `PRAGMA` / `EXPLAIN` only
- Auto-appends `LIMIT` (default 200, max 1000) when missing
- Writes: `allow_write=true` + `admin_key` matching `BACKFILL_ADMIN_KEY`
- Multi-statement SQL rejected

## Deploy

```bash
cd mcp-server
npx wrangler deploy
```

Worker name: `leaksnipe` (see `wrangler.toml`).

## Files

- `src/lib/core.js` — filters, shaping, SQL safety, sessions, meta validation
- `src/lib/register-tools.js` — all tool registrations
- `src/mcp-worker.js` — HTTP/JSON-RPC shell + landing page + tool wiring
- `../mcp_server.py` / `../mcp_grok_server.py` — local parity (summary default + new tools)
