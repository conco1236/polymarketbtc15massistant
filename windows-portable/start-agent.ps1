$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Project = Split-Path -Parent $Root
$EnvFile = Join-Path $Project '.env'
$Node = Join-Path $Root 'runtime\node.exe'

if (-not (Test-Path $EnvFile)) {
  Write-Error "Missing .env. Copy windows-portable\.env.example to .env and fill Telegram values."
}
if (-not (Test-Path $Node)) {
  Write-Error "Missing bundled runtime\node.exe. Re-extract the complete portable package."
}

Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith('#')) {
    $pair = $line -split '=', 2
    if ($pair.Count -eq 2) {
      [Environment]::SetEnvironmentVariable($pair[0].Trim(), $pair[1].Trim(), 'Process')
    }
  }
}

New-Item -ItemType Directory -Force -Path (Join-Path $Project 'logs') | Out-Null
Set-Location $Project
Write-Host "Starting Polymarket paper agent..."
Write-Host "Live execution is disabled. Press Ctrl+C to stop."
& $Node (Join-Path $Project 'src\index.js')
exit $LASTEXITCODE
