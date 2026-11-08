# AgenticVenus desktop installer for Windows (PowerShell):
#   irm https://raw.githubusercontent.com/princetnwr723-cloud/AgenticVenus/main/install.ps1 | iex
# Downloads the latest release, checks its SHA-256 checksum, and only then runs the installer.
$ErrorActionPreference = "Stop"
$base = if ($env:VENUS_BASE) { $env:VENUS_BASE } else { "https://github.com/princetnwr723-cloud/AgenticVenus/releases/latest/download" }
if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64") { throw "Only 64-bit Intel/AMD Windows is supported for now." }

$name = "AgenticVenus-win-x64.exe"
$file = Join-Path $env:TEMP $name
Write-Host "Downloading $name ..."
Invoke-WebRequest "$base/$name" -OutFile $file
$sums = (Invoke-WebRequest "$base/SHA256SUMS.txt").Content
$line = ($sums -split "`n") | Where-Object { $_ -match [regex]::Escape($name) } | Select-Object -First 1
if (-not $line) { Remove-Item $file -Force; throw "The checksum list does not contain $name." }
$want = ($line.Trim() -split "\s+")[0].ToLower()
$got = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
if ($got -ne $want) { Remove-Item $file -Force; throw "Checksum mismatch: the download is damaged or was tampered with. Nothing was installed." }
Write-Host "Checksum OK. Starting the installer..."
Start-Process $file

Write-Host "`nFor the local computer you also need QEMU:  winget install SoftwareFreedomConservancy.QEMU"