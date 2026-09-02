@echo off
setlocal
REM MetroMark restart script.
REM
REM Shuts down the currently running MetroMark web app + harvester loop and then
REM restarts them (via operations\start-metromark.bat). Run this when you have
REM deployed new code and want the host to pick it up cleanly.
REM
REM Matching is done on the cmd.exe COMMAND LINE (the windows were started with
REM "npm run start:prod" and "operations\run-harvesters.bat"), not on window
REM titles: taskkill's WINDOWTITLE filter does not support wildcards, so title
REM matching silently matches nothing. Killing the cmd.exe tree also closes the
REM console window, which stops the child node processes.
REM
REM NOTE: keep this file ASCII-only (no smart quotes/dashes); cmd.exe garbles
REM non-ASCII bytes in batch comments.

echo === MetroMark restart ===

REM Stop the web app + harvester windows by their command lines, then kill each
REM tree (cmd.exe + node children) so the console windows close too.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ids = Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object { $_.CommandLine -match 'npm run start:prod' -or $_.CommandLine -match 'run-harvesters\.bat' } | ForEach-Object { $_.ProcessId }; foreach ($id in $ids) { Start-Process -FilePath 'taskkill.exe' -ArgumentList '/PID', $id, '/T', '/F' -WindowStyle Hidden -Wait | Out-Null }; Write-Output (\"Stopped \" + $ids.Count + \" MetroMark window(s).\")"

REM Also stop any orphaned node processes from this project (covers the case
REM where a window was already closed but node kept running).
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ids = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'server/index\.js|harvest-(world|headway|stops)\.js|run-harvesters\.bat' } | ForEach-Object { $_.ProcessId }; foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }; Write-Output (\"Stopped \" + $ids.Count + \" orphaned node process(es).\")"

REM Give the processes a moment to release ports/files.
timeout /t 3 /nobreak >nul

echo Restarting MetroMark...
call "%~dp0start-metromark.bat"

echo === MetroMark restarted ===
endlocal
