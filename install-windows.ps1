$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$NodeVersion = '22.22.2'
$NpmVersion = '10.9.4'
$NodeIntegrity = 'sha512-w6ir5BjNVuSIC43FWLchnuc/bu9hT0ntMH/FJFouaR2oxADkFhim4YlOp4r92Euyj5b15YdbiL5xYwgmELZuZg=='
$NpmIntegrity = 'sha512-OnUG836FwboQIbqtefDNlyR0gTHzIfwRfE3DuiNewBvnMnWEpB0VEXwBlFVgqpNzIgYo/MHh3d2Hel/pszapAA=='
$Registry = 'https://registry.npmjs.org'
$InstallerErrorLog = $env:PUMPSTATION_ERROR_LOG
$script:InstallerPins = @()
if ([string]::IsNullOrWhiteSpace($InstallerErrorLog)) { $InstallerErrorLog = Join-Path $env:TEMP 'Pumpstation-install-error.log' }
try {
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  [Console]::OutputEncoding = $utf8
  [Console]::InputEncoding = $utf8
} catch { }

# Keep every installer message ASCII so CMD/Windows PowerShell never renders RTL text incorrectly.
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
      else { [regex]::Replace([string]$item, '[^\x00-\x7F]', '?') }
    }
  )
  $hostParams = @{ Object = $shown; Separator = $Separator }
  if ($PSBoundParameters.ContainsKey('ForegroundColor')) { $hostParams.ForegroundColor = $ForegroundColor }
  if ($PSBoundParameters.ContainsKey('BackgroundColor')) { $hostParams.BackgroundColor = $BackgroundColor }
  if ($NoNewline) { $hostParams.NoNewline = $true }
  Microsoft.PowerShell.Utility\Write-Host @hostParams
}

function Write-Title([string]$Text) {
  Write-Host ''
  Write-Host ('=' * 68) -ForegroundColor DarkCyan
  Write-Host $Text -ForegroundColor Cyan
  Write-Host ('=' * 68) -ForegroundColor DarkCyan
}

function Get-Sha512Integrity([string]$File) {
  $hash = (Get-FileHash -LiteralPath $File -Algorithm SHA512).Hash
  $bytes = New-Object byte[] ([int]($hash.Length / 2))
  for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($hash.Substring($i * 2, 2), 16) }
  return 'sha512-' + [Convert]::ToBase64String($bytes)
}

function Get-PinnedPackage([string]$Name, [string]$Version, [string]$Integrity, [string]$CacheDir) {
  $cacheFile = Join-Path $CacheDir ($Name + '-' + $Version + '.tgz')
  if ((Test-Path -LiteralPath $cacheFile) -and (Get-Sha512Integrity $cacheFile) -eq $Integrity) {
    Write-Host ("Using verified cached package: {0}@{1}" -f $Name, $Version)
    return $cacheFile
  }
  if (Test-Path -LiteralPath $cacheFile) { Remove-Item -LiteralPath $cacheFile -Force }
  $url = "$Registry/$Name/-/$Name-$Version.tgz"
  Write-Host ("Downloading pinned package {0}@{1} from npm registry..." -f $Name, $Version)
  Invoke-WebRequest -Uri $url -OutFile $cacheFile -UseBasicParsing
  $actual = Get-Sha512Integrity $cacheFile
  if ($actual -ne $Integrity) {
    Remove-Item -LiteralPath $cacheFile -Force -ErrorAction SilentlyContinue
    throw "SHA-512 verification failed for $Name@$Version. The package was not installed."
  }
  return $cacheFile
}

function Get-VerifiedOfflinePackage([string]$Name, [string]$Version, [string]$Integrity, [string]$VendorDir) {
  $file = Join-Path $VendorDir ($Name + '-' + $Version + '.tgz')
  if (-not (Test-Path -LiteralPath $file)) { throw "Offline package $Name@$Version was not found in offline-vendor." }
  $actual = Get-Sha512Integrity $file
  if ($actual -ne $Integrity) { throw "SHA-512 verification failed for offline package $Name@$Version." }
  Write-Host ("Verified offline package: {0}@{1}" -f $Name, $Version) -ForegroundColor Green
  return $file
}

function Test-RegistryOnline {
  # The lightweight ping endpoint avoids downloading npm's large package metadata.
  # Some proxies reject HEAD requests even when normal package downloads are allowed.
  try {
    Invoke-WebRequest -Uri "$Registry/-/ping" -Method Get -TimeoutSec 8 -UseBasicParsing | Out-Null
    return $true
  } catch { return $false }
}

function Copy-OfflineNpmCache([string]$Source, [string]$Destination) {
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  & robocopy.exe $Source $Destination /E /R:1 /W:1 /NFL /NDL /NP
  if ($LASTEXITCODE -ge 8) { throw 'Could not copy the offline npm cache.' }
}

