@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
set "PUMPSTATION_EXIT=%ERRORLEVEL%"
if not "%PUMPSTATION_EXIT%"=="0" (
  echo.
  echo Pumpstation installer failed with exit code %PUMPSTATION_EXIT%.
  pause
)
exit /b %PUMPSTATION_EXIT%
