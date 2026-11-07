$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ErrorLog = Join-Path $env:TEMP 'Pumpstation-pin-reset-error.log'
try {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch { }

function Write-Host {
  [CmdletBinding()]
  param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)] [AllowNull()] [object[]] $Object,
    [ConsoleColor] $ForegroundColor,
    [string] $Separator = ' ',
    [switch] $NoNewline
  )
  $shown = @(
    foreach ($item in $Object) {
      if ($null -eq $item) { '' }
      else { [regex]::Replace([string]$item, '[^\x00-\x7F]', '?') }
    }
  )
  $hostParams = @{ Object = $shown; Separator = $Separator }
  if ($PSBoundParameters.ContainsKey('ForegroundColor')) { $hostParams.ForegroundColor = $ForegroundColor }
  if ($NoNewline) { $hostParams.NoNewline = $true }
  Microsoft.PowerShell.Utility\Write-Host @hostParams
}

function Assert-DirectoryFilesEqual([string]$Source, [string]$Destination) {
  $sourceFiles = @(Get-ChildItem -LiteralPath $Source -File -Recurse -Force | Sort-Object -Property FullName)
  $destinationFiles = @(Get-ChildItem -LiteralPath $Destination -File -Recurse -Force | Sort-Object -Property FullName)
  if ($sourceFiles.Count -ne $destinationFiles.Count) { throw 'PIN-reset backup file count does not match the database.' }
  $sourceBase = [IO.Path]::GetFullPath($Source).TrimEnd([char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)) + [IO.Path]::DirectorySeparatorChar
  foreach ($sourceFile in $sourceFiles) {
    $relative = $sourceFile.FullName.Substring($sourceBase.Length)
    $destinationFile = Join-Path $Destination $relative
    if (-not (Test-Path -LiteralPath $destinationFile -PathType Leaf)) { throw "PIN-reset backup is missing: $relative" }
    $destinationInfo = Get-Item -LiteralPath $destinationFile
    if ($sourceFile.Length -ne $destinationInfo.Length) { throw "PIN-reset backup size mismatch: $relative" }
    $sourceHash = (Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash
    $destinationHash = (Get-FileHash -LiteralPath $destinationFile -Algorithm SHA256).Hash
    if ($sourceHash -ne $destinationHash) { throw "PIN-reset backup hash mismatch: $relative" }
  }
}

function Stop-PumpstationServer([string]$InstallRoot, [string]$AppDir, [string]$RuntimeDir, [string]$DatabaseDir) {
  $pidPath = Join-Path $InstallRoot 'config\server.pid'
  $lockPath = Join-Path $DatabaseDir '.pumpstation.lock'
  $savedPid = 0
  $databaseOwnerPid = 0
  if (Test-Path -LiteralPath $pidPath) {
    $raw = (Get-Content -LiteralPath $pidPath -Raw).Trim()
    [void][int]::TryParse($raw, [ref]$savedPid)
  }
  if (Test-Path -LiteralPath $lockPath) {
    try {
      $lock = [IO.File]::ReadAllText($lockPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
      $parsedPid = [int]::TryParse([string]$lock.pid, [ref]$databaseOwnerPid)
      if (-not $parsedPid -or $databaseOwnerPid -le 0) { throw 'Invalid owner PID' }
    } catch { throw 'The database lock file is unreadable. No process was stopped and PINs were not changed.' }
  }
  try {
    $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop)
  } catch { throw 'Could not safely inspect Pumpstation processes. No process was stopped.' }

  $nodePath = [IO.Path]::GetFullPath((Join-Path $RuntimeDir 'node.exe'))
  $killPids = @()
  foreach ($proc in $processes) {
    $command = [string]$proc.CommandLine
    if (-not $command) { continue }
    $executable = [string]$proc.ExecutablePath
    $sameRuntime = $false
    if ($executable) {
      try { $sameRuntime = [IO.Path]::GetFullPath($executable).Equals($nodePath, [StringComparison]::OrdinalIgnoreCase) } catch { }
    }
    $mentionsApp = $command.IndexOf($AppDir, [StringComparison]::OrdinalIgnoreCase) -ge 0
    $isLauncher = $mentionsApp -and $command -match '(?i)scripts[\\/]+serve\.mjs\s+start'
    $isNextServer = ($command -match '(?i)node_modules[\\/]+next[\\/]+dist[\\/]') -and ($command -match '(?i)\bstart\b')
    $isDatabaseOwner = ([int]$proc.ProcessId -eq $databaseOwnerPid) -and $sameRuntime -and $isNextServer
    $isManagedNext = $isNextServer -and $sameRuntime -and $mentionsApp
    if ($isLauncher -or $isManagedNext -or $isDatabaseOwner) { $killPids += [int]$proc.ProcessId }
  }

  $candidatePids = @($databaseOwnerPid, $savedPid) | Where-Object { $_ -gt 0 } | Select-Object -Unique
  foreach ($candidatePid in $candidatePids) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $candidatePid" -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    if ($candidatePid -eq $databaseOwnerPid -and $candidatePid -notin $killPids) {
      throw 'The process holding the Pumpstation database could not be identified safely. Close Pumpstation and retry; PINs were not changed.'
    }
  }

  foreach ($serverPid in @($killPids | Select-Object -Unique)) {
    & taskkill.exe /PID $serverPid /T /F 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue }
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      if (-not (Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Milliseconds 500
    }
    if (Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue) {
      throw 'Pumpstation server could not be stopped safely; PINs were not changed.'
    }
  }

  if ($databaseOwnerPid -gt 0 -and (Get-CimInstance Win32_Process -Filter "ProcessId = $databaseOwnerPid" -ErrorAction SilentlyContinue)) {
    throw 'The Pumpstation database is still open in another process. Close the app and retry; PINs were not changed.'
  }
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

