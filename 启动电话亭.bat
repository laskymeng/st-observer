@echo off
chcp 65001 >nul
title Tavern Observer - Phonebooth
echo ==========================================
echo   Tavern Observer - Phonebooth launcher
echo ==========================================
echo.
echo   Starting phonebooth (listening on 127.0.0.1:6701)...
echo   Keep this window OPEN while observing.
echo   Close this window to stop.
echo.
cd /d "%~dp0"

rem ========== Python detection (tried in order) ==========
rem 1) Custom path: if Python is installed somewhere unusual,
rem    uncomment the next 3 lines and edit the path:
rem if exist "D:/your-python/python.exe" (
rem     "D:/your-python/python.exe" phonebooth.py
rem     goto end
rem )

rem 2) Windows Python Launcher (recommended)
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 phonebooth.py
    goto end
)

rem 3) Python in PATH
where python >nul 2>nul
if %errorlevel%==0 (
    python phonebooth.py
    goto end
)

echo [ERROR] Python not found. Install Python 3, or edit this
echo         launcher to point at your Python path (see comment above).
pause

:end
pause
