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
    instructions=(
        "LeakSnipe poker hand database (sqlite). Default DB: poker_hands. "
        "Heroes tracked: Gboss101/gboss101 and jdwalka/Johndawalka. "
        "Find hero hands by joining hands with players where is_hero=1 and "
        "name matches (use lower(name) LIKE '%gboss101%' or '%jdwalka%'). "
        "Tools: list_databases, list_tables, describe_table, read_query, "
        "database_overview. Only SELECT/WITH allowed."
    ),
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


def serialize_hand(hand: Hand, settings: dict) -> dict:
    hero_name = resolve_hand_hero_name(
        settings,
        hand.site,
        players=hand.players,
        raw_text=hand.raw_text,
        hero_player=getattr(hand, "hero_player", ""),
    )
    date_str = hand.date.isoformat() if hand.date else None
    
    return {
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
        "players": [
            {
                "seat": seat,
                "name": p["name"],
                "stack": p["stack"],
                "is_hero": p.get("is_hero", False)
            }
            for seat, p in hand.players.items()
        ],
        "streets": [
            {
                "name": street.get("name", ""),
                "cards": street.get("cards", []),
                "actions": [
                    {
                        "player": act.get("player", ""),
                        "action": act.get("action", ""),
                        "amount": act.get("amount", 0.0)
                    }
                    for act in street.get("actions", [])
                ]
            }
            for street in getattr(hand, "streets", [])
        ],
        "winners": [
            {
                "name": w["name"],
                "amount": w["amount"]
            }
            for w in getattr(hand, "winners", [])
        ],
        "raw_text": hand.raw_text
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

def query_and_serialize_hands(db, settings, sql, params):
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
            return [serialize_hand(h, settings) for h in hands]
        finally:
            conn.close()


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
    database: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Returns the most recent hands played by the user.

    Args:
        limit: Max hands to return (default 10).
        since: ISO timestamp YYYY-MM-DD to get hands after.
        database: Optional database name (default: poker_hands).
    """
    settings = load_settings()
    db = HandDatabase(str(_resolve_db(database)))
    where_clauses = []
    sql_params = []
    if since:
        where_clauses.append("date >= ?")
        sql_params.append(since)
    where_str = ""
    if where_clauses:
        where_str = " WHERE " + " AND ".join(where_clauses)
    sql = f"SELECT * FROM hands{where_str} ORDER BY date DESC LIMIT ?"
    return query_and_serialize_hands(db, settings, sql, sql_params + [limit])


@mcp.tool()
def get_hands_by_cards(
    cards: str,
    limit: int = 10,
    database: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Returns hands containing specific hole cards (e.g. 'QQ', 'AKs', '76s').

    Args:
        cards: Card string like 'QQ', 'AK', '76s'.
        limit: Max hands to return (default 10).
        database: Optional database name (default: poker_hands).
    """
    settings = load_settings()
    db = HandDatabase(str(_resolve_db(database)))
    cards_sql, cards_params = build_cards_sql(cards)
    if not cards_sql:
        raise ValueError("Invalid cards specified")
    sql = f"SELECT * FROM hands WHERE {cards_sql} ORDER BY date DESC LIMIT ?"
    return query_and_serialize_hands(db, settings, sql, cards_params + [limit])


@mcp.tool()
def get_biggest_winning_hands(
    limit: int = 10,
    database: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Returns the biggest winning hands by profit.

    Args:
        limit: Max hands to return (default 10).
        database: Optional database name (default: poker_hands).
    """
    settings = load_settings()
    db = HandDatabase(str(_resolve_db(database)))
    sql = "SELECT * FROM hands WHERE hero_won > 0 ORDER BY hero_won DESC LIMIT ?"
    return query_and_serialize_hands(db, settings, sql, [limit])


@mcp.tool()
def get_winrate_by_position(
    database: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Returns winrate statistics broken down by position.

    Args:
        database: Optional database name (default: poker_hands).
    """
    db = HandDatabase(str(_resolve_db(database)))
    sql = """
        SELECT 
            hero_position,
            COUNT(*) as hands_played,
            SUM(hero_won) as net_profit,
            SUM(CASE WHEN hero_won > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as win_rate
        FROM hands
        WHERE hero_position IS NOT NULL AND hero_position != '?'
        GROUP BY hero_position
        ORDER BY net_profit DESC
    """
    with db.lock:
        conn = db._connect()
        try:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(sql).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()


@mcp.tool()
def get_hands_by_position(
    position: str,
    limit: int = 10,
    database: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Returns hands played from a specific position.

    Args:
        position: Position like 'UTG', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'.
        limit: Max hands to return (default 10).
        database: Optional database name (default: poker_hands).
    """
    settings = load_settings()
    db = HandDatabase(str(_resolve_db(database)))
    sql = "SELECT * FROM hands WHERE UPPER(hero_position) = ? ORDER BY date DESC LIMIT ?"
    return query_and_serialize_hands(db, settings, sql, [position.upper(), limit])


@mcp.tool()
def search_hands(
    query: str,
    limit: Optional[int] = None,
    offset: int = 0,
    database: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Natural language search across hands (e.g. 'my last 3-bet pot from cutoff').

    Args:
        query: Natural language search query.
        limit: Optional limit to override query limit.
        offset: Pagination offset.
        database: Optional database name (default: poker_hands).
    """
    settings = load_settings()
    db = HandDatabase(str(_resolve_db(database)))
    where_str, sql_params, parsed_limit = parse_natural_language_query(query)
    lim = limit if limit is not None else parsed_limit
    sql = f"SELECT * FROM hands{where_str} ORDER BY date DESC LIMIT ? OFFSET ?"
    return query_and_serialize_hands(db, settings, sql, sql_params + [lim, offset])


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
