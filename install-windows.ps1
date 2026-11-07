$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$NodeVersion = '22.22.2'
$NpmVersion = '10.9.4'
$NodeIntegrity = 'sha512-w6ir5BjNVuSIC43FWLchnuc/bu9hT0ntMH/FJFouaR2oxADkFhim4YlOp4r92Euyj5b15YdbiL5xYwgmELZuZg=='
$NpmIntegrity = 'sha512-OnUG836FwboQIbqtefDNlyR0gTHzIfwRfE3DuiNewBvnMnWEpB0VEXwBlFVgqpNzIgYo/MHh3d2Hel/pszapAA=='
$Registry = 'https://registry.npmjs.org'
$InstallerErrorLog = $env:PUMPSTATION_ERROR_LOG
if ([string]::IsNullOrWhiteSpace($InstallerErrorLog)) { $InstallerErrorLog = Join-Path $env:TEMP 'Pumpstation-install-error.log' }
try {
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  [Console]::OutputEncoding = $utf8
  [Console]::InputEncoding = $utf8
} catch { }

# Windows Console historically handles bidirectional scripts inconsistently.
# Surround Persian strings with explicit RTL embedding marks instead of changing their text.
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
  $dataDrive = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($DataRoot))
  $drives = @([IO.DriveInfo]::GetDrives() | Where-Object {
    $_.IsReady -and $_.DriveType -in @([IO.DriveType]::Fixed, [IO.DriveType]::Removable) -and
    $_.Name.ToUpperInvariant() -ne 'C:\' -and $_.Name.ToUpperInvariant() -ne $dataDrive.ToUpperInvariant()
  })
  $sameDriveMirror = Join-Path $DataRoot 'بک آپ\آینه'
  if ($drives.Count -eq 0) {
    Write-Host 'درایو جداگانه‌ای برای آینه پیدا نشد؛ فعلاً آینه روی همان درایو داده می‌ماند و جای نسخهٔ بیرونی را نمی‌گیرد.' -ForegroundColor Yellow
    return $sameDriveMirror
  }
  Write-Host 'برای مقاومت در برابر خرابی دیسک، آینه را ترجیحاً روی یک درایو فیزیکی جدا بگذارید:' -ForegroundColor Yellow
  for ($i = 0; $i -lt $drives.Count; $i++) {
    $freeGb = [Math]::Round($drives[$i].AvailableFreeSpace / 1GB, 1)
    Write-Host ("  {0}) {1}  برچسب: {2}  فضای خالی: {3} GB" -f ($i + 1), $drives[$i].Name, $drives[$i].VolumeLabel, $freeGb)
  }
  $choice = Read-Host 'شمارهٔ درایو آینه را انتخاب کنید؛ Enter برای حفظ آینه روی درایو داده'
  if ([string]::IsNullOrWhiteSpace($choice)) { return $sameDriveMirror }
  if ($choice -notmatch '^\d+$' -or [int]$choice -lt 1 -or [int]$choice -gt $drives.Count) {
    Write-Host 'انتخاب نامعتبر است؛ آینه فعلاً روی درایو داده قرار می‌گیرد.' -ForegroundColor Yellow
    return $sameDriveMirror
  }
  $selected = $drives[[int]$choice - 1]
  $dataDisk = Get-PhysicalDiskNumber $DataRoot
  $mirrorDisk = Get-PhysicalDiskNumber $selected.Name
  if ($null -ne $dataDisk -and $null -ne $mirrorDisk -and $dataDisk -eq $mirrorDisk) {
    Write-Host 'این دو درایو letter متفاوت دارند اما روی یک دیسک فیزیکی‌اند؛ آینه روی درایو داده می‌ماند.' -ForegroundColor Yellow
    return $sameDriveMirror
  }
  if ($null -eq $dataDisk -or $null -eq $mirrorDisk) {
    Write-Host 'Windows نتوانست دیسک فیزیکی را تأیید کند؛ استقلال فیزیکی آینه تضمین نمی‌شود.' -ForegroundColor Yellow
  }
  return Join-Path $selected.Name 'Pumpstation-Mirror'
}

