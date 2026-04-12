<#
.SYNOPSIS
Runs a lightweight smoke test against the local Bountarr server.

.PARAMETER BaseUrl
Base URL for the running app.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$BaseUrl = 'http://localhost:4173'
)

$ErrorActionPreference = 'Stop'
$baseUri = [Uri]$BaseUrl
$repoRoot = Split-Path -Path $PSScriptRoot -Parent
$buildEntryPoint = Join-Path -Path $repoRoot -ChildPath 'build/index.js'
$runtimeDirectory = Join-Path -Path $repoRoot -ChildPath 'data/runtime/smoke'

function Assert-True {
    param(
        [Parameter(Mandatory)]
        [bool]$Condition,

        [Parameter(Mandatory)]
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Test-ServerReady {
    param(
        [Parameter(Mandatory)]
        [string]$Url
    )

    try {
        $response = Invoke-WebRequest -Uri "$Url/" -UseBasicParsing
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Start-LocalServerIfNeeded {
    param(
        [Parameter(Mandatory)]
        [Uri]$Uri
    )

    if ($Uri.Host -notin @('localhost', '127.0.0.1')) {
        return $null
    }

    $listener = Get-NetTCPConnection -LocalPort $Uri.Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        return $null
    }

    if (-not (Test-Path -LiteralPath $buildEntryPoint)) {
        throw "Build output was not found at '$buildEntryPoint'. Run 'npm run build' first."
    }

    New-Item -ItemType Directory -Path $runtimeDirectory -Force -ErrorAction Stop | Out-Null

    $stdoutPath = Join-Path -Path $runtimeDirectory -ChildPath 'server.stdout.log'
    $stderrPath = Join-Path -Path $runtimeDirectory -ChildPath 'server.stderr.log'
    $origin = "$($Uri.Scheme)://$($Uri.Host):$($Uri.Port)"

    $process = Start-Process -FilePath 'node' -ArgumentList @(
        '--env-file-if-exists=.env',
        $buildEntryPoint
    ) -WorkingDirectory $repoRoot -Environment @{
        PORT = "$($Uri.Port)"
        ORIGIN = $origin
    } -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru

    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (Test-ServerReady -Url $Uri.AbsoluteUri.TrimEnd('/')) {
            return $process
        }

        Start-Sleep -Milliseconds 750
    }

    throw "Timed out waiting for the local server on port $($Uri.Port)."
}

$startedServerProcess = $null

try {
    $startedServerProcess = Start-LocalServerIfNeeded -Uri $baseUri

    $rootResponse = Invoke-WebRequest -Uri "$BaseUrl/" -UseBasicParsing
    Assert-True ($rootResponse.StatusCode -eq 200) 'Root page did not return HTTP 200.'
    Assert-True ($rootResponse.Content -match 'Bountarr') 'Root HTML is missing the app title.'
    Assert-True ($rootResponse.Content -match '>Search<') 'Root HTML is missing the search submit button.'
    Assert-True ($rootResponse.Content -match 'aria-label=\"Primary navigation\"') 'Root HTML is missing the primary navigation landmark.'

    $config = Invoke-RestMethod -Uri "$BaseUrl/api/config/status"
    Assert-True ($config.configured -eq $true) 'Config endpoint reports no Arr service configured.'

    $health = Invoke-RestMethod -Uri "$BaseUrl/api/health"
    Assert-True ($health.status -eq 'ok') 'Health endpoint did not report an ok runtime state.'
    Assert-True ($health.runtime.healthy -eq $true) 'Health endpoint reported runtime issues.'

    if ($config.plexConfigured) {
        $plexRecent = Invoke-RestMethod -Uri "$BaseUrl/api/plex/recent"
        Assert-True (($plexRecent | Measure-Object).Count -gt 0) 'Plex recent endpoint returned no items.'

        $plexSeed = $null
        $plexItem = $null

        foreach ($candidate in ($plexRecent | Select-Object -First 5)) {
            $plexQuery = [Uri]::EscapeDataString($candidate.title)
            $plexKind = if ($candidate.kind -eq 'movie' -or $candidate.kind -eq 'series') {
                $candidate.kind
            }
            else {
                'all'
            }

            $plexBlocked = Invoke-RestMethod -Uri "$BaseUrl/api/search?q=$plexQuery&kind=$plexKind"
            $plexItem = $plexBlocked | Where-Object { $_.inPlex -eq $true } | Select-Object -First 1
            if ($null -ne $plexItem) {
                $plexSeed = $candidate
                break
            }
        }

        if ($null -ne $plexItem) {
            Assert-True ($plexItem.canAdd -eq $false) 'A Plex result is incorrectly marked addable.'
        }
        else {
            Write-Output 'Skipped Plex-enriched search assertion because no current Plex recent title mapped into search results.'
        }
    }

    $search = Invoke-RestMethod -Uri "$BaseUrl/api/search?q=matrix&kind=all"
    Assert-True (($search | Measure-Object).Count -gt 0) 'Search endpoint returned no results.'

    $tracked = $search | Where-Object { $_.inArr -eq $true } | Select-Object -First 1
    Assert-True ($null -ne $tracked) 'Search results did not include any tracked Arr item for duplicate-path testing.'

    $duplicateBody = @{
        item = $tracked
        preferences = @{
            preferredLanguage = 'English'
            requireSubtitles = $true
        }
    } | ConvertTo-Json -Depth 12

    $duplicateResult = Invoke-RestMethod -Uri "$BaseUrl/api/request" -Method Post -ContentType 'application/json' -Body $duplicateBody
    Assert-True ($duplicateResult.existing -eq $true) 'Duplicate add path did not return existing=true.'
    Assert-True ($duplicateResult.item.canAdd -eq $false) 'Duplicate add path returned a tracked item as addable.'

    $dashboard = Invoke-RestMethod -Uri "$BaseUrl/api/dashboard?preferredLanguage=English&requireSubtitles=true"
    Assert-True ($null -ne $dashboard.items) 'Dashboard response is missing items.'

    $queue = Invoke-RestMethod -Uri "$BaseUrl/api/queue"
    Assert-True ($null -ne $queue.items) 'Queue response is missing items.'
    Assert-True ($null -ne $queue.acquisitionJobs) 'Queue response is missing acquisitionJobs.'

    [pscustomobject]@{
        RootStatus          = $rootResponse.StatusCode
        Configured          = $config.configured
        HealthStatus        = $health.status
        PlexConfigured      = $config.plexConfigured
        SearchResults       = ($search | Measure-Object).Count
        DuplicateMessage    = $duplicateResult.message
        DashboardItemCount  = ($dashboard.items | Measure-Object).Count
        QueueItemCount      = ($queue.items | Measure-Object).Count
        AcquisitionJobCount = ($queue.acquisitionJobs | Measure-Object).Count
    } | Format-List | Out-String | Write-Output
}
catch {
    Write-Error $_
    exit 1
}
finally {
    if ($null -ne $startedServerProcess -and -not $startedServerProcess.HasExited) {
        Stop-Process -Id $startedServerProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
