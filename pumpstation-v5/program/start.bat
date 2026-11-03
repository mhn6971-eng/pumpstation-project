@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Pumpstation V5
set "PY_CMD="
py -3 -c "import sys" >nul 2>nul
if not errorlevel 1 set "PY_CMD=py -3"
if not defined PY_CMD (
  python -c "import sys" >nul 2>nul
  if not errorlevel 1 set "PY_CMD=python"
)
if not defined PY_CMD (
  echo Python 3 was not found on this computer.
  echo Install Python 3.11 or newer from python.org.
  echo During installation, enable "Add python.exe to PATH".
  echo Then run this file again.
  pause
  exit /b 1
)
%PY_CMD% "%~dp0bootstrap.py"
if errorlevel 1 (
  echo.
  echo Setup or startup failed. Read the message above and setup.log.
  pause
  exit /b 1
)
endlocal
