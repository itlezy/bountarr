#Requires -Version 7.6

<#
.SYNOPSIS
Starts the built Bountarr app for destructive live Playwright tests.

.DESCRIPTION
Builds the app, resets the isolated live-UI acquisition database, and starts the
Node server on the requested host and port. The script refuses to run unless
BOUNTARR_ALLOW_LIVE_INTEGRATION is set to 1. Runtime metadata is written to
data\runtime\live-ui\run.json and stdout/stderr are captured alongside the
isolated database.
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
$runtimeDirectory = Join-Path -Path $repoRoot -ChildPath 'data\runtime\live-ui'
$databaseBasePath = Join-Path -Path $runtimeDirectory -ChildPath 'acquisition.db'
$stdoutLogPath = Join-Path -Path $runtimeDirectory -ChildPath 'app.stdout.log'
$stderrLogPath = Join-Path -Path $runtimeDirectory -ChildPath 'app.stderr.log'
$runInfoPath = Join-Path -Path $runtimeDirectory -ChildPath 'run.json'
$resetPaths = @(
    $databaseBasePath,
    "$databaseBasePath-shm",
    "$databaseBasePath-wal",
    $stdoutLogPath,
    $stderrLogPath,
    $runInfoPath
)
$buildEntryPoint = Join-Path -Path $repoRoot -ChildPath 'build\index.js'

New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
foreach ($candidatePath in $resetPaths) {
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

    $origin = "http://$HostName`:$Port"
    $runInfo = [ordered]@{
        scope = 'live-ui'
        startedAt = [DateTimeOffset]::UtcNow.ToString('o')
        repoRoot = $repoRoot
        acquisitionDatabasePath = $databaseBasePath
        stdoutLogPath = $stdoutLogPath
        stderrLogPath = $stderrLogPath
        buildEntryPoint = $buildEntryPoint
        hostName = $HostName
        port = $Port
        origin = $origin
        pid = $null
    }
    $runInfo | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $runInfoPath -Encoding utf8

    Write-Output "Live UI runtime reset under '$runtimeDirectory'."
    Write-Output "Live UI acquisition DB: $databaseBasePath"
    Write-Output "Live UI stdout log: $stdoutLogPath"
    Write-Output "Live UI stderr log: $stderrLogPath"

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = 'node'
    [void]$startInfo.ArgumentList.Add('--env-file-if-exists=.env')
    [void]$startInfo.ArgumentList.Add($buildEntryPoint)
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.Environment['ACQUISITION_DB_PATH'] = $databaseBasePath
    $startInfo.Environment['ORIGIN'] = $origin
    $startInfo.Environment['PORT'] = [string]$Port

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo

    $stdoutWriter = [System.IO.StreamWriter]::new(
        $stdoutLogPath,
        $false,
        [System.Text.UTF8Encoding]::new($false)
    )
    $stderrWriter = [System.IO.StreamWriter]::new(
        $stderrLogPath,
        $false,
        [System.Text.UTF8Encoding]::new($false)
    )

    $stdoutHandler = [System.Diagnostics.DataReceivedEventHandler]{
        param($sender, $eventArgs)

        if ($null -eq $eventArgs.Data) {
            return
        }

        $stdoutWriter.WriteLine($eventArgs.Data)
        $stdoutWriter.Flush()
        [Console]::Out.WriteLine($eventArgs.Data)
    }
    $stderrHandler = [System.Diagnostics.DataReceivedEventHandler]{
        param($sender, $eventArgs)

        if ($null -eq $eventArgs.Data) {
            return
        }

        $stderrWriter.WriteLine($eventArgs.Data)
        $stderrWriter.Flush()
        [Console]::Error.WriteLine($eventArgs.Data)
    }

    $process.add_OutputDataReceived($stdoutHandler)
    $process.add_ErrorDataReceived($stderrHandler)

    if (-not $process.Start()) {
        throw 'Failed to start the live UI Node process.'
    }

    $runInfo.pid = $process.Id
    $runInfo | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $runInfoPath -Encoding utf8
    $process.BeginOutputReadLine()
    $process.BeginErrorReadLine()
    $process.WaitForExit()

    $runInfo.exitedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $runInfo.exitCode = $process.ExitCode
    $runInfo | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $runInfoPath -Encoding utf8

    if ($process.ExitCode -ne 0) {
        throw "Live UI Node process exited with code $($process.ExitCode)."
    }

    exit 0
}
finally {
    if ($null -ne $stdoutWriter) {
        $stdoutWriter.Dispose()
    }

    if ($null -ne $stderrWriter) {
        $stderrWriter.Dispose()
    }

    Pop-Location
}
