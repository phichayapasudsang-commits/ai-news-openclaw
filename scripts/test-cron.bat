@echo off
REM scripts/test-cron.bat
REM ---------------------------------------------------------------
REM Install a Windows Scheduled Task that fires EXACTLY 2 times,
REM 10 minutes apart, then auto-deletes itself (/Z).
REM
REM Timeline (assume now = 11:06):
REM   11:06  - run 1 (scheduler fires immediately at /ST)
REM   11:16  - run 2 (next /MO 10 tick before /ET 11:17)
REM   11:17  - task auto-deletes after last run
REM
REM Then bt switches to production with install-cron.bat daily 07:00.
REM ---------------------------------------------------------------

setlocal
set "TASK_NAME=AI News Digest (Test 2x)"
set "SCRIPT=%~dp0run-digest.bat"

REM Compute /ST = current time, /ET = current time + 11 min.
REM Windows requires /ET - /ST > /MO interval; +11 leaves room for 2 runs.
for /f "tokens=*" %%s in ('powershell -NoProfile -Command ^
  "(Get-Date).ToString('HH:mm')"') do set "START_TIME=%%s"
for /f "tokens=*" %%t in ('powershell -NoProfile -Command ^
  "(Get-Date).AddMinutes(11).ToString('HH:mm')"') do set "END_TIME=%%t"

echo [test-cron] Task     : %TASK_NAME%
echo [test-cron] Script   : %SCRIPT%
echo [test-cron] Schedule : every 10 minutes
echo [test-cron] Start at : %START_TIME%
echo [test-cron] End at   : %END_TIME%  (~11 min from now, 2 runs fit)
echo [test-cron] Result   : fires 2 times, then auto-deletes
echo.

REM Clean up any leftover test task from a previous run.
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1

schtasks /Create ^
  /SC MINUTE ^
  /MO 10 ^
  /ST %START_TIME% ^
  /ET %END_TIME% ^
  /Z ^
  /F ^
  /TN "%TASK_NAME%" ^
  /TR "\"%SCRIPT%\"" >nul

if errorlevel 1 (
  echo [test-cron] FAILED. Run as Administrator?
  exit /b 1
)

echo [test-cron] Task installed OK.
echo.
echo --- task info ---
schtasks /Query /TN "%TASK_NAME%" /V /FO LIST ^
  | findstr /C:"HostName" /C:"TaskName" /C:"Next Run Time" /C:"Schedule" /C:"Start Time"
echo.
echo [test-cron] What to do next:
echo   1. Wait ~14 minutes for both runs to fire.
echo   2. Watch the log:     Get-Content ..\logs\digest.log -Tail 30
echo   3. Verify Supabase:   browse https://supabase.com/dashboard/project/cljwftdzuzbuswthynie/editor
echo   4. Confirm 2 INSERT batches with +20 articles each.
echo   5. Switch to prod:   .\install-cron.bat daily 07:00

endlocal
