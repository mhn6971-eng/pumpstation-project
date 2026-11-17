@echo off
setlocal
chcp 65001 >nul
set "APP_LAUNCHER=%LOCALAPPDATA%\Programs\Pumpstation\launch-pumpstation.ps1"
set "PUMPSTATION_ERROR_LOG=%TEMP%\Pumpstation-launch-error.log"
set "PUMPSTATION_STDERR_LOG=%TEMP%\Pumpstation-launch-stderr.tmp"
if exist "%PUMPSTATION_ERROR_LOG%" del /q "%PUMPSTATION_ERROR_LOG%" >nul 2>&1
if exist "%PUMPSTATION_STDERR_LOG%" del /q "%PUMPSTATION_STDERR_LOG%" >nul 2>&1
if not exist "%APP_LAUNCHER%" (
  >"%PUMPSTATION_ERROR_LOG%" echo Launcher script not found: %APP_LAUNCHER%
  echo Pumpstation is not installed. Run install-windows.bat first.
  echo Diagnostic log: %PUMPSTATION_ERROR_LOG%
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_LAUNCHER%" 2>"%PUMPSTATION_STDERR_LOG%"
set "PUMPSTATION_EXIT=%ERRORLEVEL%"
if not "%PUMPSTATION_EXIT%"=="0" (
  if exist "%PUMPSTATION_STDERR_LOG%" type "%PUMPSTATION_STDERR_LOG%" >> "%PUMPSTATION_ERROR_LOG%"
  echo.
  echo Pumpstation launcher failed with exit code %PUMPSTATION_EXIT%.
  echo Diagnostic log: %PUMPSTATION_ERROR_LOG%
  echo Server logs, if created, are in the configured logs folder.
  pause
) else (
  if exist "%PUMPSTATION_STDERR_LOG%" del /q "%PUMPSTATION_STDERR_LOG%" >nul 2>&1
)
exit /b %PUMPSTATION_EXIT%
