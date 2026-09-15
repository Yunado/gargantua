@echo off
setlocal
title GARGANTUA - Schwarzschild Raytracer
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js 18+ required - install from https://nodejs.org then re-run.
  pause
  exit /b 1
)
start "" http://127.0.0.1:8090
node "%~dp0tools\serve.mjs" 8090
echo.
echo Server stopped. Press a key to close.
pause >nul
