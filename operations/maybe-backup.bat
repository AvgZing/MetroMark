@echo off
setlocal
REM Runs the MetroMark nonrecoverable backup once per UTC day.
REM
REM Called from run-harvesters.bat after each harvest pass. Records the last
REM UTC date in operations\Logs\last-backup-day.txt and only runs the backup
REM when the date has changed, so it fires once per day no matter how often the
REM loop runs.
REM
REM The backup script needs SUPABASE_SERVICE_ROLE_KEY etc. from .env.production
REM (set via METROMARK_ENV_FILE by the caller). Data is written to
REM data/backups/ per BACKUP_OUTPUT_DIR.
REM
REM NOTE: keep this file ASCII-only (no smart quotes/dashes).

cd /d "%~dp0.."
if not defined METROMARK_ENV_FILE set METROMARK_ENV_FILE=.env.production

if not exist "operations\Logs" mkdir "operations\Logs"

for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "[DateTime]::UtcNow.ToString('yyyy-MM-dd')"`) do set TODAY=%%d
set MARKER=operations\Logs\last-backup-day.txt

set /p LAST=<"%MARKER%" 2>nul
if "%LAST%"=="" set LAST=none

if "%TODAY%"=="%LAST%" (
  echo [%date% %time%] Backup already ran today ^(%TODAY%^) - skipping.
  exit /b 0
)

echo [%date% %time%] Running daily nonrecoverable backup...
node server/admin/backup-nonrecoverable.js
if errorlevel 1 (
  echo [%date% %time%] Backup FAILED - will retry next pass.
  exit /b 1
)

echo %TODAY%>"%MARKER%"
echo [%date% %time%] Backup complete for %TODAY%.
exit /b 0
