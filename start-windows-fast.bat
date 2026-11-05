@echo off
chcp 65001 >nul
title Pumpstation - FAST server (keep this window open)
cd /d "%~dp0pumpstation-v1.2"

if not exist node_modules (
  echo [ERROR] Dependencies not installed. Run install-windows.bat first.
  pause
  exit /b 1
)

REM One-time (or after each code update): compile for maximum speed.
set NEED_BUILD=0
if not exist .next\BUILD_ID set NEED_BUILD=1
for /f "delims=" %%i in ('git rev-parse HEAD 2^>nul') do set HEAD=%%i
if defined HEAD (
  set BUILT=none
  if exist .next\GIT_HEAD set /p BUILT=<.next\GIT_HEAD
  if not "%BUILT%"=="%HEAD%" set NEED_BUILD=1
)
if "%NEED_BUILD%"=="1" (
  echo [BUILD] Compiling for speed (a few minutes, only when code changed)...
  call npm run build
  if errorlevel 1 (
    echo [ERROR] Build failed. Use start-windows.bat instead and report the error.
    pause
    exit /b 1
  )
  if defined HEAD echo %HEAD%>.next\GIT_HEAD
) else (
  echo [BUILD] Already compiled, skipping.
)

call npm run db:init >nul 2>&1

echo Starting FAST server... then open in your browser:  http://localhost:3000
echo Login:  admin  /  9009   (shifts: A=1011 B=2022 C=3033)
echo (Keep this window open while using the program.)
echo.
call npm run start
pause
