#Requires -Version 7.6

<#
.SYNOPSIS
Resets the local acquisition SQLite database files.

.DESCRIPTION
Deletes the acquisition database and its SQLite sidecar files from the local
data directory. This is intended for development-only resets. The helper can
also clear the isolated integration/live-ui runtime databases and their
captured harness logs.

.PARAMETER RepoRoot
Optional repository root override. Defaults to the parent of the helpers folder.

.PARAMETER Scope
Which acquisition state to remove. Use `main`, `integration`, `live-ui`, or
`all`.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter()]
    [string]$RepoRoot = (Split-Path -Path $PSScriptRoot -Parent),

    [Parameter()]
    [ValidateSet('main', 'integration', 'live-ui', 'all')]
    [string[]]$Scope = @('main')
)

$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSEdition -ne 'Core') {
    throw 'Run this script with pwsh 7.6 or newer.'
}

$resolvedRepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$selectedScopes = if ($Scope -contains 'all') {
    @('main', 'integration', 'live-ui')
}
else {
    $Scope
}

function Get-ScopeCandidatePaths {
    param(
        [Parameter(Mandatory)]
        [string]$Root,

        [Parameter(Mandatory)]
        [string]$SelectedScope
    )

    if ($SelectedScope -eq 'main') {
        $databaseBasePath = Join-Path -Path $Root -ChildPath 'data\acquisition.db'
        return @(
            $databaseBasePath,
            "$databaseBasePath-shm",
            "$databaseBasePath-wal"
        )
    }

    $runtimeRoot = Join-Path -Path $Root -ChildPath "data\runtime\$SelectedScope"
    $databaseBasePath = Join-Path -Path $runtimeRoot -ChildPath 'acquisition.db'
    return @(
        $databaseBasePath,
        "$databaseBasePath-shm",
        "$databaseBasePath-wal",
        (Join-Path -Path $runtimeRoot -ChildPath 'app.stdout.log'),
        (Join-Path -Path $runtimeRoot -ChildPath 'app.stderr.log'),
        (Join-Path -Path $runtimeRoot -ChildPath 'run.json')
    )
}

$candidatePaths = New-Object System.Collections.Generic.List[string]
foreach ($selectedScope in $selectedScopes) {
    foreach ($candidatePath in (Get-ScopeCandidatePaths -Root $resolvedRepoRoot -SelectedScope $selectedScope)) {
        if (-not $candidatePaths.Contains($candidatePath)) {
            $candidatePaths.Add($candidatePath)
        }
    }
}

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
    Write-Output "No acquisition state files were present for scopes: $($selectedScopes -join ', ')."
    exit 0
}

Write-Output "Removed acquisition state files for scopes: $($selectedScopes -join ', ')"
$removedPaths | ForEach-Object { Write-Output " - $_" }
