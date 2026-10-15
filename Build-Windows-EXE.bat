@echo off
chcp 65001 >nul
echo ========================================================
echo   Room EQ Wizard (REW V5.40) - Windows .EXE 打包工具
echo ========================================================
echo 正在安装 Electron 与 electron-builder 依赖并生成单文件版 .exe ...
call npm install
call npm run dist:win
echo.
echo 打包完成！请在 dist\ 目录下查看生成的 Room-EQ-Wizard-5.40-Portable.exe
pause
