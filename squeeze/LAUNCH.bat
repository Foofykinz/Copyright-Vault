@echo off
title SQUEEZE GPU — Copyright Evidence Tool
cd /d "%~dp0"

:: Quick check — if dependencies missing, redirect to installer
python --version >nul 2>&1
if errorlevel 1 ( echo Run INSTALL.bat first! & pause & exit /b 1 )
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    :: Try local ffmpeg bundled by installer
    if exist "%~dp0ffmpeg\bin\ffmpeg.exe" (
        set "PATH=%~dp0ffmpeg\bin;%PATH%"
    ) else (
        echo Run INSTALL.bat first! & pause & exit /b 1
    )
)

python squeeze.py
pause
