@echo off
title LeakSnipe Installer
cd /d "%~dp0"
echo ===================================================
echo  Running LeakSnipe Installer (requires admin privs)
echo ===================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0Setup-LeakSnipe.ps1\"' -Verb RunAs"
echo.
echo Setup process launched. Check the elevated PowerShell window.
pause
