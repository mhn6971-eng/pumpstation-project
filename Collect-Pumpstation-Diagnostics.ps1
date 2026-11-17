# Read-only Pumpstation diagnostic collector for Windows PowerShell 5.1+
# Creates a text report on the Desktop and opens it in Notepad.
# It does NOT change the application, database, backups, or configuration.

$ErrorActionPreference = 'Continue'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$desktop = [Environment]::GetFolderPath('Desktop')
if ([string]::IsNullOrWhiteSpace($desktop) -or -not (Test-Path -LiteralPath $desktop)) {
  $desktop = Join-Path $env:USERPROFILE 'Documents'
}
if (-not (Test-Path -LiteralPath $desktop)) { $desktop = $env:TEMP }
$reportPath = Join-Path $desktop "Pumpstation-Diagnostics-$stamp.txt"
$script:report = New-Object 'System.Collections.Generic.List[string]'

function Add-Line([string]$Text = '') {
  [void]$script:report.Add($Text)
}

function Protect-Text([string]$Text) {
  if ($null -eq $Text) { return '' }
  # Mask common secret-like values if any are accidentally present in a log.
  $safe = $Text -replace '(?i)(\b(?:pin|password|passwd|token|secret|authorization)\b\s*[:=]\s*)[^\s,;]+', '$1[REDACTED]'
  return $safe
}

function Add-FileTail([string]$Path, [int]$Tail = 120) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  Add-Line "--- FILE: $Path (last $Tail lines) ---"
  try {
    $content = Get-Content -LiteralPath $Path -Encoding UTF8 -Tail $Tail -ErrorAction Stop
    foreach ($line in $content) { Add-Line (Protect-Text ([string]$line)) }
  } catch {
    Add-Line "Could not read file: $($_.Exception.Message)"
  }
  Add-Line
}

Add-Line 'PUMPSTATION DIAGNOSTICS (read-only report)'
Add-Line "Created: $(Get-Date -Format o)"
Add-Line "Computer: $env:COMPUTERNAME"
Add-Line "Windows user: $env:USERNAME"
Add-Line 'This report does not include database contents or copy application data.'
Add-Line

$installRoots = New-Object 'System.Collections.Generic.List[string]'
$programsDir = Join-Path $env:LOCALAPPDATA 'Programs'
if (Test-Path -LiteralPath $programsDir) {
  try {
    foreach ($dir in (Get-ChildItem -LiteralPath $programsDir -Directory -Filter 'Pumpstation*' -ErrorAction SilentlyContinue)) {
      [void]$installRoots.Add($dir.FullName)
    }
  } catch { }
}
$knownInstall = Join-Path $programsDir 'Pumpstation-Fresh-1.4.25'
if ((Test-Path -LiteralPath $knownInstall) -and -not $installRoots.Contains($knownInstall)) {
  [void]$installRoots.Add($knownInstall)
}

$configs = New-Object 'System.Collections.Generic.List[object]'
foreach ($root in $installRoots) {
  $configPath = Join-Path $root 'config\install.json'
  if (Test-Path -LiteralPath $configPath -PathType Leaf) {
    try {
      $config = Get-Content -LiteralPath $configPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
      [void]$configs.Add([PSCustomObject]@{ Path = $configPath; Data = $config })
    } catch {
      Add-Line "Could not parse install config $configPath : $($_.Exception.Message)"
    }
  }
}

$dataRoots = New-Object 'System.Collections.Generic.List[string]'
$logDirs = New-Object 'System.Collections.Generic.List[string]'
foreach ($entry in $configs) {
  $cfg = $entry.Data
  Add-Line "Install config: $($entry.Path)"
  foreach ($prop in @('appDir','dataRoot','logDir','runtimeDir','appVersion')) {
    $value = $cfg.$prop
    if ($null -ne $value -and -not [string]::IsNullOrWhiteSpace([string]$value)) {
      Add-Line ("  {0}: {1}" -f $prop, [string]$value)
    }
  }
  if ($cfg.dataRoot -and -not $dataRoots.Contains([string]$cfg.dataRoot)) { [void]$dataRoots.Add([string]$cfg.dataRoot) }
  if ($cfg.logDir -and -not $logDirs.Contains([string]$cfg.logDir)) { [void]$logDirs.Add([string]$cfg.logDir) }
  if ($cfg.dataRoot) {
    foreach ($candidate in @((Join-Path ([string]$cfg.dataRoot) 'Logs'), (Join-Path ([string]$cfg.dataRoot) 'logs'))) {
      if (-not $logDirs.Contains($candidate)) { [void]$logDirs.Add($candidate) }
    }
  }
}

