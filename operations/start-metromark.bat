@echo off
setlocal
REM MetroMark host startup.
REM
REM Ensures everything that should run on the MetroMark host PC is running:
REM   1. sync from GitHub (origin/main) - best effort, offline-safe,
REM   2. the web app (Express server),
REM   3. the background harvester loop (world + headway).
REM
REM To install: put a shortcut to this file in the Windows Startup folder
REM (Win+R -> shell:startup -> paste a shortcut here). It runs at login.
REM For boot-time start + automatic restart on crash, prefer a Task Scheduler
REM task instead (trigger: At startup; action: this .bat; "restart on failure").
REM
REM NOTE: keep this file ASCII-only (no smart quotes/dashes); cmd.exe garbles
REM non-ASCII bytes in batch comments.

cd /d "%~dp0.."
if not defined METROMARK_ENV_FILE set METROMARK_ENV_FILE=.env.production
if not defined TIPPECANOE_BIN set TIPPECANOE_BIN=C:\msys64\usr\bin\tippecanoe.exe

REM --- Sync from GitHub (origin/main). Best effort: if the pull or install
REM fails (offline, dirty tree, etc.) we still start the app with local code.
echo Checking for updates from origin/main...
git fetch origin main >nul 2>&1
if errorlevel 1 goto :sync_skip
set "BEFORE_SHA="
for /f "delims=" %%i in ('git rev-parse HEAD') do set "BEFORE_SHA=%%i"
git pull --ff-only origin main >nul 2>&1
if errorlevel 1 goto :sync_skip
for /f "delims=" %%i in ('git rev-parse HEAD') do set "AFTER_SHA=%%i"
if not "%BEFORE_SHA%"=="%AFTER_SHA%" (
  echo Changes pulled from origin/main. Reinstalling dependencies...
  if exist package-lock.json (
    call npm ci
  ) else (
    call npm install
  )
) else (
  echo Already up to date.
)
:sync_skip

if not exist "operations\Logs" mkdir "operations\Logs"

echo Starting MetroMark web app...
start "MetroMark Server" cmd /k "set METROMARK_ENV_FILE=%METROMARK_ENV_FILE%&& set TIPPECANOE_BIN=%TIPPECANOE_BIN%&& node server/index.js> operations\Logs\server.log 2>&1"

echo Starting MetroMark harvester loop...
start "MetroMark Harvester" cmd /k "set METROMARK_ENV_FILE=%METROMARK_ENV_FILE%&& call operations\run-harvesters.bat> operations\Logs\harvester.log 2>&1"

echo MetroMark started. Server log: operations\Logs\server.log
echo Harvester log: operations\Logs\harvester.log
