@echo off
setlocal
cd /d "%~dp0\.."
echo [1/2] Installing dependencies...
call npm install || exit /b 1
echo.
echo [2/2] Running tests...
call npm test || exit /b 1
echo.
echo Setup complete.
