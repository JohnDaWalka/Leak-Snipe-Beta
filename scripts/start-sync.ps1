# Start the LeakSnipe -> Cloudflare R2 hand sync (sync_hands.py) in the
# background. Reactive watcher - syncs a hand within ~1s of it landing in
# poker_hands.db, so the remote MCP connector (Claude, phone app) stays
# current without a manual step.
# Run from Launch-LeakSnipe.bat or: powershell -File scripts\start-sync.ps1
# Stop it with: powershell -File scripts\start-sync.ps1 -Stop

param(
    [switch]$Stop
)

$ErrorActionPreference = "Stop"

$ScriptDir = if ($PSScriptRoot) {
    $PSScriptRoot
} elseif ($MyInvocation -and $MyInvocation.MyCommand.Path) {
    Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
    throw "Cannot resolve start-sync.ps1 directory"
}
if ($ScriptDir -match '^\\\\\?\\(.+)') { $ScriptDir = $Matches[1] }

. (Join-Path $ScriptDir "python-env.ps1")

$root = Get-LeakSnipeRoot
$script = Join-Path $root "sync_hands.py"

if (-not (Test-Path $script)) {
    Write-Warning "Sync script not found: $script - skipping."
    exit 0
}

function Get-SyncProcesses {
    $procs = Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name LIKE 'python3%.exe'" -ErrorAction SilentlyContinue
    return @($procs | Where-Object { $_.CommandLine -match 'sync_hands\.py' })
}

function Test-SyncProcessRunning {
    return (Get-SyncProcesses).Count -gt 0
}

if ($Stop) {
    $running = Get-SyncProcesses
    if (-not $running.Count) {
        Write-Host "LeakSnipe -> Cloudflare sync was not running."
        exit 0
    }
    foreach ($p in $running) {
        Write-Host "Stopping sync (pid $($p.ProcessId)) ..."
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    exit 0
}

if (Test-SyncProcessRunning) {
    Write-Host "LeakSnipe -> Cloudflare sync already running - skipping."
    exit 0
}

if (-not (Test-LeakSnipeSidecarDeps -Root $root)) {
    Write-Host "Sync dependencies missing (shares the sidecar venv) - run Install-Sidecar.bat first. Skipping sync."
    exit 0
}

$python = Resolve-LeakSnipePython -Root $root
if (-not $python) {
    Write-Warning "Python not found - skipping Cloudflare sync."
    exit 0
}

$logPath = Join-Path $env:TEMP "leaksnipe_sync.log"
$stamp = Get-Date -Format o
Add-Content -Path $logPath -Value "`n--- start-sync.ps1 launch $stamp ---`n"

Write-Host "Starting LeakSnipe -> Cloudflare sync (log: $logPath) ..."

$proc = Start-Process -FilePath $python `
    -ArgumentList "-u", "`"$script`"" `
    -WorkingDirectory $root `
    -WindowStyle Minimized `
    -RedirectStandardOutput $logPath `
    -RedirectStandardError (Join-Path $env:TEMP "leaksnipe_sync.err.log") `
    -PassThru

Start-Sleep -Milliseconds 800
if ($proc.HasExited) {
    Write-Warning "Sync process exited immediately (pid $($proc.Id)) - check $logPath"
    exit 1
}

Write-Host "Sync running in background (pid $($proc.Id))."
exit 0
