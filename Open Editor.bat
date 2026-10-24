@echo off
cd /d "%~dp0"
where node >nul 2>&1 || (
  echo Node.js is required to open the editor.
  pause
  exit /b 1
)
if not exist "dist\index.html" call npm run build
start "Rome II Campaign Editor" /MIN node tools\serve-editor.mjs --open