function Assert-DirectoryFilesEqual([string]$Source, [string]$Destination) {
  $sourceFiles = @(Get-ChildItem -LiteralPath $Source -File -Recurse -Force | Sort-Object -Property FullName)
  $destinationFiles = @(Get-ChildItem -LiteralPath $Destination -File -Recurse -Force | Sort-Object -Property FullName)
  if ($sourceFiles.Count -ne $destinationFiles.Count) { throw 'Database backup file count does not match the source.' }
  $sourceBase = [IO.Path]::GetFullPath($Source).TrimEnd([char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)) + [IO.Path]::DirectorySeparatorChar
  foreach ($sourceFile in $sourceFiles) {
    $relative = $sourceFile.FullName.Substring($sourceBase.Length)
    $destinationFile = Join-Path $Destination $relative
    if (-not (Test-Path -LiteralPath $destinationFile -PathType Leaf)) { throw "Database backup is missing: $relative" }
    $destinationInfo = Get-Item -LiteralPath $destinationFile
    if ($sourceFile.Length -ne $destinationInfo.Length) { throw "Database backup size mismatch: $relative" }
    $sourceHash = (Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash
    $destinationHash = (Get-FileHash -LiteralPath $destinationFile -Algorithm SHA256).Hash
    if ($sourceHash -ne $destinationHash) { throw "Database backup hash mismatch: $relative" }
  }
}

function Get-InstallRoot {
  $local = [Environment]::GetFolderPath('LocalApplicationData')
  if ([string]::IsNullOrWhiteSpace($local) -or [IO.Path]::GetPathRoot($local).ToUpperInvariant() -ne 'C:\') {
    throw 'Windows LocalAppData must be on drive C for this installer.'
  }
  return Join-Path $local 'Programs\Pumpstation'
}

function Select-DataRoot {
  $drives = @([IO.DriveInfo]::GetDrives() | Where-Object {
    $_.DriveType -eq [IO.DriveType]::Fixed -and $_.Name.ToUpperInvariant() -ne 'C:\' -and $_.IsReady
  } | Sort-Object -Property AvailableFreeSpace -Descending)
  if ($drives.Count -eq 0) {
    $local = [Environment]::GetFolderPath('LocalApplicationData')
    if ([string]::IsNullOrWhiteSpace($local)) { throw 'No writable local data location was found.' }
    $root = Join-Path $local 'Pumpstation-Data'
    Write-Host "WARNING: No non-system data drive was found. Data will be stored separately from the app at $root." -ForegroundColor Yellow
    return $root
  }
  $selected = $drives[0]
  $root = Join-Path $selected.Name 'Pumpstation-Data'
  $freeGb = [Math]::Round($selected.AvailableFreeSpace / 1073741824, 1)
  Write-Host "Data drive selected automatically: $($selected.Name) ($freeGb GB free)." -ForegroundColor Green
  Write-Host "Data location: $root" -ForegroundColor Green
  return $root
}

function Get-PhysicalDiskNumber([string]$Path) {
  try {
    $root = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Path))
    if ($root -notmatch '^([A-Za-z]):\\$') { return $null }
    $partition = Get-Partition -DriveLetter $Matches[1] -ErrorAction Stop | Select-Object -First 1
    if ($partition) { return [int]$partition.DiskNumber }
  } catch { }
  return $null
}

function Select-MirrorRoot([string]$DataRoot) {
  $sameDriveMirror = Join-Path $DataRoot 'Pumpstation-Mirror'
  $dataDrive = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($DataRoot))
  $dataDisk = Get-PhysicalDiskNumber $DataRoot
  $candidates = @([IO.DriveInfo]::GetDrives() | Where-Object {
    $_.IsReady -and $_.DriveType -eq [IO.DriveType]::Fixed -and
    $_.Name.ToUpperInvariant() -ne 'C:\' -and $_.Name.ToUpperInvariant() -ne $dataDrive.ToUpperInvariant()
  } | Sort-Object -Property AvailableFreeSpace -Descending)
  foreach ($drive in $candidates) {
    $disk = Get-PhysicalDiskNumber $drive.Name
    if ($null -ne $dataDisk -and $null -ne $disk -and $dataDisk -ne $disk) {
      $mirror = Join-Path $drive.Name 'Pumpstation-Mirror'
      Write-Host "Mirror drive selected automatically: $($drive.Name)." -ForegroundColor Green
      return $mirror
    }
  }
  Write-Host 'WARNING: A separate physical mirror drive could not be verified; the mirror will stay beside the data.' -ForegroundColor Yellow
  return $sameDriveMirror
}

function Write-MirrorReliabilityWarning([string]$DataRoot, [string]$MirrorRoot) {
  $dataDrive = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($DataRoot))
  $mirrorDrive = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($MirrorRoot))
  if ($dataDrive -and $mirrorDrive -and $dataDrive.ToUpperInvariant() -eq $mirrorDrive.ToUpperInvariant()) {
    Write-Host 'WARNING: Data and mirror are on the same volume. Copy backups to separate physical media regularly.' -ForegroundColor Yellow
    return
  }
  $dataDisk = Get-PhysicalDiskNumber $DataRoot
  $mirrorDisk = Get-PhysicalDiskNumber $MirrorRoot
  if ($null -ne $dataDisk -and $null -ne $mirrorDisk -and $dataDisk -eq $mirrorDisk) {
    Write-Host 'WARNING: Data and mirror are on the same physical disk; the mirror is not independent.' -ForegroundColor Yellow
  } elseif ($null -eq $dataDisk -or $null -eq $mirrorDisk) {
    Write-Host 'WARNING: The installer could not verify a separate physical mirror disk.' -ForegroundColor Yellow
  }
}

function New-RandomPin([string[]]$Used) {
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    do {
      $bytes = New-Object byte[] 4
      $rng.GetBytes($bytes)
      $pin = [string](100000 + ([BitConverter]::ToUInt32($bytes, 0) % 900000))
    } while ($Used -contains $pin -or $pin -in @('1011', '2022', '3033', '9009'))
  } finally { $rng.Dispose() }
  return $pin
}

function New-LocalPin([string]$Key, [string]$Role, [string[]]$Used) {
  return New-RandomPin $Used
}

