$ErrorActionPreference = 'Stop'
$runtime = Join-Path $env:LOCALAPPDATA 'Programs\Pumpstation-Fresh-1.4.25\runtime'
$node = Join-Path $runtime 'node.exe'
$npmCli = Join-Path $runtime 'npm\bin\npm-cli.js'
$shim = Join-Path $runtime 'npm.cmd'

if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
  throw "Node runtime not found: $node"
}
if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) {
  throw "Bundled npm CLI not found: $npmCli"
}
$version = (& $node $npmCli --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "Bundled npm CLI check failed: $version"
}

$backup = "$shim.pumpstation-backup"
if ((Test-Path -LiteralPath $shim) -and -not (Test-Path -LiteralPath $backup)) {
  Copy-Item -LiteralPath $shim -Destination $backup
}
$content = '@echo off' + "`r`n" + '"%~dp0node.exe" "%~dp0npm\bin\npm-cli.js" %*' + "`r`n"
[System.IO.File]::WriteAllText($shim, $content, [System.Text.Encoding]::ASCII)
Write-Host "Fixed npm command shim. Bundled npm version: $version"
Write-Host 'The app and operational database were not changed.'
Write-Host 'Now reopen Pumpstation and retry only the in-app ZIP update.'
Read-Host 'Press Enter to close'
