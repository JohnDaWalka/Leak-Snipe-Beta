"""
Restyle leaksnipe.win landing: load real fonts + xAI-adjacent dark palette
and richer type/formatting page-wide (matching Live with Grok chat character).
"""
from pathlib import Path
import re

p = Path(__file__).resolve().parents[1] / "mcp-server" / "src" / "mcp-worker.js"
t = p.read_text(encoding="utf-8")

# 1) Inject Google Fonts right after opening meta/title block of LANDING_HTML
FONT_LINKS = """
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
"""

if "fonts.googleapis.com/css2?family=Space+Grotesk" not in t:
    # LANDING_HTML starts with <meta charset
    needle = "const LANDING_HTML = `<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>"
    # find actual title line
    m = re.search(
        r'(const LANDING_HTML = `<meta charset="UTF-8">\s*<meta name="viewport"[^>]*>\s*<title>[^<]*</title>)',
        t,
    )
    if not m:
        raise SystemExit("LANDING head not found")
    t = t[: m.end()] + "\n" + FONT_LINKS + t[m.end() :]
    print("fonts injected")
else:
    print("fonts already present")

# 2) Replace the entire :root … :root[data-theme="light"] {…} block with new theme
# Find from first ":root {" after <style> until after light theme block closes

style_i = t.find("<style>")
if style_i < 0:
    raise SystemExit("no style")

# Locate start of :root after font-faces (after last @font-face or first :root)
root_i = t.find(":root {", style_i)
# Find end: after :root[data-theme="light"] block — next `* { box-sizing`
end_i = t.find("* { box-sizing: border-box; }", root_i)
if root_i < 0 or end_i < 0:
    raise SystemExit(f"theme bounds root={root_i} end={end_i}")

NEW_THEME = r""":root {
  /* xAI-adjacent instrument board — dark first, chat-bubble character */
  --scope-void: #050507;
  --scope-ink: #0a0b10;
  --scope-raised: #12141c;
  --scope-raised-2: #1a1d28;
  --scope-line: rgba(255, 255, 255, 0.09);

  --card-paper: #0c0d12;
  --card-raised: #14161f;
  --card-raised-2: #1c1f2b;
  --card-line: rgba(255, 255, 255, 0.1);

  --bg: var(--scope-ink);
  --bg-raised: var(--scope-raised);
  --bg-raised-2: var(--scope-raised-2);
  --line: var(--scope-line);

  --text: #f2f0f5;
  --text-dim: rgba(242, 240, 245, 0.68);
  --text-faint: rgba(242, 240, 245, 0.42);

  /* phosphor mint (Grok/chat) + violet secondary */
  --accent: #00ffa3;
  --accent-strong: #5dffc0;
  --accent-soft: rgba(0, 255, 163, 0.12);
  --accent-soft-2: rgba(0, 255, 163, 0.22);
  --accent-on: #04140e;

  --violet: #9b87ff;
  --violet-strong: #c4b5ff;
  --violet-soft: rgba(155, 135, 255, 0.14);

  --alert: #ff5c6c;
  --alert-strong: #ff8a95;
  --alert-soft: rgba(255, 92, 108, 0.14);

  --data: #6ec8ff;
  --data-strong: #9adcff;
  --data-soft: rgba(110, 200, 255, 0.14);

  --glow-accent: 0 0 18px rgba(0, 255, 163, 0.28);
  --glow-alert: 0 0 16px rgba(255, 92, 108, 0.3);
  --glow-text-accent: 0 0 16px rgba(0, 255, 163, 0.35);
  --glow-text-alert: 0 0 14px rgba(255, 92, 108, 0.35);
  --heading-shadow: 0 2px 12px rgba(0, 0, 0, 0.45);
  --h2-glow: 0 0 28px rgba(0, 255, 163, 0.18), 0 2px 8px rgba(0, 0, 0, 0.4);

  --font-display: 'Space Grotesk', 'IBM Plex Sans', system-ui, sans-serif;
  --font-body: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'IBM Plex Mono', 'SF Mono', ui-monospace, Consolas, monospace;

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --shadow-float: 0 16px 40px rgba(0, 0, 0, 0.45), 0 4px 12px rgba(0, 0, 0, 0.3);
}

/* Force dark character even if OS is light — matches chat bubbles */
@media (prefers-color-scheme: light) {
  :root {
    --bg: var(--scope-ink);
    --bg-raised: var(--scope-raised);
    --bg-raised-2: var(--scope-raised-2);
    --line: var(--scope-line);
    --text: #f2f0f5;
    --text-dim: rgba(242, 240, 245, 0.68);
    --text-faint: rgba(242, 240, 245, 0.42);
    --accent: #00ffa3;
    --accent-strong: #5dffc0;
    --accent-on: #04140e;
  }
}
:root[data-theme="dark"],
:root[data-theme="light"] {
  --bg: var(--scope-ink);
  --bg-raised: var(--scope-raised);
  --bg-raised-2: var(--scope-raised-2);
  --line: var(--scope-line);
  --text: #f2f0f5;
  --text-dim: rgba(242, 240, 245, 0.68);
  --text-faint: rgba(242, 240, 245, 0.42);
  --accent: #00ffa3;
  --accent-strong: #5dffc0;
  --accent-soft: rgba(0, 255, 163, 0.12);
  --accent-soft-2: rgba(0, 255, 163, 0.22);
  --accent-on: #04140e;
  --alert: #ff5c6c;
  --data: #6ec8ff;
  --glow-accent: 0 0 18px rgba(0, 255, 163, 0.28);
  --heading-shadow: 0 2px 12px rgba(0, 0, 0, 0.45);
  --h2-glow: 0 0 28px rgba(0, 255, 163, 0.18), 0 2px 8px rgba(0, 0, 0, 0.4);
}

"""

