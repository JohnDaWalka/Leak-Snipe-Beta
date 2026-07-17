# Handoff: fix phone connector data access

Two problems found while testing the `leaksnipe` MCP connector (the one the
Claude iPhone app uses):

1. **KV metadata index is empty.** The 12,000+ hand JSON objects (~0.6 GB)
   already exist in R2 across three buckets (`leaksnipe-hand-histories`,
   `poker-hand-histories`, `poker-hands`), but nothing ever populated the
   `leaksnipe-hand-histories` KV namespace's `meta:*` keys, which is what
   `list_hand_histories` / `search_by_player` actually read. R2 has the data;
   there's no index over it yet.
2. **`tauri_db_*` tools 530.** They proxy to `https://db.leaksnipe.win/query`,
   which doesn't resolve to anything yet — needs a Cloudflare Tunnel to the
   desktop machine, plus an actual endpoint on the other end (now built, see
   below).

## What's in this folder

- `leaksnipe-worker-updated.js` — full drop-in replacement for the deployed
  `leaksnipe` worker source. Diff summary is in the file's header comment;
  short version: fixes `get_large_hand_history` to check all three buckets,
  fixes `list_hand_histories`/`search_by_player` to return a usable `id`, and
  adds a new paginated `backfill_kv_from_r2` admin tool to build the missing
  index.

## What Cloudflare AI needs to do

1. **Deploy** `leaksnipe-worker-updated.js` as the new source for the
   `leaksnipe` worker (id `11e58a54203a4762a20c764559e2e6a0`).
2. **Add two R2 bindings** (KV binding and the first R2 binding already
   exist, leave them):
   - `R2_POKER_HH` → bucket `poker-hand-histories`
   - `R2_POKER_HANDS` → bucket `poker-hands`
3. **Add two environment variables/secrets:**
   - `DB_PROXY_KEY` = `aeead0ced9cd01afc7e2fdccc8b1c8c010506e1d85e1ed16d3dba10a1aea1757`
     (must match `LEAKSNIPE_DB_PROXY_KEY` in the desktop app's `.env` — already
     set there)
   - `BACKFILL_ADMIN_KEY` = `80c4573d2da46cb2090cf4b6ff83f2e462472548bf16aec75ae0d472382472bc`
     (only used to gate the one-time backfill call)
4. **Set up a Cloudflare Tunnel** from `db.leaksnipe.win` to the desktop
   machine's `127.0.0.1:8765` (the sidecar's default port —
   `LEAKSNIPE_API_PORT` env var if it's been changed). The sidecar already
   exposes `POST /query` for this, gated by the `DB_PROXY_KEY` bearer token
   above, read-only (SELECT / PRAGMA table_info only).
5. **Run the backfill once**, after deploy — call the new
   `backfill_kv_from_r2` tool over `/mcp` repeatedly (feeding back
   `next_cursors` each time) until it returns `done: true`. Full call shape
   is documented in the worker file's header comment. It's idempotent, so if
   it's interrupted just call it again.

## What's already done (desktop side, no action needed here)

- `sidecar/server.py` now has `POST /query` — bearer-token gated, read-only
  (SELECT / PRAGMA table_info only), runs against the live `poker_hands.db`.
- `LEAKSNIPE_DB_PROXY_KEY` is already set in `.env`.
- The desktop app needs a restart to pick up the new endpoint, but no other
  local changes are required.
