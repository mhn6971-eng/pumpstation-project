$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appPackagePath = Join-Path $root 'pumpstation-v1.2\package.json'
if (-not (Test-Path -LiteralPath $appPackagePath)) { throw 'پوشهٔ pumpstation-v1.2 پیدا نشد.' }
$offlineVendor = Join-Path $root 'offline-vendor'
if (-not (Test-Path -LiteralPath (Join-Path $offlineVendor 'manifest.json')) -or -not (Test-Path -LiteralPath (Join-Path $offlineVendor 'node-win-x64-22.22.2.tgz')) -or -not (Test-Path -LiteralPath (Join-Path $offlineVendor 'npm-10.9.4.tgz')) -or -not (Test-Path -LiteralPath (Join-Path $offlineVendor 'npm-cache\_cacache\index-v5'))) {
  throw 'فایل‌های آفلاین همراه بسته نیستند. ابتدا روی رایانهٔ متصل به اینترنت prepare-offline-vendor.ps1 را اجرا کنید.'
}
$vendorManifest = Get-Content -LiteralPath (Join-Path $offlineVendor 'manifest.json') -Raw | ConvertFrom-Json
$lockHash = (Get-FileHash -LiteralPath (Join-Path $root 'pumpstation-v1.2\package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($vendorManifest.lockSha256 -ne $lockHash -or $vendorManifest.target -ne 'win32-x64') { throw 'cache آفلاین با package-lock.json فعلی سازگار نیست؛ ابتدا آن را دوباره بسازید.' }
$version = (Get-Content -LiteralPath $appPackagePath -Raw | ConvertFrom-Json).version
$output = Join-Path $root "Pumpstation-Windows-$version.zip"
$temp = Join-Path $env:TEMP ('pumpstation-package-' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $temp 'Pumpstation'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
try {
  Write-Host 'در حال آماده‌سازی بستهٔ تمیز (بدون node_modules، پایگاه‌داده یا فایل‌های محلی)...' -ForegroundColor Cyan
  & robocopy.exe $root $stage /E /R:1 /W:1 /NFL /NDL /NP /XD '.git' 'node_modules' '.next' '.data' 'coverage' '.audit' 'dist' '_review-edition2' 'Pumpstation Full' /XF '.env' '.env.local' '.env.production' '.env.development' '.env.test' '.env.production.local' '.env.development.local' '.env.test.local' '*.log' '*.local.json' 'Pumpstation-Windows-*.zip' 'Pumpstation-Windows-*.zip.sha256'
  $code = $LASTEXITCODE
  if ($code -ge 8) { throw "تهیهٔ بسته شکست خورد (robocopy $code)." }
  Get-ChildItem -LiteralPath $stage -Force -File -Recurse | Where-Object { $_.Name -like '.env*' -and $_.Name -ne '.env.example' } | Remove-Item -Force
  if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Force }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $output -CompressionLevel Optimal
  $hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText(($output + '.sha256'), "$hash  $(Split-Path -Leaf $output)`r`n", ([System.Text.UTF8Encoding]::new($false)))
  Write-Host ''
  Write-Host ("نصب‌کننده آماده شد: {0}" -f $output) -ForegroundColor Green
  Write-Host ("SHA-256: {0}" -f $hash) -ForegroundColor Green
  Write-Host 'ZIP را کامل استخراج کنید و روی install-windows.bat دوبار کلیک کنید.'
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
