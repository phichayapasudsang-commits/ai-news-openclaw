@echo off
REM scripts/run-digest.bat
REM Schedule via Windows Task Scheduler: 07:00 daily Asia/Bangkok.
REM
REM Task setup (one-time, run as Administrator):
REM   schtasks /Create /SC DAILY /TN "AI News Digest" ^
REM     /TR "C:\Users\picha\.openclaw\workspace\ai-news-agent\scripts\run-digest.bat" ^
REM     /ST 07:00

cd /d "%~dp0\.."
call npx tsx src/digest.ts >> logs\digest.log 2>&1
exit /b %errorlevel%