function New-LocalRoster([string]$RosterPath) {
  if (Test-Path -LiteralPath $RosterPath) {
    Write-Host 'Existing local operator accounts will be preserved.' -ForegroundColor Green
    return
  }
  Write-Title 'Create secure operator PINs'
  Write-Host 'Unique PINs are generated automatically. Save the PINs shown below; the installer log never stores them.' -ForegroundColor Yellow
  $used = @()
  $roster = @()
  $script:InstallerPins = @()
  $definitions = @(
    @{ key = 'A'; label = 'شیفت A'; role = 'operator'; members = @('اپراتور شیفت A') },
    @{ key = 'B'; label = 'شیفت B'; role = 'operator'; members = @('اپراتور شیفت B') },
    @{ key = 'C'; label = 'شیفت C'; role = 'operator'; members = @('اپراتور شیفت C') },
    @{ key = 'admin'; label = 'مدیر سامانه'; role = 'admin'; members = @('مدیر سامانه') }
  )
  foreach ($definition in $definitions) {
    $pin = New-LocalPin $definition.key $definition.label $used
    $used += $pin
    $roster += [PSCustomObject]@{ key = $definition.key; label = $definition.label; role = $definition.role; pin = $pin; members = $definition.members }
    $roleName = @{ A = 'Shift A'; B = 'Shift B'; C = 'Shift C'; admin = 'Administrator' }[$definition.key]
    $script:InstallerPins += [PSCustomObject]@{ Role = $roleName; Pin = $pin }
  }
  $json = @{ roster = $roster } | ConvertTo-Json -Depth 8
  $parent = Split-Path -Parent $RosterPath
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  [IO.File]::WriteAllText($RosterPath, $json, ([System.Text.UTF8Encoding]::new($false)))
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $RosterPath /inheritance:r /grant:r "$identity`:(R,W)" | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host 'WARNING: Could not restrict roster-file permissions automatically.' -ForegroundColor Yellow }
  } catch { Write-Host 'WARNING: Review roster-file permissions in Windows Properties.' -ForegroundColor Yellow }
  Write-Host 'Initial operator accounts are ready. You can change their names later in Admin settings.' -ForegroundColor Green
  Write-Title 'SAVE THESE INITIAL ACCESS PINS'
  Write-Host 'Write them down now. PIN values are not written to installer logs.' -ForegroundColor Yellow
  foreach ($credential in $script:InstallerPins) { Write-Host ("{0}: {1}" -f $credential.Role, $credential.Pin) -ForegroundColor Yellow }
}

function Set-AppEnvironment($Config) {
  $env:NODE_ENV = 'production'
  $env:DATABASE_URL = ''
  $env:PGLITE_DATA_DIR = $Config.databaseDir
  $env:BACKUP_DIR = $Config.backupDir
  $env:CATALOG_DIR = $Config.catalogDir
  $env:ARCHIVE_DIR = $Config.archiveDir
  $env:MIRROR_DIR = $Config.mirrorDir
  $env:PGDUMP_DIR = $Config.pgdumpDir
  $env:PROCESS_REPORT_DIR = $Config.processReportDir
  $env:PM_REPORT_DIR = $Config.pmReportDir
  $env:ROSTER_FILE = $Config.rosterFile
  $env:SESSION_SECRET_DIR = $Config.sessionSecretDir
  $env:MIRROR_TOKEN_FILE = $Config.mirrorTokenFile
  $env:PUMPSTATION_HOME = $Config.installRoot
  $env:PUMPSTATION_APP_DIR = $Config.appDir
  $env:PUMPSTATION_DATA_ROOT = $Config.dataRoot
  $env:PUMPSTATION_LAUNCHER = Join-Path $Config.installRoot 'launch-pumpstation.ps1'
  $env:PUMPSTATION_LAUNCHER_KIND = 'powershell'
  $env:PUMPSTATION_UPDATE_STATUS_FILE = Join-Path $Config.dataRoot 'update-status.json'
  $env:PUMPSTATION_UPDATE_LOCK_FILE = Join-Path $Config.dataRoot 'update.lock'
  $env:PUMPSTATION_UPDATE_LOG_FILE = Join-Path $Config.logDir 'auto-update.log'
  $env:NEXT_TELEMETRY_DISABLED = '1'
  $env:npm_config_color = 'false'
  $env:FORCE_COLOR = '0'
  $npmBin = Join-Path (Join-Path $Config.runtimeDir 'npm') 'bin'
  $env:PATH = $Config.runtimeDir + ';' + $npmBin + ';' + $env:PATH
}

function Stop-PumpstationServer([string]$PidPath, [string]$AppDir) {
  $serverPids = @()
  if (Test-Path -LiteralPath $PidPath) {
    $raw = (Get-Content -LiteralPath $PidPath -Raw).Trim()
    $savedPid = 0
    if ([int]::TryParse($raw, [ref]$savedPid)) { $serverPids += $savedPid }
  }
  # If the PID file was lost, discover only this app's exact production serve command.
  try {
    $managed = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop | Where-Object {
      $_.CommandLine -and
      $_.CommandLine.IndexOf($AppDir, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
      $_.CommandLine -match '(?i)scripts[\\/]+serve\.mjs\s+start'
    })
    $serverPids += @($managed | ForEach-Object { [int]$_.ProcessId })
  } catch { }

  foreach ($serverPid in @($serverPids | Select-Object -Unique)) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
    $isThisApp = $proc -and $proc.CommandLine -and
      $proc.CommandLine.IndexOf($AppDir, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
      $proc.CommandLine -match '(?i)scripts[\\/]+serve\.mjs\s+start'
    if (-not $isThisApp) { continue }
    & taskkill.exe /PID $serverPid /T /F 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue }
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
      if (-not (Get-Process -Id $serverPid -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Milliseconds 500
    }
    if (Get-Process -Id $serverPid -ErrorAction SilentlyContinue) { throw 'The Pumpstation server could not be stopped safely; database migration was cancelled.' }
  }
  Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments, [string]$WorkingDirectory, [string]$Description) {
  Write-Host $Description -ForegroundColor Cyan
  Push-Location $WorkingDirectory
  try {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw ("Command failed (exit {0}): {1}" -f $LASTEXITCODE, $Description) }
  } finally { Pop-Location }
}

$paths = $null
$databaseBackupPath = $null
$databaseExistedBeforeMigration = $false
$databaseHadFilesBeforeMigration = $false
$migrationStarted = $false
$appSwapped = $false
$previousApp = $null
$pidPath = $null

