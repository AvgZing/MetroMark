param(
  [string]$RepoDir = ""
)

$ErrorActionPreference = "Stop"

if (-not $RepoDir) {
  $RepoDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")
}

if (-not (Test-Path -Path $RepoDir)) {
  throw "Repository directory not found: $RepoDir"
}

Set-Location $RepoDir

Write-Host "[prod] Repo: $RepoDir"

npm run backup:nonrecoverable:prod
