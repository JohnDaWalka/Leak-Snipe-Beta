"""
LeakSnipe multi-database MCP server for Grok (streamable HTTP + stdio).

Exposes all *.db files under the LeakSnipe project (poker_hands.db, coach_memory.db, …).
"""
from __future__ import annotations

import os
import sys
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastmcp import FastMCP

REPO_ROOT = Path(os.environ.get("LEAKSNIPE_ROOT", Path(__file__).resolve().parent)).expanduser().resolve()
# Optional override for a single DB; otherwise all *.db under REPO_ROOT are available.
DEFAULT_DB_ENV = os.environ.get("SQLITE_DB_PATH")

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
sys.path.append(str(REPO_ROOT / "sidecar"))

try:
    from models import HandDatabase, Hand
    from config import load_settings
    from utils import resolve_hand_hero_name
except Exception as e:
    sys.stderr.write(f"[LeakSnipe-Grok] Imports failed: {e}\n")
    sys.stderr.flush()

mcp = FastMCP(
    name="LeakSnipe",
)


def _discover_databases() -> Dict[str, Path]:
    dbs: Dict[str, Path] = {}
    if DEFAULT_DB_ENV:
        p = Path(DEFAULT_DB_ENV).expanduser().resolve()
        if p.exists():
            dbs[p.stem] = p
    for p in sorted(REPO_ROOT.glob("*.db")):
        dbs[p.stem] = p.resolve()
    # Common alternate locations
    for extra in (
        REPO_ROOT / "data",
        Path(os.environ.get("LOCALAPPDATA", "")) / "leaksnipe",
        Path(os.environ.get("APPDATA", "")) / "leaksnipe",
    ):
        if extra.is_dir():
            for p in extra.glob("*.db"):
                dbs.setdefault(p.stem, p.resolve())
    return dbs


def _resolve_db(database: Optional[str] = None) -> Path:
    dbs = _discover_databases()
    if not dbs:
        raise FileNotFoundError(f"No .db files found under {REPO_ROOT}")
    if database:
        key = database.replace(".db", "").strip()
        if key not in dbs:
            raise ValueError(f"Unknown database '{database}'. Available: {list(dbs)}")
        return dbs[key]
    # Prefer poker_hands, else first
    if "poker_hands" in dbs:
        return dbs["poker_hands"]
    return next(iter(dbs.values()))


class SQLiteConnection:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.conn: Optional[sqlite3.Connection] = None

    def __enter__(self) -> sqlite3.Connection:
        if not self.db_path.exists():
            raise FileNotFoundError(f"Database not found: {self.db_path}")
        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.row_factory = sqlite3.Row
        return self.conn

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if self.conn:
            self.conn.close()


def serialize_hand(
    hand: Hand,
    settings: dict,
    *,
    format: str = "summary",
    include_raw: bool = False,
    include_actions: bool = False,
    include_players: bool = False,
) -> dict:
    """Serialize a hand. Default format=summary omits raw_text / streets to save tokens."""
    hero_name = resolve_hand_hero_name(
        settings,
        hand.site,
        players=hand.players,
        raw_text=hand.raw_text,
        hero_player=getattr(hand, "hero_player", ""),
    )
    date_str = hand.date.isoformat() if hand.date else None
    full = format == "full" or include_raw

    out: Dict[str, Any] = {
        "hand_id": hand.hand_id,
        "site": hand.site,
        "date": date_str,
        "game_type": hand.game_type,
        "is_tournament": hand.is_tournament,
        "table_name": hand.table_name,
        "hero_cards": hand.hero_cards,
        "board_cards": hand.board_cards,
        "pot": hand.pot,
        "rake": hand.rake,
        "hero_won": hand.hero_won,
        "hero_position": hand.hero_position,
        "hero_name": hero_name,
    }
    if include_players or full:
        out["players"] = [
            {
                "seat": seat,
                "name": p["name"],
                "stack": p["stack"],
                "is_hero": p.get("is_hero", False),
            }
            for seat, p in hand.players.items()
        ]
    if include_actions or full:
        out["streets"] = [
            {
                "name": street.get("name", ""),
                "cards": street.get("cards", []),
                "actions": [
                    {
                        "player": act.get("player", ""),
                        "action": act.get("action", ""),
                        "amount": act.get("amount", 0.0),
                    }
                    for act in street.get("actions", [])
                ],
            }
            for street in getattr(hand, "streets", [])
        ]
        out["winners"] = [
            {"name": w["name"], "amount": w["amount"]}
            for w in getattr(hand, "winners", [])
        ]
    if include_raw or full:
        out["raw_text"] = hand.raw_text
    return out

def _safe_decode(b):
    if not b:
        return ""
    for encoding in ['utf-8', 'cp1252', 'cp850']:
        try:
            return b.decode(encoding)
        except UnicodeDecodeError:
            continue
    return b.decode('utf-8', errors='replace')

