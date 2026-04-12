<#
.SYNOPSIS
Starts the built Bountarr server using the repository environment file when present.

.DESCRIPTION
Launches the adapter-node build entrypoint from the repository root. If a local
.env file exists, Node loads it automatically before starting the server.

.PARAMETER RepoRoot
Optional repository root override. Defaults to the parent of the helpers folder.

.PARAMETER Port
Optional port override for the started process.

.PARAMETER Origin
Optional origin override for the started process.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$RepoRoot = (Split-Path -Path $PSScriptRoot -Parent),

    [Parameter()]
    [int]$Port,

    [Parameter()]
    [string]$Origin
)

$ErrorActionPreference = 'Stop'

$resolvedRepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$buildEntryPoint = Join-Path -Path $resolvedRepoRoot -ChildPath 'build/index.js'

if (-not (Test-Path -LiteralPath $buildEntryPoint)) {
    throw "Build output was not found at '$buildEntryPoint'. Run 'npm run build' first."
}

Push-Location -LiteralPath $resolvedRepoRoot
try {
    if ($PSBoundParameters.ContainsKey('Port')) {
        $env:PORT = "$Port"
    }

    if ($PSBoundParameters.ContainsKey('Origin')) {
        $env:ORIGIN = $Origin
    }

    & node '--env-file-if-exists=.env' $buildEntryPoint
    if ($LASTEXITCODE -ne 0) {
        throw "Server exited with code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
