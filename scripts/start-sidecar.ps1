# Start LeakSnipe Python sidecar on port 8765 (visible window if spawned here).
# Run from Launch-LeakSnipe.bat or: powershell -File scripts\start-sidecar.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = if ($PSScriptRoot) {
    $PSScriptRoot
} elseif ($MyInvocation -and $MyInvocation.MyCommand.Path) {
    Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
    throw "Cannot resolve start-sidecar.ps1 directory"
}
if ($ScriptDir -match '^\\\\\?\\(.+)') { $ScriptDir = $Matches[1] }
$Script:LeakSnipeScriptDir = $ScriptDir

. (Join-Path $ScriptDir "python-env.ps1")

$root = Get-LeakSnipeRoot
$port = if ($env:LEAKSNIPE_API_PORT) { $env:LEAKSNIPE_API_PORT } else { "8765" }
$script = Join-Path $root "sidecar\server.py"

if (-not (Test-Path $script)) {
    Write-Error "Sidecar not found: $script"
    exit 1
}

function Test-SidecarHealthy {
    param(
        [string]$Port = $port,
        [int]$TimeoutSec = 8
    )
    try {
        $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec $TimeoutSec
        return ($null -ne $r.api_version)
    } catch {
        return $false
    }
}

function Test-SidecarProcessOnPort {
    param([string]$Port = $port)
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        $procId = $c.OwningProcess
        if (-not $procId -or $procId -le 0) { continue }
        try {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction Stop
            if ($proc.CommandLine -match 'sidecar\\server\.py') {
                return $true
            }
        } catch {
            continue
        }
    }
    return $false
}

function Stop-SidecarOnPort {
    param(
        [string]$Port = $port,
        [switch]$LeakSnipeOnly
    )
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        $procId = $c.OwningProcess
        if (-not $procId -or $procId -le 0) { continue }
        if ($LeakSnipeOnly) {
            try {
                $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction Stop
                if ($proc.CommandLine -notmatch 'sidecar\\server\.py') {
                    continue
                }
            } catch {
                continue
            }
        }
        Write-Host "Stopping stale process on port $Port (PID $procId)..."
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }
}

$logPath = Join-Path $env:TEMP "leaksnipe_sidecar.log"

Set-Location $root

if (Test-SidecarHealthy) {
    Write-Host "Sidecar already healthy on port $port"
    exit 0
}

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    if (Test-SidecarProcessOnPort) {
        Write-Host "Port $port owned by LeakSnipe sidecar - waiting for health (may be busy during startup)..."
        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Milliseconds 500
            if (Test-SidecarHealthy) {
                Write-Host "Sidecar became healthy on port $port"
                exit 0
            }
        }
        Write-Host "LeakSnipe sidecar on port $port not responding - stopping hung listener..."
        Stop-SidecarOnPort -LeakSnipeOnly
    } else {
        Write-Host "Port $port in use but health check failed - waiting for sidecar..."
        for ($i = 0; $i -lt 40; $i++) {
            Start-Sleep -Milliseconds 500
            if (Test-SidecarHealthy) {
                Write-Host "Sidecar became healthy on port $port"
                exit 0
            }
        }
        Write-Host "Port $port still unhealthy - stopping stale listener..."
        Stop-SidecarOnPort
    }
}

if (-not (Test-LeakSnipeSidecarDeps -Root $root)) {
    Write-Host "Sidecar Python deps missing - running install first..."
    try {
        Install-LeakSnipePythonDeps -Root $root | Out-Null
    } catch {
        Write-Error "Install failed: $($_.Exception.Message). Run Install-Sidecar.bat manually."
        exit 1
    }
}

$python = Resolve-LeakSnipePython -Root $root
if (-not $python) {
    Write-Error "Python not found. Run Install-Sidecar.bat from the LeakSnipe repo folder."
    exit 1
}

$env:LEAKSNIPE_ROOT = $root
$env:LEAKSNIPE_API_PORT = $port
$env:LEAKSNIPE_API_HOST = "127.0.0.1"
$env:LEAKSNIPE_PYTHON = $python

$env:LEAKSNIPE_SIDECAR_LOG = $logPath
$stamp = Get-Date -Format o
Add-Content -Path $logPath -Value "`n--- start-sidecar.ps1 launch $stamp ---`n"

Write-Host "Starting LeakSnipe sidecar on port $port using $python ..."
Write-Host "Log: $logPath"

$proc = Start-Process -FilePath $python `
    -ArgumentList "`"$script`"" `
    -WorkingDirectory $root `
    -WindowStyle Minimized `
    -PassThru

Add-Content -Path $logPath -Value "Sidecar process started pid $($proc.Id) at $stamp"

for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-SidecarHealthy) {
        Write-Host "Sidecar ready on http://127.0.0.1:$port (pid $($proc.Id))"
        exit 0
    }
    if ($proc.HasExited) {
        Write-Error "Sidecar process exited before health check passed (pid $($proc.Id)). See $logPath"
        exit 1
    }
}

Write-Warning "Sidecar did not become healthy within 40s (pid $($proc.Id)). Check $logPath"
exit 1
