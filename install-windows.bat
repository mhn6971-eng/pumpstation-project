@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "PUMPSTATION_ERROR_LOG=%TEMP%\Pumpstation-install-error.log"
set "PUMPSTATION_STDERR_LOG=%TEMP%\Pumpstation-install-stderr.tmp"
if exist "%PUMPSTATION_ERROR_LOG%" del /q "%PUMPSTATION_ERROR_LOG%" >nul 2>&1
if exist "%PUMPSTATION_STDERR_LOG%" del /q "%PUMPSTATION_STDERR_LOG%" >nul 2>&1
echo Pumpstation automatic installer is starting...
echo Progress and any errors will be shown in this window.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" 2>"%PUMPSTATION_STDERR_LOG%"
set "PUMPSTATION_EXIT=%ERRORLEVEL%"
if not "%PUMPSTATION_EXIT%"=="0" (
  if exist "%PUMPSTATION_STDERR_LOG%" (
    type "%PUMPSTATION_STDERR_LOG%" >> "%PUMPSTATION_ERROR_LOG%"
    echo PowerShell reported an error. Details were added to the diagnostic log.
  )
  echo.
  echo ========================================
  echo INSTALLATION FAILED - exit code %PUMPSTATION_EXIT%
  echo Diagnostic log: %PUMPSTATION_ERROR_LOG%
  echo Do not move or delete the data folder. Review the diagnostic log before retrying.
  echo Press Enter to close this window.
  set /p "PUMPSTATION_WAIT="
) else (
  if exist "%PUMPSTATION_STDERR_LOG%" del /q "%PUMPSTATION_STDERR_LOG%" >nul 2>&1
  echo.
  echo ========================================
  echo INSTALLATION COMPLETE
  echo Desktop shortcut: Pumpstation
  echo Next time, double-click the desktop shortcut to open the app.
  echo Press Enter to close this installer window.
  set /p "PUMPSTATION_WAIT="
)
exit /b %PUMPSTATION_EXIT%
