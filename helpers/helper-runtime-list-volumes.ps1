<#
.SYNOPSIS
Outputs local Windows volume capacity details as compact JSON for the runtime status view.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'Run this script with pwsh 7 or newer.'
}

$sortProperties = @(
    @{ Expression = { if ($_.DriveLetter) { 0 } else { 1 } } }
    @{ Expression = { [string]$_.DriveLetter } }
    @{ Expression = { [string]$_.Name } }
)

$volumes = Get-CimInstance -ClassName Win32_Volume -ErrorAction Stop |
    Where-Object {
        $_.DriveType -eq 3 -and
        $null -ne $_.Capacity -and
        [double]$_.Capacity -gt 0
    } |
    Sort-Object -Property $sortProperties |
    ForEach-Object {
        [pscustomobject]@{
            driveLetter = if ($_.DriveLetter) { [string]$_.DriveLetter } else { $null }
            mountPoint = if ($_.Name) { [string]$_.Name } else { $null }
            label = if ($_.Label) { [string]$_.Label } else { $null }
            fileSystem = if ($_.FileSystem) { [string]$_.FileSystem } else { $null }
            freeSpaceBytes = if ($null -ne $_.FreeSpace) { [double]$_.FreeSpace } else { $null }
            totalSpaceBytes = if ($null -ne $_.Capacity) { [double]$_.Capacity } else { $null }
        }
    }

ConvertTo-Json -InputObject @($volumes) -Depth 3 -Compress
