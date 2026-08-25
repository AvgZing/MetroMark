@echo off
setlocal
REM MetroMark host startup.
REM
REM Opens two VISIBLE terminal windows:
REM   1. "MetroMark Server" - runs npm run start:prod (Express server),
REM   2. "MetroMark Harvester" - runs operations\run-harvesters.bat
REM      (background harvester loop: world + headway + stops).
REM
REM Output is shown LIVE in each window so you can watch both processes.
REM The windows stay open until you close them (which stops the process),
REM so do not close them if you want MetroMark to keep running.
REM
REM GitHub updates are NOT applied here - run operations\sync-from-github.bat
REM manually when you want to pull the latest stable code.
REM
REM To install: put a shortcut to this file in the Windows Startup folder
REM (Win+R -> shell:startup -> paste a shortcut here). It runs at login.
REM For boot-time start + automatic restart on crash, prefer a Task Scheduler
REM task instead (trigger: At startup; action: this .bat; "restart on failure").
REM
REM NOTE: keep this file ASCII-only (no smart quotes/dashes); cmd.exe garbles
REM non-ASCII bytes in batch comments.

cd /d "%~dp0.."
if not defined TIPPECANOE_BIN set TIPPECANOE_BIN=C:\msys64\usr\bin\tippecanoe.exe

echo Opening MetroMark web app window (npm run start:prod)...
start "MetroMark Server" cmd /k "npm run start:prod"

echo Opening MetroMark harvester window...
start "MetroMark Harvester" cmd /k "call operations\run-harvesters.bat"

echo MetroMark started. Two windows are open - keep them open.