t = t[:root_i] + NEW_THEME + t[end_i:]
print("theme tokens replaced")

# 3) Richer base type
OLD_BODY = """body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 16.5px;
  line-height: 1.55;
  overflow-x: hidden;
  text-shadow: var(--heading-shadow);
}
::selection { background: var(--accent-soft-2); color: var(--text); }

.wrap {
  max-width: 74rem;
  margin: 0 auto;
  padding: 0 clamp(1.25rem, 4vw, 3rem);
}

h1, h2, h3, h4 {
  font-family: var(--font-display);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  text-wrap: balance;
  margin: 0;
  color: var(--text);
  text-shadow: var(--heading-shadow);
}
h2 {
  text-shadow: var(--h2-glow);
}

.eyebrow {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent);
  display: inline-flex;
  align-items: center;
  gap: 0.55em;
}
.eyebrow::before {
  content: "";
  width: 0.6em;
  height: 0.6em;
  border: 1px solid currentColor;
  transform: rotate(45deg);
  flex: none;
}

p { margin: 0; }
.prose { max-width: 42em; color: var(--text-dim); }
.prose strong { color: var(--text); font-weight: 600; }
.prose + .prose { margin-top: 1.1rem; }
"""

NEW_BODY = """body {
  margin: 0;
  background:
    radial-gradient(1200px 600px at 10% -10%, rgba(155, 135, 255, 0.08), transparent 55%),
    radial-gradient(900px 500px at 90% 0%, rgba(0, 255, 163, 0.05), transparent 50%),
    var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  font-weight: 400;
  font-size: 17px;
  line-height: 1.65;
  letter-spacing: 0.01em;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
::selection { background: var(--accent-soft-2); color: var(--text); }

.wrap {
  max-width: 74rem;
  margin: 0 auto;
  padding: 0 clamp(1.25rem, 4vw, 3rem);
}

h1, h2, h3, h4 {
  font-family: var(--font-display);
  font-weight: 600;
  text-transform: none;
  letter-spacing: -0.03em;
  text-wrap: balance;
  margin: 0;
  color: var(--text);
  text-shadow: var(--heading-shadow);
}
h1 {
  font-weight: 700;
  letter-spacing: -0.04em;
}
h2 {
  font-weight: 650;
  letter-spacing: -0.035em;
  text-shadow: var(--h2-glow);
}
h3 {
  font-weight: 600;
  letter-spacing: -0.02em;
  font-size: 1.15rem;
}

.eyebrow {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent);
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
}

p { margin: 0; }
.prose {
  max-width: 40em;
  color: var(--text-dim);
  font-size: 1.02rem;
  line-height: 1.7;
  font-weight: 400;
}
.prose strong {
  color: var(--text);
  font-weight: 600;
  background: linear-gradient(180deg, transparent 55%, rgba(0, 255, 163, 0.14) 55%);
}
.prose em {
  color: var(--violet-strong);
  font-style: italic;
  font-family: var(--font-body);
}
.prose b { color: var(--accent-strong); font-weight: 600; }
.prose + .prose { margin-top: 1.15rem; }
"""

if OLD_BODY not in t:
    # try looser match
    if "font-weight: 500;\n  font-size: 16.5px;" in t:
        print("body block slightly different — partial patch")
    raise SystemExit("OLD_BODY not found — inspect CSS")
t = t.replace(OLD_BODY, NEW_BODY, 1)
print("body/type replaced")

