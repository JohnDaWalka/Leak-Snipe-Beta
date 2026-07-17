$Root = 'C:\Users\Giuli\Projects\LeakSnipe'
Set-Location $Root
$parent = (Get-Process leaksnipe-ui -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id)
if ($parent) { $env:LEAKSNIPE_PARENT_PID = "$parent" }
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'poker_gui\.py.*--live-hud' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 400
$p = Start-Process -FilePath "$Root\.venv\Scripts\python.exe" `
    -ArgumentList "$Root\poker_gui.py", '--live-hud' `
    -WorkingDirectory $Root -WindowStyle Hidden -PassThru
Set-Content -Path (Join-Path $env:TEMP 'leaksnipe_python_hud.pid') -Value $p.Id -Encoding ascii -Force
Write-Output "HUD PID $($p.Id) parent=$($env:LEAKSNIPE_PARENT_PID)"