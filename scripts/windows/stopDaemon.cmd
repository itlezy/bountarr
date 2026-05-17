@ECHO OFF
SETLOCAL

CD /D "%~dp0\..\.."
IF ERRORLEVEL 1 (
    ECHO Failed to switch to the repository root.
    EXIT /B 1
)

CALL pm2 stop bountarr

EXIT /B %ERRORLEVEL%