# 4) Buttons — find .btn block
# Read a slice for .btn
btn_i = t.find(".btn {")
if btn_i > 0:
    # find next major comment or selector at same level after ~30 lines
    btn_end = t.find("\n.btn.", btn_i + 1)
    if btn_end < 0:
        btn_end = t.find("\n.btn ", btn_i + 5)
    # print small snippet
    print("btn snippet", repr(t[btn_i : btn_i + 400]))

# Patch common btn styles if present
old_btn_patterns = [
    (
        """.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45em;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--accent-on);
  font-family: var(--font-mono);
  font-size: 0.82rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.85rem 1.25rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  box-shadow: var(--glow-accent);
}""",
        """.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  border: 1px solid rgba(0, 255, 163, 0.45);
  background: linear-gradient(145deg, rgba(0, 255, 163, 0.95), rgba(0, 200, 140, 0.85));
  color: var(--accent-on);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.9rem 1.35rem;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: transform 0.15s, box-shadow 0.15s, filter 0.15s;
  box-shadow: var(--glow-accent), var(--shadow-float);
}""",
    ),
]

for a, b in old_btn_patterns:
    if a in t:
        t = t.replace(a, b, 1)
        print("btn primary patched")
    else:
        print("btn primary skip")

# 5) Hero h1 color spans — target/instrument
# Make sure .target and .instrument use violet/mint
for old, new in [
    (
        ".hero h1 .target",
        None,  # find later
    )
]:
    pass

# Inject utility after h2 rule if target class exists
if ".hero h1 .target" in t or "span class=\"target\"" in t:
    # add/replace color rules near hero h1
    hero_extra = """
.hero h1 .target {
  color: var(--alert-strong);
  text-shadow: var(--glow-text-alert);
}
.hero h1 .instrument {
  color: var(--accent-strong);
  text-shadow: var(--glow-text-accent);
  background: linear-gradient(90deg, var(--accent-strong), var(--violet-strong));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 12px rgba(0, 255, 163, 0.25));
}
.section-head h2 {
  font-size: clamp(1.85rem, 3.6vw, 2.65rem);
  line-height: 1.08;
  max-width: 16ch;
}
.section-more {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--violet-strong);
  border: 1px solid rgba(155, 135, 255, 0.3);
  background: rgba(155, 135, 255, 0.08);
  border-radius: 999px;
  padding: 0.55rem 0.9rem;
  box-shadow: 0 0 18px rgba(155, 135, 255, 0.1);
}
.section-more:hover {
  color: var(--text);
  border-color: rgba(0, 255, 163, 0.35);
  background: rgba(0, 255, 163, 0.08);
}
.field-entry {
  border: 1px solid var(--line);
  background: linear-gradient(165deg, rgba(255,255,255,0.03), transparent 40%), var(--bg-raised);
  border-radius: var(--radius-md);
  padding: 1.35rem 1.4rem;
  margin-top: 1rem;
  box-shadow: var(--shadow-float);
}
.field-entry-head h3 {
  font-family: var(--font-display);
  font-size: 1.25rem;
  letter-spacing: -0.02em;
  text-transform: none;
}
.loop-step, .stat-tile, .hud-mock {
  border-radius: var(--radius-md);
}
.topbar {
  background: color-mix(in srgb, var(--bg) 78%, transparent);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
}
.tab-btn {
  letter-spacing: 0.08em;
  font-weight: 500;
}
.tab-btn[aria-selected="true"] {
  color: var(--accent);
  text-shadow: var(--glow-text-accent);
}
.brand {
  letter-spacing: 0.14em;
  font-weight: 600;
  color: var(--text);
}
"""
    # insert before live with grok css if not already
    if ".hero h1 .instrument" not in t or "background-clip: text" not in t:
        anchor = "/* ---------- live with grok"
        # find either old or new marker
        for a in ["/* ---------- live with grok (xAI chat) ---------- */", "/* ---------- live with grok ---------- */"]:
            if a in t:
                t = t.replace(a, hero_extra + "\n" + a, 1)
                print("hero/section extras injected before", a[:30])
                break
        else:
            # before footer
            t = t.replace("/* ---------- footer ---------- */", hero_extra + "\n/* ---------- footer ---------- */", 1)
            print("hero extras before footer")

# 6) Build stamp bump
t = t.replace("build 0720c", "build 0720e")
t = t.replace("build 0720d", "build 0720e")

p.write_text(t, encoding="utf-8")
print("wrote", p)
print("Space Grotesk", "Space Grotesk" in t)
print("00ffa3 root", t.count("#00ffa3"))
print("fonts.googleapis", "fonts.googleapis.com/css2" in t)
