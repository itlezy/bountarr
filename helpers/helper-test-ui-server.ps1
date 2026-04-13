# Starts the Vite dev server in deterministic UI-test mode for Playwright.
param(
    [string]$HostName = '127.0.0.1',
    [int]$Port = 4173
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Path $PSScriptRoot -Parent
$viteEntryPoint = Join-Path -Path $repoRoot -ChildPath 'node_modules\vite\bin\vite.js'

if (-not (Test-Path -LiteralPath $viteEntryPoint)) {
    throw "Vite entrypoint not found at $viteEntryPoint"
}

$env:BOUNTARR_UI_TEST_MODE = '1'

& node $viteEntryPoint dev --host $HostName --port $Port