try {
  $packageJson = Join-Path (Join-Path $PSScriptRoot 'pumpstation-v1.2') 'package.json'
  if (-not (Test-Path -LiteralPath $packageJson)) { throw 'App files were not found beside install-windows.bat. Extract the complete ZIP, then run the installer again.' }
  $appVersion = (Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json).version
  Write-Title ("Pumpstation Windows Installer v{0} (Windows 10/11 x64)" -f $appVersion)
  Write-Host 'STEP 1/8 - Check Windows, available space, and installer files.' -ForegroundColor Cyan
  Write-Host 'The installer verifies pinned Node.js and npm packages, installs dependencies, prepares the database, and creates shortcuts automatically.'
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'This installer requires 64-bit Windows 10 or Windows 11.' }
  if ([version]$PSVersionTable.PSVersion -lt [version]'5.1') { throw 'Windows PowerShell 5.1 is required.' }
  $os = Get-CimInstance Win32_OperatingSystem
  if (-not $os -or [int]$os.ProductType -ne 1) { throw 'This installer supports Windows 10/11 desktop, not Windows Server.' }
  if ([int]$os.BuildNumber -lt 17763) { throw 'Minimum supported OS: Windows 10 version 1809 (build 17763) or Windows 11.' }

  Write-Title 'STEP 2/8 - Select persistent data storage'
  $installRoot = Get-InstallRoot
  $systemDrive = @([IO.DriveInfo]::GetDrives() | Where-Object { $_.Name.ToUpperInvariant() -eq 'C:\' -and $_.IsReady }) | Select-Object -First 1
  if (-not $systemDrive -or $systemDrive.AvailableFreeSpace -lt 3221225472) { throw 'At least 3 GB of free space is required on drive C.' }
  $appDir = Join-Path $installRoot 'app'
  $runtimeDir = Join-Path $installRoot 'runtime'
  $configDir = Join-Path $installRoot 'config'
  $configPath = Join-Path $configDir 'install.json'
  $launcherPath = Join-Path $installRoot 'launch-pumpstation.ps1'
  $launcherBatPath = Join-Path $installRoot 'launch-pumpstation.bat'
  $launcherVbsPath = Join-Path $installRoot 'launch-pumpstation.vbs'
  $previousConfig = $null
  $previousConfigRaw = $null
  if (Test-Path -LiteralPath $configPath) {
    $previousConfigRaw = [IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8)
    $previousConfig = $previousConfigRaw | ConvertFrom-Json
    $dataRoot = [string]$previousConfig.dataRoot
    if ([string]::IsNullOrWhiteSpace($dataRoot)) {
      throw 'The existing installation has no saved data path. Installation stopped to protect existing data.'
    }
    if ([IO.Path]::GetPathRoot($dataRoot).ToUpperInvariant() -eq 'C:\') {
      Write-Host 'WARNING: Existing data is on drive C and will stay in its current location.' -ForegroundColor Yellow
    }
    Write-Host ("Existing data location preserved: {0}" -f $dataRoot) -ForegroundColor Green
  } else {
    $dataRoot = Select-DataRoot
  }
  if ($previousConfig) {
    $mirrorDir = [string]$previousConfig.mirrorDir
    if ([string]::IsNullOrWhiteSpace($mirrorDir)) { $mirrorDir = Join-Path $dataRoot 'Pumpstation-Mirror' }
    Write-Host ("Existing mirror location preserved: {0}" -f $mirrorDir) -ForegroundColor Green
  } else {
    $mirrorDir = Select-MirrorRoot $dataRoot
  }
  Write-MirrorReliabilityWarning $dataRoot $mirrorDir

  $paths = @{
    databaseDir = Join-Path $dataRoot 'Database'
    processReportDir = Join-Path $dataRoot 'Process-Reports'
    pmReportDir = Join-Path $dataRoot 'PM-Reports'
    backupDir = Join-Path $dataRoot 'Backups'
    catalogDir = Join-Path $dataRoot 'Backups\Attachments-Catalog'
    archiveDir = Join-Path $dataRoot 'Backups\Cold-Archive'
    mirrorDir = $mirrorDir
    pgdumpDir = Join-Path $dataRoot 'Backups\Postgres-Dumps'
    logDir = Join-Path $dataRoot 'Logs'
    rosterFile = Join-Path $configDir 'roster.local.json'
    sessionSecretDir = Join-Path $configDir 'session-secret'
    mirrorTokenFile = Join-Path $configDir 'mirror-token'
  }
  if ($previousConfig) {
    foreach ($key in @('databaseDir', 'processReportDir', 'pmReportDir', 'backupDir', 'catalogDir', 'archiveDir', 'mirrorDir', 'pgdumpDir', 'logDir', 'rosterFile', 'sessionSecretDir', 'mirrorTokenFile')) {
      $savedPath = [string]$previousConfig.$key
      if (-not [string]::IsNullOrWhiteSpace($savedPath)) { $paths[$key] = $savedPath }
    }
  }
  foreach ($directory in @($dataRoot, $paths.databaseDir, $paths.processReportDir, $paths.pmReportDir, $paths.backupDir, $paths.catalogDir, $paths.archiveDir, $paths.mirrorDir, $paths.pgdumpDir, $paths.logDir, $configDir, $paths.sessionSecretDir)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }

  $cacheDir = Join-Path $installRoot 'cache\pinned-runtimes'
  New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
  $vendorDir = Join-Path $PSScriptRoot 'offline-vendor'
  $offlineNpmCache = Join-Path $vendorDir 'npm-cache'
  $offlineAvailable = (Test-Path -LiteralPath (Join-Path $vendorDir "node-win-x64-$NodeVersion.tgz")) -and (Test-Path -LiteralPath (Join-Path $vendorDir "npm-$NpmVersion.tgz")) -and (Test-Path -LiteralPath (Join-Path $offlineNpmCache '_cacache\index-v5')) -and (Test-Path -LiteralPath (Join-Path $offlineNpmCache '_cacache\content-v2')) -and (Test-Path -LiteralPath (Join-Path $vendorDir 'manifest.json'))
  if ($offlineAvailable) {
    try {
      $vendorManifest = Get-Content -LiteralPath (Join-Path $vendorDir 'manifest.json') -Raw | ConvertFrom-Json
      $currentLockHash = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'pumpstation-v1.2\package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
      $offlineAvailable = ($vendorManifest.target -eq 'win32-x64' -and $vendorManifest.lockSha256 -eq $currentLockHash)
    } catch { $offlineAvailable = $false }
  }

  $nodePath = Join-Path $runtimeDir 'node.exe'
  $npmBin = Join-Path (Join-Path $runtimeDir 'npm') 'bin'
  $npmCli = Join-Path $npmBin 'npm-cli.js'
  $nodeReady = $false
  $npmReady = $false
  if (Test-Path -LiteralPath $nodePath) {
    try {
      $nodeOutput = @(& $nodePath --version 2>$null)
      $nodeExitCode = $LASTEXITCODE
      $installedNode = ($nodeOutput | Out-String).Trim()
      $nodeReady = ($nodeExitCode -eq 0 -and $installedNode -eq "v$NodeVersion")
    } catch { $nodeReady = $false }
  }
  if ($nodeReady -and (Test-Path -LiteralPath $npmCli)) {
    try {
      $npmOutput = @(& $nodePath $npmCli --version 2>$null)
      $npmExitCode = $LASTEXITCODE
      $installedNpm = ($npmOutput | Out-String).Trim()
      $npmReady = ($npmExitCode -eq 0 -and $installedNpm -eq $NpmVersion)
    } catch { $npmReady = $false }
  }
  $runtimeReady = ($nodeReady -and $npmReady)
  if ($runtimeReady) {
    Write-Host ("Pinned Node.js {0} and npm {1} are already installed; download skipped." -f $NodeVersion, $NpmVersion) -ForegroundColor Green
  } elseif ($nodeReady) {
    Write-Host ("Node.js {0} is valid; npm {1} will be installed or repaired." -f $NodeVersion, $NpmVersion) -ForegroundColor Yellow
  }

  $onlineAvailable = Test-RegistryOnline
  if (-not $onlineAvailable -and -not $offlineAvailable -and (-not $nodeReady -or -not $npmReady)) { throw 'Internet is unavailable and no verified offline cache is present. Connect to the internet and retry.' }
  Write-Title 'STEP 3/8 - Verify or download Node.js and npm'
  if ($onlineAvailable) {
    $installMode = 'online'
    Write-Host 'Internet connection detected. Runtime and application dependencies will be installed automatically.' -ForegroundColor Green
  } elseif ($offlineAvailable) {
    $installMode = 'offline'
    Write-Host 'Internet is unavailable. Using the verified offline bundle automatically.' -ForegroundColor Yellow
  } elseif ($nodeReady -and $npmReady) {
    $installMode = 'offline'
    Write-Host 'Internet is unavailable. The installer will try the local npm cache.' -ForegroundColor Yellow
  } else {
    throw 'Internet is unavailable and no verified offline bundle is present. Connect to the internet and retry.'
  }
  $tar = $null
  if (-not $runtimeReady) {
    $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
    if (-not $tar) { throw 'Windows tar.exe is required to unpack the runtime. Update Windows and retry.' }
  }

  $npmCacheDir = Join-Path $installRoot 'cache\npm'
  $nodeArchive = $null
  $npmArchive = $null
  if (-not $runtimeReady) {
    if ($installMode -eq 'offline') {
      if (-not $nodeReady) { $nodeArchive = Get-VerifiedOfflinePackage 'node-win-x64' $NodeVersion $NodeIntegrity $vendorDir }
      if (-not $npmReady) { $npmArchive = Get-VerifiedOfflinePackage 'npm' $NpmVersion $NpmIntegrity $vendorDir }
      if ($offlineAvailable) { Copy-OfflineNpmCache $offlineNpmCache $npmCacheDir }
    } else {
      try {
        if (-not $nodeReady) { $nodeArchive = Get-PinnedPackage 'node-win-x64' $NodeVersion $NodeIntegrity $cacheDir }
        if (-not $npmReady) { $npmArchive = Get-PinnedPackage 'npm' $NpmVersion $NpmIntegrity $cacheDir }
      } catch {
        if (-not $offlineAvailable) { throw }
        Write-Host 'Online runtime download failed; trying the verified offline bundle.' -ForegroundColor Yellow
        $installMode = 'offline'
        if (-not $nodeReady) { $nodeArchive = Get-VerifiedOfflinePackage 'node-win-x64' $NodeVersion $NodeIntegrity $vendorDir }
        if (-not $npmReady) { $npmArchive = Get-VerifiedOfflinePackage 'npm' $NpmVersion $NpmIntegrity $vendorDir }
        Copy-OfflineNpmCache $offlineNpmCache $npmCacheDir
      }
    }

    $unpackRoot = Join-Path $env:TEMP ('pumpstation-runtime-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $unpackRoot -Force | Out-Null
    $nodeUnpack = Join-Path $unpackRoot 'node'
    $npmUnpack = Join-Path $unpackRoot 'npm'
    if (-not $nodeReady) { New-Item -ItemType Directory -Path $nodeUnpack -Force | Out-Null }
    if (-not $npmReady) { New-Item -ItemType Directory -Path $npmUnpack -Force | Out-Null }
    try {
      if (-not $nodeReady) {
        & $tar.Source -xzf $nodeArchive -C $nodeUnpack 'package/bin/node.exe'
        if ($LASTEXITCODE -ne 0) { throw 'Could not extract Node.js.' }
      }
      if (-not $npmReady) {
        & $tar.Source -xzf $npmArchive -C $npmUnpack 'package'
        if ($LASTEXITCODE -ne 0) { throw 'Could not extract npm.' }
        if (-not (Test-Path -LiteralPath (Join-Path $npmUnpack 'package/bin/npm-cli.js'))) { throw 'npm-cli.js was not found after extraction.' }
      }
      New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
      if (-not $nodeReady) {
        Copy-Item -LiteralPath (Join-Path $nodeUnpack 'package\bin\node.exe') -Destination $nodePath -Force
      }
      if (-not $npmReady) {
        $npmRoot = Join-Path $runtimeDir 'npm'
        if (Test-Path -LiteralPath $npmRoot) { Remove-Item -LiteralPath $npmRoot -Recurse -Force }
        New-Item -ItemType Directory -Path $npmRoot -Force | Out-Null
        & robocopy.exe (Join-Path $npmUnpack 'package') $npmRoot /E /R:1 /W:1 /NFL /NDL /NP
        $npmCopyCode = $LASTEXITCODE
        if ($npmCopyCode -ge 8) { throw "Could not copy npm files (robocopy $npmCopyCode)." }
        if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) { throw "npm-cli.js was not found after copying. Robocopy exit code: $npmCopyCode." }
      }
    } finally { Remove-Item -LiteralPath $unpackRoot -Recurse -Force -ErrorAction SilentlyContinue }
  }
  if ($runtimeReady -and $installMode -eq 'offline' -and $offlineAvailable) {
    Copy-OfflineNpmCache $offlineNpmCache $npmCacheDir
  }
  $nodeOutput = @(& $nodePath --version 2>&1)
  $nodeExitCode = $LASTEXITCODE
  $nodeActual = ($nodeOutput | Out-String).Trim()
  if ($nodeExitCode -ne 0 -or $nodeActual -ne "v$NodeVersion") { throw "Node.js version check failed (exit=$nodeExitCode, output=$nodeActual)." }
  if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) { throw 'npm-cli.js was not found in the runtime folder.' }
  $npmOutput = @(& $nodePath $npmCli --version 2>&1)
  $npmExitCode = $LASTEXITCODE
  $npmActual = ($npmOutput | Out-String).Trim()
  if ($npmExitCode -ne 0 -or $npmActual -ne $NpmVersion) { throw "npm version check failed (exit=$npmExitCode, output=$npmActual)." }
  $runtimeNotices = Join-Path $PSScriptRoot 'RUNTIME-LICENSES.txt'
  if (-not (Test-Path -LiteralPath $runtimeNotices)) { throw 'RUNTIME-LICENSES.txt was not found beside the installer.' }
  Copy-Item -LiteralPath $runtimeNotices -Destination (Join-Path $runtimeDir 'LICENSES.txt') -Force

  $config = [PSCustomObject]@{
    installRoot = $installRoot; appDir = $appDir; runtimeDir = $runtimeDir; dataRoot = $dataRoot
    databaseDir = $paths.databaseDir; processReportDir = $paths.processReportDir; pmReportDir = $paths.pmReportDir
    backupDir = $paths.backupDir; catalogDir = $paths.catalogDir; archiveDir = $paths.archiveDir
    mirrorDir = $paths.mirrorDir; pgdumpDir = $paths.pgdumpDir; logDir = $paths.logDir
    rosterFile = $paths.rosterFile; sessionSecretDir = $paths.sessionSecretDir; mirrorTokenFile = $paths.mirrorTokenFile
    appVersion = $appVersion; nodeVersion = $NodeVersion; npmVersion = $NpmVersion; port = 3000
  }
  Set-AppEnvironment $config

  $sourceApp = Join-Path $PSScriptRoot 'pumpstation-v1.2'
  $stageApp = Join-Path $installRoot 'app.new'
  if (Test-Path -LiteralPath $stageApp) { Remove-Item -LiteralPath $stageApp -Recurse -Force }
  New-Item -ItemType Directory -Path $stageApp -Force | Out-Null
  Write-Title 'STEP 4/8 - Prepare the application files'
  & robocopy.exe $sourceApp $stageApp /E /R:1 /W:1 /NFL /NDL /NP /XD '.git' 'node_modules' '.next' '.data' 'coverage' /XF '.env' '.env.local' '.env.production' '.env.development' '.env.test' '.env.production.local' '.env.development.local' '.env.test.local' '*.log' '*.local.json'
  $copyCode = $LASTEXITCODE
  if ($copyCode -ge 8) { throw "Could not copy application files (robocopy $copyCode)." }
  Get-ChildItem -LiteralPath $stageApp -Force -File -Recurse | Where-Object { $_.Name -like '.env*' -and $_.Name -ne '.env.example' } | Remove-Item -Force

  $stagePackage = Get-Content -LiteralPath (Join-Path $stageApp 'package.json') -Raw | ConvertFrom-Json
  if ($stagePackage.version -ne $appVersion) { throw 'Package version mismatch. Re-extract the complete installer ZIP and retry.' }
  Set-AppEnvironment $config
  Write-Title 'STEP 5/8 - Install locked dependencies and build the app'
  if ($installMode -eq 'offline') {
    $npmCiArguments = @($npmCli, 'ci', '--offline', '--no-audit', '--no-fund', '--cache', $npmCacheDir)
    Invoke-Checked -Executable $nodePath -Arguments $npmCiArguments -WorkingDirectory $stageApp -Description 'Installing locked dependencies from offline cache...'
  } else {
    $npmCiArguments = @($npmCli, 'ci', '--no-audit', '--no-fund', '--registry', $Registry, '--cache', $npmCacheDir)
    try {
      Invoke-Checked -Executable $nodePath -Arguments $npmCiArguments -WorkingDirectory $stageApp -Description 'Downloading and installing locked dependencies...'
    } catch {
      if (-not $offlineAvailable) { throw }
      Write-Host 'Online dependency install failed; retrying with the verified offline cache.' -ForegroundColor Yellow
      $installMode = 'offline'
      Copy-OfflineNpmCache $offlineNpmCache $npmCacheDir
      $npmCiArguments = @($npmCli, 'ci', '--offline', '--no-audit', '--no-fund', '--cache', $npmCacheDir)
      Invoke-Checked -Executable $nodePath -Arguments $npmCiArguments -WorkingDirectory $stageApp -Description 'Installing locked dependencies from offline cache...'
    }
  }
  $buildArguments = @($npmCli, 'run', 'build')
  Invoke-Checked -Executable $nodePath -Arguments $buildArguments -WorkingDirectory $stageApp -Description 'Building the production application...'
  Write-Title 'STEP 6/8 - Preserve PINs, back up and prepare the database'
  $rosterMarker = Join-Path $configDir 'roster-consumed.flag'
  $databaseHasFiles = $false
  if (Test-Path -LiteralPath $paths.databaseDir) { $databaseHasFiles = @(Get-ChildItem -LiteralPath $paths.databaseDir -Force -ErrorAction SilentlyContinue).Count -gt 0 }
  if ((Test-Path -LiteralPath $rosterMarker) -and -not $databaseHasFiles) {
    Remove-Item -LiteralPath $rosterMarker -Force -ErrorAction SilentlyContinue
    Write-Host 'The database is empty; new local operator PINs will be generated.' -ForegroundColor Yellow
  }
  if ($databaseHasFiles -and -not (Test-Path -LiteralPath $rosterMarker) -and -not (Test-Path -LiteralPath $paths.rosterFile)) {
    Write-Host 'Existing database files were found without an installer marker; saved PINs will not be replaced.' -ForegroundColor Yellow
  } elseif (-not (Test-Path -LiteralPath $rosterMarker)) { New-LocalRoster $paths.rosterFile }
  else { Write-Host 'Existing database PINs are preserved; no new PIN file will be created.' -ForegroundColor Green }

  $pidPath = Join-Path $configDir 'server.pid'
  $previousApp = Join-Path $installRoot 'app.previous'
  Stop-PumpstationServer $pidPath $appDir
  $databaseExistedBeforeMigration = Test-Path -LiteralPath $paths.databaseDir -PathType Container
  $existingEntries = @()
  if ($databaseExistedBeforeMigration) { $existingEntries = @(Get-ChildItem -LiteralPath $paths.databaseDir -Force -ErrorAction SilentlyContinue) }
  $databaseHadFilesBeforeMigration = $existingEntries.Count -gt 0
  if ($databaseHadFilesBeforeMigration) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $safetyDir = Join-Path $paths.backupDir (Join-Path 'pre-update' $stamp)
    New-Item -ItemType Directory -Path $safetyDir -Force | Out-Null
    $databaseBackupPath = Join-Path $safetyDir 'Database'
    Copy-Item -LiteralPath $paths.databaseDir -Destination $databaseBackupPath -Recurse -Force
    if (-not (Test-Path -LiteralPath $databaseBackupPath -PathType Container)) { throw 'Database safety copy could not be verified; migration was not started.' }
    Write-Host 'Verifying every database backup file by size and SHA-256...' -ForegroundColor Cyan
    Assert-DirectoryFilesEqual $paths.databaseDir $databaseBackupPath
    Write-Host ("Verified database safety copy: {0}" -f $safetyDir) -ForegroundColor Green
  }
  $migrationArguments = @((Join-Path $stageApp 'scripts/init-db.mjs'))
  $migrationStarted = $true
  Invoke-Checked -Executable $nodePath -Arguments $migrationArguments -WorkingDirectory $stageApp -Description 'Applying database migrations...'

  $previousApp = Join-Path $installRoot 'app.previous'
  if (Test-Path -LiteralPath $previousApp) { Remove-Item -LiteralPath $previousApp -Recurse -Force }
  if (Test-Path -LiteralPath $appDir) { Rename-Item -LiteralPath $appDir -NewName 'app.previous' }
  try {
    Rename-Item -LiteralPath $stageApp -NewName 'app'
    $appSwapped = $true
  } catch {
    if ((Test-Path -LiteralPath $previousApp) -and -not (Test-Path -LiteralPath $appDir)) { Rename-Item -LiteralPath $previousApp -NewName 'app' }
    throw
  }
  $config.appVersion = $appVersion
  $configJson = $config | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($configPath, $configJson, ([System.Text.UTF8Encoding]::new($false)))
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'launch-pumpstation.ps1') -Destination $launcherPath -Force
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'launch-pumpstation.bat') -Destination $launcherBatPath -Force
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'launch-pumpstation.vbs') -Destination $launcherVbsPath -Force

  Write-Title 'STEP 7/8 - Create desktop and Start Menu shortcuts'
  $shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Pumpstation.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $shortcut.Arguments = '"' + $launcherVbsPath + '"'
  $shortcut.WorkingDirectory = $installRoot
  $shortcut.Description = 'Pumpstation monitoring system'
  $iconPath = Join-Path $appDir 'public\brand\logo.ico'
  if (Test-Path -LiteralPath $iconPath) { $shortcut.IconLocation = $iconPath + ',0' }
  else { $shortcut.IconLocation = $env:SystemRoot + '\System32\shell32.dll,220' }
  $shortcut.Save()
  $startShortcut = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\Pumpstation.lnk'
  $startFolder = Split-Path -Parent $startShortcut
  New-Item -ItemType Directory -Path $startFolder -Force | Out-Null
  Copy-Item -LiteralPath $shortcutPath -Destination $startShortcut -Force

  Write-Title 'STEP 8/8 - Start Pumpstation and verify the local server'
  Write-Host "Application folder: $appDir"
  Write-Host "Persistent data folder: $dataRoot"
  Write-Host 'Desktop shortcut created. Opening Pumpstation...' -ForegroundColor Green
  $env:PUMPSTATION_LAUNCHER_HIDDEN = '0'
  $env:PUMPSTATION_SKIP_BROWSER = '1'
  & (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass -File $launcherPath
  Remove-Item Env:\PUMPSTATION_SKIP_BROWSER -ErrorAction SilentlyContinue
  if ($LASTEXITCODE -ne 0) { throw 'The application did not start successfully. Check the server logs.' }
  $finalConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $applicationUrl = "http://127.0.0.1:$([int]$finalConfig.port)"
  Write-Host 'Verifying first-run database setup and securely hashing the generated PINs...' -ForegroundColor Cyan
  # The auth route runs ensureSeed before rejecting this intentionally empty login body; HTTP 400 confirms seed completed.
  $seedStatus = 0
  try {
    $seedResponse = Invoke-WebRequest -Uri "$applicationUrl/api/auth" -Method Post -ContentType 'application/json' -Body '{}' -UseBasicParsing -TimeoutSec 120 -ErrorAction Stop
    $seedStatus = [int]$seedResponse.StatusCode
  } catch {
    if ($_.Exception.Response) { $seedStatus = [int]$_.Exception.Response.StatusCode }
    else { throw }
  }
  if ($seedStatus -ne 400) { throw "Initial database setup could not be verified (HTTP $seedStatus). The temporary PIN file was kept for recovery." }
  [IO.File]::WriteAllText($rosterMarker, "seeded=$(Get-Date -Format o)`r`n", ([System.Text.UTF8Encoding]::new($false)))
  if (Test-Path -LiteralPath $paths.rosterFile) {
    try {
      Remove-Item -LiteralPath $paths.rosterFile -Force -ErrorAction Stop
      Write-Host 'Initial PINs are now stored as hashes; the temporary PIN file was deleted.' -ForegroundColor Green
    } catch {
      Write-Host ("WARNING: Could not delete the temporary PIN file: {0}" -f $paths.rosterFile) -ForegroundColor Yellow
    }
  }
  try {
    Start-Process $applicationUrl -ErrorAction Stop
    Write-Host 'Pumpstation opened in your default browser.' -ForegroundColor Green
  } catch {
    Write-Host "The server is ready. Open this address in your browser: $applicationUrl" -ForegroundColor Yellow
  }
  Write-Title 'INSTALLATION COMPLETE'
  Write-Host 'Pumpstation is installed. Use the desktop shortcut to open it next time.' -ForegroundColor Green
  if ($script:InstallerPins.Count -gt 0) {
    Write-Host 'Save these initial PINs now. They are not written to the installer log:' -ForegroundColor Yellow
    foreach ($credential in $script:InstallerPins) { Write-Host ("{0}: {1}" -f $credential.Role, $credential.Pin) -ForegroundColor Yellow }
  }
  Write-Host 'The app opened in your default browser. Press Enter in this installer window to close it.' -ForegroundColor Green
} catch {
  $caught = $_
  $rollbackNotes = @()
  if ($appSwapped -and $pidPath -and $appDir) {
    try { Stop-PumpstationServer $pidPath $appDir }
    catch { $rollbackNotes += "Could not stop the candidate server: $($_.Exception.Message)" }
  }
  if ($migrationStarted -and $paths -and $paths.databaseDir) {
    try {
      if (Test-Path -LiteralPath $paths.databaseDir) { Remove-Item -LiteralPath $paths.databaseDir -Recurse -Force }
      if ($databaseBackupPath -and (Test-Path -LiteralPath $databaseBackupPath -PathType Container)) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $paths.databaseDir) -Force | Out-Null
        Copy-Item -LiteralPath $databaseBackupPath -Destination $paths.databaseDir -Recurse -Force
        Assert-DirectoryFilesEqual $databaseBackupPath $paths.databaseDir
        $rollbackNotes += 'Database restored and verified from the pre-migration safety copy.'
      } elseif ($databaseExistedBeforeMigration -and $databaseHadFilesBeforeMigration) {
        throw 'The database backup is missing; the installer did not remove the backup folder.'
      } elseif ($databaseExistedBeforeMigration) {
        New-Item -ItemType Directory -Path $paths.databaseDir -Force | Out-Null
        $rollbackNotes += 'The original empty database directory was restored.'
      } else {
        $rollbackNotes += 'The newly created database directory was removed.'
      }
    } catch {
      $rollbackNotes += "DATABASE ROLLBACK FAILED: $($_.Exception.Message)"
    }
  }
  if ($appSwapped -and $previousConfig -and $previousApp -and (Test-Path -LiteralPath $previousApp -PathType Container)) {
    try {
      if (Test-Path -LiteralPath $appDir) { Remove-Item -LiteralPath $appDir -Recurse -Force }
      Rename-Item -LiteralPath $previousApp -NewName 'app'
      if ($previousConfigRaw) {
        [IO.File]::WriteAllText($configPath, $previousConfigRaw, ([System.Text.UTF8Encoding]::new($false)))
      }
      $appSwapped = $false
      $rollbackNotes += 'Previous application code and configuration were restored.'
    } catch {
      $rollbackNotes += "APPLICATION ROLLBACK FAILED: $($_.Exception.Message)"
    }
  }
  $failureDetails = @(
    ("Time: {0}" -f (Get-Date -Format o)),
    ("Message: {0}" -f $caught.Exception.Message),
    ("Category: {0}" -f $caught.CategoryInfo),
    ("Position: {0}" -f $caught.InvocationInfo.PositionMessage),
    ("Script stack: {0}" -f $caught.ScriptStackTrace),
    ("Working directory: {0}" -f (Get-Location).Path),
    ("Rollback: {0}" -f ($rollbackNotes -join '; '))
  ) -join "`r`n"
  try {
    [IO.File]::WriteAllText($InstallerErrorLog, $failureDetails + "`r`n", ([System.Text.UTF8Encoding]::new($false)))
    if ($paths -and $paths.logDir -and (Test-Path -LiteralPath $paths.logDir)) {
      Copy-Item -LiteralPath $InstallerErrorLog -Destination (Join-Path $paths.logDir 'install-error.log') -Force -ErrorAction SilentlyContinue
    }
  } catch { }
  Write-Host ''
  Write-Host ('INSTALLATION FAILED: ' + $caught.Exception.Message) -ForegroundColor Red
  Write-Host ("Diagnostic log saved to: {0}" -f $InstallerErrorLog) -ForegroundColor Yellow
  Write-Host 'Existing database backups are retained. Previous application code remains in app.previous when rollback is needed.' -ForegroundColor Yellow
  exit 1
}
