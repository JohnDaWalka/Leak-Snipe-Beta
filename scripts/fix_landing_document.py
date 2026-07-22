"""
Fix LANDING_HTML so text/fonts actually render:
1. Proper HTML document shell (html/head/body)
2. Escape any raw backticks in the template literal
3. Fix invalid font-weights and invisible gradient text
4. Ensure Google Fonts load in <head>
"""
from pathlib import Path

BT = chr(96)  # backtick
p = Path(__file__).resolve().parents[1] / "mcp-server" / "src" / "mcp-worker.js"
raw = p.read_text(encoding="utf-8")

marker = "const LANDING_HTML = " + BT
start = raw.find(marker)
if start < 0:
    raise SystemExit("LANDING_HTML not found")

content_start = start + len(marker)

# Find the REAL end of the template: look for closing `;\n after </footer> / </div> and before next const/class
# Prefer: after </style> there is topbar... footer... then `;
footer = raw.find("</footer>", content_start)
if footer < 0:
    raise SystemExit("footer not found in landing")

# After footer should close overview divs then detail panels then script then end template
# Find last </script> before export or class McpServer
script_end = raw.find("</script>", footer)
if script_end < 0:
    raise SystemExit("landing script end not found")

# From script_end, find the closing backtick+semicolon that ends LANDING_HTML
search_from = script_end + len("</script>")
# skip whitespace
close = raw.find(BT + ";", search_from)
if close < 0:
    # try with newline patterns
    close = raw.find(BT + ";\n", search_from)
if close < 0:
    raise SystemExit("could not find LANDING_HTML close")

# Verify nothing huge wrong - content should be > 50kb
html = raw[content_start:close]
print("extracted landing len", len(html))
print("starts with", repr(html[:80]))
print("ends with", repr(html[-80:]))
if len(html) < 50000:
    raise SystemExit("landing too short — abort")

# Escape any backticks inside HTML for JS template literal safety
# (base64 shouldn't have them, but just in case)
inner = html.replace("\\", "\\\\").replace(BT, "\\" + BT)
# Wait - if we double-escape existing backslashes in already-valid JS escapes, we break things.
# The content is stored as a JS template literal body. Backslashes before quotes in original
# might be for JS. Safest: only escape unescaped backticks.
inner_parts = []
i = 0
h = html
while i < len(h):
    if h[i] == "\\" and i + 1 < len(h):
        inner_parts.append(h[i : i + 2])
        i += 2
        continue
    if h[i] == BT:
        inner_parts.append("\\" + BT)
        i += 1
        continue
    inner_parts.append(h[i])
    i += 1
inner = "".join(inner_parts)
if inner.count(BT) != inner.count("\\" + BT):
    # raw backticks remaining?
    raw_bt = 0
    j = 0
    while j < len(inner):
        if inner[j] == "\\" and j + 1 < len(inner):
            j += 2
            continue
        if inner[j] == BT:
            raw_bt += 1
        j += 1
    print("raw backticks remaining", raw_bt)

# Fix invalid font-weights
inner = inner.replace("font-weight: 650;", "font-weight: 700;")
inner = inner.replace("font-weight: 450;", "font-weight: 500;")

# Fix instrument gradient text that can vanish — solid amber + phosphor glow instead
old_inst = """.hero h1 .instrument {
  font-style: normal;
  color: var(--accent);
  text-shadow: var(--glow-text-accent);
}"""
# There may be a later rule with text-fill transparent
import re

inner = re.sub(
    r"\.hero h1 \.instrument\s*\{[^}]+\}",
    """.hero h1 .instrument {
  font-style: normal;
  color: var(--accent-strong);
  text-shadow: 0 0 18px rgba(232, 145, 47, 0.55), 0 0 28px rgba(69, 222, 133, 0.2);
  -webkit-text-fill-color: var(--accent-strong);
  background: none;
}""",
    inner,
    count=2,
)

# Ensure full document shell
inner = inner.strip()
if not inner.lower().startswith("<!doctype") and not inner.lower().startswith("<html"):
    # Split head assets vs body
    # Currently: meta, title, links, style... then topbar etc
    # Put everything before topbar/div in head
    body_markers = ['<div class="topbar"', "<div class=\"topbar\"", "<body"]
    body_at = -1
    for m in body_markers:
        body_at = inner.find(m)
        if body_at >= 0:
            break
    if body_at < 0:
        # fallback: after </style>
        body_at = inner.find("</style>")
        if body_at >= 0:
            body_at = body_at + len("</style>")
    if body_at < 0:
        raise SystemExit("cannot split head/body")

    head_inner = inner[:body_at].strip()
    body_inner = inner[body_at:].strip()
    if body_inner.startswith("<body"):
        # already has body tag content
        pass
    else:
        body_inner = body_inner

    # Remove duplicate font links if any, ensure one set
    # head_inner may already have links + style
    if "fonts.googleapis.com/css2" not in head_inner:
        head_inner = (
            """<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LeakSnipe — Field Instrument for Your Own Poker Game</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
"""
            + head_inner
        )

    inner = f"""<!DOCTYPE html>
<html lang="en">
<head>
{head_inner}
</head>
<body>
{body_inner}
</body>
</html>"""
    print("wrapped in full HTML document")
else:
    print("already has doctype/html")

# Rebuild file
new_raw = raw[:content_start] + inner + raw[close:]
# Verify new template length
new_html_len = close  # will recompute
ns = new_raw.find(marker) + len(marker)
# find close: first unescaped backtick after ns that's followed by ;
def find_template_end(s, start):
    i = start
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s):
            i += 2
            continue
        if s[i] == BT and i + 1 < len(s) and s[i + 1] == ";":
            return i
        i += 1
    return -1

ne = find_template_end(new_raw, ns)
print("new landing content length", ne - ns if ne > 0 else "FAIL")
if ne < 0 or ne - ns < 50000:
    raise SystemExit("new landing still too short")

# Stamp
for a in ["build 0720t", "build 0720r", "build 0720g", "build 0720f", "build 0720e"]:
    new_raw = new_raw.replace(a, "build 0720x")

p.write_text(new_raw, encoding="utf-8")
print("written", p)
print("document ok", "<!DOCTYPE html>" in new_raw[ns:ne])
print("body tag", "<body>" in new_raw[ns:ne])
print("Live with Grok", "Live with Grok" in new_raw[ns:ne])
print("font-weight 650 left", new_raw.count("font-weight: 650"))
