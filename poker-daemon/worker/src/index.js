// src/index.js – leaksnipe-proxy
//
// Was overwritten (outside this repo, 2026-07-18) with an "AI agent
// discovery" wrapper that advertised fake OAuth endpoints and injected a
// WebMCP script for tools that don't exist ("search leaked credentials",
// "check a domain for breaches"). The unconditional `Link:` header it added
// to every response — including proxied /mcp traffic — is what made MCP
// clients think this server required OAuth and trigger a login flow that
// had nowhere real to go. This version drops all of that: no OAuth/agent
// metadata, no injected script, no Link header. robots.txt/sitemap.xml and
// markdown content negotiation for the ORIGIN passthrough are kept since
// they're harmless. (env.ORIGIN is not currently bound on this Worker, so
// the passthrough branch is inert until/unless that's configured.)
var originalHandler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const accept = request.headers.get("Accept") || "";
    const wantsMarkdown = accept.includes("text/markdown");

    if (path === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\n\nSitemap: https://leaksnipe.win/sitemap.xml\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
      });
    }
    if (path === "/sitemap.xml") {
      const urls = ["https://leaksnipe.win/"];
      const lastmod = new Date().toISOString().split("T")[0];
      const entries = urls
        .map((u) => "  <url>\n    <loc>" + u + "</loc>\n    <lastmod>" + lastmod + "</lastmod>\n  </url>")
        .join("\n");
      const xml =
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        entries +
        "\n</urlset>";
      return new Response(xml, {
        headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
      });
    }
    if (env.ORIGIN) {
      const response = await env.ORIGIN.fetch(request);
      const contentType = response.headers.get("Content-Type") || "";
      if (wantsMarkdown && contentType.includes("text/html")) {
        const html = await response.text();
        return new Response(htmlToMarkdown(html), {
          status: response.status,
          headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600", Vary: "Accept" },
        });
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers(response.headers),
      });
    }
    return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });
  },
};

function htmlToMarkdown(html) {
  const bt = "`";
  const tb = bt + bt + bt;
  let md = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  md = md.replace(/<style[\s\S]*?<\/style>/gi, "");
  md = md.replace(/<!--[\s\S]*?-->/g, "");
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");
  md = md.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const response = await originalHandler.fetch(request, env);
    const contentType = response.headers.get("Content-Type") || "";
    if (
      contentType.includes("json") ||
      contentType.includes("text") ||
      contentType.includes("xml") ||
      contentType.includes("markdown")
    ) {
      let bodyText = await response.text();
      bodyText = bodyText.replaceAll("https://leaksnipe.win", url.origin);
      return new Response(bodyText, {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers(response.headers),
      });
    }
    return response;
  },
};
