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

  # Restart prod server task if it already exists.
  schtasks /Run /TN "MetroMark-StartProd" | Out-Null
  Write-Host "[sync] Triggered MetroMark-StartProd task."
} else {
  Write-Host "[sync] No changes pulled."
}
