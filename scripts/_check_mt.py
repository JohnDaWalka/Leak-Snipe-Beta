from pathlib import Path
import sys
p = Path(r"C:/Users/Giuli/AppData/Local/Temp/ls-mt5.html")
if not p.exists():
    # try any ls-mt
    cands = list(Path(r"C:/Users/Giuli/AppData/Local/Temp").glob("ls-mt*.html"))
    print("cands", cands)
    if not cands:
        sys.exit(1)
    p = max(cands, key=lambda x: x.stat().st_mtime)
t = p.read_text(encoding="utf-8")
print("file", p, "len", len(t))
print("bubbles", t.count('class="bubble"'))
print("msg you", t.count("msg you"))
print("msg grok", t.count("msg grok"))
print("spewy", "spewy" in t)
print("die slowly", "die slowly" in t)
print("multiway", "multiway" in t)
print("denying equity", "denying equity" in t)
