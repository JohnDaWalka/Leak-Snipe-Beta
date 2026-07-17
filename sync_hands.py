#!/usr/bin/env python3
import sqlite3
import time
import json
import os
import requests
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "poker_hands.db")
API_BASE = "https://leaksnipe.win"
STAGGER_DELAY = 1.0

# How often to poll the DB file's mtime for changes (cheap stat() call, not a
# query) — this is what makes sync react within ~1s of a hand completing
# instead of waiting on a long fixed interval.
WATCH_INTERVAL = 1.0

# Safety-net full rescan interval, in case an mtime change is ever missed
# (e.g. a WAL checkpoint that doesn't touch the -wal file's timestamp).
FALLBACK_INTERVAL = 30.0


def db_files_mtime(db_path):
    """Max mtime across the main db file and its WAL/SHM sidecars.

    In WAL mode (the mode this DB runs in) writes land in `-wal` first, so
    watching only the main file would miss most updates.
    """
    latest = 0.0
    for suffix in ("", "-wal", "-shm"):
        path = db_path + suffix
        try:
            latest = max(latest, os.path.getmtime(path))
        except FileNotFoundError:
            continue
    return latest

def init_db(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS _cloudflare_sync (
            hand_id TEXT PRIMARY KEY,
            synced_at TEXT,
            r2_key TEXT
        )
    """)
    conn.commit()
    conn.close()

def get_new_hands(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT h.* FROM hands h
        LEFT JOIN _cloudflare_sync s ON CAST(h.hand_id AS TEXT) = s.hand_id
        WHERE (s.hand_id IS NULL OR h.imported_at > s.synced_at)
          AND h.hand_id NOT IN (SELECT hand_id FROM hand_tags WHERE tag = 'in_progress')
        ORDER BY h.imported_at DESC
        LIMIT 50
    """)
    rows = cursor.fetchall()
    conn.close()
    return rows

def get_players_for_hand(db_path, hand_id):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM players WHERE hand_id = ?", (str(hand_id),))
    players = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return players

def get_actions_for_hand(db_path, hand_id):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM actions WHERE hand_id = ? ORDER BY rowid", (str(hand_id),))
    actions = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return actions

def get_winners_for_hand(db_path, hand_id):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM winners WHERE hand_id = ?", (str(hand_id),))
    winners = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return winners

def mark_synced(db_path, hand_id, r2_key):
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT OR REPLACE INTO _cloudflare_sync (hand_id, synced_at, r2_key) VALUES (?, ?, ?)",
        (str(hand_id), datetime.now().isoformat(), r2_key)
    )
    conn.commit()
    conn.close()

def upload_hand(hand_id, hand_data):
    r2_key = f"hands/{hand_id}.json"
    try:
        res = requests.post(
            f"{API_BASE}/hands",
            json={"key": r2_key, "content": hand_data},
            timeout=10
        )
        if res.status_code == 200:
            print(f"  [OK] Uploaded: {r2_key}")
            return r2_key
        else:
            print(f"  [FAIL] Failed: {r2_key} - {res.status_code}")
            return None
    except Exception as e:
        print(f"  [ERROR] Error: {e}")
        return None

def sync_pending(db_path, total_synced):
    """Sync whatever's currently pending. Returns the updated total_synced."""
    hands = get_new_hands(db_path)
    if not hands:
        return total_synced

    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] {len(hands)} new hand(s)")

    for hand in hands:
        hand_id = hand["hand_id"]
        hand_dict = dict(hand)

        # Attach related data for full context
        hand_dict["players"] = get_players_for_hand(db_path, hand_id)
        hand_dict["actions"] = get_actions_for_hand(db_path, hand_id)
        hand_dict["winners"] = get_winners_for_hand(db_path, hand_id)

        hand_json = json.dumps(hand_dict, indent=2, default=str)

        r2_key = upload_hand(hand_id, hand_json)
        if r2_key:
            mark_synced(db_path, hand_id, r2_key)
            total_synced += 1
        time.sleep(STAGGER_DELAY)

    print(f"  Total synced: {total_synced}")
    return total_synced


def main():
    print("=" * 50)
    print("  LeakSnipe -> Cloudflare R2 Sync")
    print("  Reactive mode | No duplicates | All players")
    print("=" * 50)

    if not os.path.exists(DB_PATH):
        print(f"\n[ERROR] Database not found: {DB_PATH}")
        return

    init_db(DB_PATH)
    print(f"\n[*] Watching {os.path.basename(DB_PATH)} for changes "
          f"(checked every {WATCH_INTERVAL:.0f}s, syncs the moment a hand "
          f"lands)... Ctrl+C to stop.\n")

    total_synced = sync_pending(DB_PATH, 0)  # catch up on anything already pending
    last_seen_mtime = db_files_mtime(DB_PATH)
    last_fallback_check = time.monotonic()

    while True:
        try:
            time.sleep(WATCH_INTERVAL)

            current_mtime = db_files_mtime(DB_PATH)
            due_for_fallback = (time.monotonic() - last_fallback_check) >= FALLBACK_INTERVAL

            if current_mtime > last_seen_mtime or due_for_fallback:
                last_seen_mtime = current_mtime
                last_fallback_check = time.monotonic()
                total_synced = sync_pending(DB_PATH, total_synced)

        except KeyboardInterrupt:
            print(f"\n\nStopped. Total synced: {total_synced}")
            break
        except Exception as e:
            print(f"\n[WARNING] Error: {e}")
            time.sleep(WATCH_INTERVAL)

if __name__ == "__main__":
    main()