try {
  $installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Pumpstation'
  $configPath = Join-Path $installRoot 'config\install.json'
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw 'Pumpstation install.json was not found. Run the installer first.' }
  $config = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
  $appDir = [string]$config.appDir
  $nodePath = Join-Path $config.runtimeDir 'node.exe'
  $databaseDir = [string]$config.databaseDir
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw 'The private Pumpstation Node.js runtime was not found.' }
  if (-not (Test-Path -LiteralPath (Join-Path $appDir 'node_modules\@electric-sql\pglite')) -or -not (Test-Path -LiteralPath (Join-Path $appDir 'src\lib\pin.ts'))) {
    throw 'The installed app dependencies are incomplete. Run the current installer before resetting PINs.'
  }
  if (-not (Test-Path -LiteralPath $databaseDir -PathType Container)) { throw 'The configured Pumpstation database folder was not found.' }

  Write-Host 'This recovery sets every shift PIN to the temporary default 1234.' -ForegroundColor Yellow
  Write-Host 'The database is backed up and verified first. Existing operational data is not reset.'
  Stop-PumpstationServer $installRoot $appDir $config.runtimeDir $databaseDir

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $safetyDir = Join-Path $config.backupDir (Join-Path 'credential-recovery' $stamp)
  New-Item -ItemType Directory -Path $safetyDir -Force | Out-Null
  $databaseBackup = Join-Path $safetyDir 'Database'
  New-Item -ItemType Directory -Path $databaseBackup -Force | Out-Null
  Get-ChildItem -LiteralPath $databaseDir -Force | Copy-Item -Destination $databaseBackup -Recurse -Force
  Assert-DirectoryFilesEqual $databaseDir $databaseBackup
  Write-Host ("Verified database backup: {0}" -f $databaseBackup) -ForegroundColor Green

  $env:DATABASE_URL = ''
  $env:PGLITE_DATA_DIR = $databaseDir
  $nodeScript = @'
