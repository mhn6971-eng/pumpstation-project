$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$installRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $installRoot 'config\install.json'
if (-not (Test-Path -LiteralPath $configPath)) {
  Write-Host 'نصب Pumpstation پیدا نشد. ابتدا install-windows.bat را اجرا کنید.' -ForegroundColor Red
  Read-Host 'برای بستن Enter بزنید'
  exit 1
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$nodePath = Join-Path $config.runtimeDir 'node.exe'
$serveScript = Join-Path $config.appDir 'scripts\serve.mjs'
if (-not (Test-Path -LiteralPath $nodePath) -or -not (Test-Path -LiteralPath $serveScript) -or -not (Test-Path -LiteralPath (Join-Path $config.appDir 'node_modules\next\dist\bin\next'))) {
  Write-Host 'Runtime یا فایل‌های برنامه ناقص است. نصب‌کننده را دوباره اجرا کنید.' -ForegroundColor Red
  Read-Host 'برای بستن Enter بزنید'
  exit 1
}

$env:NODE_ENV = 'production'
$env:PORT = '3000'
$env:DATABASE_URL = ''
$env:PGLITE_DATA_DIR = $config.databaseDir
$env:BACKUP_DIR = $config.backupDir
$env:CATALOG_DIR = $config.catalogDir
$env:ARCHIVE_DIR = $config.archiveDir
$env:MIRROR_DIR = $config.mirrorDir
$env:PGDUMP_DIR = $config.pgdumpDir
$env:PROCESS_REPORT_DIR = $config.processReportDir
$env:PM_REPORT_DIR = $config.pmReportDir
$env:ROSTER_FILE = $config.rosterFile
$env:SESSION_SECRET_DIR = $config.sessionSecretDir
$env:MIRROR_TOKEN_FILE = $config.mirrorTokenFile
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:PATH = $config.runtimeDir + ';' + (Join-Path $config.runtimeDir 'npm\package\bin') + ';' + (Join-Path $config.appDir 'node_modules\.bin') + ';' + $env:PATH

$baseUrl = 'http://127.0.0.1:3000'
$pidPath = Join-Path $installRoot 'config\server.pid'
$logsDir = $config.logDir
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

$running = $false
if (Test-Path -LiteralPath $pidPath) {
  $savedPid = 0
  $rawPid = (Get-Content -LiteralPath $pidPath -Raw).Trim()
  if ([int]::TryParse($rawPid, [ref]$savedPid)) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine -and $process.CommandLine.IndexOf($config.appDir, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      try {
        $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 2
        $running = [bool]$health.ok
      } catch { $running = $false }
      if (-not $running) {
        & taskkill.exe /PID $savedPid /T /F 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { Stop-Process -Id $savedPid -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 1
      }
    }
  }
  if (-not $running) { Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue }
}

if (-not $running) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $stdoutLog = Join-Path $logsDir "server-$stamp.log"
  $stderrLog = Join-Path $logsDir "server-error-$stamp.log"
  $argumentLine = '"' + $serveScript + '" start'
  $proc = Start-Process -FilePath $nodePath -ArgumentList $argumentLine -WorkingDirectory $config.appDir -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
  [IO.File]::WriteAllText($pidPath, [string]$proc.Id, ([System.Text.UTF8Encoding]::new($false)))
  $ready = $false
  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 1
    $proc.Refresh()
    if ($proc.HasExited) { break }
    try {
      $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 2
      if ($health.ok -and $health.version -eq $config.appVersion) { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    Write-Host ("برنامه آماده نشد. گزارش خطا: {0}" -f $stderrLog) -ForegroundColor Red
    if (Test-Path -LiteralPath $stderrLog) { Get-Content -LiteralPath $stderrLog -Tail 30 }
    Read-Host 'برای بستن Enter بزنید'
    exit 1
  }
}

Start-Process $baseUrl
Write-Host 'سامانهٔ Pumpstation در مرورگر باز شد. این پنجره را می‌توانید ببندید.' -ForegroundColor Green
