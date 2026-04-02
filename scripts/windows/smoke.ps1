<#
.SYNOPSIS
Runs the local smoke test helper.

.DESCRIPTION
Wraps the shared smoke helper so it is easy to invoke from scripts/windows.

.PARAMETER RepoRoot
Optional repository root override. Defaults to the parent of the scripts folder.

.PARAMETER BaseUrl
Base URL for the running app.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$RepoRoot = (Split-Path -Path (Split-Path -Path $PSScriptRoot -Parent) -Parent),

    [Parameter()]
    [string]$BaseUrl = 'http://localhost:4173'
)

$ErrorActionPreference = 'Stop'

$resolvedRepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$helperPath = Join-Path -Path $resolvedRepoRoot -ChildPath 'helpers/helper-smoke-ui.ps1'

if (-not (Test-Path -LiteralPath $helperPath)) {
    throw "Smoke helper was not found at '$helperPath'."
}

Push-Location -LiteralPath $resolvedRepoRoot
try {
    & pwsh -NoLogo -NoProfile -File $helperPath -BaseUrl $BaseUrl
    if ($LASTEXITCODE -ne 0) {
        throw "Smoke helper exited with code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
