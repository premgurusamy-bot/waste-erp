@echo off
rem Double-click to start G Road Lines ERP (after SETUP-WINDOWS.bat has been run once). Keep this window open.
cd /d "%~dp0"
set NODE_OPTIONS=--max-old-space-size=4096
echo Starting G Road Lines ERP... open http://localhost:4000
start "" http://localhost:4000
node dist\server\server\index.js
pause
