@ECHO OFF
SETLOCAL

CD /D "%~dp0\..\.."
IF ERRORLEVEL 1 (
    ECHO Failed to switch to the repository root.
    EXIT /B 1
)

WHERE pm2 >NUL 2>NUL
IF ERRORLEVEL 1 (
    ECHO pm2 was not found on PATH.
    EXIT /B 1
)

CALL npm run build
IF ERRORLEVEL 1 (
    ECHO Build failed.
    EXIT /B 1
)

CALL pm2 startOrRestart ecosystem.config.cjs --only bountarr
IF ERRORLEVEL 1 EXIT /B 1

CALL pm2 save
IF ERRORLEVEL 1 EXIT /B 1

EXIT /B 0
