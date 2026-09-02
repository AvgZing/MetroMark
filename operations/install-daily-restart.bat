@echo off
setlocal
REM MetroMark daily maintenance task installer.
REM
REM Registers a Windows Task Scheduler task that restarts MetroMark once a day
REM (server + harvester windows) at the configured time. Restarting the server
REM daily is industry-standard hygiene: it rolls the log files (the logger
REM rotates by date) and recycles the Express process so memory/connection
REM creep never accumulates. The harvester loop is restarted too - it resumes
REM from its saved state on the next pass.
REM
REM Task name: MetroMark-Daily-Restart
REM Default run time: 05:00 local time (when quota is fresh, traffic is lowest).
REM Change it with:  schtasks /Change /TN MetroMark-Daily-Restart /ST HH:MM
REM
REM Requires an elevated shell (right-click cmd -> Run as administrator) the
REM first time. Re-run to update the time/path after moving the repo.
REM
REM NOTE: keep this file ASCII-only.

set TASK_NAME=MetroMark-Daily-Restart
set REPO_DIR=%~dp0..
set RESTART_BAT=%~dp0restart-metromark.bat

echo Registering task "%TASK_NAME%"...
schtasks /Create /TN "%TASK_NAME%" /SC DAILY /ST 05:00 /TR "\"%RESTART_BAT%\"" /F
if errorlevel 1 (
  echo Failed to create the task. Run this as Administrator.
  exit /b 1
)

echo.
echo Task installed. It runs daily at 05:00 and calls:
echo   %RESTART_BAT%
echo.
echo View/verify:   schtasks /Query /TN "%TASK_NAME%"
echo Run it now:    schtasks /Run /TN "%TASK_NAME%"
echo Disable:       schtasks /Change /TN "%TASK_NAME%" /DISABLE
echo Remove:        schtasks /Delete /TN "%TASK_NAME%" /F
endlocal
