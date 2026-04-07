"""
Hand importing from files and DriveHUD 2 database synchronization.
Supports file watching, batch imports, and DriveHUD 2 integration.
"""

import os
import json
import sqlite3
import threading
import hashlib
import re
from typing import Dict, List, Tuple, Optional, Any, Callable
from datetime import datetime
from collections import defaultdict
import logging

from models import Hand, HandDatabase
from parsers import HandParser


def _canonical_path(path: str) -> str:
    """Convert path to canonical form for comparison."""
    if not path:
        return ""
    try:
        return os.path.normcase(os.path.realpath(os.path.normpath(path)))
    except Exception:
        return os.path.normcase(os.path.normpath(path))


def _is_drive_root(path: str) -> bool:
    """Check if path is a drive root."""
    if not path:
        return False
    norm = os.path.normpath(path)
    drive, tail = os.path.splitdrive(norm)
    return bool(drive) and tail in ("\\", "/")


class HandImporter:
    """Watches hand history directories and imports new hands."""

    def __init__(self, settings: Dict[str, Any], db: Optional[HandDatabase] = None):
        self.settings = settings
        self.parser = HandParser(settings)
        self.db = db
        self.hands: List[Hand] = []
        self.files_scanned: set = set()
        self.file_mtimes: Dict[str, float] = {}
        self.file_signatures: Dict[str, Tuple] = {}
        self.lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def update_settings(self, settings: Dict[str, Any]) -> None:
        """Update settings and recreate parser."""
        with self.lock:
            self.settings = settings
            self.parser = HandParser(settings)

    def _save_hand_if_new(self, hand: Hand, source_file: str) -> bool:
        """Save hand to database or memory if it doesn't exist."""
        if self.db:
            if self.db.hand_exists(hand.hand_id):
                return False
            self.db.save_hand(hand, source_file=source_file)
            return True

        with self.lock:
            existing_ids = {hh.hand_id for hh in self.hands}
            if hand.hand_id in existing_ids:
                return False
            self.hands.append(hand)
            return True

    def _get_file_signature(self, fpath: str) -> Optional[Tuple[int, int, str]]:
        """Get file signature (mtime, size, tail hash)."""
        try:
            stat = os.stat(fpath)
        except OSError as exc:
            logging.warning("Failed to stat hand history %s: %s", fpath, exc)
            return None

        mtime_ns = getattr(stat, "st_mtime_ns", int(stat.st_mtime * 1_000_000_000))
        size = stat.st_size

        try:
            with open(fpath, "rb") as fh:
                if size > 4096:
                    fh.seek(-4096, os.SEEK_END)
                tail_hash = hashlib.sha1(fh.read()).hexdigest()
        except OSError as exc:
            logging.warning("Failed to read hand history tail %s: %s", fpath, exc)
            return None

        return (mtime_ns, size, tail_hash)

    def full_scan(self) -> Tuple[int, int]:
        """Scan all configured directories and import new hands. Returns (saved, files_scanned)."""
        saved = 0
        files_count = 0
        for entry in self.settings.get("scan_dirs", []):
            path = os.path.normpath(entry["path"])
            site = entry["site"]
            if _is_drive_root(path):
                continue
            if not os.path.isdir(path):
                continue
            for root, dirs, files in os.walk(path):
                for fname in files:
                    if not fname.lower().endswith(".txt"):
                        continue
                    fpath = os.path.join(root, fname)
                    signature = self._get_file_signature(fpath)
                    if signature is None:
                        continue
                    if self.file_signatures.get(fpath) == signature:
                        continue
                    self.file_signatures[fpath] = signature
                    self.file_mtimes[fpath] = signature[0]
                    try:
                        parsed = self.parser.parse_file(fpath, site)
                    except Exception as exc:
                        logging.error("Failed to parse hand history %s: %s", fpath, exc, exc_info=True)
                        continue
                    for h in parsed:
                        if self._save_hand_if_new(h, fpath):
                            saved += 1
                    files_count += 1
                    self.files_scanned.add(fpath)
        return saved, files_count

    def import_files(self, file_paths: List[str]) -> Tuple[int, int]:
        """Import hands from explicit file paths. Returns (saved, files_count)."""
        new_hands: List[Tuple[Hand, str]] = []
        files_count = 0
        for fpath in file_paths:
            if not os.path.isfile(fpath):
                continue
            try:
                with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
            except Exception:
                continue
            detected = self.parser.detect_site(content)
            if detected is None:
                continue
            parsed = self.parser.parse_file(fpath, detected)
            for h in parsed:
                if self.db and self.db.hand_exists(h.hand_id):
                    continue
                new_hands.append((h, fpath))
            files_count += 1
            signature = self._get_file_signature(fpath)
            if signature is not None:
                self.file_signatures[fpath] = signature
                self.file_mtimes[fpath] = signature[0]
            self.files_scanned.add(fpath)
        saved = 0
        for h, fpath in new_hands:
            if self.db:
                self.db.save_hand(h, source_file=fpath)
                saved += 1
            else:
                with self.lock:
                    existing_ids = {hh.hand_id for hh in self.hands}
                    if h.hand_id not in existing_ids:
                        self.hands.append(h)
                        saved += 1
        return saved, files_count

    def start_watcher(self, callback: Optional[Callable] = None) -> None:
        """Start background file watcher."""
        self._stop.clear()
        self._thread = threading.Thread(target=self._watch_loop, args=(callback,), daemon=True)
        self._thread.start()

    def stop_watcher(self) -> None:
        """Stop background file watcher."""
        self._stop.set()

    def _watch_loop(self, callback: Optional[Callable]) -> None:
        """Background loop for watching files."""
        while not self._stop.is_set():
            try:
                new_count, file_count = self.full_scan()
                if callback and new_count > 0:
                    callback(new_count, file_count)
            except Exception as e:
                logging.error(f"Error in watch loop: {e}", exc_info=True)
            interval = self.settings.get("refresh_interval", 5)
            self._stop.wait(interval)

    def get_hands(self) -> List[Hand]:
        """Get all hands from database or memory."""
        if self.db:
            return self.db.get_all_hands()
        with self.lock:
            return list(self.hands)

    def get_stats_text(self) -> str:
        """Get human-readable stats text."""
        if self.db:
            counts = self.db.get_hand_count()
            total = sum(counts.values())
            parts = [f"{site}: {count}" for site, count in counts.items() if count > 0]
            fcount = len(self.files_scanned)
            return f"{total} hands imported from {fcount} files ({', '.join(parts)})"
        with self.lock:
            total = len(self.hands)
            counts = defaultdict(int)
            for h in self.hands:
                counts[h.site] += 1
            parts = [f"{site}: {count}" for site, count in counts.items()]
            fcount = len(self.files_scanned)
        return f"{total} hands imported from {fcount} files ({', '.join(parts)})"


