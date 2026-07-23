# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

LeakSnipe is a local-first poker study workstation: it imports poker hand histories into a local SQLite database, exposes them through a FastAPI sidecar, and presents them in a React/Tauri desktop app. It also ships an original CustomTkinter app (`poker_gui.py`) that remains the production live-table HUD, plus several Cloudflare Workers / MCP servers that expose hand data to remote AI agents (Claude, ChatGPT, Grok).

The canonical stack, in one line: **hand-history files → Python parser/importer → `poker_hands.db` (SQLite) → FastAPI sidecar (`sidecar/server.py`, port 8765) → React/Tauri v2 UI (`leaksnipe-ui/`)**, with `poker_gui.py --live-hud` running independently as the Windows overlay.

```
C:\ACR Poker\handHistory\<user>\*.txt  ─┐
CoinPoker hand history *.txt           ─┤─► HandParser (parsers.py) ─► HandImporter (importing.py) ─► poker_hands.db
```

Development currently happens on Windows (the app targets Windows-first: pywin32 live HUD, PowerShell scripts, `.bat` launchers), but the Python/React/Rust code itself is cross-platform-buildable.

## Repository layout — what's canonical vs. legacy

This repo accumulated several generations of the same idea. **Do not casually "clean up" or delete the legacy pieces** — they're kept intentionally (see AGENTS.md) — but don't build new features on them either.

| Path | Status |
|---|---|
| `leaksnipe-ui/` | **Canonical.** React 19 + Tauri v2 desktop app — the primary UI. |
| `sidecar/server.py` | **Canonical.** FastAPI service the UI talks to (port 8765). |
| Root Python engine (`models.py`, `parsers.py`, `importing.py`, `analysis.py`, `equity.py`, `pot_odds.py`, `ai_processor.py`, `config.py`, `db_migrations.py`, `theory/`) | **Canonical.** Shared by the sidecar, `poker_gui.py`, and the MCP servers. |
| `poker_gui.py` | **Canonical fallback + primary live HUD.** CustomTkinter desktop app; `--live-hud` flag is the real production overlay (the Tauri overlay in `leaksnipe-ui` is experimental). Never delete this or break it while refactoring shared modules. |
| `mcp-server/` (Cloudflare Worker, `mcp.leaksnipe.win`) | **Canonical remote MCP connector v2** used by the Claude phone/desktop app and other agents. |
| `cloudflare-api/` | **Canonical.** Read-only Worker exposing D1 + R2 hand data for ChatGPT Actions. |
| `mcp_server.py`, `mcp_grok_server.py` | Local stdio/HTTP MCP servers (parity with the Cloudflare worker) for Claude Desktop / Grok. |
| `poker-daemon/` | Go daemon + its own Cloudflare Worker for R2-backed hand history; separate from `mcp-server/`. |
| `cloudflare-handoff/` | One-off handoff notes/scripts for a specific worker migration — historical record, not a live component. |
| `leak-snipe-desktop/`, `PokerBuild/` | **Legacy/incomplete scaffolds** (older Tauri attempt, and an Electron+React "Poker Therapist" experiment). Not the canonical app — don't extend these. |
| `.github/copilot-instructions.md` | **Stale.** Describes an older `D:\poker-build` three-project layout that no longer matches this repo. Prefer this file and `README.md`/`AGENTS.md` over it. |

## Common commands

All commands below assume the repository root unless noted. Paths in scripts are Windows-oriented (PowerShell/`.bat`); Python/Node/Cargo commands work the same cross-platform.

### Python engine + sidecar

```bash
# one-time: create .venv and install deps (Windows: Install-Sidecar.bat)
python -m venv .venv && .venv/bin/pip install -r sidecar/requirements.txt && .venv/bin/pip install -e .

# run the sidecar directly (Windows: Start-Sidecar.bat)
.venv/bin/python sidecar/server.py     # http://127.0.0.1:8765, docs at /docs, health at /health

# run the full test suite
.venv/bin/python -m unittest discover -s tests -p "test_*.py"

# run a single test file / single test
.venv/bin/python -m unittest tests.test_tags
.venv/bin/python -m unittest tests.test_tags.TaggingAndSearchTests.test_search_hands_filtered_by_tag

# fallback desktop app / live HUD
.venv/bin/python poker_gui.py
.venv/bin/python poker_gui.py --live-hud
```

There is no linter configured for the root Python engine (per `.github/copilot-instructions.md`); `setup.cfg` lists `black`/`flake8`/`pytest` as optional dev extras but no config enforces them.

### React/Tauri UI (`leaksnipe-ui/`)

```bash
cd leaksnipe-ui
npm install
npm run dev          # vite dev server
npm run build         # tsc && vite build — production build / type-check
npm run tauri dev     # full desktop dev shell (spawns/expects the sidecar)
npm run tauri build   # package the desktop app
```

