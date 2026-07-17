"""Versioned SQLite migrations and derived positional facts for LeakSnipe."""

from __future__ import annotations

import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Tuple


CURRENT_SCHEMA_VERSION = 2
POSITIONS = ("UTG", "UTG+1", "UTG+2", "MP", "HJ", "CO", "BTN", "SB", "BB")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    return any(row[1] == column for row in conn.execute(f"PRAGMA table_info({table})"))


def _position_for(seat: int, button_seat: int, seats: List[int]) -> str | None:
    if seat not in seats or button_seat not in seats:
        return None
    n = len(seats)
    if n < 2:
        return None
    dist = (seats.index(seat) - seats.index(button_seat)) % n
    if dist == 0:
        return "BTN"
    if n == 2 and dist == 1:
        return "BB"
    if dist == 1:
        return "SB"
    if dist == 2:
        return "BB"
    if dist == n - 1:
        return "CO"
    if n >= 5 and dist == n - 2:
        return "HJ"
    if n >= 6 and dist == n - 3:
        return "MP"
    if n >= 7 and dist == n - 4:
        return "UTG+2"
    if n >= 8 and dist == n - 5:
        return "UTG+1"
    return "UTG"


def _position_fact_rows(
    conn: sqlite3.Connection, hand_ids: Iterable[str] | None = None,
) -> List[Tuple[str, str, str, int, int, str]]:
    selected = list(dict.fromkeys(hand_ids or []))
    where = ""
    params: List[str] = []
    if selected:
        where = f" WHERE p.hand_id IN ({','.join('?' for _ in selected)})"
        params = selected

    player_rows = conn.execute(
        "SELECT p.hand_id, p.seat, p.name, p.is_hero, h.button_seat "
        "FROM players p JOIN hands h ON h.hand_id = p.hand_id"
        f"{where} ORDER BY p.hand_id, p.seat",
        params,
    ).fetchall()
    if not player_rows:
        return []

    action_where = "lower(street) = 'preflop' AND lower(action) IN ('call','raise','bet')"
    action_params: List[str] = []
    if selected:
        action_where += f" AND hand_id IN ({','.join('?' for _ in selected)})"
        action_params = selected
    action_rows = conn.execute(
        "SELECT hand_id, player, lower(action) FROM actions WHERE " + action_where,
        action_params,
    ).fetchall()
    action_flags: Dict[Tuple[str, str], List[int]] = defaultdict(lambda: [0, 0])
    for hand_id, player, action in action_rows:
        key = (str(hand_id), str(player or "").casefold())
        action_flags[key][0] = 1
        if action in ("raise", "bet"):
            action_flags[key][1] = 1

    hands: Dict[str, List[Tuple[int, str, int, int]]] = defaultdict(list)
    for hand_id, seat, name, is_hero, button_seat in player_rows:
        if seat is None or not name:
            continue
        hands[str(hand_id)].append((int(seat), str(name), int(is_hero or 0), int(button_seat or 0)))

    now = _utc_now()
    facts: List[Tuple[str, str, str, int, int, str]] = []
    for hand_id, players in hands.items():
        seats = sorted({seat for seat, _name, _hero, _button in players})
        button_seat = players[0][3]
        seen_players = set()
        for seat, name, is_hero, _button in players:
            if is_hero:
                continue
            name_lower = name.casefold()
            if name_lower in seen_players:
                continue
            seen_players.add(name_lower)
            position = _position_for(seat, button_seat, seats)
            if not position:
                continue
            vpip, pfr = action_flags[(hand_id, name_lower)]
            facts.append((hand_id, name, position, vpip, pfr, now))
    return facts


def rebuild_position_facts(conn: sqlite3.Connection) -> int:
    facts = _position_fact_rows(conn)
    conn.execute("DELETE FROM player_position_facts")
    conn.executemany(
        "INSERT INTO player_position_facts "
        "(hand_id, player, position, vpip, pfr, updated_at) VALUES (?,?,?,?,?,?)",
        facts,
    )
    return len(facts)


def refresh_hand_position_facts(conn: sqlite3.Connection, hand_id: str) -> int:
    facts = _position_fact_rows(conn, [hand_id])
    conn.execute("DELETE FROM player_position_facts WHERE hand_id = ?", (hand_id,))
    conn.executemany(
        "INSERT INTO player_position_facts "
        "(hand_id, player, position, vpip, pfr, updated_at) VALUES (?,?,?,?,?,?)",
        facts,
    )
    return len(facts)


