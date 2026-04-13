@ECHO OFF
SETLOCAL

PUSHD "%~dp0\..\.."
IF ERRORLEVEL 1 (
    ECHO Failed to switch to the repository root.
    EXIT /B 1
)

CALL npm run build
IF ERRORLEVEL 1 (
    ECHO Build failed.
    POPD
    EXIT /B 1
)

pwsh -NoLogo -NoProfile -File ".\helpers\helper-server-start.ps1"
SET "EXIT_CODE=%ERRORLEVEL%"

POPD
EXIT /B %EXIT_CODE%
