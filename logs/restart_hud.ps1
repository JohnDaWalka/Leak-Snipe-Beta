$Root = 'C:\Users\Giuli\Projects\LeakSnipe'
Set-Location $Root
$env:LEAKSNIPE_PARENT_PID = (Get-Process leaksnipe-ui -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id)
if (-not $env:LEAKSNIPE_PARENT_PID) { $env:LEAKSNIPE_PARENT_PID = '0' }
& "$Root\scripts\start-python-hud.ps1"