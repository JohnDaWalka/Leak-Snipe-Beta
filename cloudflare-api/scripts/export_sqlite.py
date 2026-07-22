"""Export the local LeakSnipe SQLite database into a D1-compatible SQL file.

Run from the repository root:
    .venv\\Scripts\\python.exe cloudflare-api\\scripts\\export_sqlite.py
Then import with the command printed by the script.  The export is local only;
it never prints or commits hand contents.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "poker_hands.db"
COACH_SOURCE = ROOT / "coach_memory.db"
OUTPUT = ROOT / "cloudflare-api" / ".local" / "leaksnipe-hands.sql"
TABLES = (
    "hands",
    "players",
    "actions",
    "winners",
    "ocr_imports",
    "hand_tags",
    "player_types",
    "tournament_summaries",
    "player_position_facts",
    "ai_analysis",
)

# Full coaching schema catalog (written into schema_catalog on export)
SCHEMA_CATALOG = {
    "hands": "Core hand histories (cash + MTT). hero_won is $ for cash, chips for tournament.",
    "players": "Seats per hand: name, stack, is_hero.",
    "actions": "Street-by-street actions with amounts.",
    "winners": "Showdown/collected amounts per player.",
    "hand_tags": "Manual/auto tags on hands.",
    "player_types": "HUD labels: vpip/pfr/af/wtsd/3bet sample stats.",
    "player_position_facts": "Per-hand VPIP/PFR by position.",
    "tournament_summaries": "MTT results: buy-in, finish, prize.",
    "ai_analysis": "Stored AI coach notes per hand.",
    "ocr_imports": "OCR capture imports.",
    "coach_memory": "Cross-session coach chat memory (hero, kind, messages).",
}


def _export_table(conn: sqlite3.Connection, target, table: str) -> int:
    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone()
    if not exists:
        return 0
    columns = [row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')]
    quoted = ", ".join(f'"{column}"' for column in columns)
    count = 0
    for row in conn.execute(f'SELECT {quoted} FROM "{table}"'):
        target.write(
            f'INSERT OR REPLACE INTO "{table}" ({quoted}) VALUES ('
            + ", ".join(sql_literal(value) for value in row)
            + ");\n"
        )
        count += 1
    return count


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Local database not found: {SOURCE}")
    OUTPUT.parent.mkdir(exist_ok=True)
    counts: dict[str, int] = {}
    with OUTPUT.open("w", encoding="utf-8", newline="\n") as target:
        conn = sqlite3.connect(SOURCE)
        try:
            for table in TABLES:
                counts[table] = _export_table(conn, target, table)
            # schema_catalog rows for coaching MCP
            from datetime import datetime, timezone

            now = datetime.now(timezone.utc).isoformat()
            for table_name, desc in SCHEMA_CATALOG.items():
                cols = []
                if table_name == "coach_memory" and COACH_SOURCE.exists():
                    cc = sqlite3.connect(COACH_SOURCE)
                    try:
                        cols = [r[1] for r in cc.execute('PRAGMA table_info("coach_memory")')]
                    finally:
                        cc.close()
                else:
                    cols = [r[1] for r in conn.execute(f'PRAGMA table_info("{table_name}")')]
                cols_json = sql_literal(",".join(cols))
                target.write(
                    "INSERT OR REPLACE INTO schema_catalog "
                    '(table_name, database_name, description, columns_json, updated_at) VALUES ('
                    f"{sql_literal(table_name)}, "
                    f"{sql_literal('coach_memory' if table_name == 'coach_memory' else 'poker_hands')}, "
                    f"{sql_literal(desc)}, {cols_json}, {sql_literal(now)});\n"
                )
        finally:
            conn.close()

        if COACH_SOURCE.exists():
            cconn = sqlite3.connect(COACH_SOURCE)
            try:
                counts["coach_memory"] = _export_table(cconn, target, "coach_memory")
            finally:
                cconn.close()

    print(f"Exported D1 data to {OUTPUT}")
    for name, n in counts.items():
        print(f"  {name}: {n} rows")
    print("Apply schema: npx wrangler d1 migrations apply leaksnipe-hands --remote")
    print("Import data:  npx wrangler d1 execute leaksnipe-hands --remote --file cloudflare-api/.local/leaksnipe-hands.sql")


def sql_literal(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bytes):
        return "X'" + value.hex() + "'"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


if __name__ == "__main__":
    main()