function Write-MirrorReliabilityWarning([string]$DataRoot, [string]$MirrorRoot) {
  $dataDrive = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($DataRoot))
  $mirrorDrive = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($MirrorRoot))
  if ($dataDrive -and $mirrorDrive -and $dataDrive.ToUpperInvariant() -eq $mirrorDrive.ToUpperInvariant()) {
    Write-Host 'هشدار: بک‌آپ و آینه روی یک volume هستند؛ خرابی همان درایو هر دو را از بین می‌برد. یک نسخه را دوره‌ای به رسانهٔ مستقل کپی کنید.' -ForegroundColor Yellow
    return
  }
  $dataDisk = Get-PhysicalDiskNumber $DataRoot
  $mirrorDisk = Get-PhysicalDiskNumber $MirrorRoot
  if ($null -ne $dataDisk -and $null -ne $mirrorDisk -and $dataDisk -eq $mirrorDisk) {
    Write-Host 'هشدار: مسیرهای جدا روی یک دیسک فیزیکی هستند؛ این آینه در برابر خرابی دیسک مستقل نیست.' -ForegroundColor Yellow
  } elseif ($null -eq $dataDisk -or $null -eq $mirrorDisk) {
    Write-Host 'نصاب نتوانست استقلال دیسک فیزیکی آینه را بررسی کند؛ آن را با رسانهٔ بیرونی مستقل تأیید کنید.' -ForegroundColor Yellow
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
  Write-Host 'PINها موقتاً در فایل محلیِ محدودشده به حساب ویندوز نگه داشته می‌شوند و پس از seed موفق حذف می‌شوند. PINهای واقعی را با اپراتورها امن به‌اشتراک بگذارید.' -ForegroundColor Yellow
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
  $launcherBatPath = Join-Path $installRoot 'launch-pumpstation.bat'
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
  if ($previousConfig) {
    $mirrorDir = [string]$previousConfig.mirrorDir
    if ([string]::IsNullOrWhiteSpace($mirrorDir)) { $mirrorDir = Join-Path $dataRoot 'بک آپ\آینه' }
    Write-Host ("مسیر آینهٔ قبلی حفظ می‌شود: {0}" -f $mirrorDir) -ForegroundColor Green
  } else {
    $mirrorDir = Select-MirrorRoot $dataRoot
  }
  Write-MirrorReliabilityWarning $dataRoot $mirrorDir

  $paths = @{
    databaseDir = Join-Path $dataRoot 'پایگاه داده'
    processReportDir = Join-Path $dataRoot 'گزارشات فرایند'
    pmReportDir = Join-Path $dataRoot 'PM'
    backupDir = Join-Path $dataRoot 'بک آپ'
    catalogDir = Join-Path $dataRoot 'بک آپ\پیوست‌ها و کاتالوگ'
    archiveDir = Join-Path $dataRoot 'بک آپ\آرشیو سرد'
    mirrorDir = $mirrorDir
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

  $nodePath = Join-Path $runtimeDir 'node.exe'
  $npmCli = Join-Path $runtimeDir 'npm\package\bin\npm-cli.js'
  $nodeReady = $false
  $npmReady = $false
  if (Test-Path -LiteralPath $nodePath) {
    try {
      $installedNode = (& $nodePath --version 2>$null).Trim()
      $nodeReady = ($installedNode -eq "v$NodeVersion")
    } catch { $nodeReady = $false }
  }
  if ($nodeReady -and (Test-Path -LiteralPath $npmCli)) {
    try {
      $installedNpm = (& $nodePath $npmCli --version 2>$null).Trim()
      $npmReady = ($installedNpm -eq $NpmVersion)
    } catch { $npmReady = $false }
  }
  $runtimeReady = ($nodeReady -and $npmReady)
  if ($runtimeReady) {
    Write-Host ("نسخهٔ دقیق Node.js {0} و npm {1} از قبل نصب است؛ دوباره دانلود نمی‌شود." -f $NodeVersion, $NpmVersion) -ForegroundColor Green
  } elseif ($nodeReady) {
    Write-Host ("Node.js {0} سالم است و حفظ می‌شود؛ فقط npm {1} نصب/ترمیم خواهد شد." -f $NodeVersion, $NpmVersion) -ForegroundColor Yellow
  }

  $onlineAvailable = Test-RegistryOnline
  if (-not $onlineAvailable -and -not $offlineAvailable -and (-not $nodeReady -or -not $npmReady)) { throw 'اینترنت در دسترس نیست و cache آفلاین معتبر/سازگار کنار نصاب پیدا نشد. ZIP کامل را از نو استخراج کنید یا اینترنت را وصل کنید.' }
  if ($offlineAvailable -and $onlineAvailable) {
    $choice = Read-Host 'روش نصب: 1 اینترنتی (پیش‌فرض)، 2 آفلاین از فایل‌های همین ZIP'
    $installMode = if ($choice -eq '2') { 'offline' } else { 'online' }
  } elseif ($offlineAvailable) {
    $installMode = 'offline'
    Write-Host 'اتصال اینترنت پیدا نشد؛ نصب آفلاین از بسته‌های همراه ZIP انتخاب شد.' -ForegroundColor Yellow
  } elseif ($onlineAvailable) {
    $installMode = 'online'
    Write-Host 'بستهٔ آفلاین کامل موجود نیست؛ نصب وابستگی‌های موردنیاز از اینترنت انجام می‌شود.' -ForegroundColor Yellow
  } else {
    $installMode = 'offline'
    Write-Host 'runtime موجود است؛ dependencyهای برنامه با cache npm محلی نصب می‌شوند.' -ForegroundColor Yellow
  }
  $tar = $null
  if (-not $runtimeReady) {
    $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
    if (-not $tar) { throw 'برای نصب یا ترمیم runtime، ابزار tar.exe ویندوز لازم است؛ Windows 10 را به‌روز کنید.' }
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
        Write-Host 'دریافت آنلاین runtime شکست خورد؛ به بستهٔ آفلاین تأییدشده برمی‌گردیم.' -ForegroundColor Yellow
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
        if ($LASTEXITCODE -ne 0) { throw 'استخراج فایل Node.js ناموفق بود.' }
      }
      if (-not $npmReady) {
        & $tar.Source -xzf $npmArchive -C $npmUnpack 'package'
        if ($LASTEXITCODE -ne 0) { throw 'استخراج فایل npm ناموفق بود.' }
        if (-not (Test-Path -LiteralPath (Join-Path $npmUnpack 'package/bin/npm-cli.js'))) { throw 'فایل npm-cli.js پس از استخراج پیدا نشد.' }
      }
      New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
      if (-not $nodeReady) {
        Copy-Item -LiteralPath (Join-Path $nodeUnpack 'package\bin\node.exe') -Destination $nodePath -Force
      }
      if (-not $npmReady) {
        $npmRoot = Join-Path $runtimeDir 'npm'
        if (Test-Path -LiteralPath $npmRoot) { Remove-Item -LiteralPath $npmRoot -Recurse -Force }
        $npmPackageDestination = Join-Path $npmRoot 'package'
        New-Item -ItemType Directory -Path $npmPackageDestination -Force | Out-Null
        & robocopy.exe (Join-Path $npmUnpack 'package') $npmPackageDestination /E /R:1 /W:1 /NFL /NDL /NP
        $npmCopyCode = $LASTEXITCODE
        if ($npmCopyCode -ge 8) { throw "کپی فایل‌های npm ناموفق بود (robocopy $npmCopyCode)." }
        if (-not (Test-Path -LiteralPath $npmCli)) { throw "npm-cli.js پس از نصب در مسیر مورد انتظار پیدا نشد: $npmCli" }
      }
    } finally { Remove-Item -LiteralPath $unpackRoot -Recurse -Force -ErrorAction SilentlyContinue }
  }
  if ($runtimeReady -and $installMode -eq 'offline' -and $offlineAvailable) {
    Copy-OfflineNpmCache $offlineNpmCache $npmCacheDir
  }
  $nodeActual = (& $nodePath --version).Trim()
  $npmActual = (& $nodePath $npmCli --version).Trim()
  if ($nodeActual -ne "v$NodeVersion" -or $npmActual -ne $NpmVersion) { throw "نسخهٔ runtime نادرست است: Node=$nodeActual npm=$npmActual" }
  $runtimeNotices = Join-Path $PSScriptRoot 'RUNTIME-LICENSES.txt'
  if (-not (Test-Path -LiteralPath $runtimeNotices)) { throw 'فایل مجوزهای runtime کنار نصب‌کننده پیدا نشد.' }
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
  Write-Title 'آماده‌سازی نسخهٔ برنامه'
  & robocopy.exe $sourceApp $stageApp /E /R:1 /W:1 /NFL /NDL /NP /XD '.git' 'node_modules' '.next' '.data' 'coverage' /XF '.env' '.env.local' '.env.production' '.env.development' '.env.test' '.env.production.local' '.env.development.local' '.env.test.local' '*.log' '*.local.json'
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
  $rosterMarker = Join-Path $configDir 'roster-consumed.flag'
  $databaseHasFiles = $false
  if (Test-Path -LiteralPath $paths.databaseDir) { $databaseHasFiles = @(Get-ChildItem -LiteralPath $paths.databaseDir -Force -ErrorAction SilentlyContinue).Count -gt 0 }
  if ((Test-Path -LiteralPath $rosterMarker) -and -not $databaseHasFiles) {
    Remove-Item -LiteralPath $rosterMarker -Force -ErrorAction SilentlyContinue
    Write-Host 'پایگاه داده خالی است؛ برای مقداردهی دوباره باید PINهای محلی را بسازید.' -ForegroundColor Yellow
  }
  if (-not (Test-Path -LiteralPath $rosterMarker)) { New-LocalRoster $paths.rosterFile }
  else { Write-Host 'PINهای هش‌شدهٔ پایگاه داده حفظ می‌شوند؛ فایل PIN متنی دوباره ساخته نمی‌شود.' -ForegroundColor Green }

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
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'launch-pumpstation.bat') -Destination $launcherBatPath -Force

  $shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Pumpstation.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $launcherBatPath
  $shortcut.Arguments = ''
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
  if (Test-Path -LiteralPath $paths.rosterFile) {
    try {
      [IO.File]::WriteAllText($rosterMarker, "seeded=$(Get-Date -Format o)`r`n", ([System.Text.UTF8Encoding]::new($false)))
      Remove-Item -LiteralPath $paths.rosterFile -Force -ErrorAction Stop
      Write-Host 'PINهای اولیه در پایگاه داده به‌صورت هش‌شده ذخیره شدند؛ فایل متنی موقت حذف شد.' -ForegroundColor Green
    } catch {
      Write-Host ("هشدار: حذف فایل متنی PIN خودکار نشد؛ دسترسی آن را محدود کنید: {0}" -f $paths.rosterFile) -ForegroundColor Yellow
    }
  } else {
    [IO.File]::WriteAllText($rosterMarker, "seeded=$(Get-Date -Format o)`r`n", ([System.Text.UTF8Encoding]::new($false)))
  }
} catch {
  $caught = $_
  $failureDetails = @(
    ("Time: {0}" -f (Get-Date -Format o)),
    ("Message: {0}" -f $caught.Exception.Message),
    ("Category: {0}" -f $caught.CategoryInfo),
    ("Position: {0}" -f $caught.InvocationInfo.PositionMessage),
    ("Script stack: {0}" -f $caught.ScriptStackTrace),
    ("Working directory: {0}" -f (Get-Location).Path)
  ) -join "`r`n"
  try {
    [IO.File]::WriteAllText($InstallerErrorLog, $failureDetails + "`r`n", ([System.Text.UTF8Encoding]::new($false)))
    if ($paths -and $paths.logDir -and (Test-Path -LiteralPath $paths.logDir)) {
      Copy-Item -LiteralPath $InstallerErrorLog -Destination (Join-Path $paths.logDir 'install-error.log') -Force -ErrorAction SilentlyContinue
    }
  } catch { }
  Write-Host ''
  Write-Host ('خطای نصب: ' + $caught.Exception.Message) -ForegroundColor Red
  Write-Host ("گزارش تشخیصی ذخیره شد: {0}" -f $InstallerErrorLog) -ForegroundColor Yellow
  Write-Host 'هیچ فایل پایگاه داده یا بک‌آپ قبلی حذف نمی‌شود. در صورت شکست به‌روزرسانی، نسخهٔ قبلی برنامه در app.previous باقی می‌ماند.' -ForegroundColor Yellow
  Read-Host 'برای بستن این پنجره Enter بزنید'
  exit 1
}
