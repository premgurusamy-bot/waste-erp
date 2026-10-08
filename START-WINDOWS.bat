@echo off
rem Double-click this file to start the Waste ERP (after SETUP-WINDOWS.bat has been run once).
cd /d "%~dp0"
echo Starting GreenCycle Waste ERP... keep this window open. Open http://localhost:3000
start "" http://localhost:3000
npm start
pause
