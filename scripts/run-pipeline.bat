@echo off
REM ============================================================
REM AI News Pipeline - wrapper for Windows Task Scheduler
REM Runs the compiled pipeline once and writes a timestamped log.
REM Exits with the pipeline's exit code so the scheduler can log
REM task failures (0x1) vs. successes (0x0).
REM ============================================================
setlocal

set "ROOT=C:\Users\picha\.openclaw\workspace\ai-news-agent"
set "LOGDIR=%ROOT%\logs"
set "STAMP=%date:~10,4-%date:~4,2-%date:~7,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
set "STAMP=%STAMP: =0%"
set "LOGFILE=%LOGDIR%\pipeline_%STAMP%.log"

if not exist "%LOGDIR%" mkdir "%LOGDIR%"

echo ============================================================ >> "%LOGFILE%"
echo Run started: %date% %time% >> "%LOGFILE%"
echo ============================================================ >> "%LOGFILE%"

cd /d "%ROOT%"

"%SystemRoot%\node.exe" "%ROOT%\dist\index.js" >> "%LOGFILE%" 2>&1
set "EXITCODE=%ERRORLEVEL%"

echo ============================================================ >> "%LOGFILE%"
echo Run ended:   %date% %time% >> "%LOGFILE%"
echo Exit code:   %EXITCODE% >> "%LOGFILE%"
echo ============================================================ >> "%LOGFILE%"

REM Trim log dir to the 50 most recent files so it doesn't grow forever.
for /f "skip=50 delims=" %%F in ('dir /b /a-d /od /tw "%LOGDIR%\pipeline_*.log"') do (
    del /q "%LOGDIR%\%%F" 2>nul
)

exit /b %EXITCODE%
