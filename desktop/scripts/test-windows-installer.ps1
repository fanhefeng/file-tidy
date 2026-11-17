# Destructive only to this disposable CI runner's test installation. Never run on a user's PC.
param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$PreviousInstaller,
    [Parameter(Mandatory)][string]$PreviousVersion
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'This lifecycle test requires a disposable GitHub Actions Windows runner.'
}
$desktop = Split-Path -Parent $PSScriptRoot
$output = Join-Path $desktop 'release/smoke/installer'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$previousPath = (Resolve-Path -LiteralPath $PreviousInstaller).Path
if ([version]$PreviousVersion -ge [version]$Version) { throw 'An older baseline version is required.' }

function Get-Registration {
    @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -match '^File Tidy(?: |$)' })
}
function Wait-Result([scriptblock]$Read, [string]$Failure) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        if (& $Read) { return }
        Start-Sleep -Milliseconds 500
    } while ($timer.Elapsed.TotalSeconds -lt 45)
    throw $Failure
}
function Run-Nsis([string]$File, [string]$Arguments) {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
    try {
        if (-not $process.WaitForExit(120000)) { $process.Kill(); throw "NSIS timed out: $File" }
        if ($process.ExitCode -ne 0) { throw "NSIS exited with $($process.ExitCode): $File" }
    } finally { $process.Dispose() }
}
function Read-Installation([string]$ExpectedVersion) {
    $entries = @(Get-Registration)
    if ($entries.Count -ne 1) { throw "Expected one installation, found $($entries.Count)" }
    $entry = $entries[0]
    if ($entry.DisplayVersion -ne $ExpectedVersion) { throw 'Installed version is incorrect.' }
    if ($entry.QuietUninstallString -notmatch '^"([^"]+)" (/currentuser /S)$') {
        throw 'Expected a per-user NSIS uninstaller.'
    }
    $uninstaller = $Matches[1]
    $directory = Split-Path -Parent $uninstaller
    $exe = Join-Path $directory 'File Tidy.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Installed executable is missing.' }
    if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw 'Uninstaller is missing.' }
    $binaryVersion = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
    # PE resources use four numeric components for these stable semver builds.
    if ($binaryVersion -ne $ExpectedVersion -and $binaryVersion -ne "$ExpectedVersion.0") {
        throw "Installed executable version [$binaryVersion] does not match [$ExpectedVersion]."
    }
    Write-Host "Verified binary version $binaryVersion and registry version $ExpectedVersion"
    return @{ Exe = $exe; Uninstaller = $uninstaller; RegistryPath = $entry.PSPath; Directory = $directory }
}
function Test-InstalledApp($Installation, [string]$Stage) {
    & node (Join-Path $PSScriptRoot 'smoke.mjs') --executable $Installation.Exe --output (Join-Path $output $Stage)
    if ($LASTEXITCODE -ne 0) { throw "Installed application smoke failed: $Stage" }
}

if (@(Get-Registration).Count) { throw 'Refusing to alter an existing File Tidy installation.' }
$rulesDirectory = Join-Path $env:APPDATA 'tidy'
if (Test-Path -LiteralPath $rulesDirectory) { throw 'Refusing to alter existing classification rules.' }
New-Item -ItemType Directory -Path $rulesDirectory | Out-Null
$rulesFile = Join-Path $rulesDirectory 'config.json'
$sentinel = '{"extensions":{"LifecycleSentinel":[".ci-test"]}}'
[IO.File]::WriteAllText($rulesFile, $sentinel)
function Assert-Rules {
    if (-not (Test-Path -LiteralPath $rulesFile) -or [IO.File]::ReadAllText($rulesFile) -cne $sentinel) {
        throw 'Installer lifecycle changed the existing classification rules.'
    }
}
Start-Transcript -Path (Join-Path $output 'lifecycle.log') -Force | Out-Null
try {
    Run-Nsis $previousPath '/S /currentuser'
    $previous = Read-Installation $PreviousVersion
    Assert-Rules
    Write-Host "PASS: baseline $PreviousVersion installed and registered"

    Run-Nsis $installerPath '/S /currentuser'
    $current = Read-Installation $Version
    if ($current.Directory -ne $previous.Directory) { throw 'Upgrade changed the installation directory.' }
    Assert-Rules
    Test-InstalledApp $current 'upgraded-installed'
    Write-Host "PASS: in-place $PreviousVersion -> $Version upgrade and real renderer smoke"

    Run-Nsis $current.Uninstaller '/currentuser /S'
    Wait-Result { -not (Test-Path -LiteralPath $current.Exe) -and @(Get-Registration).Count -eq 0 } 'Uninstall left the executable or registration.'
    Assert-Rules
    Write-Host 'PASS: uninstall removed the program and registration, preserving classification rules'

    Run-Nsis $installerPath '/S /currentuser'
    $fresh = Read-Installation $Version
    Test-InstalledApp $fresh 'fresh-current-installed'
    Assert-Rules
    Run-Nsis $fresh.Uninstaller '/currentuser /S'
    Wait-Result { -not (Test-Path -LiteralPath $fresh.Exe) -and @(Get-Registration).Count -eq 0 } 'Final uninstall failed.'
    Assert-Rules
    Write-Host "PASS: fresh $Version install, real renderer smoke and uninstall"
    @{ ok = $true; previousVersion = $PreviousVersion; version = $Version; installerSha256 = (Get-FileHash $installerPath -Algorithm SHA256).Hash; previousInstallerSha256 = (Get-FileHash $previousPath -Algorithm SHA256).Hash; scope = 'Windows CI silent NSIS installation; not interactive wizard, SmartScreen or physical-device acceptance' } |
        ConvertTo-Json | Set-Content (Join-Path $output 'result.json')
} finally { Stop-Transcript | Out-Null }
