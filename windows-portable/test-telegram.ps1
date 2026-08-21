$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Project = Split-Path -Parent $Root
$EnvFile = Join-Path $Project '.env'
if (-not (Test-Path $EnvFile)) { Write-Error "Missing .env" }
$token = $null
Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith('#')) {
    $pair = $line -split '=', 2
    if ($pair.Count -eq 2 -and $pair[0].Trim() -eq 'TELEGRAM_BOT_TOKEN') { $token = $pair[1].Trim() }
  }
}
if (-not $token) { Write-Error "TELEGRAM_BOT_TOKEN is empty" }
$result = Invoke-RestMethod -Method Get -Uri ("https://api.telegram.org/bot{0}/getMe" -f $token)
if ($result.ok) {
  Write-Host ("Telegram bot OK: @{0}" -f $result.result.username)
  exit 0
}
Write-Error "Telegram bot verification failed"
