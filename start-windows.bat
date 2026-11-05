@echo off
chcp 65001 >nul
title Pumpstation - server (keep this window open)
cd /d "%~dp0pumpstation-v1.2"

if not exist node_modules (
  echo [ERROR] Dependencies not installed. Run install-windows.bat first.
  pause
  exit /b 1
)

echo Starting... then open in your browser:  http://localhost:3000
echo Login:  admin  /  9999
echo (Keep this window open while using the program.)
echo.
npm run preview
pause
