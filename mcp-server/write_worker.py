#!/usr/bin/env python3
import os

code = r'''const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,DELETE,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization,mcp-session-id"};
const LINK='</.well-known/api-catalog>; rel="api-catalog", </.well-known/mcp/server-card.json>; rel="service-desc", </hands>; rel="service-doc", </.well-known/oauth-protected-resource>; rel="oauth-protected-resource", </auth.md>; rel="service-doc"';
const ROBOTS=`User-agent: *
Allow: /chat
Allow: /hands
Allow: /search
Disallow: /api/
Disallow: /mcp

User-agent: GPTBot
Allow: /hands
Allow: /search
Disallow: /api/

User-agent: OAI-SearchBot
Allow: /hands
Allow: /search
Disallow: /api/

User-agent: Claude-Web
Allow: /hands
Allow: /search
Allow: /chat
Disallow: /api/

User-agent: Google-Extended
Allow: /hands
Allow: /search
Disallow: /api/

Sitemap: https://leaksnipe.win/sitemap.xml
Content-Signal: ai-train=no, search=yes, ai-input=no`;
const SITEMAP=`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://leaksnipe.win/</loc><priority>1.0</priority></url><url><loc>https://leaksnipe.win/chat</loc><priority>0.9</priority></url><url><loc>https://leaksnipe.win/hands</loc><priority>0.8</priority></url><url><loc>https://leaksnipe.win/search</loc><priority>0.7</priority></url><url><loc>https://leaksnipe.win/auth.md</loc><priority>0.5</priority></url></urlset>`;
const AUTH_MD=`# Auth.md

## Agent Registration

### Claude Desktop Registration
1. Open Claude Desktop Settings then Developer then Edit Config
2. Add to claude_desktop_config.json:
` + '`' + `json
{"mcpServers":{"leaksnipe":{"url":"https://leaksnipe.win/mcp"}}}
` + '`' + `
3. Restart Claude Desktop

### Claude Connectors
1. Go to Claude Settings then Connectors
2. Add URL: https://leaksnipe.win/mcp

### Generic OAuth Registration
1. Register: POST https://leaksnipe.win/register
2. Get token: POST https://leaksnipe.win/token
3. Use: Authorization: Bearer token

### Scopes
- hands:read, hands:write, search

### Discovery Endpoints
- /.well-known/oauth-authorization-server
- /.well-known/oauth-protected-resource
- /.well-known/api-catalog
- /.well-known/mcp/server-card.json
- /.well-known/agent-skills/index.json

## Public Endpoints (No Auth)
- GET /hands, GET /hands/:key, GET /search?q=
- GET /chat, POST /mcp`;
const HOMEPAGE_MD=`# LeakSnipe Poker API

## Endpoints
- GET /hands - List all hand histories
- GET /hands/:key - Get a specific hand
- GET /search?q= - Search hands
- POST /hands - Upload a hand
- POST /mcp - MCP protocol endpoint
- GET /chat - Web chat UI

## MCP Tools
- list_hand_histories, search_by_player, get_hand_history
- get_large_hand_history (checks 3 R2 buckets)
- tauri_db_query, tauri_db_tables, tauri_db_schema
- tauri_db_player_stats, tauri_db_hands
- backfill_kv_from_r2 (admin)`;
const BUCKETS=[{alias:"leaksnipe-hand-histories",binding:"HAND_HISTORY_R2"},{alias:"poker-hand-histories",binding:"R2_POKER_HH"},{alias:"poker-hands",binding:"R2_POKER_HANDS"}];
const MCP_TOOLS=[{name:"list_hand_histories",description:"List all hand history metadata from KV",inputSchema:{type:"object",properties:{limit:{type:"number"},prefix:{type:"string"}}}},{name:"get_hand_history",description:"Get a hand history by ID from KV",inputSchema:{type:"object",properties:{id:{type:"string"}},required:["id"]}},{name:"search_by_player",description:"Search hand histories by player name in KV metadata",inputSchema:{type:"object",properties:{player:{type:"string"}},required:["player"]}},{name:"get_large_hand_history",description:"Get large hand history file from R2 (checks all 3 buckets)",inputSchema:{type:"object",properties:{key:{type:"string"}},required:["key"]}},{name:"search_hand_histories",description:"Search hand histories by text in R2 filenames",inputSchema:{type:"object",properties:{query:{type:"string"}},required:["query"]}},{name:"tauri_db_query",description:"Send raw SQL to Tauri SQLite DB via HTTP proxy",inputSchema:{type:"object",properties:{sql:{type:"string"},params:{type:"array"}},required:["sql"]}},{name:"tauri_db_tables",description:"List all tables in Tauri SQLite DB",inputSchema:{type:"object",properties:{}}},{name:"tauri_db_schema",description:"Get schema for a table",inputSchema:{type:"object",properties:{table:{type:"string"}},required:["table"]}},{name:"tauri_db_player_stats",description:"Get HUD stats for a player",inputSchema:{type:"object",properties:{player:{type:"string"},limit:{type:"number"}},required:["player"]}},{name:"tauri_db_hands",description:"Get recent hands with filters",inputSchema:{type:"object",properties:{player:{type:"string"},game_type:{type:"string"},limit:{type:"number"}}}},{name:"backfill_kv_from_r2",description:"ADMIN: index R2 objects into KV",inputSchema:{type:"object",properties:{admin_key:{type:"string"},cursors:{type:"object"}},required:["admin_key"]}}];
const TOOLS=[{type:"function",function:{name:"list_hand_histories",description:"List all poker hand history files",parameters:{type:"object",properties:{}}}},{type:"function",function:{name:"search_hand_histories",description:"Search hand histories by text",parameters:{type:"object",properties:{query:{type:"string"}},required:["query"]}}},{type:"function",function:{name:"get_hand_history",description:"Get a hand by ID",parameters:{type:"object",properties:{id:{type:"string"}},required:["id"]}}},{type:"function",function:{name:"get_large_hand_history",description:"Get hand from R2",parameters:{type:"object",properties:{key:{type:"string"}},required:["key"]}}},{type:"function",function:{name:"search_by_player",description:"Search by player name",parameters:{type:"object",properties:{player:{type:"string"}},required:["player"]}}}];
const CHAT='<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LeakSnipe</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#0a0a0f;color:#e0e0e0;height:100vh;display:flex;flex-direction:column}#h{background:#14141f;padding:12px 16px;border-bottom:1px solid #2a2a3a;display:flex;align-items:center;gap:8px}#h h1{font-size:18px;color:#fff}.dot{width:8px;height:8px;border-radius:50%;background:#00ff88}#c{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}.m{max-width:85%;padding:12px 16px;border-radius:16px;font-size:15px;line-height:1.5;white-space:pre-wrap;word-break:break-word}.m.u{align-self:flex-end;background:#2563eb;color:#fff}.m.b{align-self:flex-start;background:#1e1e2e}.m.e{align-self:center;background:#2a1a1a;color:#e66;font-size:12px}#ib{background:#14141f;padding:8px 12px;border-top:1px solid #2a2a3a;display:flex;gap:8px}#mi{flex:1;background:#1e1e2e;border:1px solid #2a2a3a;color:#fff;border-radius:20px;padding:10px 16px;font-size:16px;outline:none}#sb{background:#2563eb;color:#fff;border:none;border-radius:50%;width:40px;height:40px;font-size:18px;cursor:pointer}#sb:disabled{opacity:.4}</style></head><body><script>try{if(navigator.modelContext&&navigator.modelContext.provideContext){navigator.modelContext.provideContext({tools:[{name:"list_hand_histories",description:"List all poker hand history files",inputSchema:{type:"object",properties:{}},execute:async()=>
