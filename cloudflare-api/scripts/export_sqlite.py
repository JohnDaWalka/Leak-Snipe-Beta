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
OUTPUT = ROOT / "cloudflare-api" / ".local" / "leaksnipe-hands.sql"
TABLES = (
    "hands", "players", "actions", "winners", "ocr_imports", "hand_tags",
    "player_types", "tournament_summaries", "player_position_facts",
)

# Tables keyed by an auto-increment id (or nothing): INSERT OR REPLACE cannot
# dedupe them across exports — local ids renumber when the DB is rebuilt, so a
# re-import silently doubles every row. Wipe them before reloading. Tables with
# stable natural keys (hands, player_types, ...) replace in place and are left out.
WIPE_BEFORE_LOAD = ("players", "actions", "winners", "ocr_imports", "hand_tags")


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Local database not found: {SOURCE}")
    OUTPUT.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(SOURCE)
    try:
        with OUTPUT.open("w", encoding="utf-8", newline="\n") as target:
            for table in WIPE_BEFORE_LOAD:
                target.write(f'DELETE FROM "{table}";\n')
            for table in TABLES:
                exists = conn.execute(
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
                ).fetchone()
                if not exists:
                    continue
                columns = [row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')]
                quoted = ", ".join(f'"{column}"' for column in columns)
                placeholders = ", ".join("?" for _ in columns)
                for row in conn.execute(f'SELECT {quoted} FROM "{table}"'):
                    target.write(
                        f'INSERT OR REPLACE INTO "{table}" ({quoted}) VALUES ('
                        + ", ".join(sql_literal(value) for value in row)
                        + ");\n"
                    )
    finally:
        conn.close()
    print(f"Exported D1 data to {OUTPUT}")
    print("Import with: npx wrangler d1 execute leaksnipe-hands --remote --file .local/leaksnipe-hands.sql")


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
