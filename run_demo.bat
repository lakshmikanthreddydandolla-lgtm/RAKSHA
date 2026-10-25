@echo off
cd /d "%~dp0"
echo Frontend: http://127.0.0.1:5173   Backend: http://127.0.0.1:8000
call npm run dev