import { PGlite } from "@electric-sql/pglite";
import { hashPin, verifyPin } from "./src/lib/pin.ts";
import { acquireDbLock, releaseDbLock } from "./src/lib/dblock.ts";
const dataDir = process.env.PGLITE_DATA_DIR;
if (!dataDir) throw new Error("PGLITE_DATA_DIR is missing");
acquireDbLock(dataDir, { enforce: true });
let db;
try {
  db = new PGlite(dataDir);
  await db.waitReady;
  const found = await db.query("SELECT key, role, totp_enabled FROM shifts ORDER BY key");
  const rows = found.rows ?? [];
  if (!rows.length) throw new Error("No local operator accounts were found; no PINs were changed");
  const admin = rows.find((row) => row.key === "admin" && row.role === "admin");
  if (!admin) throw new Error("The local administrator account was not found; no PINs were changed");
  await db.query("BEGIN");
  try {
    await db.query("UPDATE shifts SET pin = $1", [hashPin("1234")]);
    const verified = await db.query("SELECT pin FROM shifts");
    if (verified.rows.length !== rows.length || !verified.rows.every((row) => verifyPin("1234", row.pin))) {
      throw new Error("Not every shift PIN could be verified after reset");
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  console.log(`PUMPSTATION_RESET_OK=${rows.length};TOTP=${admin.totp_enabled ? "ON" : "OFF"}`);
} finally {
  if (db) await db.close();
  releaseDbLock(dataDir);
}
'@
  Push-Location $appDir
  try {
    $nodeOutput = @(& $nodePath --input-type=module -e $nodeScript 2>&1)
    $nodeExitCode = $LASTEXITCODE
  } finally { Pop-Location }
  if ($nodeExitCode -ne 0) { throw ("PIN reset failed: {0}" -f (($nodeOutput | Out-String).Trim())) }
  $resultLine = @($nodeOutput | ForEach-Object { [string]$_ } | Where-Object { $_ -match '^PUMPSTATION_RESET_OK=\d+;TOTP=(ON|OFF)$' } | Select-Object -Last 1)
  if ($resultLine.Count -eq 0) { throw 'PIN reset could not be verified; review the diagnostic log.' }
  $totpEnabled = [string]$resultLine[0] -match ';TOTP=ON$'

  Write-Title 'PIN RESET COMPLETE'
  Write-Host 'Temporary PIN for all accounts: 1234' -ForegroundColor Green
  Write-Host 'Select the Administrator account to sign in, then change PINs in Admin settings.' -ForegroundColor Yellow
  Write-Host ("Verified database backup: {0}" -f $databaseBackup) -ForegroundColor Green
  if ($totpEnabled) { Write-Host 'Administrator two-factor authentication is still enabled; its authenticator code is also required.' -ForegroundColor Yellow }
  $launcherPath = Join-Path $installRoot 'launch-pumpstation.ps1'
  if (Test-Path -LiteralPath $launcherPath) {
    Write-Host 'Restarting Pumpstation...' -ForegroundColor Cyan
    & (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass -File $launcherPath
    if ($LASTEXITCODE -ne 0) { Write-Host 'The PIN was reset, but automatic app startup failed. Use the desktop shortcut.' -ForegroundColor Yellow }
  }
} catch {
  $message = $_.Exception.Message
  try { [IO.File]::WriteAllText($ErrorLog, ("Time: {0}`r`nMessage: {1}`r`n" -f (Get-Date -Format o), $message), ([System.Text.UTF8Encoding]::new($false))) } catch { }
  Write-Host ("PIN RESET FAILED: {0}" -f $message) -ForegroundColor Red
  Write-Host ("Diagnostic log: {0}" -f $ErrorLog) -ForegroundColor Yellow
  Write-Host 'If a database backup was created, it is retained. Do not delete the data folder.' -ForegroundColor Yellow
  exit 1
}

Write-Host 'Press Enter to close this window.' -ForegroundColor Green
[void](Read-Host)

function Write-Title([string]$Text) {
  Write-Host ''
  Write-Host '====================================================================' -ForegroundColor DarkGray
  Write-Host $Text -ForegroundColor Green
  Write-Host '====================================================================' -ForegroundColor DarkGray
}
