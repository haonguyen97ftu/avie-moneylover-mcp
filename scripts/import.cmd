@echo off
setlocal
cd /d "%~dp0\.."
if "%~1"=="" (
  echo Usage: scripts\import.cmd data\YOUR_STATEMENT.json [--allow-review]
  exit /b 1
)
node scripts\batch.mjs import "%~1" %2 %3 %4 %5 %6 %7 %8 %9
