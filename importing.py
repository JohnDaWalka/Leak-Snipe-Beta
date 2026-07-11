"""
Hand importing from files with automatic hand history path detection.
Supports file watching and batch imports for all major poker sites.
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

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    HAS_WATCHDOG = True
except ImportError:
    HAS_WATCHDOG = False
    Observer = None
    FileSystemEventHandler = object  # type: ignore

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


def _path_exists_quick(path: str, timeout_sec: float = 1.0) -> bool:
    """Check path existence without blocking the API on slow/unreachable folders."""
    if not path:
        return False
    result = {"exists": False}

    def _probe() -> None:
        try:
            result["exists"] = os.path.isdir(path)
        except OSError:
            result["exists"] = False

    probe = threading.Thread(target=_probe, daemon=True)
    probe.start()
    probe.join(timeout=timeout_sec)
    return result["exists"]


def _is_drive_root(path: str) -> bool:
    """Check if path is a drive root."""
    if not path:
        return False
    norm = os.path.normpath(path)
    drive, tail = os.path.splitdrive(norm)
    return bool(drive) and tail in ("\\", "/")


def _prune_nested_scan_dirs(entries: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Drop parent scan paths when a more specific child path is also configured."""
    normalized: List[Tuple[str, Dict[str, str]]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        path = os.path.normpath(str(entry.get("path", "")).strip())
        if not path or _is_drive_root(path):
            continue
        normalized.append((path, entry))
    if len(normalized) <= 1:
        return [entry for _, entry in normalized]

    canonical = [_canonical_path(path) for path, _ in normalized]
    keep: List[Dict[str, str]] = []
    for i, (path, entry) in enumerate(normalized):
        parent_path = canonical[i]
        is_parent = False
        for j, other_path in enumerate(canonical):
            if i == j:
                continue
            if other_path != parent_path and other_path.startswith(parent_path + os.sep):
                is_parent = True
                break
        if not is_parent:
            keep.append(entry)
    return keep if keep else [entry for _, entry in normalized]


if HAS_WATCHDOG:
    class _HHFileHandler(FileSystemEventHandler):
        """Watchdog handler: triggers immediate import scan on .txt HH file changes."""

        def __init__(self, importer: "HandImporter", callback: Optional[Callable]):
            super().__init__()
            self.importer = importer
            self.callback = callback
            self._last_trigger: Dict[str, float] = {}
            self._debounce_sec = 0.6  # avoid floods on appends

        def _is_relevant(self, path: str) -> bool:
            if not path:
                return False
            p = path.lower()
            return (
                p.endswith(".txt") or p.endswith(".txt~") or p.endswith(".ots")
                or p.endswith(".log") or p.endswith(".log.gz")
            )

        def _schedule(self, src_path: str):
            import time
            now = time.time()
            last = self._last_trigger.get(src_path, 0)
            if now - last < self._debounce_sec:
                return
            self._last_trigger[src_path] = now
            # Run scan off the observer thread
            threading.Thread(
                target=self._trigger_scan, args=(src_path,), daemon=True
            ).start()

        def _trigger_scan(self, src_path: str):
            try:
                saved, fcount = self.importer.scan_file(src_path)
                if saved > 0 and self.callback:
                    try:
                        self.callback(saved, fcount)
                    except Exception:
                        pass
                elif saved > 0:
                    logging.info("FS event import: saved %d new hand(s) from %s", saved, src_path)
            except Exception as exc:
                logging.debug("FS-triggered scan error: %s", exc)

        def on_modified(self, event):
            if not event.is_directory and self._is_relevant(event.src_path):
                self._schedule(event.src_path)

        def on_created(self, event):
            if not event.is_directory and self._is_relevant(event.src_path):
                self._schedule(event.src_path)


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
        # CoinPoker rotating-log stitching: combined signature per logs dir, plus a
        # per-segment cache of extracted events (rotated .gz segments are immutable,
        # so they only need to be decompressed/parsed once).
        self._coinpoker_chain_sig: Dict[str, Tuple] = {}
        self._coinpoker_seg_cache: Dict[str, Tuple[Any, List[Dict[str, Any]]]] = {}
        self.lock = threading.Lock()
        self._scan_lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._observer: Optional["Observer"] = None
        self.last_scan_at: Optional[str] = None
        self.last_scan_saved: int = 0
        self.last_scan_files: int = 0
        self.watcher_running: bool = False

    def update_settings(self, settings: Dict[str, Any]) -> None:
        """Update settings and recreate parser."""
        with self.lock:
            self.settings = settings
            self.parser = HandParser(settings)

    def _save_hand_if_new(self, hand: Hand, source_file: str) -> bool:
        """Save hand to database or memory if it doesn't exist."""
        if self.db:
            exists = self.db.hand_exists(hand.hand_id)
            is_live = "in_progress" in (hand.tags or [])
            if exists:
                tags = self.db.get_tags(hand.hand_id)
                was_live = "in_progress" in tags
                if hand.site == "CoinPoker" and hand.date:
                    existing = self.db.get_hand_by_id(hand.hand_id)
                    if existing and existing.date != hand.date:
                        self.db.save_hand(hand, source_file=source_file)
                        return False
                if is_live:
                    self.db.save_hand(hand, source_file=source_file)
                    self.db.add_tag(hand.hand_id, "in_progress")
                    return not was_live
                if was_live:
                    self.db.save_hand(hand, source_file=source_file)
                    self.db.remove_tag(hand.hand_id, "in_progress")
                    return True
                if (
                    self.db.hand_needs_hero_backfill(hand.hand_id)
                    and self.db.hand_has_hero_fields(hand)
                ):
                    self.db.save_hand(hand, source_file=source_file)
                    return True
                return False
            self.db.save_hand(hand, source_file=source_file)
            if is_live:
                self.db.add_tag(hand.hand_id, "in_progress")
            return True

        with self.lock:
            existing_ids = {hh.hand_id for hh in self.hands}
            if hand.hand_id in existing_ids:
                return False
            self.hands.append(hand)
            return True

    def _import_ots_file(self, fpath: str, site: str) -> None:
        """Parse a WPN .ots tournament summary file and save to DB."""
        try:
            with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            data = json.loads(content)
            
            tourney_num_raw = data.get("tournament_number", "")
            # Extract digits from "T#35279025" or similar
            tourney_id_match = re.search(r"\d+", tourney_num_raw)
            if not tourney_id_match:
                return
            tourney_id = tourney_id_match.group(0)
            
            # Resolve hero names for this site
            hero_config = self.settings.get("hero_names", {}).get(site, "")
            hero_aliases = [name.strip().lower() for name in hero_config.split(",") if name.strip()]
            
            # Parse buy-in and rake from filename
            filename = os.path.basename(fpath)
            # Permissive regex for "$1.50 + $0.15" or "1.50 + 0.15" or "$0 + $0"
            bi_match = re.search(r"(\d+(?:\.\d+)?)\s*\+\s*([a-zA-Z$]*\s*)?(\d+(?:\.\d+)?)", filename)
            if bi_match:
                buy_in_val = float(bi_match.group(1))
                rake_val = float(bi_match.group(3))
                buy_in_raw = f"{bi_match.group(1)}+{bi_match.group(3)}"
            else:
                buy_in_val = 0.0
                rake_val = 0.0
                buy_in_raw = "0+0"
                
            player_count = int(data.get("player_count", 0))
            
            # Find hero's result
            hero_name = None
            finish_position = None
            prize = 0.0
            
            finishes = data.get("tournament_finishes_and_winnings", [])
            for fin in finishes:
                pname = fin.get("player_name", "")
                if pname.lower() in hero_aliases:
                    hero_name = pname
                    finish_position = fin.get("finish_position")
                    prize = float(fin.get("prize", 0.0))
                    break
                    
            if hero_name is not None:
                summary_data = {
                    "tournament_id": tourney_id,
                    "site": site,
                    "buy_in_raw": buy_in_raw,
                    "buy_in_value": buy_in_val,
                    "rake_value": rake_val,
                    "player_count": player_count,
                    "finish_position": finish_position,
                    "prize": prize,
                    "hero_name": hero_name,
                    "imported_at": datetime.now().isoformat()
                }
                if self.db:
                    self.db.save_tournament_summary(summary_data)
                else:
                    if not hasattr(self, "tournament_summaries"):
                        self.tournament_summaries = {}
                    self.tournament_summaries[tourney_id] = summary_data
        except Exception as e:
            logging.error("Failed to parse tournament summary %s: %s", fpath, e, exc_info=True)

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

    def _site_for_path(self, fpath: str) -> str:
        """Pick the most specific configured scan_dir site for a file path."""
        fpath_key = os.path.normcase(os.path.normpath(fpath))
        best_root = ""
        best_site = "BetACR"
        for entry in self.settings.get("scan_dirs", []):
            root = os.path.normpath(str(entry.get("path", "")).strip())
            if not root:
                continue
            root_key = os.path.normcase(root)
            if fpath_key == root_key or fpath_key.startswith(root_key + os.sep):
                if len(root_key) >= len(best_root):
                    best_root = root_key
                    best_site = str(entry.get("site", "")).strip() or "BetACR"
        return best_site

    def scan_file(self, fpath: str) -> Tuple[int, int]:
        """Import new hands from one changed file. Returns (saved, files_scanned)."""
        fpath = os.path.normpath(str(fpath or "").strip())
        if not fpath or not os.path.isfile(fpath):
            return 0, 0
        with self._scan_lock:
            return self._import_file(fpath, self._site_for_path(fpath))

    @staticmethod
    def _is_coinpoker_main_log(fpath: str) -> bool:
        """True for CoinPoker rotating main logs: main.log / main.N.log.gz."""
        name = os.path.basename(fpath).lower()
        return bool(re.match(r"^main(?:\.\d+)?\.log(?:\.gz)?$", name))

    def _coinpoker_chain(self, dirpath: str) -> List[str]:
        """Ordered CoinPoker main-log segments in a dir, oldest -> newest."""
        try:
            names = os.listdir(dirpath)
        except OSError:
            return []
        rotated: List[Tuple[int, str]] = []
        live: Optional[str] = None
        for name in names:
            low = name.lower()
            m = re.match(r"^main\.(\d+)\.log\.gz$", low)
            if m:
                rotated.append((int(m.group(1)), os.path.join(dirpath, name)))
            elif low == "main.log":
                live = os.path.join(dirpath, name)
        # Higher rotation index == older, so descending index is chronological.
        rotated.sort(key=lambda t: t[0], reverse=True)
        chain = [p for _, p in rotated]
        if live:
            chain.append(live)
        return chain

    def _import_coinpoker_chain(self, dirpath: str) -> Tuple[int, int]:
        """Parse the whole CoinPoker main-log chain as one stream.

        Reassembles hands split across a log rotation (hole cards in a rotated
        segment, result in the live main.log) so they import complete with hero
        cards instead of the result-only segment overwriting the card-bearing one.
        """
        chain = self._coinpoker_chain(dirpath)
        if not chain:
            return 0, 0

        seg_sigs: List[Tuple[str, Any]] = [
            (p, self._get_file_signature(p)) for p in chain
        ]
        sig_key = tuple(seg_sigs)
        with self.lock:
            if self._coinpoker_chain_sig.get(dirpath) == sig_key:
                return 0, 0

        all_events: List[Dict[str, Any]] = []
        for path, sig in seg_sigs:
            cached = self._coinpoker_seg_cache.get(path)
            if cached is not None and cached[0] == sig:
                all_events.extend(cached[1])
                continue
            try:
                content = self.parser._read_file_text(path)
            except Exception:
                continue
            events = self.parser._extract_coinpoker_events(content)
            self._coinpoker_seg_cache[path] = (sig, events)
            all_events.extend(events)

        try:
            hands = self.parser._build_coinpoker_hands(all_events)
        except Exception as exc:
            logging.error("Failed to parse CoinPoker log chain in %s: %s", dirpath, exc, exc_info=True)
            return 0, 0

        saved = 0
        for h in hands:
            if self._save_hand_if_new(h, chain[-1]):
                saved += 1
        with self.lock:
            self._coinpoker_chain_sig[dirpath] = sig_key
            for path, sig in seg_sigs:
                if sig is not None:
                    self.file_signatures[path] = sig
                    self.file_mtimes[path] = sig[0]
                self.files_scanned.add(path)
            # Drop cached events for segments no longer in the chain.
            live_paths = {p for p, _ in seg_sigs}
            for stale in [p for p in self._coinpoker_seg_cache if p not in live_paths]:
                self._coinpoker_seg_cache.pop(stale, None)
            self.last_scan_at = datetime.now().isoformat()
            self.last_scan_saved = saved
            self.last_scan_files = len(chain)
        if saved > 0:
            logging.info(
                "Imported %d CoinPoker hand(s) from %d-segment log chain in %s",
                saved, len(chain), dirpath,
            )
        return saved, len(chain)

    def _import_file(self, fpath: str, site: str) -> Tuple[int, int]:
        """Parse and persist hands from a single file if its signature changed."""
        ext = fpath.lower()
        if not (
            ext.endswith(".txt") or ext.endswith(".ots")
            or ext.endswith(".log") or ext.endswith(".log.gz")
        ):
            return 0, 0

        # CoinPoker rotating logs are imported as a stitched chain (see
        # _import_coinpoker_chain) so rotation-straddling hands keep their hole cards.
        if self._is_coinpoker_main_log(fpath):
            return self._import_coinpoker_chain(os.path.dirname(fpath))

        with self.lock:
            signature = self._get_file_signature(fpath)
            if signature is None:
                return 0, 0
            if self.file_signatures.get(fpath) == signature:
                return 0, 0
            self.file_signatures[fpath] = signature
            self.file_mtimes[fpath] = signature[0]

        saved = 0
        if ext.endswith(".ots"):
            self._import_ots_file(fpath, site)
            with self.lock:
                self.files_scanned.add(fpath)
            return 0, 1

        if ext.endswith(".log") or ext.endswith(".log.gz"):
            try:
                content = self.parser._read_file_text(fpath)
            except Exception:
                return 0, 0
            detected = self.parser.detect_site(content)
            if detected is None:
                with self.lock:
                    self.files_scanned.add(fpath)
                return 0, 1
            try:
                parsed = self.parser.parse_file(fpath, detected)
            except Exception as exc:
                logging.error("Failed to parse log %s: %s", fpath, exc, exc_info=True)
                return 0, 0
            for h in parsed:
                if self._save_hand_if_new(h, fpath):
                    saved += 1
            with self.lock:
                self.files_scanned.add(fpath)
                self.last_scan_at = datetime.now().isoformat()
                self.last_scan_saved = saved
                self.last_scan_files = 1
            if saved > 0:
                logging.info("Imported %d new hand(s) from %s", saved, fpath)
            return saved, 1

        try:
            parsed = self.parser.parse_file(fpath, site)
        except Exception as exc:
            logging.error("Failed to parse hand history %s: %s", fpath, exc, exc_info=True)
            return 0, 0
        for h in parsed:
            if self._save_hand_if_new(h, fpath):
                saved += 1
        with self.lock:
            self.files_scanned.add(fpath)
            self.last_scan_at = datetime.now().isoformat()
            self.last_scan_saved = saved
            self.last_scan_files = 1
        if saved > 0:
            logging.info("Imported %d new hand(s) from %s", saved, fpath)
        return saved, 1

    def full_scan(self) -> Tuple[int, int]:
        """Scan all configured directories and import new hands. Returns (saved, files_scanned)."""
        with self._scan_lock:
            return self._full_scan_unlocked()

    def _full_scan_unlocked(self) -> Tuple[int, int]:
        with self.lock:
            scan_dirs = _prune_nested_scan_dirs(list(self.settings.get("scan_dirs", [])))

        saved = 0
        files_count = 0
        for entry in scan_dirs:
            path = os.path.normpath(entry["path"])
            site = entry["site"]
            if _is_drive_root(path):
                continue
            if not os.path.isdir(path):
                continue
            for root, dirs, files in os.walk(path):
                for fname in files:
                    ext = fname.lower()
                    if not (
                        ext.endswith(".txt") or ext.endswith(".ots")
                        or ext.endswith(".log") or ext.endswith(".log.gz")
                    ):
                        continue
                    fpath = os.path.join(root, fname)
                    file_saved, scanned = self._import_file(fpath, site)
                    if scanned:
                        saved += file_saved
                        files_count += 1
        with self.lock:
            self.last_scan_at = datetime.now().isoformat()
            self.last_scan_saved = saved
            self.last_scan_files = files_count
        if saved > 0:
            logging.info("Import scan: saved %d new hand(s) from %d file(s)", saved, files_count)
        return saved, files_count

    def reparse_hands_missing_hero(self) -> int:
        """Backfill hero cards/stats for hands parsed with the wrong hero name."""
        if not self.db:
            return 0
        return self.db.reparse_hands_missing_hero(self.parser)

    def import_files(self, file_paths: List[str]) -> Tuple[int, int]:
        """Import hands from explicit file paths. Returns (saved, files_count)."""
        new_hands: List[Tuple[Hand, str]] = []
        files_count = 0
        saved = 0
        for fpath in file_paths:
            if not os.path.isfile(fpath):
                continue
            if fpath.lower().endswith(".ots"):
                self._import_ots_file(fpath, "BetACR")
                files_count += 1
                signature = self._get_file_signature(fpath)
                if signature is not None:
                    self.file_signatures[fpath] = signature
                    self.file_mtimes[fpath] = signature[0]
                self.files_scanned.add(fpath)
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
                    if (
                        self.db.hand_needs_hero_backfill(h.hand_id)
                        and self.db.hand_has_hero_fields(h)
                    ):
                        self.db.save_hand(h, source_file=fpath)
                        saved += 1
                    continue
                new_hands.append((h, fpath))
            files_count += 1
            signature = self._get_file_signature(fpath)
            if signature is not None:
                self.file_signatures[fpath] = signature
                self.file_mtimes[fpath] = signature[0]
            self.files_scanned.add(fpath)
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
        """Start background file watcher.

        Prefers watchdog FS events for near-instant detection on HH file writes
        (critical for live HUD roster updates). Falls back to polling.
        """
        if self._thread and self._thread.is_alive():
            return
        if getattr(self, "_observer", None):
            # already using fs events
            return

        self._stop.clear()
        self.watcher_running = True

        dirs = [e.get("path", "") for e in self.settings.get("scan_dirs", [])]

        if HAS_WATCHDOG:
            self._start_fs_observer(callback)
            # Keep a very light safety poll (every 15s) in case FS misses something
            self._thread = threading.Thread(
                target=self._watch_loop, args=(callback, True), daemon=True
            )
            self._thread.start()
            logging.info(
                "Hand watcher started with FS events (watchdog) + light poll fallback, watching %d folder(s): %s",
                len(dirs),
                "; ".join(dirs[:5]) + ("…" if len(dirs) > 5 else ""),
            )
            return

        # Pure poll fallback
        self._thread = threading.Thread(target=self._watch_loop, args=(callback,), daemon=True)
        self._thread.start()
        logging.info(
            "Hand watcher started — polling every %ss, watching %d folder(s): %s",
            self.settings.get("refresh_interval", 5),
            len(dirs),
            "; ".join(dirs[:5]) + ("…" if len(dirs) > 5 else ""),
        )

    def stop_watcher(self) -> None:
        """Stop background file watcher (poll thread + fs observer)."""
        self._stop.set()
        self.watcher_running = False

        if getattr(self, "_observer", None):
            try:
                self._observer.stop()
                self._observer.join(timeout=2.0)
            except Exception:
                pass
            self._observer = None

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._thread = None

    def _start_fs_observer(self, callback: Optional[Callable]) -> None:
        """Start watchdog recursive observer on scan dirs."""
        if not HAS_WATCHDOG or self._observer:
            return
        try:
            scan_dirs = _prune_nested_scan_dirs(list(self.settings.get("scan_dirs", [])))
            self._observer = Observer()
            handler = _HHFileHandler(self, callback)
            scheduled = 0
            for entry in scan_dirs:
                path = os.path.normpath(str(entry.get("path", "")).strip())
                if os.path.isdir(path):
                    self._observer.schedule(handler, path, recursive=True)
                    scheduled += 1
            if scheduled:
                self._observer.start()
            else:
                self._observer = None
        except Exception as exc:
            logging.warning("Failed to start watchdog FS observer: %s (falling back to poll)", exc)
            self._observer = None

    def get_status(self) -> Dict[str, Any]:
        """Watcher/import status for the UI."""
        dirs = []
        for entry in self.settings.get("scan_dirs", []):
            path = os.path.normpath(str(entry.get("path", "")).strip())
            exists = _path_exists_quick(path)
            dirs.append({
                "path": path,
                "site": str(entry.get("site", "")).strip(),
                "exists": exists,
            })
        alive = bool(self._thread and self._thread.is_alive()) or bool(getattr(self, "_observer", None))
        using_fs = bool(getattr(self, "_observer", None) and HAS_WATCHDOG)
        return {
            "watcher_running": alive and self.watcher_running,
            "poll_interval_sec": self.settings.get("refresh_interval", 5),
            "using_fs_events": using_fs,
            "watch_folders": dirs,
            "watch_folder_count": len(dirs),
            "existing_folder_count": sum(1 for d in dirs if d["exists"]),
            "last_scan_at": self.last_scan_at,
            "last_scan_saved": self.last_scan_saved,
            "last_scan_files": self.last_scan_files,
            "files_tracked": len(self.file_signatures),
        }

    def poll_scan(self) -> Tuple[int, int]:
        """Fast import pass for live play — only changed tracked files and log archives."""
        saved = 0
        files_count = 0
        with self._scan_lock:
            with self.lock:
                tracked = list(self.file_signatures.keys())
            for fpath in tracked:
                file_saved, scanned = self._import_file(
                    fpath, self._site_for_path(fpath),
                )
                if scanned:
                    saved += file_saved
                    files_count += 1

            for entry in _prune_nested_scan_dirs(list(self.settings.get("scan_dirs", []))):
                root = os.path.normpath(str(entry.get("path", "")).strip())
                site = str(entry.get("site", "")).strip() or "BetACR"
                if not root or not os.path.isdir(root):
                    continue
                try:
                    names = os.listdir(root)
                except OSError:
                    continue
                for fname in names:
                    low = fname.lower()
                    if not (low.endswith(".log") or low.endswith(".log.gz")):
                        continue
                    fpath = os.path.join(root, fname)
                    file_saved, scanned = self._import_file(fpath, site)
                    if scanned:
                        saved += file_saved
                        files_count += 1

        if saved > 0:
            with self.lock:
                self.last_scan_at = datetime.now().isoformat()
                self.last_scan_saved = saved
                self.last_scan_files = files_count
            logging.info("Poll scan: saved %d new hand(s) from %d file(s)", saved, files_count)
        return saved, files_count

    def _watch_loop(self, callback: Optional[Callable], light_fallback: bool = False) -> None:
        """Background loop for watching files.

        Uses fast poll_scan — full_scan is reserved for startup and manual Scan Now.
        """
        import time as _time

        base = max(3, int(self.settings.get("refresh_interval", 5) or 5))
        # Cap poll at 4s during live play so CoinPoker main.log imports within a few seconds.
        interval = max(15, base) if light_fallback else max(3, min(base, 4))
        last_full_scan = _time.monotonic()
        full_scan_interval = 1800.0  # 30 min safety net
        while not self._stop.is_set():
            try:
                if light_fallback and (_time.monotonic() - last_full_scan) >= full_scan_interval:
                    new_count, file_count = self.full_scan()
                    last_full_scan = _time.monotonic()
                else:
                    new_count, file_count = self.poll_scan()
                if callback and new_count > 0:
                    callback(new_count, file_count)
            except Exception as e:
                logging.error(f"Error in watch loop: {e}", exc_info=True)
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


def get_builtin_scan_dirs() -> List[Dict[str, str]]:
    """Folders always watched for imports (cannot be removed in Settings)."""
    appdata = os.environ.get("APPDATA", "")
    builtins: List[Dict[str, str]] = []
    coinpoker_logs = os.path.join(appdata, "CoinPoker", "logs")
    if os.path.isdir(coinpoker_logs):
        builtins.append({
            "path": os.path.normpath(coinpoker_logs),
            "site": "CoinPoker",
            "pinned": True,
        })
    return builtins


def get_default_hh_paths() -> dict:
    """
    Return default hand history folder paths for each supported poker site.
    Checks common install locations and returns existing paths only.
    """
    appdata = os.environ.get("APPDATA", "")
    localappdata = os.environ.get("LOCALAPPDATA", "")
    userprofile = os.environ.get("USERPROFILE", "")
    documents = os.path.join(userprofile, "Documents")

    candidates = {
        "CoinPoker": [
            os.path.join(appdata, "CoinPoker", "logs"),
            os.path.join(appdata, "CoinPoker", "HandHistory"),
            os.path.join(localappdata, "CoinPoker", "HandHistory"),
        ],
        "BetACR": [
            os.path.join(r"C:\ACR Poker\handHistory"),
            os.path.join(localappdata, "WPN", "HandHistory"),
            os.path.join(appdata, "WPN", "HandHistory"),
            os.path.join(appdata, "Americas Cardroom", "HandHistory"),
            os.path.join(localappdata, "Americas Cardroom", "HandHistory"),
            os.path.join(localappdata, "ACR", "HandHistory"),
            os.path.join(documents, "ACR Poker", "HandHistory"),
            os.path.join(documents, "Americas Cardroom", "HandHistory"),
            os.path.join(documents, "ACR", "HandHistory"),
            os.path.join(documents, "BetACR", "HandHistory"),
            os.path.join(appdata, "ACR", "HandHistory"),
            os.path.join(appdata, "ACR Poker", "HandHistory"),
            os.path.join(localappdata, "ACR Poker", "HandHistory"),
        ],
        "GGPoker": [
            os.path.join(localappdata, "GGPoker", "HandHistory"),
            os.path.join(appdata, "GGPoker", "HandHistory"),
        ],
        "ClubGG": [
            os.path.join(localappdata, "ClubGG", "HandHistory"),
            os.path.join(appdata, "ClubGG", "HandHistory"),
        ],
        "PokerStars": [
            os.path.join(appdata, "PokerStars", "HandHistory"),
            os.path.join(appdata, "PokerStars.EU", "HandHistory"),
            os.path.join(appdata, "PokerStars.FR", "HandHistory"),
        ],
        "888poker": [
            os.path.join(localappdata, "888poker", "HandHistory"),
            os.path.join(appdata, "888poker", "HandHistory"),
        ],
        "Ignition": [
            os.path.join(documents, "Ignition", "HandHistory"),
            os.path.join(userprofile, "Ignition", "HandHistory"),
        ],
    }

    result = {}
    for site, paths in candidates.items():
        for path in paths:
            if path and os.path.isdir(path):
                result[site] = path
                break
    return result


def discover_scan_dirs(settings: Optional[Dict[str, Any]] = None) -> List[Dict[str, str]]:
    """Find existing hand-history folders for all supported sites."""
    settings = settings or {}
    hero_names = settings.get("hero_names") or {}
    betacr_hero_raw = str(hero_names.get("BetACR") or "JohnDaWalka").strip()
    betacr_aliases = [n.strip() for n in betacr_hero_raw.split(",") if n.strip()]

    candidates: List[Tuple[str, str]] = []

    acr_hh_root = os.path.join(r"C:\ACR Poker", "handHistory")
    for alias in betacr_aliases:
        candidates.append((os.path.join(acr_hh_root, alias), "BetACR"))
        candidates.append((os.path.join(r"C:\ACR Poker", "TournamentSummary", alias), "BetACR"))

    if os.path.isdir(acr_hh_root):
        for name in os.listdir(acr_hh_root):
            subdir = os.path.join(acr_hh_root, name)
            if os.path.isdir(subdir):
                candidates.append((subdir, "BetACR"))

    for site, path in get_default_hh_paths().items():
        candidates.append((path, site))

    extra_betacr = [
        r"C:\HM3Archive\Winning Poker Network",
        r"C:\Hand2Note4Hh\MyHandsArchive_H2N4\WinningPokerNetwork",
    ]
    for path in extra_betacr:
        candidates.append((path, "BetACR"))

    discovered: List[Dict[str, str]] = []
    seen = set()
    for raw_path, site in candidates:
        path = os.path.normpath(str(raw_path).strip())
        if not path or _is_drive_root(path) or not os.path.isdir(path):
            continue
        key = (site, os.path.normcase(path))
        if key in seen:
            continue
        seen.add(key)
        discovered.append({"path": path, "site": site})
    return discovered


def merge_scan_dirs(
    existing: Optional[List[Dict[str, str]]],
    discovered: Optional[List[Dict[str, str]]],
) -> List[Dict[str, str]]:
    """Merge built-in, configured, and auto-discovered scan directories."""
    merged: List[Dict[str, str]] = []
    seen = set()
    for entries in (get_builtin_scan_dirs(), existing or [], discovered or []):
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            path = os.path.normpath(str(entry.get("path", "")).strip())
            site = str(entry.get("site", "")).strip() or "CoinPoker"
            if not path or _is_drive_root(path) or not os.path.isdir(path):
                continue
            key = (site, os.path.normcase(path))
            if key in seen:
                continue
            seen.add(key)
            item = {"path": path, "site": site}
            if entry.get("pinned"):
                item["pinned"] = True
            merged.append(item)
    return merged

