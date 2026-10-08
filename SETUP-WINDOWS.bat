@echo off
rem Double-click this file to install and start the Waste ERP on Windows.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-windows.ps1"
pause
