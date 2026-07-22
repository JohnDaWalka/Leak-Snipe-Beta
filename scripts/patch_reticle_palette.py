"""Restore sniper reticle green + amber glow while keeping improved type/chat layout."""
from pathlib import Path
import re

p = Path(__file__).resolve().parents[1] / "mcp-server" / "src" / "mcp-worker.js"
t = p.read_text(encoding="utf-8")

# Replace the main :root theme block we injected (from first :root after style to * { box-sizing)
style_i = t.find("<style>")
root_i = t.find(":root {", style_i)
end_i = t.find("* { box-sizing: border-box; }", root_i)
if root_i < 0 or end_i < 0:
    raise SystemExit("theme bounds missing")

NEW_THEME = r""":root {
  /* Sniper reticle board — scope-tube green + amber illumination */
  --scope-void: #050806;
  --scope-ink: #0a100c;
  --scope-raised: #121a14;
  --scope-raised-2: #1a241c;
  --scope-line: rgba(120, 160, 110, 0.18);

  --card-paper: #0c120e;
  --card-raised: #141c16;
  --card-raised-2: #1c261e;
  --card-line: rgba(140, 170, 120, 0.16);

  --bg: var(--scope-ink);
  --bg-raised: var(--scope-raised);
  --bg-raised-2: var(--scope-raised-2);
  --line: var(--scope-line);

  /* ballistic glass readouts */
  --text: #ece5d4;
  --text-dim: #a89d84;
  --text-faint: #7c7157;

  /* amber reticle illumination (primary accent) */
  --accent: #e8912f;
  --accent-strong: #f5aa52;
  --accent-soft: rgba(232, 145, 47, 0.16);
  --accent-soft-2: rgba(232, 145, 47, 0.32);
  --accent-on: #1a1006;

  /* phosphor green (secondary reticle mode) */
  --phosphor: #45de85;
  --phosphor-strong: #6ef0a4;
  --phosphor-soft: rgba(69, 222, 133, 0.14);

  /* keep --violet aliases mapped to amber so older chat CSS still reads reticle */
  --violet: #e8912f;
  --violet-strong: #f5aa52;
  --violet-soft: rgba(232, 145, 47, 0.14);

  --alert: #ff4455;
  --alert-strong: #ff6674;
  --alert-soft: rgba(255, 68, 85, 0.14);

  /* cerulean data flare (coated glass) */
  --data: #2e9fe0;
  --data-strong: #5cbaf0;
  --data-soft: rgba(46, 159, 224, 0.16);

  --glow-accent: 0 0 16px rgba(232, 145, 47, 0.4), 0 0 32px rgba(232, 145, 47, 0.15);
  --glow-alert: 0 0 14px rgba(255, 68, 85, 0.35);
  --glow-text-accent: 0 0 14px rgba(232, 145, 47, 0.55);
  --glow-text-alert: 0 0 12px rgba(255, 68, 85, 0.45);
  --glow-phosphor: 0 0 16px rgba(69, 222, 133, 0.4);
  --heading-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  --h2-glow: 0 0 22px rgba(232, 145, 47, 0.45), 0 0 40px rgba(69, 222, 133, 0.12), 0 2px 6px rgba(0, 0, 0, 0.4);

  --font-display: 'Space Grotesk', 'IBM Plex Sans', system-ui, sans-serif;
  --font-body: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'IBM Plex Mono', 'SF Mono', ui-monospace, Consolas, monospace;

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --shadow-float: 0 16px 40px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.35);
}

@media (prefers-color-scheme: light) {
  :root {
    --bg: var(--scope-ink);
    --bg-raised: var(--scope-raised);
    --bg-raised-2: var(--scope-raised-2);
    --line: var(--scope-line);
    --text: #ece5d4;
    --text-dim: #a89d84;
    --text-faint: #7c7157;
    --accent: #e8912f;
    --accent-strong: #f5aa52;
    --accent-on: #1a1006;
  }
}
:root[data-theme="dark"],
:root[data-theme="light"] {
  --bg: var(--scope-ink);
  --bg-raised: var(--scope-raised);
  --bg-raised-2: var(--scope-raised-2);
  --line: var(--scope-line);
  --text: #ece5d4;
  --text-dim: #a89d84;
  --text-faint: #7c7157;
  --accent: #e8912f;
  --accent-strong: #f5aa52;
  --accent-soft: rgba(232, 145, 47, 0.16);
  --accent-soft-2: rgba(232, 145, 47, 0.32);
  --accent-on: #1a1006;
  --alert: #ff4455;
  --data: #2e9fe0;
  --glow-accent: 0 0 16px rgba(232, 145, 47, 0.4), 0 0 32px rgba(232, 145, 47, 0.15);
  --heading-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  --h2-glow: 0 0 22px rgba(232, 145, 47, 0.45), 0 0 40px rgba(69, 222, 133, 0.12), 0 2px 6px rgba(0, 0, 0, 0.4);
}

"""

