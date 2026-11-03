@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Prepare offline packages
set "PY_CMD="
py -3 -c "import sys" >nul 2>nul
if not errorlevel 1 set "PY_CMD=py -3"
if not defined PY_CMD (
  python -c "import sys" >nul 2>nul
  if not errorlevel 1 set "PY_CMD=python"
)
if not defined PY_CMD (
  echo Python 3 was not found. Install Python 3.11 or newer first.
  pause
  exit /b 1
)
%PY_CMD% -m pip download -r requirements.txt -d wheels
if errorlevel 1 (
  echo Download failed. Check internet connection and try again.
  pause
  exit /b 1
)
echo Offline packages are ready in the wheels folder.
echo Copy the whole program folder to the offline station computer.
pause
