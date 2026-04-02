<#
.SYNOPSIS
Resets the local acquisition SQLite database files.

.DESCRIPTION
Deletes the acquisition database and its SQLite sidecar files from the local
data directory. This is intended for development-only resets.

.PARAMETER RepoRoot
Optional repository root override. Defaults to the parent of the scripts folder.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter()]
    [string]$RepoRoot = (Split-Path -Path (Split-Path -Path $PSScriptRoot -Parent) -Parent)
)

$ErrorActionPreference = 'Stop'

$resolvedRepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$dataDirectory = Join-Path -Path $resolvedRepoRoot -ChildPath 'data'
$databaseBasePath = Join-Path -Path $dataDirectory -ChildPath 'acquisition.db'
$candidatePaths = @(
    $databaseBasePath,
    "$databaseBasePath-shm",
    "$databaseBasePath-wal"
)

$removedPaths = New-Object System.Collections.Generic.List[string]

foreach ($candidatePath in $candidatePaths) {
    if (-not (Test-Path -LiteralPath $candidatePath)) {
        continue
    }

    if ($PSCmdlet.ShouldProcess($candidatePath, 'Remove acquisition database file')) {
        Remove-Item -LiteralPath $candidatePath -Force -ErrorAction Stop
        $removedPaths.Add($candidatePath)
    }
}

if ($removedPaths.Count -eq 0) {
    Write-Output "No acquisition database files were present under '$dataDirectory'."
    exit 0
}

Write-Output 'Removed acquisition database files:'
$removedPaths | ForEach-Object { Write-Output " - $_" }