def _exec_cmd(cmd_list, cwd=None):
    import subprocess
    cmd_str = " ".join(cmd_list)
    res = subprocess.run(
        cmd_str,
        cwd=cwd,
        shell=True,
        capture_output=True,
        timeout=30
    )
    return {
        "stdout": _safe_decode(res.stdout),
        "stderr": _safe_decode(res.stderr),
        "exit_code": res.returncode
    }

def build_cards_sql(cards: str) -> tuple[str, list]:
    c = cards.strip().lower()
    if not c or len(c) < 2:
        return "", []
    c1, c2 = c[0].upper(), c[1].upper()
    if c1 == c2:
        return "hero_cards LIKE ?", [f"{c1}% {c2}%"]
    p1 = f"{c1}% {c2}%"
    p2 = f"{c2}% {c1}%"
    if len(c) >= 3 and c[2] == 's':
        return "( (hero_cards LIKE ? OR hero_cards LIKE ?) AND SUBSTR(hero_cards, 2, 1) = SUBSTR(hero_cards, 5, 1) )", [p1, p2]
    elif len(c) >= 3 and c[2] == 'o':
        return "( (hero_cards LIKE ? OR hero_cards LIKE ?) AND SUBSTR(hero_cards, 2, 1) != SUBSTR(hero_cards, 5, 1) )", [p1, p2]
    else:
        return "(hero_cards LIKE ? OR hero_cards LIKE ?)", [p1, p2]

def parse_natural_language_query(query: str) -> tuple[str, list, int]:
    import re
    query_lower = query.lower()
    where_clauses = []
    params = []
    
    pos_map = {
        "utg": "UTG", "mp": "MP", "hj": "HJ", "co": "CO", "cutoff": "CO",
        "btn": "BTN", "button": "BTN", "sb": "SB", "small blind": "SB",
        "bb": "BB", "big blind": "BB"
    }
    for key, val in pos_map.items():
        if f"from {key}" in query_lower or f"at {key}" in query_lower or f"in {key}" in query_lower or (f" {key} " in f" {query_lower} "):
            where_clauses.append("hero_position = ?")
            params.append(val)
            break
            
    if "won" in query_lower or "winning" in query_lower or "profit" in query_lower:
        where_clauses.append("hero_won > 0")
    elif "lost" in query_lower or "losing" in query_lower or "loss" in query_lower:
        where_clauses.append("hero_won < 0")
        
    if "3-bet" in query_lower or "3bet" in query_lower:
        where_clauses.append("(raw_text LIKE '%3-bet%' OR raw_text LIKE '%3bet%')")
    elif "4-bet" in query_lower or "4bet" in query_lower:
        where_clauses.append("(raw_text LIKE '%4-bet%' OR raw_text LIKE '%4bet%')")
    elif "all-in" in query_lower or "allin" in query_lower or "all in" in query_lower:
        where_clauses.append("(raw_text LIKE '%all-in%' OR raw_text LIKE '%all in%')")

    card_pattern = re.compile(r'\b([2-9tjqka]{2})([so]?)\b', re.IGNORECASE)
    card_match = card_pattern.search(query_lower)
    if card_match:
        cards_input = card_match.group(1).upper()
        suited_offsuited = card_match.group(2).lower()
        c1, c2 = cards_input[0], cards_input[1]
        if c1 == c2:
            where_clauses.append("hero_cards LIKE ?")
            params.append(f"{c1}% {c2}%")
        else:
            p1 = f"{c1}% {c2}%"
            p2 = f"{c2}% {c1}%"
            if suited_offsuited == 's':
                where_clauses.append("( (hero_cards LIKE ? OR hero_cards LIKE ?) AND SUBSTR(hero_cards, 2, 1) = SUBSTR(hero_cards, 5, 1) )")
                params.extend([p1, p2])
            elif suited_offsuited == 'o':
                where_clauses.append("( (hero_cards LIKE ? OR hero_cards LIKE ?) AND SUBSTR(hero_cards, 2, 1) != SUBSTR(hero_cards, 5, 1) )")
                params.extend([p1, p2])
            else:
                where_clauses.append("(hero_cards LIKE ? OR hero_cards LIKE ?)")
                params.extend([p1, p2])

    if "coinpoker" in query_lower or "coin poker" in query_lower:
        where_clauses.append("site = ?")
        params.append("CoinPoker")
    elif "acr" in query_lower or "wpn" in query_lower or "americas" in query_lower:
        where_clauses.append("site = ?")
        params.append("BetACR")

    limit = 10
    limit_match = re.search(r'\blimit\s+(\d+)\b', query_lower)
    if not limit_match:
        limit_match = re.search(r'\blast\s+(\d+)\b', query_lower)
    if limit_match:
        limit = int(limit_match.group(1))

    if not where_clauses:
        where_str = " WHERE (raw_text LIKE ? OR hand_id LIKE ? OR table_name LIKE ?)"
        params = [f"%{query}%", f"%{query}%", f"%{query}%"]
    else:
        where_str = " WHERE " + " AND ".join(where_clauses)
    return where_str, params, limit