# DriveHUD 2 constants
DH2_SITE_MAP = {44: "CoinPoker", 12: "BetACR", 24: "BetACR"}
DH2_GAMETYPE_MAP = {1: "NLHE", 2: "LHE", 3: "PLO", 4: "NLO", 5: "PLO8", 29: "NLHE", 30: "NLHE"}


def _candidate_dh2_db_paths(configured_path: str = "") -> List[str]:
    """Find candidate DriveHUD 2 database paths."""
    seen = set()
    candidates = []

    def add(path: str) -> None:
        if not path:
            return
        key = _canonical_path(path) or os.path.normcase(os.path.normpath(path))
        if key in seen:
            return
        seen.add(key)
        candidates.append(path)

    add(configured_path)
    add(r"C:\Users\user\AppData\Roaming\DriveHUD 2\drivehud.db")

    username = os.environ.get("USERNAME", "").strip()
    for letter in "CDEFGHIJKLMNOPQRSTUVWXYZ":
        drive_root = f"{letter}:\\"
        if not os.path.isdir(drive_root):
            continue

        if username:
            add(os.path.join(drive_root, "Users", username, "AppData", "Roaming", "DriveHUD 2", "drivehud.db"))
            add(os.path.join(drive_root, "Documents and Settings", username, "AppData", "Roaming", "DriveHUD 2", "drivehud.db"))

        users_root = os.path.join(drive_root, "Users")
        if os.path.isdir(users_root):
            try:
                for entry in os.listdir(users_root):
                    add(os.path.join(users_root, entry, "AppData", "Roaming", "DriveHUD 2", "drivehud.db"))
            except OSError:
                pass

    return candidates


def resolve_dh2_db_path(configured_path: str = "") -> str:
    """Resolve the path to DriveHUD 2 database."""
    configured_path = (configured_path or "").strip()
    if configured_path and os.path.exists(configured_path):
        return os.path.normpath(configured_path)

    for candidate in _candidate_dh2_db_paths(configured_path):
        if os.path.exists(candidate):
            return os.path.normpath(candidate)

    return os.path.normpath(configured_path or r"C:\Users\user\AppData\Roaming\DriveHUD 2\drivehud.db")


