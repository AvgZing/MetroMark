@echo off
setlocal
REM MetroMark harvester runner.
REM
REM Loops the world + headway harvesters in the background. Each pass stops
REM automatically when Transitland's daily quotas are reached, then waits and
REM runs again - so coverage of the whole world builds up over time without
REM maintaining a list of city slugs. Run it directly, or it is started by
REM start-metromark.bat (which you shortcut into the Startup folder).
REM
REM Once per UTC day this also runs the nonrecoverable backup (auth users,
REM profiles, presets, station visits, station overrides) using the Supabase
REM service-role key from .env.production. A marker file records the last run
REM date so it fires once per day, not every pass.
REM
REM NOTE: keep this file ASCII-only (no smart quotes/dashes); cmd.exe garbles
REM non-ASCII bytes in batch comments.

cd /d "%~dp0.."
if not defined METROMARK_ENV_FILE set METROMARK_ENV_FILE=.env.production
set HARVEST_DELAY_SECONDS=600

:loop
echo [%date% %time%] === MetroMark harvester pass ===
node operations\harvest\harvest-world.js
echo [%date% %time%] === World harvest done, running headway backfill ===
node server/admin/harvest-headway.js
echo [%date% %time%] === Headway backfill done, running stops backfill ===
node server/admin/harvest-stops.js
echo [%date% %time%] === Stops backfill done ===

call "%~dp0maybe-backup.bat"

echo Waiting %HARVEST_DELAY_SECONDS% seconds before the next pass...
timeout /t %HARVEST_DELAY_SECONDS% /nobreak >nul
goto loop
