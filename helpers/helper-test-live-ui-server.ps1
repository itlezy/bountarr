#Requires -Version 7.6

<#
.SYNOPSIS
Starts the built Bountarr app for destructive live Playwright tests.

.DESCRIPTION
Builds the app, resets the isolated live-UI acquisition database, and starts the
Node server on the requested host and port. The script refuses to run unless
BOUNTARR_ALLOW_LIVE_INTEGRATION is set to 1.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$HostName = '127.0.0.1',

    [Parameter()]
    [int]$Port = 4311
)

$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSEdition -ne 'Core') {
    throw 'Run this script with pwsh 7.6 or newer.'
}

if ($env:BOUNTARR_ALLOW_LIVE_INTEGRATION -ne '1') {
    throw 'Set BOUNTARR_ALLOW_LIVE_INTEGRATION=1 before running live UI tests.'
}

$repoRoot = (Resolve-Path -LiteralPath (Split-Path -Path $PSScriptRoot -Parent)).Path
$databaseBasePath = Join-Path -Path $repoRoot -ChildPath 'data\runtime\live-ui\acquisition.db'
$databaseDirectory = Split-Path -Path $databaseBasePath -Parent
$databasePaths = @(
    $databaseBasePath,
    "$databaseBasePath-shm",
    "$databaseBasePath-wal"
)
$buildEntryPoint = Join-Path -Path $repoRoot -ChildPath 'build\index.js'

New-Item -ItemType Directory -Force -Path $databaseDirectory | Out-Null
foreach ($candidatePath in $databasePaths) {
    if (Test-Path -LiteralPath $candidatePath) {
        Remove-Item -LiteralPath $candidatePath -Force
    }
}

Push-Location -LiteralPath $repoRoot
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build failed with exit code $LASTEXITCODE."
    }

    if (-not (Test-Path -LiteralPath $buildEntryPoint)) {
        throw "Build output was not found at $buildEntryPoint."
    }

    $env:ACQUISITION_DB_PATH = $databaseBasePath
    $env:ORIGIN = "http://$HostName`:$Port"
    $env:PORT = [string]$Port

    & node '--env-file-if-exists=.env' $buildEntryPoint
}
finally {
    Pop-Location
}
