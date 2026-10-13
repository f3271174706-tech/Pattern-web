$ErrorActionPreference = 'Stop'
$taskProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $taskProjectRoot
& (Join-Path $PSScriptRoot 'prepare-local.ps1')
if (-not (Test-Path -LiteralPath (Join-Path $taskProjectRoot 'node_modules\vite\package.json'))) {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
}
Write-Host 'Workbench: http://127.0.0.1:5173 . Press Ctrl+C to stop.'
npm run dev
