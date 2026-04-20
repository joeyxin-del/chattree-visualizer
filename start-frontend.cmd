@echo off
echo ========================================
echo ChatTree Visualizer - Frontend
echo ========================================
echo.

cd /d "%~dp0frontend"

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
)

echo.
echo ========================================
echo Starting frontend dev server...
echo ========================================
call npm run dev

pause