def query_and_serialize_hands(
    db,
    settings,
    sql,
    params,
    *,
    format: str = "summary",
    include_raw: bool = False,
    include_actions: bool = False,
    include_players: bool = False,
):
    with db.lock:
        conn = db._connect()
        try:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            rows = c.execute(sql, params).fetchall()
            if not rows:
                return []
            hand_ids = [row["hand_id"] for row in rows]
            players_by_hand, actions_by_hand, winners_by_hand, tags_by_hand = (
                db._load_related_for_ids(c, hand_ids)
            )
            hands = [
                db._hydrate_hand(
                    row, players_by_hand, actions_by_hand, winners_by_hand, tags_by_hand
                )
                for row in rows
            ]
            return [
                serialize_hand(
                    h,
                    settings,
                    format=format,
                    include_raw=include_raw,
                    include_actions=include_actions,
                    include_players=include_players,
                )
                for h in hands
            ]
        finally:
            conn.close()


def _ok_list(results, *, limit=None, offset=0, has_more=False, **extra):
    return {
        "success": True,
        "count": len(results) if results is not None else 0,
        "results": results or [],
        "limit": limit,
        "offset": offset,
        "has_more": has_more,
        **extra,
    }


def _clamp_limit(limit: Optional[int], default: int = 10, max_limit: int = 100) -> int:
    try:
        n = int(limit) if limit is not None else default
    except (TypeError, ValueError):
        n = default
    return max(1, min(n, max_limit))


def _assert_select(query: str) -> str:
    q = query.strip()
    if q.endswith(";"):
        q = q[:-1].strip()
    in_single = in_double = False
    for ch in q:
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif ch == ";" and not in_single and not in_double:
            raise ValueError("Multiple SQL statements are not allowed")
    lower = q.lower()
    if not (lower.startswith("select") or lower.startswith("with")):
        raise ValueError("Only SELECT / WITH queries are allowed")
    return q


@mcp.tool()
def list_databases() -> List[Dict[str, Any]]:
    """List all LeakSnipe SQLite databases available on this machine.

    Returns name, path, and size_bytes for each .db file.
    """
    out: List[Dict[str, Any]] = []
    for name, path in _discover_databases().items():
        try:
            size = path.stat().st_size
        except OSError:
            size = None
        out.append({"name": name, "path": str(path), "size_bytes": size})
    return out


@mcp.tool()
def list_tables(database: Optional[str] = None) -> List[str]:
    """List tables in a LeakSnipe database (default: poker_hands).

    Args:
        database: Database name without .db, e.g. 'poker_hands' or 'coach_memory'.
    """
    with SQLiteConnection(_resolve_db(database)) as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        return [r["name"] for r in rows]


@mcp.tool()
def describe_table(table_name: str, database: Optional[str] = None) -> List[Dict[str, Any]]:
    """Return column schema for a table (name, type, pk, etc.).

    Args:
        table_name: Table to inspect.
        database: Optional DB name (default poker_hands).
    """
    with SQLiteConnection(_resolve_db(database)) as conn:
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            [table_name],
        ).fetchone()
        if not exists:
            raise ValueError(f"Table '{table_name}' does not exist")
        safe = table_name.replace('"', "")
        cols = conn.execute(f'PRAGMA table_info("{safe}")').fetchall()
        return [dict(c) for c in cols]


@mcp.tool()
def read_query(
    query: str,
    database: Optional[str] = None,
    params: Optional[List[Any]] = None,
    fetch_all: bool = True,
    row_limit: int = 200,
) -> List[Dict[str, Any]]:
    """Run a read-only SQL SELECT against a LeakSnipe database.

    Args:
        query: SELECT or WITH query only.
        database: Optional DB name (default poker_hands). Use list_databases first.
        params: Optional bound parameters.
        fetch_all: Fetch all rows vs first row.
        row_limit: Max rows (default 200, max 1000).
    """
    query = _assert_select(query)
    params = params or []
    limit = max(1, min(int(row_limit), 1000))
    if "limit" not in query.lower():
        query = f"{query} LIMIT {limit}"

    with SQLiteConnection(_resolve_db(database)) as conn:
        try:
            cur = conn.execute(query, params)
            rows = cur.fetchall() if fetch_all else [cur.fetchone()]
            return [dict(r) for r in rows if r is not None]
        except sqlite3.Error as e:
            raise ValueError(f"SQLite error: {e}") from e


