// index.js
var originalHandler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const accept = request.headers.get("Accept") || "";
    const wantsMarkdown = accept.includes("text/markdown");
    const LH = '</.well-known/api-catalog>; rel="api-catalog", </auth.md>; rel="service-doc", </.well-known/agent-skills/index.json>; rel="service-meta"';
    function withLink(h) {
      h["Link"] = LH;
      h["Vary"] = "Accept";
      return h;
    }
    function J(body, ct) {
      return new Response(JSON.stringify(body, null, 2), { headers: withLink({ "Content-Type": ct || "application/json", "Cache-Control": "public, max-age=3600" }) });
    }
    function M(body) {
      return new Response(body, { headers: withLink({ "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600" }) });
    }

    // OAuth/OIDC discovery paths are intentionally NOT handled here anymore.
    // This server has no real /authorize, /token, or /register implementation
    // anywhere, so advertising fabricated endpoints for them broke every real
    // MCP client (Claude Desktop, Grok) that tried to follow the discovery doc.
    // Fall through to ORIGIN, which correctly answers 404 (no-store) for these
    // paths so spec-compliant clients treat the server as unauthenticated.

    if (path === "/.well-known/api-catalog") {
      return new Response(JSON.stringify({ linkset: [{ anchor: "https://leaksnipe.win/api", "service-doc": [{ href: "https://leaksnipe.win/auth.md" }], status: [{ href: "https://leaksnipe.win/health" }] }] }, null, 2), { headers: withLink({ "Content-Type": "application/linkset+json", "Cache-Control": "public, max-age=3600" }) });
    }
    if (path === "/.well-known/mcp/server-card.json") {
      return J({ serverInfo: { name: "leaksnipe", version: "1.0.0" }, transport: { type: "http", endpoint: "https://leaksnipe.win/mcp" }, capabilities: { tools: true, resources: true, prompts: false } });
    }
    if (path === "/.well-known/agent-skills/index.json") {
      const skills = [{ name: "sitemap", type: "metadata", description: "XML sitemap for site URLs", url: "https://leaksnipe.win/.well-known/agent-skills/sitemap/SKILL.md" }, { name: "link-headers", type: "metadata", description: "Link response headers for agent discovery (RFC 8288)", url: "https://leaksnipe.win/.well-known/agent-skills/link-headers/SKILL.md" }, { name: "markdown-negotiation", type: "content", description: "Markdown content negotiation for agents", url: "https://leaksnipe.win/.well-known/agent-skills/markdown-negotiation/SKILL.md" }, { name: "api-catalog", type: "metadata", description: "API catalog for automated discovery (RFC 9727)", url: "https://leaksnipe.win/.well-known/agent-skills/api-catalog/SKILL.md" }, { name: "mcp-server-card", type: "metadata", description: "MCP Server Card for agent discovery (SEP-1649)", url: "https://leaksnipe.win/.well-known/agent-skills/mcp-server-card/SKILL.md" }, { name: "agent-skills", type: "metadata", description: "Agent skills discovery index", url: "https://leaksnipe.win/.well-known/agent-skills/agent-skills/SKILL.md" }];
      return (async () => {
        const result = await Promise.all(skills.map(async (s) => {
          const data = new TextEncoder().encode(s.name + s.description + s.url);
          const hash = await crypto.subtle.digest("SHA-256", data);
          const hex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
          return { name: s.name, type: s.type, description: s.description, url: s.url, sha256: hex };
        }));
        return J({ "$schema": "https://agentskills.io/schemas/agent-skills-discovery.v0.2.0.json", skills: result });
      })();
    }
    if (path.startsWith("/.well-known/agent-skills/") && path.endsWith("/SKILL.md")) {
      const skillName = path.replace("/.well-known/agent-skills/", "").replace("/SKILL.md", "");
      const skills = { "sitemap": "# Sitemap Skill\n\nThis resource publishes a sitemap at /sitemap.xml and references it from /robots.txt.\n\n## Endpoints\n- Sitemap: https://leaksnipe.win/sitemap.xml\n- Robots: https://leaksnipe.win/robots.txt", "link-headers": "# Link Headers Skill\n\nThis resource includes Link response headers (RFC 8288) on all responses for agent discovery.\n\n## Link Relations\n- api-catalog: /.well-known/api-catalog\n- service-doc: /auth.md\n- service-meta: /.well-known/agent-skills/index.json", "markdown-negotiation": '# Markdown Negotiation Skill\n\nThis resource supports Markdown content negotiation. Requests with Accept: text/markdown receive markdown responses.\n\n## Usage\ncurl -H "Accept: text/markdown" https://leaksnipe.win/\n\n## Response Headers\n- Content-Type: text/markdown; charset=utf-8\n- Vary: Accept', "api-catalog": "# API Catalog Skill\n\nThis resource publishes an API catalog at /.well-known/api-catalog per RFC 9727.\n\n## Endpoints\n- API Catalog: https://leaksnipe.win/.well-known/api-catalog\n- Health: https://leaksnipe.win/health", "mcp-server-card": "# MCP Server Card Skill\n\nThis resource publishes an MCP Server Card at /.well-known/mcp/server-card.json per SEP-1649.\n\n## Endpoints\n- Server Card: https://leaksnipe.win/.well-known/mcp/server-card.json\n- MCP Transport: https://leaksnipe.win/mcp\n\n## Capabilities\n- tools: true\n- resources: true\n- prompts: false", "agent-skills": "# Agent Skills Discovery Skill\n\nThis resource publishes a skills discovery index at /.well-known/agent-skills/index.json per the Agent Skills Discovery RFC v0.2.0.\n\n## Endpoints\n- Skills Index: https://leaksnipe.win/.well-known/agent-skills/index.json" };
      const content = skills[skillName];
      if (content) return M(content);
    }
    if (path === "/auth.md") {
      const content = ["# Auth.md", "", "leaksnipe.win requires no authentication for its MCP endpoint.", "", "## MCP Access", "", "Connect directly to https://leaksnipe.win/mcp — no registration, API key, or OAuth flow is required.", ""].join("\n");
      return M(content);
    }
    if (path === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\n\nSitemap: https://leaksnipe.win/sitemap.xml\n", { headers: withLink({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" }) });
    }
    if (path === "/sitemap.xml") {
      const urls = ["https://leaksnipe.win/", "https://leaksnipe.win/auth.md", "https://leaksnipe.win/.well-known/api-catalog", "https://leaksnipe.win/.well-known/mcp/server-card.json", "https://leaksnipe.win/.well-known/agent-skills/index.json"];
      const lastmod = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      const entries = urls.map((u) => "  <url>\n    <loc>" + u + "</loc>\n    <lastmod>" + lastmod + "</lastmod>\n  </url>").join("\n");
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + entries + "\n</urlset>";
      return new Response(xml, { headers: withLink({ "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" }) });
    }
    if (env.ORIGIN) {
      const response = await env.ORIGIN.fetch(request);
      const newHeaders = new Headers(response.headers);
      newHeaders.set("Link", LH);
      newHeaders.append("Vary", "Accept");
      const contentType = response.headers.get("Content-Type") || "";
      if (wantsMarkdown && contentType.includes("text/html")) {
        const html = await response.text();
        const markdown = htmlToMarkdown(html);
        return new Response(markdown, { status: response.status, headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600", "Vary": "Accept", "Link": LH } });
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: newHeaders });
    }
    return new Response("Not Found", { status: 404, headers: withLink({ "Content-Type": "text/plain" }) });
  }
};
function htmlToMarkdown(html) {
  var bt = String.fromCharCode(96);
  var tb = bt + bt + bt;
  var md = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  md = md.replace(/<style[\s\S]*?<\/style>/gi, "");
  md = md.replace(/<!--[\s\S]*?-->/g, "");
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");
  md = md.replace(/<a[^>]*href=["\x27]([^"\x27]*)["\x27][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  md = md.replace(/<\/?(ul|ol)[^>]*>/gi, "\n");
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n" + tb + "\n$1\n" + tb + "\n");
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, bt + "$1" + bt);
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "\n> $1\n");
  md = md.replace(/<[^>]+>/g, "");
  md = md.replace(/&amp;/g, "&");
  md = md.replace(/&lt;/g, "<");
  md = md.replace(/&gt;/g, ">");
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, " ");
  md = md.replace(/\n{3,}/g, "\n\n");
  return md.trim();
}
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const response = await originalHandler.fetch(request, env);
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("json") || contentType.includes("text") || contentType.includes("xml") || contentType.includes("markdown")) {
      let bodyText = await response.text();
      bodyText = bodyText.replaceAll("https://leaksnipe.win", url.origin);
      const newHeaders = new Headers(response.headers);
      const linkHeader = newHeaders.get("Link");
      if (linkHeader) {
        newHeaders.set("Link", linkHeader.replaceAll("https://leaksnipe.win", url.origin));
      }
      return new Response(bodyText, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    }
    return response;
  }
};
export default index_default;
