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
        return
    }

    $listener = Get-NetTCPConnection -LocalPort $Uri.Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        return
    }

    Start-Process -FilePath 'pwsh' -ArgumentList '-NoLogo', '-NoProfile', '-Command', "& { Set-Location '$repoRoot'; `$env:PORT='$($Uri.Port)'; `$env:ORIGIN='$($Uri.Scheme)://$($Uri.Host):$($Uri.Port)'; node --env-file=.env 'build/index.js' }" -WorkingDirectory $repoRoot -RedirectStandardOutput (Join-Path $repoRoot 'server.stdout.log') -RedirectStandardError (Join-Path $repoRoot 'server.stderr.log') | Out-Null

    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (Test-ServerReady -Url $Uri.AbsoluteUri.TrimEnd('/')) {
            return
        }

        Start-Sleep -Milliseconds 750
    }

    throw "Timed out waiting for the local server on port $($Uri.Port)."
}

try {
    Start-LocalServerIfNeeded -Uri $baseUri

    $rootResponse = Invoke-WebRequest -Uri "$BaseUrl/" -UseBasicParsing
    Assert-True ($rootResponse.StatusCode -eq 200) 'Root page did not return HTTP 200.'
    Assert-True ($rootResponse.Content -match 'Bountarr') 'Root HTML is missing the app title.'
    Assert-True ($rootResponse.Content -match '>Search<') 'Root HTML is missing the search submit button.'
    Assert-True ($rootResponse.Content -match 'aria-label=\"Open .* menu\"') 'Root HTML is missing the compact view menu.'

    $config = Invoke-RestMethod -Uri "$BaseUrl/api/config/status"
    Assert-True ($config.configured -eq $true) 'Config endpoint reports no Arr service configured.'

    if ($config.plexConfigured) {
        $plexRecent = Invoke-RestMethod -Uri "$BaseUrl/api/plex/recent"
        Assert-True (($plexRecent | Measure-Object).Count -gt 0) 'Plex recent endpoint returned no items.'

        $plexBlocked = Invoke-RestMethod -Uri "$BaseUrl/api/search?q=high%20potential&kind=series"
        $plexItem = $plexBlocked | Where-Object { $_.inPlex -eq $true } | Select-Object -First 1
        Assert-True ($null -ne $plexItem) 'Plex-enriched search result was not found for addability testing.'
        Assert-True ($plexItem.canAdd -eq $false) 'A Plex result is incorrectly marked addable.'
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
