param(
  [string]$ProjectRoot = (Resolve-Path ".").Path,
  [int]$ApiPort = 4569,
  [int]$ClientPort = 4567,
  [switch]$AutoInit
)

$ErrorActionPreference = "Stop"

function Test-CommandExists {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

if (-not (Test-CommandExists "pnpm")) {
  throw "pnpm not found. Install pnpm and reopen terminal."
}

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $workspaceRoot
$resolvedProjectRoot = (Resolve-Path $ProjectRoot).Path
$inkosConfigPath = Join-Path $resolvedProjectRoot "inkos.json"

if (-not (Test-Path $inkosConfigPath)) {
  Write-Host "" -ForegroundColor Yellow
  Write-Host "inkos.json not found: $inkosConfigPath" -ForegroundColor Red
  Write-Host "Studio needs an InkOS project directory (created by 'inkos init')." -ForegroundColor Yellow

  if ($AutoInit) {
    Write-Host "AutoInit enabled. Initializing InkOS project..." -ForegroundColor Cyan
    pnpm --filter @actalk/inkos exec inkos -- init "$resolvedProjectRoot"
  } else {
    Write-Host "" -ForegroundColor Yellow
    Write-Host "Quick fix:" -ForegroundColor Cyan
    Write-Host "  pnpm --filter @actalk/inkos exec inkos -- init `"$resolvedProjectRoot`"" -ForegroundColor Gray
    Write-Host "Then rerun: pnpm run dev:win -- -ProjectRoot `"$resolvedProjectRoot`"" -ForegroundColor Gray
    throw "Missing inkos.json in ProjectRoot."
  }
}

Write-Host "Workspace: $workspaceRoot" -ForegroundColor Cyan
Write-Host "ProjectRoot: $resolvedProjectRoot" -ForegroundColor Cyan
Write-Host "API Port: $ApiPort, Client Port: $ClientPort" -ForegroundColor Cyan

$apiCmd = "Set-Location '{0}'; `$env:INKOS_STUDIO_PORT='{1}'; `$env:INKOS_PROJECT_ROOT='{2}'; pnpm --filter @actalk/inkos-studio exec tsx watch src/api/index.ts" -f $workspaceRoot, $ApiPort, $resolvedProjectRoot
$clientCmd = "Set-Location '{0}'; `$env:INKOS_STUDIO_PORT='{1}'; `$env:INKOS_PROJECT_ROOT='{2}'; pnpm --filter @actalk/inkos-studio run dev:client -- --port {3} --host" -f $workspaceRoot, $ApiPort, $resolvedProjectRoot, $ClientPort

$apiProcess = Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoExit",
  "-Command",
  $apiCmd
) -PassThru

$clientProcess = Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoExit",
  "-Command",
  $clientCmd
) -PassThru

Write-Host ""
Write-Host "Studio starting..." -ForegroundColor Green
Write-Host "Web: http://localhost:$ClientPort" -ForegroundColor Green
Write-Host "API: http://localhost:$ApiPort" -ForegroundColor Green
Write-Host ""
Write-Host "Opened two terminal windows. Close them to stop services." -ForegroundColor Yellow