@mcp.tool()
def database_overview(database: Optional[str] = None) -> Dict[str, Any]:
    """Snapshot of one DB (or all if database omitted): tables, hand counts, dates."""
    dbs = _discover_databases()
    targets = {database.replace(".db", ""): dbs[database.replace(".db", "")]} if database else dbs
    if database and database.replace(".db", "") not in dbs:
        raise ValueError(f"Unknown database '{database}'. Available: {list(dbs)}")

    result: Dict[str, Any] = {"repo_root": str(REPO_ROOT), "databases": {}}
    for name, path in targets.items():
        info: Dict[str, Any] = {"path": str(path), "size_bytes": path.stat().st_size}
        with SQLiteConnection(path) as conn:
            tables = [
                r["name"]
                for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
                ).fetchall()
            ]
            info["tables"] = tables
            if "hands" in tables:
                info["hand_count"] = conn.execute("SELECT COUNT(*) AS c FROM hands").fetchone()["c"]
                try:
                    row = conn.execute(
                        "SELECT MIN(date) AS dmin, MAX(date) AS dmax FROM hands"
                    ).fetchone()
                    info["date_min"] = row["dmin"]
                    info["date_max"] = row["dmax"]
                except sqlite3.Error:
                    pass
                try:
                    sites = conn.execute(
                        "SELECT site, COUNT(*) AS c FROM hands GROUP BY site ORDER BY c DESC LIMIT 20"
                    ).fetchall()
                    info["hands_by_site"] = {r["site"]: r["c"] for r in sites}
                except sqlite3.Error:
                    pass
            if "players" in tables:
                try:
                    info["distinct_players"] = conn.execute(
                        "SELECT COUNT(DISTINCT name) AS c FROM players"
                    ).fetchone()["c"]
                except sqlite3.Error:
                    pass
        result["databases"][name] = info
    return result


@mcp.tool()
def get_recent_hands(
    limit: int = 10,
    since: Optional[str] = None,
    database: Optional[str] = None,
    format: str = "summary",
    include_raw: bool = False,
    offset: int = 0,
) -> Dict[str, Any]:
    """Returns the most recent hands (summary by default — no raw_text).

    Args:
        limit: Max hands to return (default 10, max 100).
        since: ISO timestamp YYYY-MM-DD to get hands after.
        database: Optional database name (default: poker_hands).
        format: 'summary' (default) or 'full'.
        include_raw: Include raw_text even in summary mode.
        offset: Pagination offset.
    """
    settings = load_settings()
    db = HandDatabase(str(_resolve_db(database)))
    limit = _clamp_limit(limit)
    where_clauses = []
    sql_params: List[Any] = []
    if since:
        where_clauses.append("date >= ?")
        sql_params.append(since)
    where_str = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    sql = f"SELECT * FROM hands{where_str} ORDER BY date DESC LIMIT ? OFFSET ?"
    hands = query_and_serialize_hands(
        db,
        settings,
        sql,
        sql_params + [limit + 1, offset],
        format=format,
        include_raw=include_raw,
    )
    has_more = len(hands) > limit
    return _ok_list(hands[:limit], limit=limit, offset=offset, has_more=has_more)


@mcp.tool()
def get_hands_by_cards(
    cards: str,
    limit: int = 10,
    database: Optional[str] = None,
    format: str = "summary",
    include_raw: bool = False,
    offset: int = 0,
) -> Dict[str, Any]:
    """Returns hands containing specific hole cards (e.g. 'QQ', 'AKs', '76s'). Summary by default."""
    settings = load_settings()
    db = HandDatabase(str(_resolve_db(database)))
    limit = _clamp_limit(limit)
    cards_sql, cards_params = build_cards_sql(cards)
    if not cards_sql:
        raise ValueError("Invalid cards specified")
    sql = f"SELECT * FROM hands WHERE {cards_sql} ORDER BY date DESC LIMIT ? OFFSET ?"
    hands = query_and_serialize_hands(
        db, settings, sql, cards_params + [limit + 1, offset],
        format=format, include_raw=include_raw,
    )
    has_more = len(hands) > limit
    return _ok_list(hands[:limit], limit=limit, offset=offset, has_more=has_more)


@mcp.tool()
def get_biggest_winning_hands(
    limit: int = 10,
    database: Optional[str] = None,
    format: str = "summary",
    include_raw: bool = False,
    offset: int = 0,
) -> Dict[str, Any]:
    """Biggest winning hands by profit (chip units). Summary by default."""
    settings = load_settings()
    db = HandDatabase(str(_resolve_db(database)))
    limit = _clamp_limit(limit)
    sql = "SELECT * FROM hands WHERE hero_won > 0 ORDER BY hero_won DESC LIMIT ? OFFSET ?"
    hands = query_and_serialize_hands(
        db, settings, sql, [limit + 1, offset], format=format, include_raw=include_raw,
    )
    has_more = len(hands) > limit
    return _ok_list(hands[:limit], limit=limit, offset=offset, has_more=has_more)


