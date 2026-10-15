@echo off
chcp 65001 >nul
title Room EQ Wizard (REW V5.40) Desktop Launcher
set "APP_HTML=%~dp0public\index.html"
set "FILE_URL=file:///%APP_HTML:\=/%"

if exist "%~dp0node_modules\.bin\electron.cmd" (
    start "" "%~dp0node_modules\.bin\electron.cmd" "%~dp0."
    exit /b 0
)

where msedge >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    start "" msedge --app="%FILE_URL%" --window-size=1480,920
    exit /b 0
)

if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app="%FILE_URL%" --window-size=1480,920
    exit /b 0
)

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app="%FILE_URL%" --window-size=1480,920
    exit /b 0
)

start "" "%APP_HTML%"
