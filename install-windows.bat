@echo off
setlocal
chcp 65001 >nul
set "PUMPSTATION_ERROR_LOG=%TEMP%\Pumpstation-install-error.log"
set "PUMPSTATION_STDERR_LOG=%TEMP%\Pumpstation-install-stderr.tmp"
if exist "%PUMPSTATION_ERROR_LOG%" del /q "%PUMPSTATION_ERROR_LOG%" >nul 2>&1
if exist "%PUMPSTATION_STDERR_LOG%" del /q "%PUMPSTATION_STDERR_LOG%" >nul 2>&1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" 2>"%PUMPSTATION_STDERR_LOG%"
set "PUMPSTATION_EXIT=%ERRORLEVEL%"
if not "%PUMPSTATION_EXIT%"=="0" (
  if exist "%PUMPSTATION_STDERR_LOG%" type "%PUMPSTATION_STDERR_LOG%" >> "%PUMPSTATION_ERROR_LOG%"
  echo.
  echo Pumpstation installer failed with exit code %PUMPSTATION_EXIT%.
  echo Diagnostic log: %PUMPSTATION_ERROR_LOG%
  pause
) else (
  if exist "%PUMPSTATION_STDERR_LOG%" del /q "%PUMPSTATION_STDERR_LOG%" >nul 2>&1
)
exit /b %PUMPSTATION_EXIT%
