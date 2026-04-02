@echo off
setlocal
pwsh -NoLogo -NoProfile -File "%~dp0smoke.ps1" %*
exit /b %ERRORLEVEL%
