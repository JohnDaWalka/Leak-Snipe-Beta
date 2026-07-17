// src/index.js – Full MCP implementation for hand‑history R2 bucket
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    console.log('MCP fetch invoked', { method: request.method, pathname: url.pathname });
    // R2 bucket endpoints for Antigravity integration
    // -----------------------------------------------------------------
    // New endpoint: /r2/all  – returns **all** hand‑history keys
    // -----------------------------------------------------------------
    if (url.pathname === "/r2/all") {
      // R2 stores hands under the "hands/hands/" prefix
      const prefix = "hands/hands/";
      let cursor = null;
      const allKeys = [];

      do {
        const opts = { prefix };
        if (cursor) opts.cursor = cursor;
        const resp = await env.POKER_R2.list(opts);
        // Collect keys (strip the prefix for a cleaner list)
        allKeys.push(...resp.objects.map(o => o.key.replace(prefix, "")));
        cursor = resp.result_info?.cursor;
      } while (cursor);

      return new Response(JSON.stringify({ hands: allKeys }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname.startsWith("/r2/get")) {
      const id = url.searchParams.get("id");
      if (!id) return new Response(JSON.stringify({ error: "Missing id" }), { status: 400, headers: { "Content-Type": "application/json" } });
      const obj = await env.POKER_R2.get(`hands/hands/${id}`);
      if (!obj) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
      const txt = await obj.text();
      return new Response(txt, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    // Serve robots.txt with explicit directives
    if (url.pathname === "/robots.txt") {
      const txt = `User-agent: *\nAllow: /\nDisallow: /private`;
      return new Response(txt, { status: 200, headers: { "Content-Type": "text/plain" } });
    }

    // Serve robots.txt with explicit directives
    if (url.pathname === "/robots.txt") {
      const txt = `User-agent: *\nAllow: /\nDisallow: /private`;
      return new Response(txt, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    // Markdown negotiation – if the client requests text/markdown, return a markdown version of the page
    const acceptHeader = request.headers.get('Accept') || '';
    if (acceptHeader.includes('text/markdown')) {
      const md = `# Leaksnipe Proxy

- This is a Cloudflare Worker serving the MCP API.
- Use the **/mcp** endpoint for JSON‑RPC calls.
- The **/robots.txt** file defines crawl rules.
`;
      return new Response(md, { status: 200, headers: { "Content-Type": "text/markdown" } });
    }

    // Expect JSON‑RPC POST requests
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Only POST allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }
    let body;
    try {
      body = await request.json();
    } catch (e) {
      console.error("Invalid JSON body", e);
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

        const { method, id, params } = body;
    try {
      // Support both legacy and newer method naming
      if (method === "mcp.manifest" || method === "initialize" || method === "tools/list") {
        return jsonResponse({ jsonrpc: "2.0", id, result: manifest() }, 200);
      }

      if (method === "mcp.executeTool" || method === "tools/call") {
        const toolName = params?.name || params?.tool;
        const args = params?.arguments || params?.args || {};
        const result = await executeTool(toolName, args, env);
        // Wrap result for tools/call method
        const wrapped = (method === "tools/call") ? { content: [{ type: "text", text: JSON.stringify(result) }] } : result;
        return jsonResponse({ jsonrpc: "2.0", id, result: wrapped }, 200);
      }

      return jsonResponse({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }, 400);
    } catch (e) {
      console.error("MCP error", e);
      return jsonResponse({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } }, 500);
    }
  },
};

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function manifest() {
  return {
    tools: [
      {
        name: "list_hand_histories",
        description: "List all poker hand history files",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "get_hand_history",
        description: "Get content of a specific hand history file",
        parameters: {
          type: "object",
          properties: { file: { type: "string", description: "Hand file name (e.g., hand-123.json)" } },
          required: ["file"],
        },
      },
      {
        name: "search_hand_histories",
        description: "Search hand histories for a substring",
        parameters: {
          type: "object",
          properties: { query: { type: "string", description: "Case‑insensitive substring to search for" } },
          required: ["query"],
        },
      },
    ],
  };
}

async function executeTool(tool, args, env) {
  const bucket = env.POKER_R2; // R2 binding
  if (!bucket) throw new Error("POKER_R2 binding not configured");

  const prefix = "hand-histories/";
  switch (tool) {
    case "list_hand_histories": {
      const list = await bucket.list({ prefix });
      const keys = list.objects.map(o => o.key.replace(prefix, ""));
      return { jsonrpc: "2.0", result: keys };
    }
    case "get_hand_history": {
      const key = prefix + (args?.file || "");
      const obj = await bucket.get(key);
      if (!obj) throw new Error(`File not found: ${args.file}`);
      const content = await obj.text();
      return { jsonrpc: "2.0", result: content };
    }
    case "search_hand_histories": {
      const query = (args?.query || "").toLowerCase();
      const list = await bucket.list({ prefix });
      const matches = [];
      for (const o of list.objects) {
        const obj = await bucket.get(o.key);
        const txt = await obj.text();
        if (txt.toLowerCase().includes(query)) {
          matches.push(o.key.replace(prefix, ""));
        }
      }
      return { jsonrpc: "2.0", result: matches };
    }
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}