t = t[:root_i] + NEW_THEME + t[end_i:]
print("reticle :root applied")

# Body background: green/amber scope bloom instead of purple
t = t.replace(
    """  background:
    radial-gradient(1200px 600px at 10% -10%, rgba(155, 135, 255, 0.08), transparent 55%),
    radial-gradient(900px 500px at 90% 0%, rgba(0, 255, 163, 0.05), transparent 50%),
    var(--bg);""",
    """  background:
    radial-gradient(1100px 560px at 12% -8%, rgba(232, 145, 47, 0.09), transparent 55%),
    radial-gradient(900px 520px at 88% 0%, rgba(69, 222, 133, 0.07), transparent 52%),
    var(--bg);""",
)
print("body bloom reticle")

# Strong highlight underline amber
t = t.replace(
    "background: linear-gradient(180deg, transparent 55%, rgba(0, 255, 163, 0.14) 55%);",
    "background: linear-gradient(180deg, transparent 55%, rgba(232, 145, 47, 0.18) 55%);",
)

# Eyebrow chips → amber reticle
t = t.replace(
    """  color: var(--accent);
  display: inline-flex;
  align-items: center;
  gap: 0.6em;
  text-shadow: var(--glow-text-accent);
  padding: 0.28rem 0.65rem 0.28rem 0.45rem;
  border: 1px solid rgba(0, 255, 163, 0.22);
  border-radius: 999px;
  background: rgba(0, 255, 163, 0.06);
  box-shadow: 0 0 20px rgba(0, 255, 163, 0.08);
}
.eyebrow::before {
  content: "";
  width: 0.45em;
  height: 0.45em;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 10px var(--accent);
  border: none;
  transform: none;
  flex: none;
}""",
    """  color: var(--accent-strong);
  display: inline-flex;
  align-items: center;
  gap: 0.6em;
  text-shadow: var(--glow-text-accent);
  padding: 0.28rem 0.65rem 0.28rem 0.45rem;
  border: 1px solid rgba(232, 145, 47, 0.35);
  border-radius: 999px;
  background: rgba(232, 145, 47, 0.08);
  box-shadow: 0 0 22px rgba(232, 145, 47, 0.12);
}
.eyebrow::before {
  content: "";
  width: 0.45em;
  height: 0.45em;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 12px rgba(232, 145, 47, 0.8), 0 0 4px rgba(69, 222, 133, 0.5);
  border: none;
  transform: none;
  flex: none;
}""",
)

# Buttons amber primary, ghost with phosphor edge
old_btn = """.btn {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-decoration: none;
  padding: 0.9rem 1.45rem;
  border: 1px solid rgba(0, 255, 163, 0.4);
  color: var(--accent-on);
  background: linear-gradient(145deg, #3dffb5 0%, #00d98a 55%, #00b87a 100%);
  box-shadow: var(--glow-accent), 0 10px 28px rgba(0, 0, 0, 0.35);
  display: inline-flex;
  align-items: center;
  gap: 0.6em;
  cursor: pointer;
  border-radius: 10px;
  transition: transform 0.12s, filter 0.15s, box-shadow 0.15s;
}
.btn:hover { filter: brightness(1.08); box-shadow: 0 0 24px rgba(0, 255, 163, 0.4), 0 12px 32px rgba(0, 0, 0, 0.4); }
.btn:active { transform: translateY(1px); }
.btn:focus-visible { outline: 2px solid var(--violet); outline-offset: 3px; }
.btn.ghost {
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
}
.btn.ghost:hover {
  border-color: rgba(155, 135, 255, 0.45);
  color: var(--violet-strong);
  background: rgba(155, 135, 255, 0.08);
  box-shadow: 0 0 20px rgba(155, 135, 255, 0.15);
}"""

