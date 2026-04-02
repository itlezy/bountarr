<#
.SYNOPSIS
Starts the Vite development server for Bountarr.

.DESCRIPTION
Runs npm run dev with an explicit host and port for local or LAN development.

.PARAMETER RepoRoot
Optional repository root override. Defaults to the parent of the scripts folder.

.PARAMETER Port
Port to bind the dev server to.

.PARAMETER ListenHost
Host interface to bind to. Defaults to 0.0.0.0 for LAN testing.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$RepoRoot = (Split-Path -Path (Split-Path -Path $PSScriptRoot -Parent) -Parent),

    [Parameter()]
    [int]$Port = 5173,

    [Parameter()]
    [string]$ListenHost = '0.0.0.0'
)

$ErrorActionPreference = 'Stop'

$resolvedRepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

Push-Location -LiteralPath $resolvedRepoRoot
try {
    & npm run dev -- --host $ListenHost --port $Port
    if ($LASTEXITCODE -ne 0) {
        throw "Dev server exited with code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
