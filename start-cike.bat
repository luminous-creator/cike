@echo off
rem Double-click to start Cike: installs dependencies on first run, then opens the browser
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install --no-audit --no-fund
)
start "" http://localhost:3000
call npm run dev
