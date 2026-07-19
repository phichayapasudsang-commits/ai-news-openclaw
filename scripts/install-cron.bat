@echo off
REM scripts/install-cron.bat
REM ---------------------------------------------------------------
REM Install Windows Scheduled Task for AI News Digest.
REM Must be run as Administrator.
REM
REM Usage:
REM   install-cron.bat 10              -> every 10 minutes (TEST)
REM   install-cron.bat daily 07:00     -> 07:00 daily (PRODUCTION)
REM   install-cron.bat weekly 10:00    -> 10:00 Mon-Fri (PRODUCTION, weekday only)
REM   install-cron.bat hourly          -> every hour on the hour
REM   install-cron.bat off             -> remove the task
REM ---------------------------------------------------------------

setlocal
set "TASK_NAME=AI News Digest"
set "SCRIPT=%~dp0run-digest.bat"

if "%1"=="" (
  echo Usage: %~nx0 { 10 ^| daily HH:MM ^| weekly HH:MM ^| hourly ^| off }
  exit /b 1
)

REM Uninstall first so we can re-install cleanly.
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1

if /I "%1"=="off" (
  echo [install-cron] Task "%TASK_NAME%" removed.
  goto :end
)

if /I "%1"=="10" (
  schtasks /Create /SC MINUTE /MO 10 /TN "%TASK_NAME%" ^
    /TR "\"%SCRIPT%\"" ^
    /F >nul
  if errorlevel 1 (
    echo [install-cron] FAILED to create 10-minute task. Run as Administrator?
    exit /b 1
  )
  echo [install-cron] Task "%TASK_NAME%" installed: every 10 minutes.
  echo Test now: schtasks /Run /TN "%TASK_NAME%"
  goto :verify
)

if /I "%1"=="hourly" (
  schtasks /Create /SC HOURLY /TN "%TASK_NAME%" ^
    /TR "\"%SCRIPT%\"" ^
    /F >nul
  if errorlevel 1 (
    echo [install-cron] FAILED. Run as Administrator?
    exit /b 1
  )
  echo [install-cron] Task "%TASK_NAME%" installed: every hour.
  goto :end
)

if /I "%1"=="daily" (
  if "%2"=="" (
    echo [install-cron] daily needs a time. Example: daily 07:00
    exit /b 1
  )
  schtasks /Create /SC DAILY /ST %2 /TN "%TASK_NAME%" ^
    /TR "\"%SCRIPT%\"" ^
    /F >nul
  if errorlevel 1 (
    echo [install-cron] FAILED. Run as Administrator?
    exit /b 1
  )
  echo [install-cron] Task "%TASK_NAME%" installed: daily at %2.
  goto :end
)

if /I "%1"=="weekly" (
  if "%2"=="" (
    echo [install-cron] weekly needs a time. Example: weekly 10:00
    exit /b 1
  )
  schtasks /Create /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST %2 /TN "%TASK_NAME%" ^
    /TR "\"%SCRIPT%\"" ^
    /F >nul
  if errorlevel 1 (
    echo [install-cron] FAILED. Run as Administrator?
    exit /b 1
  )
  echo [install-cron] Task "%TASK_NAME%" installed: weekly MON-FRI at %2.
  goto :verify
)

echo [install-cron] Unknown option "%1".
echo Usage: %~nx0 { 10 ^| daily HH:MM ^| weekly HH:MM ^| hourly ^| off }
exit /b 1

:verify
echo --- verify ---
schtasks /Query /TN "%TASK_NAME%" /V /FO LIST | findstr /C:"Schedule" /C:"Next Run Time" /C:"Status"

:end
endlocal
