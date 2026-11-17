$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Join-Path $root 'pumpstation-v1.2'
$vendor = Join-Path $root 'offline-vendor'
$registry = 'https://registry.npmjs.org'
$nodeVersion = '22.22.2'
$npmVersion = '10.9.4'
$nodeIntegrity = 'sha512-w6ir5BjNVuSIC43FWLchnuc/bu9hT0ntMH/FJFouaR2oxADkFhim4YlOp4r92Euyj5b15YdbiL5xYwgmELZuZg=='
$npmIntegrity = 'sha512-OnUG836FwboQIbqtefDNlyR0gTHzIfwRfE3DuiNewBvnMnWEpB0VEXwBlFVgqpNzIgYo/MHh3d2Hel/pszapAA=='

function Get-Sha512Integrity([string]$File) {
  $hex = (Get-FileHash -LiteralPath $File -Algorithm SHA512).Hash
  $bytes = New-Object byte[] ([int]($hex.Length / 2))
  for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16) }
  return 'sha512-' + [Convert]::ToBase64String($bytes)
}

function Test-Target([object]$Package, [string]$Target) {
  if ($null -eq $Package) { return $true }
  $values = @($Package)
  if ($values.Count -eq 0) { return $true }
  $negative = @($values | Where-Object { ([string]$_).StartsWith('!') } | ForEach-Object { ([string]$_).Substring(1) })
  if ($negative -contains $Target) { return $false }
  $positive = @($values | Where-Object { -not ([string]$_).StartsWith('!') })
  return ($positive.Count -eq 0 -or $positive -contains $Target)
}

function Save-PinnedRuntime([string]$Name, [string]$Version, [string]$Integrity) {
  $file = Join-Path $vendor ($Name + '-' + $Version + '.tgz')
  $url = "$registry/$Name/-/$Name-$Version.tgz"
  Write-Host ("دریافت {0}@{1}..." -f $Name, $Version) -ForegroundColor Cyan
  Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing
  if ((Get-Sha512Integrity $file) -ne $Integrity) {
    Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
    throw "SHA-512 بستهٔ $Name@$Version نادرست است."
  }
}

try {
  if (-not (Test-Path -LiteralPath (Join-Path $app 'package-lock.json'))) { throw 'package-lock.json پیدا نشد.' }
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
  if (-not $npm) { throw 'برای آماده‌سازی بستهٔ آفلاین، روی این رایانه npm لازم است. این پیش‌نیاز فقط برای سازندهٔ بسته است، نه رایانهٔ مقصد.' }
  $lock = Get-Content -LiteralPath (Join-Path $app 'package-lock.json') -Raw | ConvertFrom-Json
  $urls = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($property in $lock.packages.PSObject.Properties) {
    $package = $property.Value
    if (-not $package.resolved) { continue }
    if (-not (Test-Target $package.os 'win32') -or -not (Test-Target $package.cpu 'x64')) { continue }
    if (-not $package.integrity) { throw "برای بستهٔ قفل‌شده checksum موجود نیست: $($property.Name)" }
    if (-not ([string]$package.resolved).StartsWith($registry + '/', [StringComparison]::OrdinalIgnoreCase)) { throw "منبع خارج از registry مجاز است: $($package.resolved)" }
    [void]$urls.Add([string]$package.resolved)
  }
  if ($urls.Count -eq 0) { throw 'هیچ بسته‌ای از package-lock برای Windows x64 پیدا نشد.' }

  if (Test-Path -LiteralPath $vendor) { Remove-Item -LiteralPath $vendor -Recurse -Force }
  New-Item -ItemType Directory -Path $vendor -Force | Out-Null
  $npmCache = Join-Path $vendor 'npm-cache'
  New-Item -ItemType Directory -Path $npmCache -Force | Out-Null
  Save-PinnedRuntime 'node-win-x64' $nodeVersion $nodeIntegrity
  Save-PinnedRuntime 'npm' $npmVersion $npmIntegrity

  $npmArguments = @('cache', 'add', '--cache', $npmCache, '--prefer-offline')
  $batch = @()
  foreach ($url in @($urls | Sort-Object)) {
    $batch += $url
    if ($batch.Count -ge 30) {
      $batchArguments = $npmArguments + $batch
      & $npm.Source @batchArguments
      if ($LASTEXITCODE -ne 0) { throw 'ساخت cache آفلاین npm ناموفق بود.' }
      $batch = @()
    }
  }
  if ($batch.Count -gt 0) {
    $batchArguments = $npmArguments + $batch
    & $npm.Source @batchArguments
    if ($LASTEXITCODE -ne 0) { throw 'ساخت cache آفلاین npm ناموفق بود.' }
  }

  $manifest = [PSCustomObject]@{
    format = 'pumpstation-offline-cache-v1'
    target = 'win32-x64'
    nodeVersion = $nodeVersion
    npmVersion = $npmVersion
    lockSha256 = (Get-FileHash -LiteralPath (Join-Path $app 'package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    packageTarballs = $urls.Count
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  [IO.File]::WriteAllText((Join-Path $vendor 'manifest.json'), ($manifest | ConvertTo-Json -Depth 4), ([System.Text.UTF8Encoding]::new($false)))
  Write-Host ("بستهٔ آفلاین آماده شد: {0} بستهٔ npm برای Windows x64" -f $urls.Count) -ForegroundColor Green
  Write-Host 'اکنون package-windows.ps1 را اجرا کنید تا همهٔ فایل‌ها داخل ZIP نصب قرار بگیرند.'
} catch {
  Write-Host ('آماده‌سازی آفلاین ناموفق بود: ' + $_.Exception.Message) -ForegroundColor Red
  Read-Host 'برای بستن Enter بزنید'
  exit 1
}
