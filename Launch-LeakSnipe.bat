@echo off
title LeakSnipe Launcher
cd /d "%~dp0"

echo ========================================
echo   LeakSnipe - Poker Therapist
echo ========================================
echo.

REM Ensure sidecar is healthy (or clear a hung listener) before Tauri starts.
echo Starting sidecar on port 8765...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-sidecar.ps1"
if %ERRORLEVEL% NEQ 0 (
  echo [WARN] Sidecar did not report healthy — Tauri will retry or respawn.
) else (
  set "LEAKSNIPE_SIDECAR_EXTERNAL=1"
  echo Sidecar ready on port 8765.
)
echo Stale Vite on port 1420 from a prior session is cleared automatically.
echo.

echo Starting LeakSnipe -^> Cloudflare hand sync...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-sync.ps1"
echo.

REM Double-click friendly: always invoke PowerShell explicitly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\tauri-dev.ps1"
set EXITCODE=%ERRORLEVEL%

echo Stopping LeakSnipe -^> Cloudflare hand sync...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-sync.ps1" -Stop

if %EXITCODE% NEQ 0 (
  echo.
  echo [FAILED] LeakSnipe did not start ^(exit %EXITCODE%^).
  echo.
  echo If you saw "Port 1420 is already in use", close any old LeakSnipe
  echo windows or kill the blocking app, then run this launcher again.
  echo.
  echo Try in a terminal instead:
  echo   cd "%~dp0"
  echo   powershell -ExecutionPolicy Bypass -File scripts\tauri-dev.ps1
  echo.
  pause
  exit /b %EXITCODE%
)

echo.
echo LeakSnipe closed.
pause
