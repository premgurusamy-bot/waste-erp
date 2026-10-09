@echo off
rem Double-click to start GreenCycle ERP (after SETUP-WINDOWS.bat has been run once).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-windows.ps1"
pause
