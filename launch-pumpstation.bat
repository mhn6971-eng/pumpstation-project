@echo off
title Pumpstation launcher
cd /d "%~dp0pumpstation-v1.2"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Please install Node.js LTS from https://nodejs.org first, then double-click again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing dependencies, please wait...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] Install failed. Check your internet connection and double-click again.
    pause
    exit /b 1
  )
)

where curl >nul 2>nul
if errorlevel 1 goto :nocurl
curl -s -o nul --max-time 3 http://localhost:3000/api/health
if not errorlevel 1 goto :open
goto :startserver

:nocurl
echo curl not found; opening the browser after a short wait...
timeout /t 20 /nobreak >nul
goto :open

:startserver
start "Pumpstation server" /min cmd /c "npm run preview"
set "TRY=0"
:wait
timeout /t 3 /nobreak >nul
curl -s -o nul --max-time 3 http://localhost:3000/api/health
if not errorlevel 1 goto :open
set /a TRY+=1
if %TRY% LSS 40 goto :wait
echo [ERROR] Server did not start in 2 minutes. Check the server window for errors.
pause
exit /b 1

:open
start "" http://localhost:3000
exit
