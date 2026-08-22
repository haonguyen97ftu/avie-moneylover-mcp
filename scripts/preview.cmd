@echo off
setlocal
cd /d "%~dp0\.."
if "%~1"=="" (
  echo Usage: scripts\preview.cmd data\YOUR_STATEMENT.json
  exit /b 1
)
node scripts\batch.mjs preview "%~1"
