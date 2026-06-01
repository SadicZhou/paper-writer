@echo off
setlocal enabledelayedexpansion

set "PORTS=4567 4569"

echo [INFO] Stopping processes on ports: %PORTS%

for %%P in (%PORTS%) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P " ^| findstr "LISTENING"') do (
    echo [INFO] Killing PID %%A on port %%P
    taskkill /PID %%A /F >nul 2>nul
  )
)

echo [INFO] Done.
