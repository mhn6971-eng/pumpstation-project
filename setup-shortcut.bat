@echo off
setlocal
chcp 65001 >nul
set "TARGET=%LOCALAPPDATA%\Programs\Pumpstation\launch-pumpstation.ps1"
if not exist "%TARGET%" (
  echo ابتدا install-windows.bat را اجرا کنید؛ نصب‌کننده میانبر دسکتاپ می‌سازد.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$s=New-Object -ComObject WScript.Shell; $l=$s.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Pumpstation.lnk')); $l.TargetPath=Join-Path $PSHOME 'powershell.exe'; $l.Arguments='-NoProfile -ExecutionPolicy Bypass -File ' + [char]34 + $env:TARGET + [char]34; $l.WorkingDirectory=(Split-Path -Parent $env:TARGET); $l.IconLocation=$env:SystemRoot + '\System32\shell32.dll,220'; $l.Save()"
if errorlevel 1 (
  echo ساخت میانبر ناموفق بود.
  pause
  exit /b 1
)
echo میانبر Pumpstation روی دسکتاپ ساخته شد.
