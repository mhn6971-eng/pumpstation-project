@echo off
chcp 65001 >nul
title Pumpstation - install (one time)
cd /d "%~dp0pumpstation-v1.2"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Please install Node.js LTS from https://nodejs.org first, then run this file again.
  pause
  exit /b 1
)

echo Node version:
node --version
echo.
echo Installing dependencies, please wait...
npm ci --no-audit --no-fund

echo.
if errorlevel 1 (
  echo [ERROR] Install failed. Check your internet connection and run again.
  pause
  exit /b 1
)
echo DONE. Now double-click start-windows.bat to run the program.
pause
