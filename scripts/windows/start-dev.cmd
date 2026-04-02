@echo off
setlocal
pwsh -NoLogo -NoProfile -File "%~dp0start-dev.ps1" %*
exit /b %ERRORLEVEL%
