import sys
import os
import json
import sqlite3
import traceback
from datetime import datetime

# Add sidecar folder to import search path
REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(REPO_ROOT, "sidecar"))

# Redirect stdout print statements to stderr to prevent corrupting JSON-RPC on stdout
def log_err(msg):
    sys.stderr.write(f"[LeakSnipe-MCP] {msg}\n")
    sys.stderr.flush()

try:
    from models import HandDatabase, Hand
    from paths import resolve_db_path
    from config import load_settings
    from utils import resolve_hand_hero_name
except Exception as e:
    log_err(f"Imports failed: {e}\n{traceback.format_exc()}")
    sys.exit(1)

def get_db():
    try:
        settings = load_settings()
        db_path = resolve_db_path(settings)
        return HandDatabase(db_path), settings
    except Exception as e:
        log_err(f"Failed to connect to database: {e}")
        raise

def serialize_hand(hand: Hand, settings: dict, *, format: str = "summary", include_raw: bool = False) -> dict:
    """Default format=summary omits raw_text/streets to save agent context."""
    hero_name = resolve_hand_hero_name(
        settings,
        hand.site,
        players=hand.players,
        raw_text=hand.raw_text,
        hero_player=getattr(hand, "hero_player", ""),
    )
    date_str = hand.date.isoformat() if hand.date else None
    full = format == "full" or include_raw
    out = {
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
    if full:
        out["players"] = [
            {
                "seat": seat,
                "name": p["name"],
                "stack": p["stack"],
                "is_hero": p.get("is_hero", False),
            }
            for seat, p in hand.players.items()
        ]
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
        out["raw_text"] = hand.raw_text
    return out

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
            fmt = "summary"
            return [serialize_hand(h, settings, format=fmt) for h in hands]
        finally:
            conn.close()

def calculate_sessions(db, settings, site=None, gap_minutes=30, limit=10):
    from collections import defaultdict
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

def exec_cmd(cmd_list, cwd=None):
    try:
        import subprocess
        cmd_str = " ".join(cmd_list)
        res = subprocess.run(
            cmd_str,
            cwd=cwd,
            shell=True,
            capture_output=True,
            timeout=30
        )
        
        def safe_decode(b):
            if not b:
                return ""
            for encoding in ['utf-8', 'cp1252', 'cp850']:
                try:
                    return b.decode(encoding)
                except UnicodeDecodeError:
                    continue
            return b.decode('utf-8', errors='replace')

        return {
            "stdout": safe_decode(res.stdout),
            "stderr": safe_decode(res.stderr),
            "exit_code": res.returncode
        }
    except Exception as e:
        return {
            "error": str(e)
        }

def handle_request(req):
    method = req.get("method")
    params = req.get("params", {})
    req_id = req.get("id")

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": {
                    "name": "LeakSnipe MCP Server",
                    "version": "2.0.0"
                }
            }
        }

    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "tools": [
                    {
                        "name": "get_all_heroes",
                        "description": "List all hero/user names registered in the tracker database (e.g. gboss101, jdwalka).",
                        "inputSchema": {
                            "type": "object",
                            "properties": {}
                        }
                    },
                    {
                        "name": "get_totals_stats",
                        "description": "Retrieve aggregate statistics (total hands, collected, lost, net profit) from the database.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "site": {"type": "string", "description": "Filter by site ('CoinPoker' or 'BetACR')"},
                                "tag": {"type": "string", "description": "Filter by custom tag"},
                                "user": {"type": "string", "description": "Filter by hero name ('Gboss101' or 'jdwalka')"},
                                "start_date": {"type": "string", "description": "ISO format start date (YYYY-MM-DD)"},
                                "end_date": {"type": "string", "description": "ISO format end date (YYYY-MM-DD)"}
                            }
                        }
                    },
                    {
                        "name": "search_hands",
                        "description": "Natural language search across hands (e.g. 'my last 3-bet pot from cutoff')",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "query": {"type": "string", "description": "Natural language search query like '3-bet from cutoff'"},
                                "limit": {"type": "integer", "description": "Max hands to return (default 10)"},
                                "offset": {"type": "integer", "description": "Pagination offset"}
                            },
                            "required": ["query"]
                        }
                    },
                    {
                        "name": "get_recent_hands",
                        "description": "Returns the most recent hands played by the user",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "limit": {"type": "integer", "description": "Max hands to return (default 10)"},
                                "since": {"type": "string", "description": "ISO timestamp (YYYY-MM-DD) to get hands after"}
                            }
                        }
                    },
                    {
                        "name": "get_hands_by_cards",
                        "description": "Returns hands containing specific hole cards (e.g. 'QQ', 'AKs', '76s')",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "cards": {"type": "string", "description": "Card string like 'QQ', 'AK', '76s'"},
                                "limit": {"type": "integer", "description": "Max hands to return (default 10)"}
                            },
                            "required": ["cards"]
                        }
                    },
                    {
                        "name": "get_biggest_winning_hands",
                        "description": "Returns the biggest winning hands by profit",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "limit": {"type": "integer", "description": "Max hands to return (default 10)"}
                            }
                        }
                    },
                    {
                        "name": "get_winrate_by_position",
                        "description": "Returns winrate statistics broken down by position",
                        "inputSchema": {
                            "type": "object",
                            "properties": {}
                        }
                    },
                    {
                        "name": "get_hands_by_position",
                        "description": "Returns hands played from a specific position",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "position": {"type": "string", "enum": ["UTG","MP","HJ","CO","BTN","SB","BB"], "description": "Table position"},
                                "limit": {"type": "integer", "description": "Max hands to return (default 10)"}
                            },
                            "required": ["position"]
                        }
                    },
                    {
                        "name": "get_hand_detail",
                        "description": "Retrieve the complete action-by-action detail and raw hand history log for a specific hand ID.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "hand_id": {"type": "string", "description": "The unique hand ID"}
                            },
                            "required": ["hand_id"]
                        }
                    },
                    {
                        "name": "add_tag",
                        "description": "Tag a specific hand with a label.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "hand_id": {"type": "string", "description": "The unique hand ID"},
                                "tag": {"type": "string", "description": "Custom label to add"}
                            },
                            "required": ["hand_id", "tag"]
                        }
                    },
                    {
                        "name": "remove_tag",
                        "description": "Remove a tag from a specific hand.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "hand_id": {"type": "string", "description": "The unique hand ID"},
                                "tag": {"type": "string", "description": "Custom label to remove"}
                            },
                            "required": ["hand_id", "tag"]
                        }
                    },
                    {
                        "name": "get_sessions_winrate",
                        "description": "Calculate poker sessions dynamically based on gap minutes and return session winrate, profit, and duration.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "site": {"type": "string", "description": "Filter by poker site (e.g. 'CoinPoker', 'BetACR')"},
                                "gap_minutes": {"type": "integer", "description": "Minutes gap between hands to define a new session (default 30)"},
                                "limit": {"type": "integer", "description": "Max sessions to return (default 10)"}
                            }
                        }
                    },
                    {
                        "name": "run_network_command",
                        "description": "Execute network diagnostics and tools (ipconfig, ping, tracert, nslookup, netstat, arp, route).",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "command": {
                                    "type": "string", 
                                    "enum": ["ipconfig", "ping", "tracert", "nslookup", "netstat", "arp", "route", "getmac"],
                                    "description": "Network tool to run"
                                },
                                "args": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "List of arguments to pass to the command (e.g. ['-ano'] or ['db.leaksnipe.win'])"
                                }
                            },
                            "required": ["command"]
                        }
                    },
                    {
                        "name": "run_cloudflare_command",
                        "description": "Execute Cloudflare wrangler or cloudflared commands to inspect configuration, tunnels, D1, or R2.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "command": {
                                    "type": "string",
                                    "enum": ["wrangler", "cloudflared"],
                                    "description": "Command to execute"
                                },
                                "args": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Arguments to pass (e.g. ['tunnel', 'list'] or ['whoami'])"
                                },
                                "sub_project": {
                                    "type": "string",
                                    "enum": ["root", "mcp-server", "cloudflare-api", "poker-daemon-worker"],
                                    "description": "Working directory context to run wrangler command (default: 'root')"
                                }
                            },
                            "required": ["command", "args"]
                        }
                    }
                ]
            }
        }

    elif method == "tools/call":
        tool_name = params.get("name")
        args = params.get("arguments", {})
        db, settings = get_db()

        try:
            if tool_name == "get_all_heroes":
                heroes = db.get_all_heroes()
                return json_rpc_success(req_id, {"heroes": heroes})

            elif tool_name == "get_totals_stats":
                res = db.search_hands(
                    site=args.get("site"),
                    tag=args.get("tag"),
                    start_date=args.get("start_date"),
                    end_date=args.get("end_date"),
                    hero_name=args.get("user"),
                    limit=1,
                    offset=0
                )
                return json_rpc_success(req_id, {"totals": res["totals"]})

            elif tool_name == "search_hands":
                query = args.get("query", "")
                limit = min(args.get("limit", 10), 100)
                offset = args.get("offset", 0)
                where_str, sql_params, parsed_limit = parse_natural_language_query(query)
                if not args.get("limit"):
                    limit = parsed_limit
                sql = f"SELECT * FROM hands{where_str} ORDER BY date DESC LIMIT ? OFFSET ?"
                hands = query_and_serialize_hands(db, settings, sql, sql_params + [limit, offset])
                return json_rpc_success(req_id, {"hands": hands})

            elif tool_name == "get_recent_hands":
                limit = min(args.get("limit", 10), 100)
                since = args.get("since")
                where_clauses = []
                sql_params = []
                if since:
                    where_clauses.append("date >= ?")
                    sql_params.append(since)
                where_str = ""
                if where_clauses:
                    where_str = " WHERE " + " AND ".join(where_clauses)
                sql = f"SELECT * FROM hands{where_str} ORDER BY date DESC LIMIT ?"
                hands = query_and_serialize_hands(db, settings, sql, sql_params + [limit])
                return json_rpc_success(req_id, {"hands": hands})

            elif tool_name == "get_hands_by_cards":
                cards = args.get("cards", "")
                limit = min(args.get("limit", 10), 100)
                cards_sql, cards_params = build_cards_sql(cards)
                if not cards_sql:
                    return json_rpc_error(req_id, -32602, "Invalid cards specified")
                sql = f"SELECT * FROM hands WHERE {cards_sql} ORDER BY date DESC LIMIT ?"
                hands = query_and_serialize_hands(db, settings, sql, cards_params + [limit])
                return json_rpc_success(req_id, {"hands": hands})

            elif tool_name == "get_biggest_winning_hands":
                limit = min(args.get("limit", 10), 100)
                sql = "SELECT * FROM hands WHERE hero_won > 0 ORDER BY hero_won DESC LIMIT ?"
                hands = query_and_serialize_hands(db, settings, sql, [limit])
                return json_rpc_success(req_id, {"hands": hands})

            elif tool_name == "get_winrate_by_position":
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
                        stats = [dict(r) for r in rows]
                        return json_rpc_success(req_id, {"winrate_by_position": stats})
                    finally:
                        conn.close()

            elif tool_name == "get_hands_by_position":
                position = args.get("position", "").upper()
                limit = min(args.get("limit", 10), 100)
                sql = "SELECT * FROM hands WHERE UPPER(hero_position) = ? ORDER BY date DESC LIMIT ?"
                hands = query_and_serialize_hands(db, settings, sql, [position, limit])
                return json_rpc_success(req_id, {"hands": hands})

            elif tool_name == "get_hand_detail" or tool_name == "get_hand":
                hand_id = args.get("hand_id") or args.get("id")
                hand = db.get_hand_by_id(hand_id)
                if not hand:
                    return json_rpc_error(req_id, -32602, f"Hand not found: {hand_id}")
                detail = serialize_hand(
                    hand,
                    settings,
                    format=args.get("format", "full"),
                    include_raw=bool(args.get("include_raw", True)),
                )
                return json_rpc_success(req_id, {"success": True, "found": True, "result": detail, "hand": detail})

            elif tool_name == "add_tag":
                hand_id = args.get("hand_id")
                tag = args.get("tag")
                db.add_tag(hand_id, tag)
                return json_rpc_success(req_id, {"ok": True, "tags": db.get_tags(hand_id)})

            elif tool_name == "remove_tag":
                hand_id = args.get("hand_id")
                tag = args.get("tag")
                db.remove_tag(hand_id, tag)
                return json_rpc_success(req_id, {"ok": True, "tags": db.get_tags(hand_id)})

            elif tool_name == "get_sessions_winrate":
                site = args.get("site")
                gap_minutes = args.get("gap_minutes", 30)
                limit = min(args.get("limit", 10), 100)
                sessions = calculate_sessions(db, settings, site=site, gap_minutes=gap_minutes, limit=limit)
                return json_rpc_success(req_id, {"sessions": sessions})

            elif tool_name == "run_network_command":
                cmd = args.get("command")
                cmd_args = args.get("args", [])
                if cmd not in ["ipconfig", "ping", "tracert", "nslookup", "netstat", "arp", "route", "getmac"]:
                    return json_rpc_error(req_id, -32602, f"Unauthorized network command: {cmd}")
                
                clean_args = []
                import re
                for arg in cmd_args:
                    if re.match(r'^[a-zA-Z0-9\-_\.\/\\:\s\?\*]+$', arg):
                        clean_args.append(arg)
                    else:
                        return json_rpc_error(req_id, -32602, f"Invalid characters in argument: {arg}")
                
                cmd_list = [cmd] + clean_args
                res = exec_cmd(cmd_list)
                return json_rpc_success(req_id, res)

            elif tool_name == "run_cloudflare_command":
                cmd = args.get("command")
                cmd_args = args.get("args", [])
                sub_proj = args.get("sub_project", "root")
                
                if cmd not in ["wrangler", "cloudflared"]:
                    return json_rpc_error(req_id, -32602, f"Unauthorized cloudflare command: {cmd}")
                
                proj_dir = REPO_ROOT
                if sub_proj == "mcp-server":
                    proj_dir = os.path.join(REPO_ROOT, "mcp-server")
                elif sub_proj == "cloudflare-api":
                    proj_dir = os.path.join(REPO_ROOT, "cloudflare-api")
                elif sub_proj == "poker-daemon-worker":
                    proj_dir = os.path.join(REPO_ROOT, "poker-daemon", "worker")
                
                if not os.path.isdir(proj_dir):
                    return json_rpc_error(req_id, -32602, f"Directory does not exist: {proj_dir}")
                
                clean_args = []
                import re
                for arg in cmd_args:
                    if re.match(r'^[a-zA-Z0-9\-_\.\/\\:\s=@\"\?\*]+$', arg):
                        clean_args.append(arg)
                    else:
                        return json_rpc_error(req_id, -32602, f"Invalid characters in cloudflare argument: {arg}")
                
                if cmd == "wrangler":
                    cmd_list = ["npx", "wrangler"] + clean_args
                else:
                    cmd_list = [cmd] + clean_args
                
                res = exec_cmd(cmd_list, cwd=proj_dir)
                return json_rpc_success(req_id, res)

            else:
                return json_rpc_error(req_id, -32601, f"Method not found: {tool_name}")

        except Exception as err:
            log_err(f"Error executing tool {tool_name}: {err}\n{traceback.format_exc()}")
            return json_rpc_error(req_id, -32000, str(err))

    # Respond to fallback or notifications silently
    if req_id is not None:
        return json_rpc_error(req_id, -32601, f"Method not found: {method}")
    return None

def json_rpc_success(req_id, result):
    # Formulate content response list as required by MCP tools
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "result": {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(result, indent=2)
                }
            ]
        }
    }

def json_rpc_error(req_id, code, message):
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {
            "code": code,
            "message": message
        }
    }

def main():
    log_err("LeakSnipe MCP server started on stdio.")
    
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            
            req = json.loads(line)
            response = handle_request(req)
            if response:
                sys.stdout.write(json.dumps(response) + "\n")
                sys.stdout.flush()
        except Exception as e:
            log_err(f"Loop error: {e}")

if __name__ == "__main__":
    main()
