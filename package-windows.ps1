$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appSource = Join-Path $root 'pumpstation-v1.2'
$appPackagePath = Join-Path $appSource 'package.json'
if (-not (Test-Path -LiteralPath $appPackagePath)) { throw 'pumpstation-v1.2 was not found.' }

$version = (Get-Content -LiteralPath $appPackagePath -Raw | ConvertFrom-Json).version
$output = Join-Path $root "Pumpstation-Windows-$version.zip"
$offlineOutput1 = Join-Path $root "Pumpstation-Offline-Resources-$version-Part1.zip"
$offlineOutput2 = Join-Path $root "Pumpstation-Offline-Resources-$version-Part2.zip"
$downloadDir = Join-Path $root 'downloads'
$temp = Join-Path $env:TEMP ('pumpstation-package-' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $temp 'Pumpstation'
$stageApp = Join-Path $stage 'pumpstation-v1.2'
$offlineVendor = Join-Path $root 'offline-vendor'
$offlineNpmCache = Join-Path $offlineVendor 'npm-cache'
$lockPath = Join-Path $appSource 'package-lock.json'

$requiredRootFiles = @(
  'install-windows.bat',
  'install-windows-fresh.bat',
  'install-windows.ps1',
  'launch-pumpstation.bat',
  'launch-pumpstation.ps1',
  'launch-pumpstation.vbs',
  'RUNTIME-LICENSES.txt',
  'INSTALL-WINDOWS-FA.md'
)
foreach ($file in $requiredRootFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $file) -PathType Leaf)) { throw "Required installer file is missing: $file" }
}

