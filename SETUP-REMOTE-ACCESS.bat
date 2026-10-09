@echo off
rem Make GreenCycle reachable from anywhere (Cloudflare Tunnel). Run once on the office computer.
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\setup-remote-access.ps1"
