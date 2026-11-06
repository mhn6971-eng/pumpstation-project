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
exit /b %errorlevel%