@mcp.tool()
def get_winrate_by_position(
    database: Optional[str] = None,
    site: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    is_tournament: Optional[bool] = None,
) -> Dict[str, Any]:
    """Winrate / profit by position. Profit may be tournament chips, not USD."""
    db = HandDatabase(str(_resolve_db(database)))
    where = ["hero_position IS NOT NULL", "hero_position != '?'", "hero_position != ''"]
    params: List[Any] = []
    if site:
        where.append("LOWER(site) = LOWER(?)")
        params.append(site)
    if date_from:
        where.append("date >= ?")
        params.append(date_from)
    if date_to:
        where.append("date <= ?")
        params.append(date_to)
    if is_tournament is True:
        where.append("is_tournament = 1")
    elif is_tournament is False:
        where.append("is_tournament = 0")
    sql = f"""
        SELECT
            hero_position AS position,
            COUNT(*) AS total_hands,
            SUM(CASE WHEN hero_won > 0 THEN 1 ELSE 0 END) AS hands_won,
            SUM(hero_won) AS total_profit
        FROM hands
        WHERE {' AND '.join(where)}
        GROUP BY hero_position
        ORDER BY total_profit DESC
    """
    with db.lock:
        conn = db._connect()
        try:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(sql, params).fetchall()
            results = [dict(r) for r in rows]
            return _ok_list(
                results,
                note="total_profit is in site/tournament chip units, not always USD.",
            )
        finally:
            conn.close()


@mcp.tool()
def get_hands_by_position(
    position: str,
    limit: int = 10,
    database: Optional[str] = None,
    format: str = "summary",
    include_raw: bool = False,
    offset: int = 0,
) -> Dict[str, Any]:
    """Hands from a hero position. Summary by default."""
    settings = load_settings()
    db = HandDatabase(str(_resolve_db(database)))
    limit = _clamp_limit(limit)
    sql = "SELECT * FROM hands WHERE UPPER(hero_position) = ? ORDER BY date DESC LIMIT ? OFFSET ?"
    hands = query_and_serialize_hands(
        db, settings, sql, [position.upper(), limit + 1, offset],
        format=format, include_raw=include_raw,
    )
    has_more = len(hands) > limit
    return _ok_list(hands[:limit], limit=limit, offset=offset, has_more=has_more)


@mcp.tool()
def search_hands(
    query: str,
    limit: Optional[int] = None,
    offset: int = 0,
    database: Optional[str] = None,
    format: str = "summary",
    include_raw: bool = False,
) -> Dict[str, Any]:
    """Natural language search (e.g. 'BTN won QQ'). Summary by default."""
    settings = load_settings()
    db = HandDatabase(str(_resolve_db(database)))
    where_str, sql_params, parsed_limit = parse_natural_language_query(query)
    lim = _clamp_limit(limit if limit is not None else parsed_limit)
    sql = f"SELECT * FROM hands{where_str} ORDER BY date DESC LIMIT ? OFFSET ?"
    hands = query_and_serialize_hands(
        db, settings, sql, sql_params + [lim + 1, offset],
        format=format, include_raw=include_raw,
    )
    has_more = len(hands) > lim
    return _ok_list(hands[:lim], limit=lim, offset=offset, has_more=has_more)


@mcp.tool()
def get_hand(
    hand_id: str,
    database: Optional[str] = None,
    format: str = "summary",
    include_raw: bool = False,
    include_actions: bool = False,
    include_players: bool = False,
    include_tags: bool = False,
) -> Dict[str, Any]:
    """Get a single hand by id with optional includes."""
    settings = load_settings()
    db = HandDatabase(str(_resolve_db(database)))
    hands = query_and_serialize_hands(
        db,
        settings,
        "SELECT * FROM hands WHERE hand_id = ? LIMIT 1",
        [hand_id],
        format=format,
        include_raw=include_raw,
        include_actions=include_actions,
        include_players=include_players,
    )
    if not hands:
        return {"success": True, "found": False, "result": None}
    result = hands[0]
    if include_tags:
        with db.lock:
            conn = db._connect()
            try:
                tags = conn.execute(
                    "SELECT tag FROM hand_tags WHERE hand_id = ? ORDER BY tag",
                    [hand_id],
                ).fetchall()
                result["tags"] = [t[0] if not isinstance(t, sqlite3.Row) else t["tag"] for t in tags]
            finally:
                conn.close()
    return {"success": True, "found": True, "result": result}