new_btn = """.btn {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-decoration: none;
  padding: 0.9rem 1.45rem;
  border: 1px solid rgba(245, 170, 82, 0.55);
  color: var(--accent-on);
  background: linear-gradient(145deg, #f5aa52 0%, #e8912f 55%, #c9741f 100%);
  box-shadow: var(--glow-accent), 0 10px 28px rgba(0, 0, 0, 0.4);
  display: inline-flex;
  align-items: center;
  gap: 0.6em;
  cursor: pointer;
  border-radius: 10px;
  transition: transform 0.12s, filter 0.15s, box-shadow 0.15s;
}
.btn:hover {
  filter: brightness(1.08);
  box-shadow: 0 0 26px rgba(232, 145, 47, 0.5), 0 0 40px rgba(69, 222, 133, 0.12), 0 12px 32px rgba(0, 0, 0, 0.4);
}
.btn:active { transform: translateY(1px); }
.btn:focus-visible { outline: 2px solid var(--phosphor); outline-offset: 3px; }
.btn.ghost {
  background: rgba(69, 222, 133, 0.04);
  color: var(--text);
  border-color: rgba(69, 222, 133, 0.28);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
}
.btn.ghost:hover {
  border-color: rgba(232, 145, 47, 0.5);
  color: var(--accent-strong);
  background: rgba(232, 145, 47, 0.08);
  box-shadow: 0 0 22px rgba(232, 145, 47, 0.18);
}"""

if old_btn in t:
    t = t.replace(old_btn, new_btn, 1)
    print("buttons reticle")
else:
    print("WARN btn block")

# Hero instrument gradient: amber → phosphor
t = t.replace(
    """  background: linear-gradient(90deg, var(--accent-strong), var(--violet-strong));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 12px rgba(0, 255, 163, 0.25));""",
    """  background: linear-gradient(90deg, var(--accent-strong), var(--phosphor-strong));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 14px rgba(232, 145, 47, 0.35));""",
)

# Grok chat CSS hardcodes purple/mint → amber/phosphor
chat_swaps = [
    ("rgba(120, 90, 255, 0.12)", "rgba(232, 145, 47, 0.12)"),
    ("rgba(0, 255, 163, 0.06)", "rgba(69, 222, 133, 0.08)"),
    ("linear-gradient(180deg, #9b87ff, #00ffa3)", "linear-gradient(180deg, #e8912f, #45de85)"),
    ("linear-gradient(180deg, #6ec8ff, #9b87ff)", "linear-gradient(180deg, #2e9fe0, #45de85)"),
    ("linear-gradient(180deg, #ff6b6b, #9b87ff)", "linear-gradient(180deg, #ff4455, #e8912f)"),
    ("color: #9b87ff;", "color: #f5aa52;"),
    ("color: #6ec8ff;", "color: #5cbaf0;"),
    ("color: #00ffa3;", "color: #45de85;"),
    ("rgba(155, 135, 255, 0.08)", "rgba(232, 145, 47, 0.1)"),
    ("rgba(110, 200, 255, 0.22)", "rgba(46, 159, 224, 0.28)"),
    ("rgba(0, 255, 163, 0.22)", "rgba(69, 222, 133, 0.28)"),
    ("rgba(110, 200, 255, 0.08)", "rgba(46, 159, 224, 0.1)"),
    ("rgba(0, 255, 163, 0.08)", "rgba(69, 222, 133, 0.12)"),
    ("0 0 18px rgba(0, 255, 163, 0.25)", "0 0 18px rgba(69, 222, 133, 0.35)"),
    ("linear-gradient(120deg, rgba(155, 135, 255, 0.08), rgba(0, 255, 163, 0.04))",
     "linear-gradient(120deg, rgba(232, 145, 47, 0.1), rgba(69, 222, 133, 0.06))"),
    ("rgba(155, 135, 255, 0.25)", "rgba(232, 145, 47, 0.3)"),
    ("color: #c4b5ff;", "color: #f5aa52;"),
    ("#00ffa3", "#45de85"),
    ("#9b87ff", "#e8912f"),
    ("rgba(155, 135, 255,", "rgba(232, 145, 47,"),
    ("rgba(0, 255, 163,", "rgba(69, 222, 133,"),
]

for a, b in chat_swaps:
    n = t.count(a)
    if n:
        t = t.replace(a, b)
        print(f"swap {n}x {a[:28]}...")

# Terminal prompt green stays phosphor; head border amber
t = t.replace(
    "border: 1px solid rgba(69, 222, 133, 0.18);",
    "border: 1px solid rgba(232, 145, 47, 0.22);",
)

# Stamp
for a in ["build 0720g", "build 0720f", "build 0720e", "build 0720c"]:
    if a in t:
        t = t.replace(a, "build 0720r")
print("stamp 0720r")

p.write_text(t, encoding="utf-8")
print("e8912f", t.count("e8912f"))
print("45de85", t.count("45de85"))
print("9b87ff left", t.count("9b87ff"))
print("OK")
