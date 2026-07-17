"""Resumable, self-healing driver for the leaksnipe-proxy backfill_kv_from_r2 tool.

Run any time (today's daily KV write quota resets ~24h after the first write
of the day, or immediately on a paid plan). Reads/writes its resume point to
backfill-resume-state.json next to this file, so it can be stopped and
restarted freely without losing progress or re-doing work (the tool itself is
also idempotent - already-indexed keys are skipped either way).

Usage: python run-backfill.py
"""
import json
import os
import time
import urllib.request
import urllib.error
import sys

URL = "https://leaksnipe-proxy.gitgoin87.workers.dev/mcp"
ADMIN_KEY = "80c4573d2da46cb2090cf4b6ff83f2e462472548bf16aec75ae0d472382472bc"
STATE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backfill-resume-state.json")

with open(STATE_PATH) as f:
    state = json.load(f)
cursors = state["cursors"]

batch = 20
MIN_BATCH = 5
MAX_ITERS = 3000
consecutive_failures = 0


def save_state():
    state["cursors"] = cursors
    with open(STATE_PATH, "w") as f:
        json.dump(state, f, indent=2)


for i in range(MAX_ITERS):
    payload = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {
            "name": "backfill_kv_from_r2",
            "arguments": {"admin_key": ADMIN_KEY, "cursors": cursors, "batch": batch},
        },
    }).encode()
    req = urllib.request.Request(
        URL, data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) leaksnipe-backfill",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            raw = resp.read().decode()
        data = json.loads(raw)
        if "error" in data:
            raise RuntimeError(f"JSONRPC error: {data['error']}")
        inner = json.loads(data["result"]["content"][0]["text"])
        consecutive_failures = 0
        if batch < 20:
            batch = min(20, batch + 5)
    except Exception as e:
        consecutive_failures += 1
        batch = max(MIN_BATCH, batch // 2)
        msg = str(e)
        print(f"iter {i}: FAILURE ({type(e).__name__}: {msg}) -> batch={batch}, retry {consecutive_failures}")
        if "limit exceeded for the day" in msg:
            print("Daily KV write quota hit again - stopping here. Resume point saved, try again later.")
            save_state()
            sys.exit(1)
        if consecutive_failures >= 8:
            print("Too many consecutive failures, stopping.")
            save_state()
            sys.exit(1)
        time.sleep(min(2 * consecutive_failures, 15))
        continue

    summary = {
        k: {"processed": v["processed"], "skipped": v["skipped"], "done": v["done"]}
        for k, v in inner["results"].items()
    }
    print(f"iter {i} (batch={batch}): {summary}")

    if inner["done"]:
        print("ALL DONE")
        cursors = inner["next_cursors"]
        save_state()
        break
    cursors = inner["next_cursors"]
    save_state()

print("FINAL CURSORS:", json.dumps(cursors))