class DriveHUD2Sync:
    """Syncs hands from DriveHUD 2's SQLite database."""

    def __init__(self, settings: Dict[str, Any], db: Optional[HandDatabase] = None, state_file: str = ""):
        self.settings = settings
        self.db = db
        self.parser = HandParser(settings)
        self.lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.last_id: int = 0
        self.last_sync: Optional[datetime] = None
        self.total_imported: int = 0
        self.dh2_db_path = resolve_dh2_db_path(settings.get("dh2_db_path", ""))
        self.settings["dh2_db_path"] = self.dh2_db_path
        self.secondary_last_ids: Dict[str, int] = {}
        self.state_file = state_file or "dh2_sync_state.json"
        self._load_state()

    def _load_state(self) -> None:
        """Load sync state from JSON file."""
        try:
            if os.path.exists(self.state_file):
                with open(self.state_file, "r") as f:
                    state = json.load(f)
                self.last_id = state.get("last_id", 0)
                self.total_imported = state.get("total_imported", 0)
                for key, val in state.items():
                    if key.startswith("last_id_"):
                        self.secondary_last_ids[key[len("last_id_"):]] = int(val)
        except Exception:
            pass

    def _save_state(self) -> None:
        """Save sync state to JSON file."""
        try:
            state = {"last_id": self.last_id, "total_imported": self.total_imported}
            for canon_path, lid in self.secondary_last_ids.items():
                state[f"last_id_{canon_path}"] = lid
            with open(self.state_file, "w") as f:
                json.dump(state, f)
        except Exception:
            pass

    def _connect_dh2(self) -> Optional[sqlite3.Connection]:
        """Open DH2 database in read-only mode."""
        self.dh2_db_path = resolve_dh2_db_path(self.settings.get("dh2_db_path", self.dh2_db_path))
        self.settings["dh2_db_path"] = self.dh2_db_path
        if not os.path.exists(self.dh2_db_path):
            return None
        uri = f"file:{self.dh2_db_path}?mode=ro"
        conn = sqlite3.connect(uri, uri=True, timeout=5)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.row_factory = sqlite3.Row
        return conn

    def sync(self) -> int:
        """Sync new hands from DH2. Returns count of new hands."""
        conn = self._connect_dh2()
        if conn is None:
            return 0
        try:
            rows = conn.execute(
                "SELECT HandHistoryId, HandHistory, PokerSiteId, HandHistoryTimestamp, "
                "GameType, TournamentNumber FROM HandHistories "
                "WHERE HandHistoryId > ? ORDER BY HandHistoryId ASC",
                (self.last_id,)
            ).fetchall()
            if not rows:
                self.last_sync = datetime.now()
                saved_secondary = self._sync_secondary_dbs()
                if saved_secondary:
                    self.total_imported += saved_secondary
                    self._save_state()
                return saved_secondary

            saved = 0
            for row in rows:
                hh_id = row["HandHistoryId"]
                raw = row["HandHistory"] or ""
                site_id = row["PokerSiteId"] or 0
                site_name = DH2_SITE_MAP.get(site_id, "Unknown")
                game_type_id = row["GameType"] or 0
                tournament_num = row["TournamentNumber"] or ""

                try:
                    if raw.strip().startswith("<?xml") or raw.strip().startswith("<HandHistory"):
                        hand = self._parse_dh2_xml(raw, site_name, game_type_id, tournament_num)
                    else:
                        hand = self._parse_dh2_text(raw, site_name)

                    if hand and hand.hand_id:
                        if self.db and not self.db.hand_exists(hand.hand_id):
                            self.db.save_hand(hand, source_file=f"DriveHUD2:{hh_id}")
                            saved += 1
                except Exception:
                    pass

                self.last_id = max(self.last_id, hh_id)

            self.total_imported += saved
            self.last_sync = datetime.now()
            saved += self._sync_secondary_dbs()
            self._save_state()
            return saved
        finally:
            conn.close()

    def _sync_secondary_dbs(self) -> int:
        """Sync hands from secondary DH2 databases. Returns count of new hands."""
        total_saved = 0
        primary_canon = _canonical_path(self.dh2_db_path)
        extra_paths = self.settings.get("dh2_db_paths", [])

        for raw_path in extra_paths:
            if not raw_path:
                continue
            resolved = resolve_dh2_db_path(raw_path)
            if not os.path.exists(resolved):
                continue
            canon = _canonical_path(resolved)
            if canon == primary_canon:
                continue

            last_id_for_db = self.secondary_last_ids.get(canon, 0)

            try:
                uri = f"file:{resolved}?mode=ro"
                conn2 = sqlite3.connect(uri, uri=True, timeout=5)
                conn2.execute("PRAGMA journal_mode=WAL")
                conn2.row_factory = sqlite3.Row
            except Exception as e:
                print(f"[DriveHUD2] Cannot open secondary DB {resolved}: {e}")
                continue

            try:
                rows = conn2.execute(
                    "SELECT HandHistoryId, HandHistory, PokerSiteId, HandHistoryTimestamp, "
                    "GameType, TournamentNumber FROM HandHistories "
                    "WHERE HandHistoryId > ? ORDER BY HandHistoryId ASC",
                    (last_id_for_db,)
                ).fetchall()

                saved = 0
                for row in rows:
                    hh_id = row["HandHistoryId"]
                    raw = row["HandHistory"] or ""
                    site_id = row["PokerSiteId"] or 0
                    site_name = DH2_SITE_MAP.get(site_id, "Unknown")
                    game_type_id = row["GameType"] or 0
                    tournament_num = row["TournamentNumber"] or ""

                    try:
                        if raw.strip().startswith("<?xml") or raw.strip().startswith("<HandHistory"):
                            hand = self._parse_dh2_xml(raw, site_name, game_type_id, tournament_num)
                        else:
                            hand = self._parse_dh2_text(raw, site_name)

                        if hand and hand.hand_id:
                            if self.db and not self.db.hand_exists(hand.hand_id):
                                self.db.save_hand(hand, source_file=f"DriveHUD2-2:{hh_id}")
                                saved += 1
                    except Exception:
                        pass

                    last_id_for_db = max(last_id_for_db, hh_id)

                self.secondary_last_ids[canon] = last_id_for_db
                total_saved += saved

            except Exception as e:
                print(f"[DriveHUD2] Error syncing secondary DB {resolved}: {e}")
            finally:
                conn2.close()

        return total_saved

    def _parse_dh2_xml(self, xml_text: str, site_name: str, game_type_id: int, tournament_num: str) -> Optional[Hand]:
        """Parse DH2's XML hand history format."""
        h = Hand()
        h.site = site_name
        hero = self.settings.get("hero_names", {}).get(site_name, "")

        def xval(tag: str) -> str:
            m = re.search(rf"<{tag}[^>]*>([^<]*)</{tag}>", xml_text, re.I)
            return m.group(1).strip() if m else ""

        def xattr(element: str, attr: str) -> str:
            m = re.search(rf'{attr}="([^"]*)"', element, re.I)
            return m.group(1) if m else ""

        hand_num = xval("HandId") or xval("HandNumber") or xval("GameNumber")
        if not hand_num:
            return None
        prefix = "CP" if site_name == "CoinPoker" else "BACR"
        h.hand_id = f"{prefix}_{hand_num}"

        h.game_type = DH2_GAMETYPE_MAP.get(game_type_id, "NLHE")
        h.is_tournament = bool(tournament_num)
        h.tournament_id = str(tournament_num) if tournament_num else ""

        h.table_name = xval("TableName")
        try:
            h.max_seats = int(xval("TotalSeatNumber") or xval("NumPlayersSeated") or "0")
        except ValueError:
            h.max_seats = 0

        ts = xval("DateOfHandUtc") or xval("DateOfHand")
        if ts:
            for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%m/%d/%Y %I:%M:%S %p"):
                try:
                    h.date = datetime.strptime(ts.split(".")[0], fmt)
                    break
                except ValueError:
                    continue
        if not h.date:
            h.date = datetime.now()

        xml_hero = xval("HeroName") or hero

        player_count = 0
        for pm in re.finditer(r"<Player\b([^/]*?)/>", xml_text, re.S):
            elem = pm.group(0)
            pname = xattr(elem, "PlayerName")
            try:
                seat = int(xattr(elem, "SeatNumber") or "0")
            except ValueError:
                seat = 0
            try:
                stack = float(xattr(elem, "StartingStack") or "0")
            except ValueError:
                stack = 0.0
            is_hero = (pname == xml_hero)
            h.players[seat] = {"name": pname, "stack": stack, "is_hero": is_hero}
            player_count += 1
            if is_hero:
                cards_str = xattr(elem, "HoleCards") or xattr(elem, "Cards") or ""
                if cards_str:
                    h.hero_cards = " ".join(
                        cards_str[i:i+2] for i in range(0, len(cards_str) - 1, 2)
                    )
        if h.max_seats == 0:
            h.max_seats = player_count

        try:
            h.button_seat = int(xval("DealerButtonPosition") or "0")
        except ValueError:
            h.button_seat = 0

        action_map = {
            "SMALL_BLIND": "posts small blind", "BIG_BLIND": "posts big blind",
            "ANTE": "posts ante", "RAISE": "raises", "CALL": "calls",
            "CHECK": "checks", "BET": "bets", "FOLD": "folds",
            "UNCALLED_BET": "uncalled bet", "WINS": "collected",
            "ALL_IN": "all-in", "POSTS": "posts",
        }
        streets_order = ["Preflop", "Flop", "Turn", "River"]
        streets_map = {}
        for am in re.finditer(r"<HandAction\b([^/]*?)/>", xml_text, re.S):
            elem = am.group(0)
            pname = xattr(elem, "PlayerName")
            act_type = xattr(elem, "HandActionType")
            street = xattr(elem, "Street") or "Preflop"
            try:
                amount = abs(float(xattr(elem, "Amount") or "0"))
            except ValueError:
                amount = 0.0
            action_str = action_map.get(act_type, act_type.lower())
            if street not in streets_map:
                streets_map[street] = {"name": street, "cards": [], "actions": []}
            streets_map[street]["actions"].append(
                {"player": pname, "action": action_str, "amount": amount}
            )

        h.streets = [streets_map[s] for s in streets_order if s in streets_map]

        comm = xval("CommunityCards")
        if comm:
            h.board_cards = [comm[i:i+2] for i in range(0, len(comm) - 1, 2)]

        try:
            h.pot = float(xval("TotalPot") or "0")
        except ValueError:
            h.pot = 0.0
        try:
            h.rake = float(xval("Rake") or "0")
        except ValueError:
            h.rake = 0.0

        for pm in re.finditer(r"<Player\b([^/]*?)/>", xml_text, re.S):
            elem = pm.group(0)
            pname = xattr(elem, "PlayerName")
            try:
                win_amt = float(xattr(elem, "Win") or "0")
            except ValueError:
                win_amt = 0.0
            if win_amt > 0:
                h.winners.append({"name": pname, "amount": win_amt})

        if not h.winners:
            for am in re.finditer(r'<HandAction\b[^>]*HandActionType="WINS"[^/]*/>', xml_text, re.S):
                elem = am.group(0)
                pname = xattr(elem, "PlayerName")
                try:
                    amt = abs(float(xattr(elem, "Amount") or "0"))
                except ValueError:
                    amt = 0.0
                if amt > 0:
                    h.winners.append({"name": pname, "amount": amt})

        hero_invested = 0.0
        hero_won_amt = 0.0
        for s in h.streets:
            for act in s["actions"]:
                if act["player"] == xml_hero:
                    if act["action"] in ("posts small blind", "posts big blind", "posts ante",
                                         "raises", "calls", "bets"):
                        hero_invested += act["amount"]
                    elif act["action"] in ("collected", "uncalled bet"):
                        hero_won_amt += act["amount"]
        h.hero_won = hero_won_amt - hero_invested

        h.hero_position = self._calc_hero_position(h, xml_hero)
        h.raw_text = xml_text
        return h

    def _parse_dh2_text(self, text: str, site_name: str) -> Optional[Hand]:
        """Parse DH2's text-format hand history."""
        try:
            hand = self.parser._parse_single(text.strip(), site_name)
            if hand:
                hand.raw_text = text.strip()
            return hand
        except Exception:
            return None

    def _calc_hero_position(self, hand: Hand, hero: str) -> str:
        """Determine hero's position from seat/button info."""
        hero_seat = None
        for seat, info in hand.players.items():
            if info.get("is_hero") or info["name"] == hero:
                hero_seat = seat
                break
        if hero_seat is None or hand.button_seat == 0:
            return ""
        n = len(hand.players)
        if n <= 1:
            return ""
        if hero_seat == hand.button_seat:
            return "BTN"
        seats = sorted(hand.players.keys())
        btn_idx = seats.index(hand.button_seat) if hand.button_seat in seats else 0
        hero_idx = seats.index(hero_seat) if hero_seat in seats else 0
        offset = (hero_idx - btn_idx) % n
        if offset == 1:
            return "SB"
        elif offset == 2:
            return "BB"
        elif offset == n - 1:
            return "CO"
        else:
            return "MP"

    def push_hand_note(self, hand_number: str, note: str, site_id: int = 44) -> bool:
        """Push a hand note back to DriveHUD 2's database."""
        if not os.path.exists(self.dh2_db_path):
            return False
        try:
            conn = sqlite3.connect(self.dh2_db_path, timeout=5)
            conn.execute(
                "INSERT OR REPLACE INTO HandNotes (HandNumber, Note, PokerSiteId) "
                "VALUES (?, ?, ?)",
                (str(hand_number), note, site_id)
            )
            conn.commit()
            conn.close()
            return True
        except Exception:
            return False

    def push_player_note(self, player_name: str, note: str, site_id: int = 44) -> bool:
        """Push a player note back to DriveHUD 2's database."""
        if not os.path.exists(self.dh2_db_path):
            return False
        try:
            conn = sqlite3.connect(self.dh2_db_path, timeout=5)
            conn.execute(
                "INSERT OR REPLACE INTO PlayerNotes (PlayerName, Note, PokerSiteId) "
                "VALUES (?, ?, ?)",
                (player_name, note, site_id)
            )
            conn.commit()
            conn.close()
            return True
        except Exception:
            return False

    def get_hand_notes(self) -> List[Dict]:
        """Read all hand notes from DH2."""
        conn = self._connect_dh2()
        if conn is None:
            return []
        try:
            rows = conn.execute("SELECT * FROM HandNotes").fetchall()
            return [dict(r) for r in rows]
        except Exception:
            return []
        finally:
            conn.close()

    def get_player_notes(self) -> List[Dict]:
        """Read all player notes from DH2."""
        conn = self._connect_dh2()
        if conn is None:
            return []
        try:
            rows = conn.execute("SELECT * FROM PlayerNotes").fetchall()
            return [dict(r) for r in rows]
        except Exception:
            return []
        finally:
            conn.close()

    def get_tournaments(self) -> List[Dict]:
        """Read tournament results from DH2."""
        conn = self._connect_dh2()
        if conn is None:
            return []
        try:
            rows = conn.execute(
                "SELECT TournamentNumber, TournamentName, BuyIn, Rake, Rebuy, "
                "Placing, WinAmount, PokerSiteId, StartDate "
                "FROM Tournaments ORDER BY StartDate DESC LIMIT 200"
            ).fetchall()
            results = []
            for r in rows:
                results.append({
                    "number": r["TournamentNumber"],
                    "name": r["TournamentName"],
                    "buy_in": (r["BuyIn"] or 0) / 100.0,
                    "rake": (r["Rake"] or 0) / 100.0,
                    "rebuy": (r["Rebuy"] or 0) / 100.0,
                    "placing": r["Placing"],
                    "winnings": (r["WinAmount"] or 0) / 100.0,
                    "site": DH2_SITE_MAP.get(r["PokerSiteId"], "Unknown"),
                    "date": r["StartDate"],
                })
            return results
        except Exception:
            return []
        finally:
            conn.close()

    def get_status(self) -> Dict[str, Any]:
        """Get sync status."""
        self.dh2_db_path = resolve_dh2_db_path(self.settings.get("dh2_db_path", self.dh2_db_path))
        self.settings["dh2_db_path"] = self.dh2_db_path
        return {
            "connected": os.path.exists(self.dh2_db_path),
            "last_id": self.last_id,
            "total_imported": self.total_imported,
            "last_sync": self.last_sync.isoformat() if self.last_sync else None,
            "db_path": self.dh2_db_path,
        }

    def reset(self) -> None:
        """Reset sync state."""
        self.last_id = 0
        self.total_imported = 0
        self.secondary_last_ids = {}
        self._save_state()

    def start_polling(self, callback: Optional[Callable] = None, interval: Optional[int] = None) -> None:
        """Start background polling for new DH2 hands."""
        self._stop.clear()
        poll_interval = interval or self.settings.get("dh2_sync_interval", 5)
        self._thread = threading.Thread(
            target=self._poll_loop, args=(callback, poll_interval), daemon=True
        )
        self._thread.start()

    def stop_polling(self) -> None:
        """Stop background polling."""
        self._stop.set()

    def _poll_loop(self, callback: Optional[Callable], interval: int) -> None:
        """Background polling loop."""
        while not self._stop.is_set():
            try:
                new_count = self.sync()
                if callback and new_count > 0:
                    callback(new_count)
            except Exception:
                pass
            self._stop.wait(interval)
