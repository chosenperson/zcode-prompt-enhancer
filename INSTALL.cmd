@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" -Action Install
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
