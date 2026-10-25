@echo off
REM One-time setup for Windows
cd /d "%~dp0"
if not exist .venv (python -m venv .venv)
.venv\Scripts\python.exe -m pip install -r requirements.txt
call npm install
call npm --prefix frontend install
if not exist .env copy .env.example .env >nul
echo.
echo Setup complete. Run run_demo.bat
