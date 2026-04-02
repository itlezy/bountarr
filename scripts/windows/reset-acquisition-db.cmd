@echo off
setlocal
pwsh -NoLogo -NoProfile -File "%~dp0reset-acquisition-db.ps1" %*
exit /b %ERRORLEVEL%
