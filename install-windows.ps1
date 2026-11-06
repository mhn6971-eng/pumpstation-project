$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$NodeVersion = '22.22.2'
$NpmVersion = '10.9.4'
$NodeIntegrity = 'sha512-w6ir5BjNVuSIC43FWLchnuc/bu9hT0ntMH/FJFouaR2oxADkFhim4YlOp4r92Euyj5b15YdbiL5xYwgmELZuZg=='
$NpmIntegrity = 'sha512-OnUG836FwboQIbqtefDNlyR0gTHzIfwRfE3DuiNewBvnMnWEpB0VEXwBlFVgqpNzIgYo/MHh3d2Hel/pszapAA=='
$Registry = 'https://registry.npmjs.org'

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
    Write-Host ("بستهٔ ثابت و تأییدشده از cache استفاده می‌شود: {0}@{1}" -f $Name, $Version)
    return $cacheFile
  }
  if (Test-Path -LiteralPath $cacheFile) { Remove-Item -LiteralPath $cacheFile -Force }
  $url = "$Registry/$Name/-/$Name-$Version.tgz"
  Write-Host ("دریافت نسخهٔ ثابت {0}@{1} از npm registry..." -f $Name, $Version)
  Invoke-WebRequest -Uri $url -OutFile $cacheFile -UseBasicParsing
  $actual = Get-Sha512Integrity $cacheFile
  if ($actual -ne $Integrity) {
    Remove-Item -LiteralPath $cacheFile -Force -ErrorAction SilentlyContinue
    throw "تأیید SHA-512 بستهٔ $Name@$Version ناموفق بود. فایل نصب اجرا نشد."
  }
  return $cacheFile
}

function Get-VerifiedOfflinePackage([string]$Name, [string]$Version, [string]$Integrity, [string]$VendorDir) {
  $file = Join-Path $VendorDir ($Name + '-' + $Version + '.tgz')
  if (-not (Test-Path -LiteralPath $file)) { throw "بستهٔ آفلاین $Name@$Version در offline-vendor پیدا نشد." }
  $actual = Get-Sha512Integrity $file
  if ($actual -ne $Integrity) { throw "تأیید SHA-512 بستهٔ آفلاین $Name@$Version ناموفق بود؛ فایل اجرا نشد." }
  Write-Host ("بستهٔ آفلاین تأیید شد: {0}@{1}" -f $Name, $Version) -ForegroundColor Green
  return $file
}

function Test-RegistryOnline {
  try {
    Invoke-WebRequest -Uri "$Registry/npm" -Method Head -TimeoutSec 6 -UseBasicParsing | Out-Null
    return $true
  } catch { return $false }
}

function Copy-OfflineNpmCache([string]$Source, [string]$Destination) {
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  & robocopy.exe $Source $Destination /E /R:1 /W:1 /NFL /NDL /NP
  if ($LASTEXITCODE -ge 8) { throw 'کپی cache آفلاین npm روی C ناموفق بود.' }
}

function Get-InstallRoot {
  $local = [Environment]::GetFolderPath('LocalApplicationData')
  if ([string]::IsNullOrWhiteSpace($local) -or [IO.Path]::GetPathRoot($local).ToUpperInvariant() -ne 'C:\') {
    throw 'پوشهٔ پروفایل ویندوز روی درایو C نیست. برای رعایت محل نصب، ابتدا پروفایل محلی C را فراهم کنید یا نصب را متوقف کنید؛ داده‌ها به درایو غیر C می‌روند.'
  }
  return Join-Path $local 'Programs\Pumpstation'
}

