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
                    "version": "1.0.0"
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
                        "description": "Search and list hands matching filters. Returns hand summaries with cards, dates, and profits.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "site": {"type": "string", "description": "Filter by site"},
                                "tag": {"type": "string", "description": "Filter by custom tag"},
                                "user": {"type": "string", "description": "Filter by hero name"},
                                "start_date": {"type": "string", "description": "ISO start date"},
                                "end_date": {"type": "string", "description": "ISO end date"},
                                "limit": {"type": "integer", "description": "Max hands to return (default 20, max 200)"},
                                "offset": {"type": "integer", "description": "Offset offset for pagination"}
                            }
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
                limit = min(args.get("limit", 20), 200)
                offset = args.get("offset", 0)
                res = db.search_hands(
                    site=args.get("site"),
                    tag=args.get("tag"),
                    start_date=args.get("start_date"),
                    end_date=args.get("end_date"),
                    hero_name=args.get("user"),
                    limit=limit,
                    offset=offset
                )
                # Map raw hands to summaries
                from server import hands_to_summaries
                summaries = hands_to_summaries(res["hands"], settings)
                return json_rpc_success(req_id, {
                    "total": res["total"],
                    "hands": summaries
                })

            elif tool_name == "get_hand_detail":
                hand_id = args.get("hand_id")
                hand = db.get_hand_by_id(hand_id)
                if not hand:
                    return json_rpc_error(req_id, -32602, f"Hand not found: {hand_id}")
                detail = serialize_hand(hand, settings)
                return json_rpc_success(req_id, {"hand": detail})

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
