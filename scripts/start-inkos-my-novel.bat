@echo off
setlocal

set "WORKSPACE=F:\AI\inkos"
set "PROJECT_ROOT=F:\AI\inkos-local-run"
set "API_PORT=4569"
set "CLIENT_PORT=4567"

cd /d "%WORKSPACE%" || (
  echo [ERROR] Workspace not found: %WORKSPACE%
  pause
  exit /b 1
)

echo [INFO] Starting InkOS Studio...
echo [INFO] Workspace: %WORKSPACE%
echo [INFO] ProjectRoot: %PROJECT_ROOT%
echo [INFO] API Port: %API_PORT%
echo [INFO] Client Port: %CLIENT_PORT%

powershell -ExecutionPolicy Bypass -File ".\scripts\dev-win.ps1" -ProjectRoot "%PROJECT_ROOT%" -ApiPort %API_PORT% -ClientPort %CLIENT_PORT%

echo.
echo [INFO] Script finished.
