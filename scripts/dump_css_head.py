from pathlib import Path
import re

t = Path(r"C:\Users\Giuli\Projects\LeakSnipe\mcp-server\src\mcp-worker.js").read_text(encoding="utf-8")
hs = t.find("const LANDING_HTML = `") + len("const LANDING_HTML = `")
he = t.find("`;", t.find("const LANDING_HTML = `") + 10)
html = t[hs:he]
s = html.find("<style>")
e = html.find("</style>")
css = html[s:e]
Path(r"C:\Users\Giuli\Projects\LeakSnipe\scripts\_landing_css_extract.css").write_text(css, encoding="utf-8")
print("css len", len(css))
print(re.findall(r"font-family:\s*'([^']+)'", css[:8000]))
# print first 4000 of :root
i = css.find(":root")
print(css[i : i + 4000])