function Compress-OfflinePart([string]$BasePath, [object[]]$Files, [string]$OutputPath) {
  Add-Type -AssemblyName System.IO.Compression
  $outputStream = [IO.File]::Open($OutputPath, [IO.FileMode]::Create, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  $archive = $null
  try {
    $archive = [IO.Compression.ZipArchive]::new($outputStream, [IO.Compression.ZipArchiveMode]::Create, $false)
    $base = [IO.Path]::GetFullPath($BasePath).TrimEnd([char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)) + [IO.Path]::DirectorySeparatorChar
    foreach ($file in $Files) {
      $relative = $file.FullName.Substring($base.Length).Replace([char]92, [char]47)
      $entry = $archive.CreateEntry(('offline-vendor/' + $relative), [IO.Compression.CompressionLevel]::Fastest)
      $entryStream = $entry.Open()
      $sourceStream = [IO.File]::OpenRead($file.FullName)
      try { $sourceStream.CopyTo($entryStream) }
      finally { $sourceStream.Dispose(); $entryStream.Dispose() }
    }
  } finally {
    if ($archive) { $archive.Dispose() } else { $outputStream.Dispose() }
  }
}

$offlineAvailable = $false
if (Test-Path -LiteralPath $offlineVendor -PathType Container) {
  $offlineFilesPresent = (Test-Path -LiteralPath (Join-Path $offlineVendor 'manifest.json')) -and
    (Test-Path -LiteralPath (Join-Path $offlineVendor 'node-win-x64-22.22.2.tgz')) -and
    (Test-Path -LiteralPath (Join-Path $offlineVendor 'npm-10.9.4.tgz')) -and
    (Test-Path -LiteralPath (Join-Path $offlineNpmCache '_cacache\index-v5')) -and
    (Test-Path -LiteralPath (Join-Path $offlineNpmCache '_cacache\content-v2'))
  if (-not $offlineFilesPresent) { throw 'offline-vendor exists but is incomplete. Rebuild it or remove it for an online-only installer.' }
  $vendorManifest = Get-Content -LiteralPath (Join-Path $offlineVendor 'manifest.json') -Raw | ConvertFrom-Json
  $lockHash = (Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($vendorManifest.lockSha256 -ne $lockHash -or $vendorManifest.target -ne 'win32-x64') {
    throw 'offline-vendor does not match the current package-lock.json or Windows target.'
  }
  $offlineAvailable = $true
}

New-Item -ItemType Directory -Path $stageApp -Force | Out-Null
try {
  Write-Host 'Preparing a clean Windows installer package...' -ForegroundColor Cyan
  foreach ($file in $requiredRootFiles) {
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $stage $file) -Force
  }

  & robocopy.exe $appSource $stageApp /E /R:1 /W:1 /NFL /NDL /NP /XD '.git' 'node_modules' '.next' '.data' 'coverage' '.turbo' 'dist' 'out' /XF '.env' '.env.local' '.env.production' '.env.development' '.env.test' '.env.production.local' '.env.development.local' '.env.test.local' '*.log' '*.local.json' '*.zip'
  $copyCode = $LASTEXITCODE
  if ($copyCode -ge 8) { throw "Could not stage application files (robocopy exit $copyCode)." }
  Get-ChildItem -LiteralPath $stageApp -Force -File -Recurse | Where-Object { $_.Name -like '.env*' -and $_.Name -ne '.env.example' } | Remove-Item -Force

  if ($offlineAvailable) {
    Write-Host 'Preparing a separate verified offline-resources ZIP; the main installer stays small.' -ForegroundColor Green
  } else {
    Write-Host 'No matching offline-vendor cache found. Creating an online installer only.' -ForegroundColor Yellow
  }

  if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Force }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $output -CompressionLevel Optimal
  $hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText(($output + '.sha256'), "$hash  $(Split-Path -Leaf $output)`r`n", ([System.Text.UTF8Encoding]::new($false)))
  New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
  Copy-Item -LiteralPath $output -Destination (Join-Path $downloadDir (Split-Path -Leaf $output)) -Force
  Copy-Item -LiteralPath ($output + '.sha256') -Destination (Join-Path $downloadDir ((Split-Path -Leaf $output) + '.sha256')) -Force

  if ($offlineAvailable) {
    $offlineStage = Join-Path $temp 'Offline-Pumpstation'
    $offlineStageVendor = Join-Path $offlineStage 'offline-vendor'
    New-Item -ItemType Directory -Path $offlineStageVendor -Force | Out-Null
    & robocopy.exe $offlineVendor $offlineStageVendor /E /R:1 /W:1 /NFL /NDL /NP
    if ($LASTEXITCODE -ge 8) { throw 'Could not stage the offline resources ZIP parts.' }
    Remove-Item -LiteralPath (Join-Path $offlineStageVendor 'npm-cache\_logs') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $offlineStageVendor 'npm-cache\_update-notifier-last-checked') -Force -ErrorAction SilentlyContinue

    $contentRoot = [IO.Path]::GetFullPath((Join-Path $offlineStageVendor 'npm-cache\_cacache\content-v2')).TrimEnd([char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)) + [IO.Path]::DirectorySeparatorChar
    $allOfflineFiles = @(Get-ChildItem -LiteralPath $offlineStageVendor -File -Recurse -Force)
    $contentFiles = @($allOfflineFiles | Where-Object { $_.FullName.StartsWith($contentRoot, [StringComparison]::OrdinalIgnoreCase) } | Sort-Object -Property @{ Expression = { $_.Length }; Descending = $true }, FullName)
    $otherFiles = @($allOfflineFiles | Where-Object { -not $_.FullName.StartsWith($contentRoot, [StringComparison]::OrdinalIgnoreCase) })
    $part1Content = @()
    $part2Content = @()
    $part1Bytes = 0L
    $part1ContentLimit = 55000000L
    foreach ($file in $contentFiles) {
      if (($part1Bytes + [long]$file.Length) -le $part1ContentLimit) {
        $part1Content += $file
        $part1Bytes += [long]$file.Length
      } else { $part2Content += $file }
    }
    $part1Files = @($otherFiles) + @($part1Content)
    $part2Files = @($part2Content)
    if ($part1Files.Count -eq 0 -or $part2Files.Count -eq 0) { throw 'The offline cache could not be divided into two valid resource ZIP parts.' }

    Compress-OfflinePart $offlineStageVendor $part1Files $offlineOutput1
    Compress-OfflinePart $offlineStageVendor $part2Files $offlineOutput2
    foreach ($offlineFile in @($offlineOutput1, $offlineOutput2)) {
      $offlineHash = (Get-FileHash -LiteralPath $offlineFile -Algorithm SHA256).Hash.ToLowerInvariant()
      [IO.File]::WriteAllText(($offlineFile + '.sha256'), "$offlineHash  $(Split-Path -Leaf $offlineFile)`r`n", ([System.Text.UTF8Encoding]::new($false)))
      Copy-Item -LiteralPath $offlineFile -Destination (Join-Path $downloadDir (Split-Path -Leaf $offlineFile)) -Force
      Copy-Item -LiteralPath ($offlineFile + '.sha256') -Destination (Join-Path $downloadDir ((Split-Path -Leaf $offlineFile) + '.sha256')) -Force
      Write-Host ("OFFLINE RESOURCE PART READY: {0}" -f $offlineFile) -ForegroundColor Green
      Write-Host ("SHA-256: {0}" -f $offlineHash) -ForegroundColor Green
    }
    Write-Host 'Extract both ZIP parts beside install-windows.bat. Together they create offline-vendor.'
  }

  Write-Host ''
  Write-Host "INSTALLER READY: $output" -ForegroundColor Green
  Write-Host "SHA-256: $hash" -ForegroundColor Green
  Write-Host 'Extract the ZIP and double-click install-windows.bat. The installer runs automatically.'
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
