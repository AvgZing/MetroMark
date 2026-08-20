param(
  [string]$RepoDir = "",
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

if (-not $RepoDir) {
  $RepoDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")
}

if (-not (Test-Path -Path $RepoDir)) {
  throw "Repository directory not found: $RepoDir"
}

Set-Location $RepoDir

Write-Host "[sync] Repo: $RepoDir"
Write-Host "[sync] Branch: $Branch"

$before = (git rev-parse HEAD).Trim()

git fetch origin $Branch

git checkout $Branch

git pull --ff-only origin $Branch

$after = (git rev-parse HEAD).Trim()

if ($before -ne $after) {
  Write-Host "[sync] Updated to new commit: $after"

  if (Test-Path package-lock.json) {
    npm ci
  } else {
    npm install
  }

  # Restart the host app (server + harvester loop) via the startup script.
  Start-Process cmd -ArgumentList '/c', 'call operations\start-metromark.bat'
  Write-Host "[sync] Triggered operations\start-metromark.bat."
} else {
  Write-Host "[sync] No changes pulled."
}