@mcp.tool()
def list_tags(
    database: Optional[str] = None,
    limit: int = 100,
    prefix: Optional[str] = None,
) -> Dict[str, Any]:
    """List distinct hand tags with counts."""
    db_path = _resolve_db(database)
    limit = _clamp_limit(limit, 100)
    with SQLiteConnection(db_path) as conn:
        params: List[Any] = []
        sql = "SELECT tag, COUNT(*) AS hand_count FROM hand_tags"
        if prefix:
            sql += " WHERE LOWER(tag) LIKE ?"
            params.append(prefix.lower() + "%")
        sql += " GROUP BY tag ORDER BY hand_count DESC LIMIT ?"
        params.append(limit)
        try:
            rows = conn.execute(sql, params).fetchall()
        except sqlite3.Error:
            return _ok_list([])
        return _ok_list([dict(r) for r in rows], limit=limit)


@mcp.tool()
def list_leaks(
    database: Optional[str] = None,
    min_mistakes: int = 1,
    limit: int = 20,
    offset: int = 0,
    include_raw_response: bool = False,
) -> Dict[str, Any]:
    """Search ai_analysis rows for coaching leaks."""
    db_path = _resolve_db(database)
    limit = _clamp_limit(limit, 20)
    cols = (
        "*"
        if include_raw_response
        else "hand_id, llm_provider, play_style, mistakes_found, tags, summary, ev_estimate, analyzed_at"
    )
    with SQLiteConnection(db_path) as conn:
        try:
            rows = conn.execute(
                f"SELECT {cols} FROM ai_analysis WHERE mistakes_found >= ? "
                "ORDER BY analyzed_at DESC LIMIT ? OFFSET ?",
                [min_mistakes, limit + 1, offset],
            ).fetchall()
        except sqlite3.Error:
            return _ok_list([])
        results = [dict(r) for r in rows]
        has_more = len(results) > limit
        return _ok_list(results[:limit], limit=limit, offset=offset, has_more=has_more)


@mcp.tool()
def list_tournaments(
    database: Optional[str] = None,
    site: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
) -> Dict[str, Any]:
    """List tournament_summaries."""
    db_path = _resolve_db(database)
    limit = _clamp_limit(limit, 20)
    where = []
    params: List[Any] = []
    if site:
        where.append("LOWER(site) = LOWER(?)")
        params.append(site)
    sql = (
        "SELECT tournament_id, site, buy_in_raw, buy_in_value, rake_value, "
        "player_count, finish_position, prize, hero_name, imported_at "
        "FROM tournament_summaries"
    )
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY imported_at DESC LIMIT ? OFFSET ?"
    params.extend([limit + 1, offset])
    with SQLiteConnection(db_path) as conn:
        try:
            rows = conn.execute(sql, params).fetchall()
        except sqlite3.Error:
            return _ok_list([])
        results = [dict(r) for r in rows]
        has_more = len(results) > limit
        return _ok_list(results[:limit], limit=limit, offset=offset, has_more=has_more)


@mcp.tool()
def query_hands(
    site: Optional[str] = None,
    game_type: Optional[str] = None,
    is_tournament: Optional[bool] = None,
    position: Optional[str] = None,
    hero_cards: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    won: Optional[bool] = None,
    min_profit: Optional[float] = None,
    max_profit: Optional[float] = None,
    limit: int = 10,
    offset: int = 0,
    format: str = "summary",
    include_raw: bool = False,
    database: Optional[str] = None,
) -> Dict[str, Any]:
    """Unified hand query with shared filters. Summary by default."""
    settings = load_settings()
    db = HandDatabase(str(_resolve_db(database)))
    limit = _clamp_limit(limit)
    where: List[str] = []
    params: List[Any] = []
    if site:
        where.append("LOWER(site) = LOWER(?)")
        params.append(site)
    if game_type:
        where.append("UPPER(game_type) = UPPER(?)")
        params.append(game_type)
    if is_tournament is True:
        where.append("is_tournament = 1")
    elif is_tournament is False:
        where.append("is_tournament = 0")
    if position:
        where.append("UPPER(hero_position) = UPPER(?)")
        params.append(position)
    if hero_cards:
        cards_sql, cards_params = build_cards_sql(hero_cards)
        if not cards_sql:
            raise ValueError("Invalid hero_cards")
        where.append(f"({cards_sql})")
        params.extend(cards_params)
    if date_from:
        where.append("date >= ?")
        params.append(date_from)
    if date_to:
        where.append("date <= ?")
        params.append(date_to)
    if won is True:
        where.append("hero_won > 0")
    elif won is False:
        where.append("hero_won < 0")
    if min_profit is not None:
        where.append("hero_won >= ?")
        params.append(min_profit)
    if max_profit is not None:
        where.append("hero_won <= ?")
        params.append(max_profit)
    where_str = (" WHERE " + " AND ".join(where)) if where else ""
    sql = f"SELECT * FROM hands{where_str} ORDER BY date DESC LIMIT ? OFFSET ?"
    hands = query_and_serialize_hands(
        db, settings, sql, params + [limit + 1, offset],
        format=format, include_raw=include_raw,
    )
    has_more = len(hands) > limit
    return _ok_list(hands[:limit], limit=limit, offset=offset, has_more=has_more)


