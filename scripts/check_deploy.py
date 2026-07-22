from pathlib import Path
import sys

for label, path in [
    ("domain", Path(r"C:/Users/Giuli/AppData/Local/Temp/d1.html")),
    ("workers", Path(r"C:/Users/Giuli/AppData/Local/Temp/d2.html")),
    ("local", Path(r"C:/Users/Giuli/Projects/LeakSnipe/mcp-server/src/mcp-worker.js")),
]:
    if not path.exists():
        print(label, "MISSING")
        continue
    t = path.read_text(encoding="utf-8", errors="replace")
    print(f"=== {label} len={len(t)}")
    print("  Live with Grok:", "Live with Grok" in t)
    print("  spewy:", "spewy" in t)
    print("  die slowly:", "die slowly" in t)
    print("  bubbles:", t.count('class="bubble"'))
    print("  msg you:", t.count("msg you"))
    print("  00ffa3:", "00ffa3" in t)
    print("  Hand before the tens?:", "Hand before the tens?" in t)
    print("  passive or did I print:", "passive or did I print" in t)
