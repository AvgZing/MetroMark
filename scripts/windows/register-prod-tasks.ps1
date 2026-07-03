param(
  [string]$RepoDir = "",
  [string]$UserName = $env:USERNAME,
  [string]$Branch = "main",
  [int]$SyncIntervalMinutes = 10,
  [int]$HarvestIntervalMinutes = 30,
  [string]$BackupTime = "02:15"
)

$ErrorActionPreference = "Stop"

if (-not $RepoDir) {
  $RepoDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")
}

if (-not (Test-Path -Path $RepoDir)) {
  throw "Repository directory not found: $RepoDir"
}

$startProdScript = Join-Path $RepoDir "scripts\windows\start-prod.ps1"
$harvestScript = Join-Path $RepoDir "scripts\windows\run-harvest-prod.ps1"
$backupScript = Join-Path $RepoDir "scripts\windows\run-backup-prod.ps1"
$syncScript = Join-Path $RepoDir "scripts\windows\sync-from-github.ps1"

$startCmd = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$startProdScript`" -RepoDir `"$RepoDir`""
$harvestCmd = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$harvestScript`" -RepoDir `"$RepoDir`""
$backupCmd = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$backupScript`" -RepoDir `"$RepoDir`""
$syncCmd = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$syncScript`" -RepoDir `"$RepoDir`" -Branch `"$Branch`""

Write-Host "[tasks] Creating scheduled tasks for $UserName in $RepoDir"

schtasks /Create /F /SC ONLOGON /TN "MetroMark-StartProd" /TR $startCmd /RU $UserName | Out-Null
schtasks /Create /F /SC MINUTE /MO $HarvestIntervalMinutes /TN "MetroMark-HarvestCore" /TR $harvestCmd /RU $UserName | Out-Null
schtasks /Create /F /SC DAILY /ST $BackupTime /TN "MetroMark-BackupNonrecoverable" /TR $backupCmd /RU $UserName | Out-Null
schtasks /Create /F /SC MINUTE /MO $SyncIntervalMinutes /TN "MetroMark-GitHubSync" /TR $syncCmd /RU $UserName | Out-Null

Write-Host "[tasks] Done."
