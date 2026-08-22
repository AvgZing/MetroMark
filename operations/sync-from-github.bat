@echo off
setlocal
REM MetroMark GitHub sync.
REM
REM Pulls the latest stable code from origin/main and reinstalls dependencies.
REM Designed to be COPIED ANYWHERE and run manually - including a spare PC
REM running an old version of the app. It locates the repo on its own:
REM   - if run from inside the repo (root or operations\), it updates that repo,
REM   - otherwise it clones MetroMark fresh into a folder next to this file.
REM Usage: sync-from-github.bat [repo-dir]
REM
REM NOTE: keep this file ASCII-only (no smart quotes/dashes); cmd.exe garbles
REM non-ASCII bytes in batch comments.

set "REPO_URL=https://github.com/AvgZing/MetroMark.git"
set "BRANCH=main"

REM --- Preflight: git must be installed ------------------------------
where git >nul 2>&1
if errorlevel 1 (
  echo.
  echo Git is not installed or not on PATH.
  echo Install it from https://git-scm.com/downloads
  echo   or run: winget install --id Git.Git -e
  echo Then close this window and run this file again.
  echo.
  pause
  exit /b 1
)

REM --- Preflight: Node.js/npm must be installed ----------------------
where npm >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js is not installed or not on PATH.
  echo Install it from https://nodejs.org (LTS recommended).
  echo Then close this window and run this file again.
  echo.
  pause
  exit /b 1
)

REM --- Locate the repo ------------------------------------------------------
set "TARGET=%~1"
if defined TARGET goto :have_target
if exist "%~dp0.git" (
  set "TARGET=%~dp0"
  goto :have_target
)
if exist "%~dp0..\.git" (
  set "TARGET=%~dp0.."
  goto :have_target
)
set "TARGET=%~dp0MetroMark"
:have_target

REM strip any trailing backslash (except a drive root)
if "%TARGET:~-1%"=="\" if not "%TARGET:~1,1%"==":" set "TARGET=%TARGET:~0,-1%"

echo Repo directory: %TARGET%

if not exist "%TARGET%\.git" (
  echo No repo at %TARGET% - cloning MetroMark...
  git clone %REPO_URL% "%TARGET%"
  if errorlevel 1 (
    echo Clone failed. Check that git and the network are available.
    pause
    exit /b 1
  )
)

cd /d "%TARGET%"

REM --- Sync ----------------------------------------------------------------
echo Setting remote origin to %REPO_URL%
git remote set-url origin %REPO_URL% >nul 2>&1

echo Fetching origin/%BRANCH%...
git fetch origin %BRANCH%
if errorlevel 1 (
  echo Fetch failed. Check git and the network.
  pause
  exit /b 1
)

git checkout %BRANCH% >nul 2>&1

echo Pulling latest %BRANCH%...
git pull --ff-only origin %BRANCH%
if errorlevel 1 (
  echo Fast-forward pull failed - forcing to latest origin/%BRANCH%...
  git reset --hard origin/%BRANCH%
)

REM --- Dependencies ---------------------------------------------------------
if exist package-lock.json (
  echo Installing dependencies (npm ci)...
  call npm ci
) else (
  echo Installing dependencies (npm install)...
  call npm install
)
if errorlevel 1 (
  echo Dependency install failed - the sync may be incomplete.
  pause
  exit /b 1
)

echo. 
echo MetroMark synced to the latest origin/%BRANCH% at %TARGET%.
echo.
pause
exit /b 0