function Select-DataRoot {
  $drives = @([IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq [IO.DriveType]::Fixed -and $_.Name.ToUpperInvariant() -ne 'C:\' -and $_.IsReady })
  if ($drives.Count -eq 0) { throw 'هیچ درایو محلیِ ثابت به‌جز C پیدا نشد؛ برای جلوگیری از نگهداری داده روی C نصب متوقف شد.' }
  Write-Host 'پوشهٔ داده و گزارش‌ها روی یک درایو ثابتِ غیر C ذخیره می‌شود:' -ForegroundColor Yellow
  for ($i = 0; $i -lt $drives.Count; $i++) {
    $freeGb = [Math]::Round($drives[$i].AvailableFreeSpace / 1GB, 1)
    Write-Host ("  {0}) {1}  برچسب: {2}  فضای خالی: {3} GB" -f ($i + 1), $drives[$i].Name, $drives[$i].VolumeLabel, $freeGb)
  }
  $default = $drives[0]
  while ($true) {
    $choice = Read-Host ("شمارهٔ درایو را انتخاب کنید (پیش‌فرض {0})" -f $default.Name)
    $selected = $default
    if (-not [string]::IsNullOrWhiteSpace($choice)) {
      if ($choice -notmatch '^\d+$' -or [int]$choice -lt 1 -or [int]$choice -gt $drives.Count) {
        Write-Host 'شمارهٔ انتخابی معتبر نیست.' -ForegroundColor Red
        continue
      }
      $selected = $drives[[int]$choice - 1]
    }
    $root = Join-Path $selected.Name 'گزارشات'
    $custom = Read-Host ("مسیر اصلی داده‌ها (Enter برای {0})" -f $root)
    if (-not [string]::IsNullOrWhiteSpace($custom)) { $root = [IO.Path]::GetFullPath($custom.Trim()) }
    if ([IO.Path]::GetPathRoot($root).ToUpperInvariant() -ne $selected.Name.ToUpperInvariant()) {
      Write-Host 'مسیر داده باید روی همان درایو محلیِ انتخاب‌شده و غیر C باشد.' -ForegroundColor Red
      continue
    }
    if ($root -match '(?i)OneDrive|Dropbox|Google Drive|iCloud|CloudStorage') {
      Write-Host 'پوشهٔ همگام‌سازی ابری انتخاب نشود؛ یک مسیر محلی پایدار انتخاب کنید.' -ForegroundColor Red
      continue
    }
    return $root
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

function Read-LocalPin([string]$Key, [string]$Role, [string[]]$Used) {
  while ($true) {
    $secure = Read-Host -Prompt ("PIN تازه برای {0} (۴ تا ۶ رقم؛ Enter = تولید تصادفی امن)" -f $Role) -AsSecureString
    if ($secure.Length -eq 0) {
      $pin = New-RandomPin $Used
      Write-Host ("PIN تصادفی {0}: {1}  (اکنون آن را ثبت کنید)" -f $Role, $pin) -ForegroundColor Yellow
    } else {
      $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      try { $pin = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
      finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    }
    if ($pin -notmatch '^\d{4,6}$') { Write-Host 'PIN باید فقط ۴ تا ۶ رقم باشد.' -ForegroundColor Red; continue }
    if ($Used -contains $pin) { Write-Host 'PIN تکراری است؛ برای هر نقش یک PIN جدا تعیین کنید.' -ForegroundColor Red; continue }
    if ($pin -in @('1011', '2022', '3033', '9009')) { Write-Host 'این PIN در نمونهٔ آزمایشی پروژه آمده و پذیرفته نمی‌شود.' -ForegroundColor Red; continue }
    return $pin
  }
}

function New-LocalRoster([string]$RosterPath) {
  if (Test-Path -LiteralPath $RosterPath) {
    Write-Host 'روستر محلی موجود حفظ می‌شود؛ PINها بازنویسی نمی‌شوند.' -ForegroundColor Green
    return
  }
  Write-Title 'ساخت PINهای اختصاصی سامانه'
  Write-Host 'PINها در فایل محلیِ محدودشده به حساب ویندوز شما ذخیره می‌شوند. PINهای واقعی را با اپراتورها امن به‌اشتراک بگذارید.' -ForegroundColor Yellow
  $used = @()
  $roster = @()
  $definitions = @(
    @{ key = 'A'; label = 'شیفت A'; role = 'operator'; members = @('اپراتور شیفت A') },
    @{ key = 'B'; label = 'شیفت B'; role = 'operator'; members = @('اپراتور شیفت B') },
    @{ key = 'C'; label = 'شیفت C'; role = 'operator'; members = @('اپراتور شیفت C') },
    @{ key = 'admin'; label = 'مدیر سامانه'; role = 'admin'; members = @('مدیر سامانه') }
  )
  foreach ($definition in $definitions) {
    $pin = Read-LocalPin $definition.key $definition.label $used
    $used += $pin
    $roster += [PSCustomObject]@{ key = $definition.key; label = $definition.label; role = $definition.role; pin = $pin; members = $definition.members }
  }
  $json = @{ roster = $roster } | ConvertTo-Json -Depth 8
  $parent = Split-Path -Parent $RosterPath
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  [IO.File]::WriteAllText($RosterPath, $json, ([System.Text.UTF8Encoding]::new($false)))
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $RosterPath /inheritance:r /grant:r "$identity`:(R,W)" | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host 'هشدار: محدودکردن ACL روستر خودکار نشد؛ دسترسی فایل را در Properties بررسی کنید.' -ForegroundColor Yellow }
  } catch { Write-Host 'هشدار: ACL فایل روستر را در Properties محدود کنید.' -ForegroundColor Yellow }
  Write-Host 'روستر محلی ساخته شد. می‌توانید نام اپراتورها را بعداً در بخش مدیریت تغییر دهید.' -ForegroundColor Green
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
  $env:NEXT_TELEMETRY_DISABLED = '1'
  $env:PATH = $Config.runtimeDir + ';' + (Join-Path $Config.runtimeDir 'npm\package\bin') + ';' + $env:PATH
}

function Stop-PumpstationServer([string]$PidPath, [string]$AppDir) {
  if (-not (Test-Path -LiteralPath $PidPath)) { return }
  $raw = (Get-Content -LiteralPath $PidPath -Raw).Trim()
  $serverPid = 0
  if ([int]::TryParse($raw, [ref]$serverPid)) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
    if ($proc -and $proc.CommandLine -and $proc.CommandLine.IndexOf($AppDir, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      & taskkill.exe /PID $serverPid /T /F 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) { Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue }
      Start-Sleep -Seconds 2
    }
  }
  Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments, [string]$WorkingDirectory, [string]$Description) {
  Write-Host $Description -ForegroundColor Cyan
  Push-Location $WorkingDirectory
  try {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw ("فرمان ناموفق بود (exit {0}): {1}" -f $LASTEXITCODE, $Description) }
  } finally { Pop-Location }
}

try {
  Write-Title 'نصب‌کنندهٔ Pumpstation برای Windows 10/11 x64'
  Write-Host 'این نصب‌کننده نسخه‌های ثابت Node.js و npm را با SHA-512 بررسی می‌کند و در صورت نیاز بین cache آفلاین و اینترنت انتخاب می‌کند.'
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'این بسته فقط برای Windows 64-bit است.' }
  $os = Get-CimInstance Win32_OperatingSystem
  if ([int]$os.BuildNumber -lt 17763) { throw 'Windows 10 باید نسخهٔ 1809 یا جدیدتر باشد تا Node.js 22 پشتیبانی شود.' }

  $installRoot = Get-InstallRoot
  $systemDrive = @([IO.DriveInfo]::GetDrives() | Where-Object { $_.Name.ToUpperInvariant() -eq 'C:\' -and $_.IsReady }) | Select-Object -First 1
  if (-not $systemDrive -or $systemDrive.AvailableFreeSpace -lt 3GB) { throw 'برای نصب و ساخت برنامه دست‌کم ۳ گیگابایت فضای خالی روی C لازم است.' }
  $appDir = Join-Path $installRoot 'app'
  $runtimeDir = Join-Path $installRoot 'runtime'
  $configDir = Join-Path $installRoot 'config'
  $configPath = Join-Path $configDir 'install.json'
  $launcherPath = Join-Path $installRoot 'launch-pumpstation.ps1'
  $previousConfig = $null
  if (Test-Path -LiteralPath $configPath) {
    $previousConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $dataRoot = [string]$previousConfig.dataRoot
    if ([string]::IsNullOrWhiteSpace($dataRoot) -or [IO.Path]::GetPathRoot($dataRoot).ToUpperInvariant() -eq 'C:\') {
      throw 'پیکربندی قبلی، مسیر دادهٔ غیر C ندارد. نصب متوقف شد تا دادهٔ قبلی ناخواسته جابه‌جا یا جایگزین نشود.'
    }
    Write-Host ("درایو دادهٔ قبلی بدون تغییر حفظ می‌شود: {0}" -f $dataRoot) -ForegroundColor Green
  } else {
    $dataRoot = Select-DataRoot
  }

  $paths = @{
    databaseDir = Join-Path $dataRoot 'پایگاه داده'
    processReportDir = Join-Path $dataRoot 'گزارشات فرایند'
    pmReportDir = Join-Path $dataRoot 'PM'
    backupDir = Join-Path $dataRoot 'بک آپ'
    catalogDir = Join-Path $dataRoot 'بک آپ\پیوست‌ها و کاتالوگ'
    archiveDir = Join-Path $dataRoot 'بک آپ\آرشیو سرد'
    mirrorDir = Join-Path $dataRoot 'بک آپ\آینه'
    pgdumpDir = Join-Path $dataRoot 'بک آپ\دامپ PostgreSQL'
    logDir = Join-Path $dataRoot 'لاگ‌ها'
    rosterFile = Join-Path $configDir 'roster.local.json'
    sessionSecretDir = Join-Path $configDir 'session-secret'
    mirrorTokenFile = Join-Path $configDir 'mirror-token'
  }
  foreach ($directory in @($dataRoot, $paths.databaseDir, $paths.processReportDir, $paths.pmReportDir, $paths.backupDir, $paths.catalogDir, $paths.archiveDir, $paths.mirrorDir, $paths.pgdumpDir, $paths.logDir, $configDir, $paths.sessionSecretDir)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }

  $packageJson = Join-Path (Join-Path $PSScriptRoot 'pumpstation-v1.2') 'package.json'
  if (-not (Test-Path -LiteralPath $packageJson)) { throw 'فایل‌های برنامه کنار install-windows.bat پیدا نشد. ZIP کامل را در یک پوشه استخراج کنید و BAT را از همان پوشه اجرا کنید.' }
  $appVersion = (Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json).version
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
  $onlineAvailable = Test-RegistryOnline
  if (-not $onlineAvailable -and -not $offlineAvailable) { throw 'اینترنت در دسترس نیست و cache آفلاین معتبر/سازگار کنار نصاب پیدا نشد. ZIP کامل را از نو استخراج کنید یا اینترنت را وصل کنید.' }
  if ($offlineAvailable -and $onlineAvailable) {
    $choice = Read-Host 'روش نصب: 1 اینترنتی (پیش‌فرض)، 2 آفلاین از فایل‌های همین ZIP'
    $installMode = if ($choice -eq '2') { 'offline' } else { 'online' }
  } elseif ($offlineAvailable) {
    $installMode = 'offline'
    Write-Host 'اتصال اینترنت پیدا نشد؛ نصب آفلاین از بسته‌های همراه ZIP انتخاب شد.' -ForegroundColor Yellow
  } else {
    $installMode = 'online'
    Write-Host 'بستهٔ آفلاین موجود نیست؛ نصب از اینترنت انجام می‌شود.' -ForegroundColor Yellow
  }
  $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
  if (-not $tar) { throw 'ابزار tar.exe ویندوز پیدا نشد؛ Windows 10 را به‌روز کنید.' }

  $npmCacheDir = Join-Path $installRoot 'cache\npm'
  if ($installMode -eq 'offline') {
    $nodeArchive = Get-VerifiedOfflinePackage 'node-win-x64' $NodeVersion $NodeIntegrity $vendorDir
    $npmArchive = Get-VerifiedOfflinePackage 'npm' $NpmVersion $NpmIntegrity $vendorDir
    Copy-OfflineNpmCache $offlineNpmCache $npmCacheDir
  } else {
    try {
      $nodeArchive = Get-PinnedPackage 'node-win-x64' $NodeVersion $NodeIntegrity $cacheDir
      $npmArchive = Get-PinnedPackage 'npm' $NpmVersion $NpmIntegrity $cacheDir
    } catch {
      if (-not $offlineAvailable) { throw }
      Write-Host 'دریافت آنلاین runtime شکست خورد؛ به بستهٔ آفلاین تأییدشده برمی‌گردیم.' -ForegroundColor Yellow
      $installMode = 'offline'
      $nodeArchive = Get-VerifiedOfflinePackage 'node-win-x64' $NodeVersion $NodeIntegrity $vendorDir
      $npmArchive = Get-VerifiedOfflinePackage 'npm' $NpmVersion $NpmIntegrity $vendorDir
      Copy-OfflineNpmCache $offlineNpmCache $npmCacheDir
    }
  }
  $nodePath = Join-Path $runtimeDir 'node.exe'
  $npmCli = Join-Path $runtimeDir 'npm\package\bin\npm-cli.js'
  if (-not (Test-Path -LiteralPath $nodePath) -or -not (Test-Path -LiteralPath $npmCli)) {
    $unpackRoot = Join-Path $env:TEMP ('pumpstation-runtime-' + [Guid]::NewGuid().ToString('N'))
    $nodeUnpack = Join-Path $unpackRoot 'node'
    $npmUnpack = Join-Path $unpackRoot 'npm'
    New-Item -ItemType Directory -Path $nodeUnpack -Force | Out-Null
    New-Item -ItemType Directory -Path $npmUnpack -Force | Out-Null
    try {
      & $tar.Source -xzf $nodeArchive -C $nodeUnpack 'package/bin/node.exe'
      if ($LASTEXITCODE -ne 0) { throw 'استخراج فایل Node.js ناموفق بود.' }
      & $tar.Source -xzf $npmArchive -C $npmUnpack 'package'
      if ($LASTEXITCODE -ne 0) { throw 'استخراج فایل npm ناموفق بود.' }
      New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
      Copy-Item -LiteralPath (Join-Path $nodeUnpack 'package\bin\node.exe') -Destination $nodePath -Force
      $npmDestination = Join-Path $runtimeDir 'npm'
      if (Test-Path -LiteralPath $npmDestination) { Remove-Item -LiteralPath $npmDestination -Recurse -Force }
      Copy-Item -LiteralPath (Join-Path $npmUnpack 'package') -Destination $npmDestination -Recurse -Force
    } finally { Remove-Item -LiteralPath $unpackRoot -Recurse -Force -ErrorAction SilentlyContinue }
  }
  $nodeActual = (& $nodePath --version).Trim()
  if ($nodeActual -ne "v$NodeVersion") { throw "نسخهٔ runtime نادرست است: $nodeActual" }
  $runtimeNotices = Join-Path $PSScriptRoot 'RUNTIME-LICENSES.txt'
  if (-not (Test-Path -LiteralPath $runtimeNotices)) { throw 'فایل مجوزهای runtime کنار نصب‌کننده پیدا نشد.' }
  Copy-Item -LiteralPath $runtimeNotices -Destination (Join-Path $runtimeDir 'LICENSES.txt') -Force

  $config = [PSCustomObject]@{
    installRoot = $installRoot; appDir = $appDir; runtimeDir = $runtimeDir; dataRoot = $dataRoot
    databaseDir = $paths.databaseDir; processReportDir = $paths.processReportDir; pmReportDir = $paths.pmReportDir
    backupDir = $paths.backupDir; catalogDir = $paths.catalogDir; archiveDir = $paths.archiveDir
    mirrorDir = $paths.mirrorDir; pgdumpDir = $paths.pgdumpDir; logDir = $paths.logDir
    rosterFile = $paths.rosterFile; sessionSecretDir = $paths.sessionSecretDir; mirrorTokenFile = $paths.mirrorTokenFile
    appVersion = $appVersion; nodeVersion = $NodeVersion; npmVersion = $NpmVersion
  }
  Set-AppEnvironment $config

  $sourceApp = Join-Path $PSScriptRoot 'pumpstation-v1.2'
  $stageApp = Join-Path $installRoot 'app.new'
  if (Test-Path -LiteralPath $stageApp) { Remove-Item -LiteralPath $stageApp -Recurse -Force }
  New-Item -ItemType Directory -Path $stageApp -Force | Out-Null
  Write-Title 'آماده‌سازی نسخهٔ برنامه'
  & robocopy.exe $sourceApp $stageApp /E /R:1 /W:1 /NFL /NDL /NP /XD '.git' 'node_modules' '.next' '.data' 'coverage' 'catalogs' /XF '.env' '.env.local' '.env.production' '.env.development' '.env.test' '.env.production.local' '.env.development.local' '.env.test.local' '*.log' '*.local.json'
  $copyCode = $LASTEXITCODE
  if ($copyCode -ge 8) { throw "کپی فایل‌های برنامه شکست خورد (robocopy $copyCode)." }
  Get-ChildItem -LiteralPath $stageApp -Force -File -Recurse | Where-Object { $_.Name -like '.env*' -and $_.Name -ne '.env.example' } | Remove-Item -Force

  $stagePackage = Get-Content -LiteralPath (Join-Path $stageApp 'package.json') -Raw | ConvertFrom-Json
  if ($stagePackage.version -ne $appVersion) { throw 'نسخهٔ package در پوشهٔ مبدأ تغییر کرده است؛ نصاب را دوباره اجرا کنید.' }
  Set-AppEnvironment $config
  if ($installMode -eq 'offline') {
    $npmCiArguments = @($npmCli, 'ci', '--offline', '--no-audit', '--no-fund', '--cache', $npmCacheDir)
    Invoke-Checked -Executable $nodePath -Arguments $npmCiArguments -WorkingDirectory $stageApp -Description 'نصب آفلاین وابستگی‌های قفل‌شده...'
  } else {
    $npmCiArguments = @($npmCli, 'ci', '--no-audit', '--no-fund', '--registry', $Registry, '--cache', $npmCacheDir)
    try {
      Invoke-Checked -Executable $nodePath -Arguments $npmCiArguments -WorkingDirectory $stageApp -Description 'نصب اینترنتی وابستگی‌های قفل‌شده...'
    } catch {
      if (-not $offlineAvailable) { throw }
      Write-Host 'دریافت وابستگی‌ها قطع شد؛ npm ci از cache آفلاینِ داخل ZIP دوباره اجرا می‌شود.' -ForegroundColor Yellow
      $installMode = 'offline'
      Copy-OfflineNpmCache $offlineNpmCache $npmCacheDir
      $npmCiArguments = @($npmCli, 'ci', '--offline', '--no-audit', '--no-fund', '--cache', $npmCacheDir)
      Invoke-Checked -Executable $nodePath -Arguments $npmCiArguments -WorkingDirectory $stageApp -Description 'نصب آفلاین وابستگی‌های قفل‌شده...'
    }
  }
  $buildArguments = @($npmCli, 'run', 'build')
  Invoke-Checked -Executable $nodePath -Arguments $buildArguments -WorkingDirectory $stageApp -Description 'ساخت نسخهٔ production...'
  New-LocalRoster $paths.rosterFile

  $pidPath = Join-Path $configDir 'server.pid'
  Stop-PumpstationServer $pidPath $appDir
  $existingDatabase = Test-Path -LiteralPath $paths.databaseDir -PathType Container
  $existingEntries = @()
  if ($existingDatabase) { $existingEntries = @(Get-ChildItem -LiteralPath $paths.databaseDir -Force -ErrorAction SilentlyContinue) }
  if ($existingEntries.Count -gt 0) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $safetyDir = Join-Path $paths.backupDir (Join-Path 'قبل از به‌روزرسانی' $stamp)
    New-Item -ItemType Directory -Path $safetyDir -Force | Out-Null
    Copy-Item -LiteralPath $paths.databaseDir -Destination (Join-Path $safetyDir 'پایگاه داده') -Recurse -Force
    Write-Host ("یک نسخهٔ ایمنی از پایگاه داده پیش از migration نگه داشته شد: {0}" -f $safetyDir) -ForegroundColor Green
  }
  $migrationArguments = @((Join-Path $stageApp 'scripts/init-db.mjs'))
  Invoke-Checked -Executable $nodePath -Arguments $migrationArguments -WorkingDirectory $stageApp -Description 'اعمال migrationهای پایگاه داده...'

  $previousApp = Join-Path $installRoot 'app.previous'
  if (Test-Path -LiteralPath $previousApp) { Remove-Item -LiteralPath $previousApp -Recurse -Force }
  if (Test-Path -LiteralPath $appDir) { Rename-Item -LiteralPath $appDir -NewName 'app.previous' }
  try { Rename-Item -LiteralPath $stageApp -NewName 'app' }
  catch {
    if ((Test-Path -LiteralPath $previousApp) -and -not (Test-Path -LiteralPath $appDir)) { Rename-Item -LiteralPath $previousApp -NewName 'app' }
    throw
  }
  $config.appVersion = $appVersion
  $configJson = $config | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($configPath, $configJson, ([System.Text.UTF8Encoding]::new($false)))
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'launch-pumpstation.ps1') -Destination $launcherPath -Force

  $shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Pumpstation.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
  $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $launcherPath + '"'
  $shortcut.WorkingDirectory = $installRoot
  $shortcut.Description = 'اجرای سامانهٔ Pumpstation'
  $shortcut.IconLocation = $env:SystemRoot + '\System32\shell32.dll,220'
  $shortcut.Save()
  $startShortcut = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\Pumpstation.lnk'
  $startFolder = Split-Path -Parent $startShortcut
  New-Item -ItemType Directory -Path $startFolder -Force | Out-Null
  Copy-Item -LiteralPath $shortcutPath -Destination $startShortcut -Force

  Write-Title 'نصب کامل شد'
  Write-Host ("برنامه: {0}" -f $appDir)
  Write-Host ("داده و گزارش: {0}" -f $dataRoot)
  Write-Host 'میانبر دسکتاپ ساخته شد. برنامه اکنون باز می‌شود.' -ForegroundColor Green
  & (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass -File $launcherPath
  if ($LASTEXITCODE -ne 0) { throw 'اجرای نخست برنامه کامل نشد؛ گزارش‌های برنامه را در پوشهٔ لاگ‌ها بررسی کنید.' }
} catch {
  Write-Host ''
  Write-Host ('خطای نصب: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'هیچ فایل پایگاه داده یا بک‌آپ قبلی حذف نمی‌شود. در صورت شکست به‌روزرسانی، نسخهٔ قبلی برنامه در app.previous باقی می‌ماند.' -ForegroundColor Yellow
  Read-Host 'برای بستن این پنجره Enter بزنید'
  exit 1
}
