$ErrorActionPreference = 'Stop'
$taskProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$taskIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
# A new directory on some Windows project volumes inherits Write but lacks Delete.
# SQLite journals, npm updates and Vite rebuilds require Modify. Scope this fix
# to generated project directories, never to source directories or the drive.
foreach ($taskGeneratedName in @('node_modules', 'data', 'dist')) {
    $taskGeneratedPath = Join-Path $taskProjectRoot $taskGeneratedName
    New-Item -ItemType Directory -Path $taskGeneratedPath -Force | Out-Null
    $taskGeneratedPath = (Resolve-Path -LiteralPath $taskGeneratedPath).Path
    if (-not $taskGeneratedPath.StartsWith($taskProjectRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Generated directory is outside the project' }
    icacls $taskGeneratedPath /grant "${taskIdentity}:(OI)(CI)M" /T /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not prepare generated directory: $taskGeneratedName" }
}
$env:npm_config_cache = Join-Path $env:LOCALAPPDATA 'bead-workbench-npm-cache'
Write-Host 'Generated directories and local npm cache are ready.'
