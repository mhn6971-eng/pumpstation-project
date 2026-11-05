@echo off
chcp 65001 >nul
title Pumpstation - shortcut setup
set "ROOT=%~dp0"
set "TARGET=%ROOT%launch-pumpstation.bat"
set "ICON=%ROOT%pumpstation-v1.2\public\brand\logo.ico"
set "LINK=%USERPROFILE%\Desktop\پمپاژخانه گلاب.lnk"

if not exist "%TARGET%" (
  echo [ERROR] launch-pumpstation.bat not found next to this file.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=New-Object -ComObject WScript.Shell; $l=$s.CreateShortcut($env:LINK); $l.TargetPath=$env:TARGET; $l.WorkingDirectory=$env:ROOT; $l.IconLocation=$env:ICON; $l.WindowStyle=7; $l.Description='Pumpstation Golab'; $l.Save()"
if errorlevel 1 (
  echo [ERROR] Could not create the shortcut.
  pause
  exit /b 1
)

echo DONE. A shortcut was created on your Desktop.
echo From now on, just double-click it to open the program.
pause
