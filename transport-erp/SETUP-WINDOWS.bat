@echo off
rem Double-click to install G Road Lines ERP (server mode) on Windows. Run once.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-windows.ps1"
pause
