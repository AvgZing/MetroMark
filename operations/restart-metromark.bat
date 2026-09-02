@echo off
setlocal
REM MetroMark restart script.
REM
REM Shuts down the currently running MetroMark web app + harvester loop and then
REM restarts them (via operations\start-metromark.bat). Run this when you have
REM deployed new code and want the host to pick it up cleanly.
REM
REM It kills every node.exe started by MetroMark on this machine. If you run
REM other Node services on this PC, prefer closing the two MetroMark console
REM windows by hand instead, then double-click start-metromark.bat.
REM
REM NOTE: keep this file ASCII-only (no smart quotes/dashes); cmd.exe garbles
REM non-ASCII bytes in batch comments.

echo === MetroMark restart ===

REM Stop the web app + harvester windows gracefully by ending their cmd shells.
REM Matching by window title avoids touching unrelated node processes.
taskkill /FI "WINDOWTITLE eq MetroMark Server*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq MetroMark Harvester*" /T /F >nul 2>&1

REM Give the processes a moment to release ports/files.
timeout /t 3 /nobreak >nul

echo Restarting MetroMark...
call "%~dp0start-metromark.bat"

echo === MetroMark restarted ===
endlocal
