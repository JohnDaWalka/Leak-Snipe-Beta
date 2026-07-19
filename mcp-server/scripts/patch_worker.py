from pathlib import Path

path = Path(__file__).resolve().parents[1] / "src" / "mcp-worker.js"
text = path.read_text(encoding="utf-8")

header_import = (
    "import { registerAllTools, extractHandMeta, HAND_HISTORY_BUCKETS, MCP_VERSION } "
    "from './lib/register-tools.js';\n\n"
)

if "registerAllTools" not in text[:800]:
    if text.lstrip().startswith("/**"):
        end_comment = text.find("*/")
        if end_comment < 0:
            raise SystemExit("unclosed comment")
        insert_at = end_comment + 2
        text = text[:insert_at] + "\n\n" + header_import + text[insert_at:].lstrip("\n")
    else:
        text = header_import + text

server_marker = "const server = new McpServer();"
idx_server = text.find(server_marker)
if idx_server < 0:
    raise SystemExit("server const not found")

export_marker = "\nexport default {"
idx_export = text.rfind(export_marker)
if idx_export < 0:
    raise SystemExit("export default not found")

text = text.replace("version: '1.2.0'", "version: MCP_VERSION")
text = text.replace('version: "1.2.0"', "version: MCP_VERSION")

new_body = """
const server = new McpServer();

// Register full v2 tool surface (shared filters, shaping, new tools, SQL safety).
registerAllTools(server);

// extractHandMeta is imported for the /hands live-ingest path inside McpServer.handleRequest.

"""

text = text[:idx_server] + new_body + text[idx_export:]

path.write_text(text, encoding="utf-8")
print("Patched", path)
print("size", path.stat().st_size)

t2 = path.read_text(encoding="utf-8")
assert "registerAllTools(server)" in t2
assert "export default" in t2
assert "server.registerTool('get_sessions_winrate'" not in t2
assert "import { registerAllTools" in t2
# /hands still references extractHandMeta
assert "extractHandMeta" in t2
print("Sanity OK")