def reconcile_missing_position_facts(conn: sqlite3.Connection) -> int:
    """Heal hands written by an older process during a rolling local upgrade."""
    rows = conn.execute(
        "SELECT DISTINCT p.hand_id FROM players p "
        "LEFT JOIN player_position_facts f "
        "ON f.hand_id = p.hand_id AND f.player = p.name COLLATE NOCASE "
        "WHERE p.is_hero = 0 AND f.hand_id IS NULL"
    ).fetchall()
    hand_ids = [str(row[0]) for row in rows]
    for hand_id in hand_ids:
        refresh_hand_position_facts(conn, hand_id)
    return len(hand_ids)


def read_player_position_stats(
    conn: sqlite3.Connection, name: str,
) -> Dict[str, Dict[str, float]]:
    result: Dict[str, Dict[str, float]] = {
        position: {"pfr": 0.0, "vpip": 0.0, "hands": 0} for position in POSITIONS
    }
    rows = conn.execute(
        "SELECT position, COUNT(*), SUM(vpip), SUM(pfr) "
        "FROM player_position_facts WHERE player = ? COLLATE NOCASE GROUP BY position",
        (name,),
    ).fetchall()
    for position, hands, vpip_hands, pfr_hands in rows:
        if position not in result or not hands:
            continue
        result[position] = {
            "hands": int(hands),
            "vpip": round(100.0 * int(vpip_hands or 0) / int(hands), 1),
            "pfr": round(100.0 * int(pfr_hands or 0) / int(hands), 1),
        }
    return result


def apply_migrations(conn: sqlite3.Connection) -> Dict[str, int]:
    """Apply idempotent migrations after the baseline tables exist."""
    owns_transaction = not conn.in_transaction
    if owns_transaction:
        conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
        )
        applied = {int(row[0]) for row in conn.execute("SELECT version FROM schema_migrations")}

        if 1 not in applied:
            if not _column_exists(conn, "player_types", "three_bet"):
                conn.execute("ALTER TABLE player_types ADD COLUMN three_bet REAL DEFAULT 0")
            conn.execute(
                "INSERT INTO schema_migrations(version, name, applied_at) VALUES (1, ?, ?)",
                ("player_types_three_bet", _utc_now()),
            )

        if 2 not in applied:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS player_position_facts (
                hand_id TEXT NOT NULL,
                player TEXT NOT NULL COLLATE NOCASE,
                position TEXT NOT NULL,
                vpip INTEGER NOT NULL DEFAULT 0 CHECK (vpip IN (0, 1)),
                pfr INTEGER NOT NULL DEFAULT 0 CHECK (pfr IN (0, 1)),
                updated_at TEXT NOT NULL,
                PRIMARY KEY (hand_id, player),
                FOREIGN KEY (hand_id) REFERENCES hands(hand_id) ON DELETE CASCADE
            )"""
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_position_facts_player_position "
                "ON player_position_facts(player, position)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_actions_player_street_action "
                "ON actions(player, street, action, hand_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_players_name_hero "
                "ON players(name, is_hero, hand_id)"
            )
            rebuild_position_facts(conn)
            conn.execute(
                "INSERT INTO schema_migrations(version, name, applied_at) VALUES (2, ?, ?)",
                ("incremental_player_position_facts", _utc_now()),
            )

        reconcile_missing_position_facts(conn)

        conn.execute(f"PRAGMA user_version = {CURRENT_SCHEMA_VERSION}")
        result = {
            "current_version": CURRENT_SCHEMA_VERSION,
            "applied_count": int(conn.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0]),
            "position_fact_count": int(conn.execute("SELECT COUNT(*) FROM player_position_facts").fetchone()[0]),
        }
        if owns_transaction:
            conn.commit()
        return result
    except Exception:
        if owns_transaction:
            conn.rollback()
        raise


def schema_diagnostics(conn: sqlite3.Connection) -> Dict[str, int]:
    version = int(conn.execute("PRAGMA user_version").fetchone()[0])
    migration_count = int(
        conn.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0]
    )
    fact_count = int(conn.execute("SELECT COUNT(*) FROM player_position_facts").fetchone()[0])
    return {
        "current_version": CURRENT_SCHEMA_VERSION,
        "database_version": version,
        "migration_count": migration_count,
        "position_fact_count": fact_count,
    }
