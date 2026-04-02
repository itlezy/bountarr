@echo off
setlocal
pwsh -NoLogo -NoProfile -File "%~dp0start-server.ps1" %*
exit /b %ERRORLEVEL%
