@echo off
setlocal
chcp 65001 >nul
set "APP_LAUNCHER=%LOCALAPPDATA%\Programs\Pumpstation\launch-pumpstation.ps1"
if not exist "%APP_LAUNCHER%" (
  echo Pumpstation هنوز نصب نشده است. ابتدا install-windows.bat را اجرا کنید.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_LAUNCHER%"
set "PUMPSTATION_EXIT=%ERRORLEVEL%"
if not "%PUMPSTATION_EXIT%"=="0" (
  echo.
  echo Pumpstation launcher failed with exit code %PUMPSTATION_EXIT%.
  echo Check the PowerShell message and server-error logs in the configured logs folder.
  pause
)
exit /b %PUMPSTATION_EXIT%
