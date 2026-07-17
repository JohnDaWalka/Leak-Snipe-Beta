# LeakSnipe Cloudflare data API

This Worker exposes a private, read-only view of the LeakSnipe hand database for
ChatGPT actions. It uses D1 for structured hands and the private
`leaksnipe-hand-histories` R2 bucket for raw-file backups.

## Deploy

From this directory:

```powershell
npx wrangler d1 execute leaksnipe-hands --remote --file migrations/0001_initial.sql
..\\.venv\\Scripts\\python.exe scripts\\export_sqlite.py
npx wrangler d1 execute leaksnipe-hands --remote --file .local/leaksnipe-hands.sql
npx wrangler secret put LEAKSNIPE_API_KEY
npx wrangler deploy
```

`.local/` is intentionally not versioned. Set a long random API key when
prompted and use the same value as the bearer token in the ChatGPT action.

The deployed OpenAPI document is at `/openapi.json`. Health is at `/health`.
No write endpoint is deployed.
