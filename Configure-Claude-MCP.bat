@echo off
title LeakSnipe - Configure Claude MCP
cd /d "%~dp0"
if exist .venv\Scripts\python.exe (
    .venv\Scripts\python.exe Configure-Claude-MCP.py
) else (
    python Configure-Claude-MCP.py
)
echo.
pause
