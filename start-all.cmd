@echo off
echo ========================================
echo ChatTree Visualizer - Start all
echo ========================================
echo.
echo Starting backend and frontend...
echo.

start "Backend Server" cmd /k "%~dp0start-backend.cmd"
timeout /t 3 /nobreak >nul
start "Frontend Dev Server" cmd /k "%~dp0start-frontend.cmd"

echo.
echo Backend and frontend launched in new windows.
echo.
echo When ready, open:
echo   Frontend: http://localhost:5173
echo   Backend:  http://localhost:8000
echo.
pause