@mcp.tool()
def get_sessions_winrate(
    site: Optional[str] = None,
    gap_minutes: int = 30,
    limit: int = 10,
    database: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Calculate poker sessions dynamically based on gap minutes and return session winrate, profit, and duration.

    Args:
        site: Filter by site (e.g. 'CoinPoker', 'BetACR').
        gap_minutes: Minutes gap between hands to define a new session (default 30).
        limit: Max sessions to return (default 10).
        database: Optional database name (default: poker_hands).
    """
    from collections import defaultdict
    from datetime import datetime
    settings = load_settings()
    db = HandDatabase(str(_resolve_db(database)))
    
    sql = "SELECT hand_id, date, site, hero_won, is_tournament, hero_position FROM hands"
    params = []
    where_clauses = []
    if site:
        where_clauses.append("site = ?")
        params.append(site)
    if where_clauses:
        sql += " WHERE " + " AND ".join(where_clauses)
    sql += " ORDER BY date ASC"
    
    with db.lock:
        conn = db._connect()
        try:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(sql, params).fetchall()
        finally:
            conn.close()
            
    if not rows:
        return []
        
    hands_by_site = defaultdict(list)
    for r in rows:
        hands_by_site[r["site"]].append(r)
        
    sessions = []
    gap_seconds = gap_minutes * 60
    
    for current_site, site_hands in hands_by_site.items():
        if not site_hands:
            continue
            
        current_session = []
        last_time = None
        
        for h in site_hands:
            h_date_str = h["date"]
            if not h_date_str:
                continue
            try:
                h_date = datetime.fromisoformat(h_date_str)
            except Exception:
                continue
                
            if last_time is not None:
                diff = (h_date - last_time).total_seconds()
                if diff > gap_seconds:
                    sessions.append((current_site, current_session))
                    current_session = []
            
            current_session.append({
                "hand_id": h["hand_id"],
                "date": h_date,
                "hero_won": h["hero_won"] or 0.0,
                "is_tournament": bool(h["is_tournament"]),
                "position": h["hero_position"]
            })
            last_time = h_date
            
        if current_session:
            sessions.append((current_site, current_session))
            
    summary_sessions = []
    for idx, (sess_site, sess) in enumerate(sessions):
        if not sess:
            continue
        first_hand = sess[0]
        last_hand = sess[-1]
        
        hand_count = len(sess)
        total_won = sum(h["hero_won"] for h in sess)
        won_hands = sum(1 for h in sess if h["hero_won"] > 0)
        lost_hands = sum(1 for h in sess if h["hero_won"] < 0)
        
        duration = (last_hand["date"] - first_hand["date"]).total_seconds()
        duration_minutes = round(duration / 60, 1)
        
        winrate_pct = round((won_hands / hand_count) * 100, 1) if hand_count > 0 else 0.0
        
        summary_sessions.append({
            "session_index": idx + 1,
            "site": sess_site,
            "start_time": first_hand["date"].isoformat(),
            "end_time": last_hand["date"].isoformat(),
            "hand_count": hand_count,
            "net_profit": round(total_won, 2),
            "won_hands": won_hands,
            "lost_hands": lost_hands,
            "winrate_pct": winrate_pct,
            "duration_minutes": duration_minutes,
            "hands_per_hour": round(hand_count / (duration / 3600), 1) if duration > 60 else hand_count
        })
        
    summary_sessions.sort(key=lambda s: s["start_time"], reverse=True)
    return summary_sessions[:limit]


@mcp.tool()
def run_network_command(
    command: str,
    args: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Execute network diagnostics and tools (ipconfig, ping, tracert, nslookup, netstat, arp, route, getmac).

    Args:
        command: Network tool to run. Enum: 'ipconfig', 'ping', 'tracert', 'nslookup', 'netstat', 'arp', 'route', 'getmac'.
        args: List of arguments to pass to the command.
    """
    if command not in ["ipconfig", "ping", "tracert", "nslookup", "netstat", "arp", "route", "getmac"]:
        raise ValueError(f"Unauthorized network command: {command}")
    
    cmd_args = args or []
    clean_args = []
    import re
    for arg in cmd_args:
        if re.match(r'^[a-zA-Z0-9\-_\.\/\\:\s\?\*]+$', arg):
            clean_args.append(arg)
        else:
            raise ValueError(f"Invalid characters in argument: {arg}")
            
    cmd_list = [command] + clean_args
    try:
        return _exec_cmd(cmd_list)
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
def run_cloudflare_command(
    command: str,
    args: List[str],
    sub_project: str = "root"
) -> Dict[str, Any]:
    """Execute Cloudflare wrangler or cloudflared commands to inspect configuration, tunnels, D1, or R2.

    Args:
        command: Command to execute. Enum: 'wrangler', 'cloudflared'.
        args: Arguments to pass (e.g. ['tunnel', 'list'] or ['whoami']).
        sub_project: Working directory context to run wrangler command. Enum: 'root', 'mcp-server', 'cloudflare-api', 'poker-daemon-worker'.
    """
    if command not in ["wrangler", "cloudflared"]:
        raise ValueError(f"Unauthorized cloudflare command: {command}")
        
    if sub_project not in ["root", "mcp-server", "cloudflare-api", "poker-daemon-worker"]:
        raise ValueError(f"Unauthorized sub_project: {sub_project}")
        
    proj_dir = REPO_ROOT
    if sub_project == "mcp-server":
        proj_dir = REPO_ROOT / "mcp-server"
    elif sub_project == "cloudflare-api":
        proj_dir = REPO_ROOT / "cloudflare-api"
    elif sub_project == "poker-daemon-worker":
        proj_dir = REPO_ROOT / "poker-daemon" / "worker"
        
    if not proj_dir.is_dir():
        raise ValueError(f"Directory does not exist: {proj_dir}")
        
    clean_args = []
    import re
    for arg in args:
        if re.match(r'^[a-zA-Z0-9\-_\.\/\\:\s=@\"\?\*]+$', arg):
            clean_args.append(arg)
        else:
            raise ValueError(f"Invalid characters in cloudflare argument: {arg}")
            
    if command == "wrangler":
        cmd_list = ["npx", "wrangler"] + clean_args
    else:
        cmd_list = [command] + clean_args
        
    try:
        return _exec_cmd(cmd_list, cwd=str(proj_dir))
    except Exception as e:
        return {"error": str(e)}


class _GrokHeaderMiddleware:
    """Make streamable-HTTP compatible with Grok's remote MCP client.

    Grok (and some proxies) send Accept: */* or omit Accept entirely. The MCP
    SDK rejects those with HTTP 406 unless application/json is present.
    This middleware rewrites Accept / Content-Type before the MCP app runs.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = []
            has_accept = False
            has_content_type = False
            method = scope.get("method", "GET").upper()

            for key, value in scope.get("headers", []):
                lk = key.lower()
                if lk == b"accept":
                    has_accept = True
                    # Force both media types the MCP SDK checks for
                    headers.append((b"accept", b"application/json, text/event-stream"))
                    continue
                if lk == b"content-type":
                    has_content_type = True
                    # Normalize to application/json for POST bodies
                    if method in ("POST", "PUT", "PATCH"):
                        headers.append((b"content-type", b"application/json"))
                        continue
                headers.append((key, value))

            if not has_accept:
                headers.append((b"accept", b"application/json, text/event-stream"))
            if method in ("POST", "PUT", "PATCH") and not has_content_type:
                headers.append((b"content-type", b"application/json"))

            # CORS so browser-side probes from grok.com don't fail
            scope = dict(scope)
            scope["headers"] = headers

            async def send_with_cors(message):
                if message["type"] == "http.response.start":
                    extra = [
                        (b"access-control-allow-origin", b"*"),
                        (b"access-control-allow-methods", b"GET, POST, DELETE, OPTIONS"),
                        (
                            b"access-control-allow-headers",
                            b"content-type, accept, mcp-session-id, mcp-protocol-version, authorization",
                        ),
                        (b"access-control-expose-headers", b"mcp-session-id"),
                    ]
                    message = dict(message)
                    message["headers"] = list(message.get("headers", [])) + extra
                await send(message)

            # Handle preflight
            if method == "OPTIONS":
                await send_with_cors(
                    {
                        "type": "http.response.start",
                        "status": 204,
                        "headers": [
                            (b"content-length", b"0"),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": b""})
                return

            await self.app(scope, receive, send_with_cors)
            return

        await self.app(scope, receive, send)


if __name__ == "__main__":
    transport = os.environ.get("LEAKSNIPE_MCP_TRANSPORT", "streamable-http")
    if transport == "stdio":
        mcp.run(transport="stdio")
    else:
        import uvicorn
        from starlette.applications import Starlette

        port = int(os.environ.get("LEAKSNIPE_MCP_PORT", "8001"))
        # Build Starlette MCP app for streamable-http
        stream_app = mcp.http_app(
            path="/mcp",
            transport="streamable-http",
            json_response=True,
            stateless_http=True,
            host_origin_protection=False,
        )
        # Build Starlette MCP app for sse
        sse_app = mcp.http_app(
            path="/sse",
            transport="sse",
            host_origin_protection=False,
        )
        # Combine routes
        app = Starlette(routes=stream_app.routes + sse_app.routes, lifespan=stream_app.lifespan)
        app = _GrokHeaderMiddleware(app)
        
        print(f"LeakSnipe MCP (Grok/Claude compatible) on http://127.0.0.1:{port} (serving /mcp and /sse)")
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
