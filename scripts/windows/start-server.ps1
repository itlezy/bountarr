<#
.SYNOPSIS
Starts the built Bountarr server using the repository .env file.

.DESCRIPTION
Launches the adapter-node build entrypoint from the repository root. If a local
.env file exists, Node loads it with --env-file before starting the server.

.PARAMETER RepoRoot
Optional repository root override. Defaults to the parent of the scripts folder.

.PARAMETER Build
Builds the app before starting the server.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$RepoRoot = (Split-Path -Path (Split-Path -Path $PSScriptRoot -Parent) -Parent),

    [Parameter()]
    [switch]$Build
)

$ErrorActionPreference = 'Stop'

$resolvedRepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$buildEntryPoint = Join-Path -Path $resolvedRepoRoot -ChildPath 'build/index.js'
$envFilePath = Join-Path -Path $resolvedRepoRoot -ChildPath '.env'

if ($Build) {
    Push-Location -LiteralPath $resolvedRepoRoot
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "npm run build failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath $buildEntryPoint)) {
    throw "Build output was not found at '$buildEntryPoint'. Run 'npm run build' first or pass -Build."
}

Push-Location -LiteralPath $resolvedRepoRoot
try {
    if (Test-Path -LiteralPath $envFilePath) {
        & node --env-file=.env $buildEntryPoint
    }
    else {
        & node $buildEntryPoint
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Server exited with code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
