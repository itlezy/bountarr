#Requires -Version 7.6

<#
.SYNOPSIS
Runs the destructive live integration suite for Bountarr.

.DESCRIPTION
Builds the app and runs the real-stack Vitest integration tests. The suite is
opt-in and refuses to run unless BOUNTARR_ALLOW_LIVE_INTEGRATION is set to 1.

.PARAMETER RepoRoot
Optional repository root override. Defaults to the parent of the helpers folder.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$RepoRoot = (Split-Path -Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSEdition -ne 'Core') {
    throw 'Run this script with pwsh 7.6 or newer.'
}

if ($env:BOUNTARR_ALLOW_LIVE_INTEGRATION -ne '1') {
    throw 'Set BOUNTARR_ALLOW_LIVE_INTEGRATION=1 before running the destructive live integration suite.'
}

$resolvedRepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

Push-Location -LiteralPath $resolvedRepoRoot
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build failed with exit code $LASTEXITCODE."
    }

    & npm exec -- vitest run --config vitest.integration.config.ts
    if ($LASTEXITCODE -ne 0) {
        throw "Vitest integration run failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
