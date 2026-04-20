@echo off
echo ========================================
echo ChatTree Visualizer - Backend
echo ========================================
echo.

cd /d "%~dp0backend"

REM venv is created ONLY when this folder is missing. It is reused on every later run.
REM There is a single backend\venv; nothing here creates duplicate virtualenvs.
if not exist "venv\Scripts\python.exe" (
    echo Creating virtual environment - first run only...
    python -m venv venv
)

echo Activating virtual environment...
call venv\Scripts\activate.bat

if not exist ".env" (
    echo Copying environment template...
    copy .env.example .env
    echo.
    echo WARNING: Edit backend\.env and set your ANTHROPIC_API_KEY
    echo.
    pause
)

REM pip runs every launch to stay in sync with requirements.txt; it does NOT recreate venv.
echo Syncing dependencies with pip; satisfied packages are left as-is.
pip install -r requirements.txt

echo.
echo ========================================
echo Starting backend server...
echo ========================================
python main.py

pause
