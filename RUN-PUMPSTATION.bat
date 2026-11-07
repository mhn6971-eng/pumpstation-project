@echo off
setlocal EnableExtensions

rem Pumpstation one-click local test launcher for Windows 10/11 x64.
rem ASCII-only by design so Windows CMD never misreads Persian text.
set "APP_VERSION=1.4.12"
set "APP_ROOT=%~dp0pumpstation-v1.2"
set "BASE_URL=http://127.0.0.1:3000"
echo Pumpstation one-click test launcher %APP_VERSION%

if /I "%~d0"=="C:" (
  echo Please extract this package to a local folder on D: and run this file there.
  pause
  exit /b 1
)
if not exist "%APP_ROOT%\package.json" (
  echo App folder not found. Extract the complete ZIP, then run RUN-PUMPSTATION.bat from its top folder.
  pause
  exit /b 1
)
where.exe node.exe >nul 2>&1
if errorlevel 1 goto NODE_MISSING
where.exe npm.cmd >nul 2>&1
if errorlevel 1 goto NPM_MISSING
node.exe -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" >nul 2>&1
if errorlevel 1 goto NODE_OLD

rem Use an existing local data folder if this package was extracted over the manual test; otherwise keep data outside the app on D:.
set "DATA_ROOT=%~d0\Pumpstation-Data"
if exist "%APP_ROOT%\.data\pglite" set "DATA_ROOT=%APP_ROOT%\.data"
set "LOG_DIR=%DATA_ROOT%\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
set "LOG_FILE=%LOG_DIR%\one-click-start.log"

rem All databases, reports, and backups stay on D:, outside cloud-synced Desktop folders.
set "NODE_ENV=development"
set "DATABASE_URL="
set "PORT=3000"
set "PGLITE_DATA_DIR=%DATA_ROOT%\pglite"
set "BACKUP_DIR=%DATA_ROOT%\backups"
set "CATALOG_DIR=%DATA_ROOT%\catalog"
set "ARCHIVE_DIR=%DATA_ROOT%\archive"
set "MIRROR_DIR=%DATA_ROOT%\mirror"
set "PGDUMP_DIR=%DATA_ROOT%\pgdump"
set "PROCESS_REPORT_DIR=%DATA_ROOT%\process-report"
set "PM_REPORT_DIR=%DATA_ROOT%\pm-report"
set "SESSION_SECRET_DIR=%DATA_ROOT%\session-secret"
set "MIRROR_TOKEN_FILE=%DATA_ROOT%\mirror-token"
set "NEXT_TELEMETRY_DISABLED=1"
set "ROSTER_FILE=%APP_ROOT%\data\roster.sample.json"
if exist "%APP_ROOT%\data\roster.local.json" set "ROSTER_FILE=%APP_ROOT%\data\roster.local.json"

rem If this version is already running, just open it; do not start a duplicate server.
powershell.exe -NoProfile -WindowStyle Hidden -Command "try { $h=Invoke-RestMethod -Uri '%BASE_URL%/api/health' -TimeoutSec 2; if ($h.ok -and $h.version -eq '%APP_VERSION%') { Start-Process '%BASE_URL%'; exit 0 } } catch {}; exit 1" >nul 2>&1
if not errorlevel 1 exit /b 0
powershell.exe -NoProfile -WindowStyle Hidden -Command "$t=New-Object Net.Sockets.TcpClient; try { $t.Connect('127.0.0.1',3000); exit 0 } catch { exit 1 } finally { $t.Dispose() }" >nul 2>&1
if not errorlevel 1 goto PORT_BUSY

>"%LOG_FILE%" echo Pumpstation one-click setup %APP_VERSION%
>>"%LOG_FILE%" echo App folder: %APP_ROOT%
>>"%LOG_FILE%" echo Data folder: %DATA_ROOT%
>>"%LOG_FILE%" echo Started: %DATE% %TIME%

if not exist "%APP_ROOT%\node_modules\next\dist\bin\next" (
  echo First run: installing the locked app dependencies. Please wait; this can take several minutes.
  pushd "%APP_ROOT%"
  call npm.cmd ci --no-audit --no-fund >>"%LOG_FILE%" 2>&1
  set "RUN_RESULT=%ERRORLEVEL%"
  popd
  if not "%RUN_RESULT%"=="0" goto INSTALL_FAILED
)

for %%D in ("%PGLITE_DATA_DIR%" "%BACKUP_DIR%" "%CATALOG_DIR%" "%ARCHIVE_DIR%" "%MIRROR_DIR%" "%PGDUMP_DIR%" "%PROCESS_REPORT_DIR%" "%PM_REPORT_DIR%" "%SESSION_SECRET_DIR%") do if not exist "%%~D" mkdir "%%~D" >nul 2>&1

echo Preparing the local database...
pushd "%APP_ROOT%"
call npm.cmd run db:migrate >>"%LOG_FILE%" 2>&1
set "RUN_RESULT=%ERRORLEVEL%"
popd
if not "%RUN_RESULT%"=="0" goto MIGRATION_FAILED

echo Starting Pumpstation %APP_VERSION% and opening the browser...
start "Pumpstation Server" /D "%APP_ROOT%" "%ComSpec%" /d /k "call npm.cmd run dev"
powershell.exe -NoProfile -WindowStyle Hidden -Command "$u='%BASE_URL%'; for ($i=0; $i -lt 60; $i++) { try { $h=Invoke-RestMethod -Uri ($u+'/api/health') -TimeoutSec 2; if ($h.ok -and $h.version -eq '%APP_VERSION%') { Start-Process $u; exit 0 } } catch {}; Start-Sleep -Seconds 1 }; exit 1" >nul 2>&1
if errorlevel 1 goto START_FAILED
>>"%LOG_FILE%" echo App ready: %BASE_URL% at %DATE% %TIME%
echo Pumpstation is running. Leave the separate server window open; close it with Ctrl+C to stop the app.
exit /b 0

:PORT_BUSY
echo Port 3000 is already used by another program. Close the older Pumpstation server window with Ctrl+C, then click this file again.
pause
exit /b 1

:NODE_MISSING
echo Node.js 22 or later is required. Install Node.js first, then click this file again.
pause
exit /b 1

:NPM_MISSING
echo npm.cmd was not found. Reinstall Node.js with the npm option enabled, then click this file again.
pause
exit /b 1

:NODE_OLD
echo Node.js 22 or later is required. The installed Node.js version is too old.
pause
exit /b 1

:INSTALL_FAILED
echo Dependency installation failed. Do not delete the data folder.
echo Diagnostic log: %LOG_FILE%
pause
exit /b 1

:MIGRATION_FAILED
echo Database preparation failed. Existing database files were not deleted.
echo Diagnostic log: %LOG_FILE%
pause
exit /b 1

:START_FAILED
echo The server did not become healthy within 60 seconds. Keep the server window open and send this log:
echo %LOG_FILE%
>>"%LOG_FILE%" echo Start failed or health check timed out at %DATE% %TIME%
pause
exit /b 1