There's no test runner configured in `leaksnipe-ui/package.json`; `npm run build` (which runs `tsc`) is the closest thing to CI-checkable validation for this package.

### Rust/Tauri shell

```bash
cd leaksnipe-ui/src-tauri
cargo check
```

### Full dev environment (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\tauri-dev.ps1
```

This starts (or reuses) the sidecar on port 8765, installs npm deps if missing, and launches `tauri dev`. `Launch-LeakSnipe.bat` is the double-click equivalent.

### Cloudflare Workers

```bash
cd mcp-server && npx wrangler deploy        # worker "leaksnipe" (mcp.leaksnipe.win)
cd cloudflare-api && npx wrangler deploy     # worker "leaksnipe-data-api"
```

## Architecture deep dive

### Data flow and the "one database, many consumers" model

`poker_hands.db` (SQLite, WAL mode, busy timeout) is the single local source of truth. It's read/written concurrently by:
- the FastAPI sidecar (via `models.HandDatabase`),
- `poker_gui.py`'s own `HandDatabase` instance (when running standalone or as the live HUD),
- the local MCP servers (`mcp_server.py`, `mcp_grok_server.py`),
- and, remotely, the Cloudflare Workers via a proxied `POST /query` endpoint on the sidecar (bearer-token gated, read-only SELECT/PRAGMA only — see "Remote access" below).

`db_migrations.py` applies versioned, idempotent migrations at sidecar/app startup and reconciles positional facts (per-position VPIP/PFR etc.) after restarts — these are persisted, not recomputed on every request, for HUD performance.

`sidecar/paths.py` resolves the DB path from `settings.json.db_path` → `LEAKSNIPE_DB` env var → repo-root `poker_hands.db`, in that order. Both the sidecar and `poker_gui.py` must resolve to the same file for data to be consistent.

### Shared Python engine — why it's structured this way

`poker_gui.py` was originally a single ~8,000-line file; it was later split into focused modules (see `REFACTORING_SUMMARY.md` for the historical extraction record) that are now imported by *both* `poker_gui.py` and `sidecar/server.py`:

| Module | Responsibility |
|---|---|
| `models.py` | `Hand` data model + `HandDatabase` (SQLite layer; **all methods acquire a `threading.Lock` before opening a connection** — never call `_connect()` directly) |
| `parsers.py` | `HandParser` — site detection (`detect_site()`) and per-site hand parsing (CoinPoker, ACR/WPN; `hand_id` format is `CP_<n>` / `ACR_<n>`) |
| `importing.py` | `HandImporter` — directory watching, mtime-based change detection, incremental import |
| `analysis.py` | `LeakEngine`, `PlayerAnalyzer`, `SummaryGenerator` — VPIP/PFR/AF/WTSD/W$SD/3-bet/c-bet stats and leak alerts |
| `equity.py`, `pot_odds.py` | Monte Carlo equity (NLHE, Omaha Hi-Lo 8, 7-stud, 7-stud hi-lo) and multi-way pot-odds math |
| `theory/` (`cfr_solver.py`, `value_net.py`, `charts.py`) | CFR+ solving for small/abstracted games, neural value estimates, stack-depth chart data |
| `ai_processor.py` | `AIProcessor`/`LLMGateway` — multi-provider AI routing (ASI:One, OpenAI, Gemini, Anthropic, DeepSeek, Ollama), tool calling, grounded street-by-street analysis |
| `coach_memory.py`, `dataset_context.py`, `web_context.py` | AI coach memory persistence and optional grounding context (dataset stats, web search) |
| `config.py` | `.env` loading (`bootstrap_env`), `settings.json` load/save, API key resolution |
| `db_migrations.py` | Versioned SQLite schema migrations + positional-fact reconciliation |

Because both `poker_gui.py` and `sidecar/server.py` import these modules directly (the sidecar adds both repo root and `sidecar/` to `sys.path`), **a change to shared-module behavior affects both the desktop fallback app and the Tauri UI** — check both call sites, not just the sidecar's usage.

### AI provider routing — non-obvious rules

- ASI:One is the *preferred* provider whenever a key is configured; the app must **not** silently fall back to a locally-running Ollama just because Ollama happens to be reachable.
- Two separate ASI:One keys (`ASI_ONE_API_KEY` primary, `ASI_ONE_API_KEY_FALLBACK`) let hand analysis and coach/chat run concurrently without sharing a rate limit — this is a deliberate design, not redundant config.
- Web search for the coach is opt-in via `ai_web_search_mode` (`off` / `on_demand` / `always`) — routine hand analysis and simple stats must stay fully local regardless of this setting.
- `.env` changes require either `POST /api/ai/reload` or a full restart; the sidecar fingerprints env/config (`_env_fingerprint()` in `sidecar/server.py`) to detect when the cached `AIProcessor` needs rebuilding.
- AI output is explanatory only — equity/EV/GTO numbers shown to the user must come from `equity.py`/`theory/`, never be invented by the LLM. See `docs/THEORY.md` for the exact-vs-abstracted-vs-approximate-vs-AI-explanation distinction the product enforces throughout.

### Live HUD — two independent implementations, run only one

- **Production path**: `poker_gui.py --live-hud` (pywin32-based `TableDetector` → `CurrentHandMonitor` → `LiveHUDOverlay`/`SeatBadge`), launched via `Launch-Python-Hud.bat` / `scripts/start-python-hud.ps1`. `settings.json.live_hud_backend` defaults to `"python"`.
- **Experimental path**: Tauri overlay (`leaksnipe-ui/hud.html`, `src-tauri/src/hud.rs`, `GET /api/live/current-hand`).
- These must never run simultaneously against the same table. Do not make the Tauri overlay the default without an explicit product decision — the README and AGENTS.md both call this out.

### Remote/MCP surfaces — three different audiences, don't conflate them

1. **`mcp-server/` (Cloudflare Worker `leaksnipe`, `mcp.leaksnipe.win`)** — the "MCP connector v2" used by the Claude apps. Tools share a common filter/pagination envelope (`{ success, count, results, limit, offset, has_more }`); see `mcp-server/MCP_V2.md`. `tauri_db_query` is read-only by default (SELECT/WITH/PRAGMA/EXPLAIN, auto-`LIMIT`, no multi-statement) and proxies to the desktop sidecar's `POST /query` over a Cloudflare Tunnel at `db.leaksnipe.win`, gated by a shared bearer secret (`LEAKSNIPE_DB_PROXY_KEY` / `DB_PROXY_KEY`).
2. **`cloudflare-api/`** — a separate, simpler read-only Worker for ChatGPT Actions, backed by D1 (`leaksnipe-hands`) + R2 (`leaksnipe-hand-histories`), populated by exporting the local SQLite DB (`scripts/export_sqlite.py`). No write endpoint.
3. **`mcp_server.py` / `mcp_grok_server.py`** — local stdio/HTTP MCP servers for Claude Desktop and Grok that import the same root Python modules directly (no HTTP hop). Keep tool behavior in parity with the Cloudflare worker when changing one (see the "local parity" note in `mcp-server/MCP_V2.md`).

When adding or changing a tool exposed to agents, check whether it needs to exist in more than one of these three places to stay consistent for every client.

### Frontend structure (`leaksnipe-ui/src/`)

Tabs map roughly 1:1 to top-level components in `src/components/`: `HandDetail`/`HandReplayer` (hands + replay), `StatsPanel`/`OpponentHud` (stats), `AiCoachPanel` (AI coach), `EquityCalculator` (equity), `TheoryPanel`/`RangeStudio`/`RangeEditor`/`RangeGrid`/`RangeTrainer`/`ToughChartsPanel` (theory), `SettingsPanel`. `src/lib/api.ts` is the sidecar HTTP client; `src/lib/hudManager.ts`/`hudStats.ts`/`seatLayout.ts`/`seatPositions.ts` back the (experimental) in-app HUD overlay. Tauri capability/permission grants live in `src-tauri/capabilities/*.json` and `src-tauri/permissions/*.toml` — HUD-related Tauri commands need `hud.json`/`hud.toml` grants or the UI will silently fail to call them.

## Key conventions

- **Theming**: colors come from a themes dict (`THEMES` in `themes.py` for `poker_gui.py`) — never hardcode hex values in UI code; the default theme is `"Midnight Purple"`.
- **Database writes**: `HandDatabase` re-imports use `INSERT OR REPLACE` (not `INSERT OR IGNORE`) so re-scanning a hand-history file safely overwrites the existing row.
- **Hero identity**: hero names are per-site (`settings.json.hero_names`), and aliases (e.g. `jdwalka` ↔ `JohnDaWalka`) are resolved via `utils.resolve_hand_hero_name` — use that helper rather than comparing player names directly.
- **`hero_won`** is always `winnings - amount_invested`, never raw winnings alone.
- **Secrets**: never commit `.env`, API keys, local databases (`poker_hands.db`, `coach_memory.db`), or `settings.json` with real paths/keys. `.env.example` documents every supported provider variable — extend it, don't hardcode new keys elsewhere.
- **Threading**: any GUI update from a background thread in `poker_gui.py` (importer, DriveHUD sync, HUD monitors) must go through `self.after(0, callback)` — direct widget writes from a thread crash tkinter.
- **Accuracy labeling**: the product distinguishes parsed facts, computed math, solver output, approximations, and AI explanation everywhere in the UI/copy (`docs/THEORY.md`). Don't label an LLM-produced number as equity, EV loss, or a GTO frequency.

## Before opening a PR

Per `README.md`'s contributing section: run the Python test suite, the frontend build (`npm run build`), and the Rust check (`cargo check`) — there is no single top-level script that runs all three.