# Known fallback from the user's reported installation, plus common local path.
foreach ($candidate in @('F:\Pumpstation-Data-Fresh-1.4.25-2', (Join-Path $env:LOCALAPPDATA 'Pumpstation-Data'))) {
  if ((Test-Path -LiteralPath $candidate) -and -not $dataRoots.Contains($candidate)) { [void]$dataRoots.Add($candidate) }
  foreach ($logs in @((Join-Path $candidate 'Logs'), (Join-Path $candidate 'logs'))) {
    if ((Test-Path -LiteralPath $logs) -and -not $logDirs.Contains($logs)) { [void]$logDirs.Add($logs) }
  }
}

Add-Line
Add-Line '==== UPDATE STATUS ===='
$statusFound = $false
foreach ($dataRoot in $dataRoots) {
  $statusPath = Join-Path $dataRoot 'update-status.json'
  if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
    $statusFound = $true
    Add-FileTail -Path $statusPath -Tail 80
  }
}
if (-not $statusFound) { Add-Line 'No update-status.json found in detected data folders.'; Add-Line }

Add-Line '==== LOG FOLDERS AND FILES ===='
$logFiles = New-Object 'System.Collections.Generic.List[object]'
foreach ($dir in $logDirs) {
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) { continue }
  Add-Line "Log folder: $dir"
  try {
    $files = @(Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    foreach ($file in ($files | Select-Object -First 12)) {
      Add-Line ("  {0} | {1} | {2} bytes" -f $file.Name, $file.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'), $file.Length)
    }
    foreach ($file in $files) {
      if (($file.Name -eq 'auto-update.log') -or ($file.Name -eq 'launch-failure.txt') -or
          ($file.Name -like 'server-error-*.log') -or ($file.Name -like 'server-*.log')) {
        $alreadyAdded = @($logFiles | Where-Object { $_.FullName -eq $file.FullName }).Count -gt 0
        if (-not $alreadyAdded) { [void]$logFiles.Add($file) }
      }
    }
  } catch {
    Add-Line "Could not list $dir : $($_.Exception.Message)"
  }
  Add-Line
}

Add-Line '==== UPDATE / LAUNCH LOG CONTENTS ===='
$selectedLogs = @($logFiles | Sort-Object LastWriteTime -Descending)
$autoLogs = @($selectedLogs | Where-Object { $_.Name -eq 'auto-update.log' } | Select-Object -First 1)
$failureLogs = @($selectedLogs | Where-Object { $_.Name -eq 'launch-failure.txt' } | Select-Object -First 3)
$errorLogs = @($selectedLogs | Where-Object { $_.Name -like 'server-error-*.log' } | Select-Object -First 4)
$serverLogs = @($selectedLogs | Where-Object { $_.Name -like 'server-*.log' -and $_.Name -notlike 'server-error-*' } | Select-Object -First 3)
foreach ($file in @($autoLogs + $failureLogs + $errorLogs + $serverLogs)) {
  if ($null -ne $file) {
    $tailCount = if ($file.Name -eq 'auto-update.log') { 250 } else { 100 }
    Add-FileTail -Path $file.FullName -Tail $tailCount
  }
}
if ($selectedLogs.Count -eq 0) { Add-Line 'No diagnostic log files found.'; Add-Line }

Add-Line '==== NODE PROCESSES (no command lines collected) ===='
try {
  $nodes = @(Get-Process -Name node -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending)
  if ($nodes.Count -eq 0) { Add-Line 'No node.exe process is running.' }
  foreach ($proc in ($nodes | Select-Object -First 10)) {
    $started = ''
    try { $started = $proc.StartTime.ToString('yyyy-MM-dd HH:mm:ss') } catch { }
    Add-Line ("PID={0}; StartTime={1}" -f $proc.Id, $started)
  }
} catch { Add-Line "Could not inspect node processes: $($_.Exception.Message)" }
Add-Line

Add-Line '==== PORT 3000 ===='
try {
  $listeners = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop)
  if ($listeners.Count -eq 0) { Add-Line 'Nothing is listening on port 3000.' }
  foreach ($listener in $listeners) {
    Add-Line ("LocalAddress={0}; LocalPort={1}; OwningProcess={2}" -f $listener.LocalAddress, $listener.LocalPort, $listener.OwningProcess)
  }
} catch {
  try {
    $matches = @(netstat.exe -ano 2>$null | Select-String ':3000\s+.*LISTENING')
    if ($matches.Count -eq 0) { Add-Line 'No LISTENING entry for port 3000 (or netstat unavailable).' }
    foreach ($match in $matches) { Add-Line ([string]$match.Line).Trim() }
  } catch { Add-Line 'Could not inspect port 3000.' }
}

try {
  Set-Content -LiteralPath $reportPath -Value $script:report -Encoding UTF8 -ErrorAction Stop
  Write-Host "گزارش عیب‌یابی ساخته شد: $reportPath" -ForegroundColor Green
  Start-Process -FilePath 'notepad.exe' -ArgumentList @($reportPath)
} catch {
  Write-Host "ساخت گزارش ناموفق بود: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "مسیر پیشنهادی: $reportPath"
}
