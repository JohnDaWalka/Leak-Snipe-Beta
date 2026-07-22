# Point Grok Build MCP at the permanent Cloudflare Worker (no ephemeral tunnels).
# Usage: powershell -ExecutionPolicy Bypass -File scripts\start-grok-mcp.ps1
#
# Preferred public MCP: https://leaksnipe.win/mcp  (Worker, always on)
# Local desktop DB proxy (named tunnel, Windows service Cloudflared):
#   https://db.leaksnipe.win  -> 127.0.0.1:8765 sidecar
#
# Do NOT register trycloudflare.com URLs into Grok — they die when cloudflared restarts.

$ErrorActionPreference = "Stop"
$StableMcpUrl = "https://leaksnipe.win/mcp"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogDir = Join-Path $env:TEMP "leaksnipe-grok-mcp"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$initPath = Join-Path $LogDir "init.json"
[System.IO.File]::WriteAllText(
    $initPath,
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"Grok","version":"1"}}}'
)

Write-Host "Probing permanent Worker MCP: $StableMcpUrl"
$code = & curl.exe -sS -o (Join-Path $LogDir "init-out.txt") -w "%{http_code}" --max-time 15 -X POST $StableMcpUrl `
    -H "Content-Type: application/json" `
    -H "Accept: application/json, text/event-stream" `
    --data-binary "@$initPath" 2>$null

if ($code -ne "200") {
    throw "Worker MCP not healthy: $StableMcpUrl (HTTP $code). Check Cloudflare Worker deploy / custom domain."
}

$body = Get-Content (Join-Path $LogDir "init-out.txt") -Raw -ErrorAction SilentlyContinue
Write-Host "Worker MCP OK (HTTP $code)"
if ($body) { Write-Host ($body.Substring(0, [Math]::Min(200, $body.Length))) }

Set-Content (Join-Path $LogDir "public-url.txt") $StableMcpUrl -Encoding utf8

# Keep Grok Build config on the permanent URL (never trycloudflare)
$GrokConfig = Join-Path $env:USERPROFILE ".grok\config.toml"
if (Test-Path $GrokConfig) {
    $toml = Get-Content $GrokConfig -Raw
    $updated = $false
    if ($toml -match '(?ms)(\[mcp_servers\.leak-snipe\]\s*\r?\nurl\s*=\s*")[^"]*(")') {
        $toml = [regex]::Replace(
            $toml,
            '(?ms)(\[mcp_servers\.leak-snipe\]\s*\r?\nurl\s*=\s*")[^"]*(")',
            "`${1}$StableMcpUrl`${2}"
        )
        $updated = $true
    } elseif ($toml -notmatch '\[mcp_servers\.leak-snipe\]') {
        $toml = $toml.TrimEnd() + "`n`n[mcp_servers.leak-snipe]`nurl = `"$StableMcpUrl`"`nenabled = true`n"
        $updated = $true
    }
    if ($updated) {
        Set-Content $GrokConfig $toml -Encoding utf8 -NoNewline
        Write-Host "Updated $GrokConfig -> $StableMcpUrl"
    } else {
        Write-Host "Grok config already has leak-snipe entry (left as-is if already correct)."
    }
}

if (Get-Command grok -ErrorAction SilentlyContinue) {
    try {
        & grok mcp remove leak-snipe 2>$null
        & grok mcp add --transport http leak-snipe $StableMcpUrl 2>$null
        Write-Host "Registered via grok CLI: leak-snipe -> $StableMcpUrl"
    } catch {
        Write-Host "grok CLI register skipped: $_"
    }
}

# Optional: verify named tunnel to local sidecar (not required for Worker MCP)
Write-Host ""
Write-Host "Checking named tunnel routes (desktop sidecar)..."
foreach ($u in @("https://db.leaksnipe.win/health", "https://mcp.leaksnipe.win/health")) {
    try {
        $h = & curl.exe -sS -o NUL -w "%{http_code}" --max-time 8 $u 2>$null
        Write-Host "  $u -> HTTP $h"
    } catch {
        Write-Host "  $u -> unreachable"
    }
}

$svc = Get-Service Cloudflared -ErrorAction SilentlyContinue
if ($svc) {
    Write-Host "Cloudflared Windows service: $($svc.Status) ($($svc.StartType))"
    if ($svc.Status -ne "Running") {
        Write-Host "Starting Cloudflared service..."
        try { Start-Service Cloudflared } catch { Write-Host "Could not start service (need admin?): $_" }
    }
} else {
    Write-Host "Cloudflared Windows service not installed (Worker MCP still works without it)."
}

Write-Host ""
Write-Host "============================================"
Write-Host " GROK MCP URL (permanent):"
Write-Host " $StableMcpUrl"
Write-Host "============================================"
Write-Host ""
Write-Host "If Grok Build still shows handshake failed:"
Write-Host "  1) Restart Grok Build / start a new session"
Write-Host "  2) Confirm .grok\config.toml has url = `"$StableMcpUrl`""
Write-Host "  3) On grok.com connectors: remove old trycloudflare URL, paste the permanent one"
Write-Host ""
Write-Host "URL also in: $LogDir\public-url.txt"
