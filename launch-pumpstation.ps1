$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  [Console]::OutputEncoding = $utf8
  [Console]::InputEncoding = $utf8
} catch { }
function Write-Host {
  [CmdletBinding()]
  param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)] [AllowNull()] [object[]] $Object,
    [ConsoleColor] $ForegroundColor,
    [ConsoleColor] $BackgroundColor,
    [string] $Separator = ' ',
    [switch] $NoNewline
  )
  $shown = @(
    foreach ($item in $Object) {
      if ($null -eq $item) { '' }
      elseif ([string]$item -match '[\u0600-\u06FF]') { ([string][char]0x202B) + [string]$item + [char]0x202C }
      else { $item }
    }
  )
  $hostParams = @{ Object = $shown; Separator = $Separator }
  if ($PSBoundParameters.ContainsKey('ForegroundColor')) { $hostParams.ForegroundColor = $ForegroundColor }
  if ($PSBoundParameters.ContainsKey('BackgroundColor')) { $hostParams.BackgroundColor = $BackgroundColor }
  if ($NoNewline) { $hostParams.NoNewline = $true }
  Microsoft.PowerShell.Utility\Write-Host @hostParams
}
function Read-Host {
  [CmdletBinding()]
  param([Parameter(Position = 0)] [string] $Prompt = '', [switch] $AsSecureString)
  if ($Prompt -match '[\u0600-\u06FF]') { $Prompt = ([string][char]0x202B) + $Prompt + [char]0x202C }
  if ($AsSecureString) { return Microsoft.PowerShell.Utility\Read-Host -Prompt $Prompt -AsSecureString }
  return Microsoft.PowerShell.Utility\Read-Host -Prompt $Prompt
}
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

$preferredPort = 3000
try {
  $savedPort = [int]$config.port
  if ($savedPort -ge 1024 -and $savedPort -le 65535) { $preferredPort = $savedPort }
} catch { }
$port = $preferredPort
$baseUrl = "http://127.0.0.1:$port"
function Set-ConfigPort([int]$Value) {
  if ($config.PSObject.Properties.Name -contains 'port') { $config.port = $Value }
  else { $config | Add-Member -NotePropertyName port -NotePropertyValue $Value }
}
$pidPath = Join-Path $installRoot 'config\server.pid'
$logsDir = $config.logDir
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

function Test-LocalPortFree([int]$Port) {
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    return $true
  } catch { return $false }
  finally { if ($listener) { $listener.Stop() } }
}

$running = $false
if (Test-Path -LiteralPath $pidPath) {
  $savedPid = 0
  $rawPid = (Get-Content -LiteralPath $pidPath -Raw).Trim()
  if ([int]::TryParse($rawPid, [ref]$savedPid)) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine -and $process.CommandLine.IndexOf($config.appDir, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      try {
        $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 2
        $running = [bool]$health.ok -and $health.version -eq $config.appVersion
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

# If the PID file was lost but this exact app is already healthy on its configured port,
# reuse it instead of starting a duplicate server.
if (-not $running) {
  try {
    $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 2
    $running = [bool]$health.ok -and $health.version -eq $config.appVersion
  } catch { $running = $false }
}

if (-not $running) {
  if (-not (Test-LocalPortFree $port)) {
    $found = $false
    for ($candidate = $preferredPort + 1; $candidate -le [Math]::Min(65535, $preferredPort + 30); $candidate++) {
      if (Test-LocalPortFree $candidate) { $port = $candidate; $found = $true; break }
    }
    if (-not $found) { throw 'پورت برنامه اشغال است و پورت آزاد دیگری در بازهٔ ۳۰تایی پیدا نشد.' }
    Set-ConfigPort $port
    [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 8), ([System.Text.UTF8Encoding]::new($false)))
  }
  $env:PORT = [string]$port
  $baseUrl = "http://127.0.0.1:$port"
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $stdoutLog = Join-Path $logsDir "server-$stamp.log"
  $stderrLog = Join-Path $logsDir "server-error-$stamp.log"
  $argumentLine = '"' + $serveScript + '" start'
  try {
    $proc = Start-Process -FilePath $nodePath -ArgumentList $argumentLine -WorkingDirectory $config.appDir -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru -ErrorAction Stop
  } catch {
    $failure = Join-Path $logsDir 'launch-failure.txt'
    [IO.File]::WriteAllText($failure, "وقت: $(Get-Date -Format o)`r`nخطا: $($_.Exception.Message)`r`nNode: $nodePath`r`nScript: $serveScript`r`nWorking directory: $($config.appDir)`r`n", ([System.Text.UTF8Encoding]::new($false)))
    Write-Host ("ساخت پردازهٔ سرور ناموفق بود؛ جزئیات در {0}" -f $failure) -ForegroundColor Red
    Read-Host 'برای بستن Enter بزنید'
    exit 1
  }
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
    $failure = Join-Path $logsDir 'launch-failure.txt'
    [IO.File]::WriteAllText($failure, "وقت: $(Get-Date -Format o)`r`nبرنامه: $($config.appDir)`r`nپورت: $port`r`nنسخهٔ مورد انتظار: $($config.appVersion)`r`nخروجی خطا: $stderrLog`r`n", ([System.Text.UTF8Encoding]::new($false)))
    Write-Host ("برنامه روی پورت {0} آماده نشد. گزارش خطا: {1}" -f $port, $stderrLog) -ForegroundColor Red
    if (Test-Path -LiteralPath $stderrLog) { Get-Content -LiteralPath $stderrLog -Tail 40 }
    if (Test-Path -LiteralPath $stdoutLog) { Get-Content -LiteralPath $stdoutLog -Tail 20 }
    Read-Host 'برای بستن Enter بزنید'
    exit 1
  }
  Set-ConfigPort $port
  [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 8), ([System.Text.UTF8Encoding]::new($false)))
}

try {
  Start-Process $baseUrl -ErrorAction Stop
  Write-Host ("سامانهٔ Pumpstation آماده است: {0}" -f $baseUrl) -ForegroundColor Green
} catch {
  Write-Host ("سرور سالم است اما مرورگر خودکار باز نشد؛ این نشانی را دستی باز کنید: {0}" -f $baseUrl) -ForegroundColor Yellow
}
