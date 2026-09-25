@echo off
title SQUEEZE — Create Desktop Shortcut
cd /d "%~dp0"

echo.
echo  Creating SQUEEZE desktop shortcut...
echo.

:: Find pythonw.exe (no-console Python runner)
set "PYTHONW="
for /f "tokens=*" %%P in ('python -c "import sys,os; print(os.path.join(os.path.dirname(sys.executable),'pythonw.exe'))" 2^>nul') do set "PYTHONW=%%P"

if defined PYTHONW if not exist "%PYTHONW%" set "PYTHONW="

:: Fall back to searching PATH directly — "where" returns a real resolved
:: path (unlike the old fallback, which set PYTHONW to the bare word
:: "pythonw", an invalid shortcut target that Windows can't resolve later).
if not defined PYTHONW (
    for /f "tokens=*" %%P in ('where pythonw 2^>nul') do if not defined PYTHONW set "PYTHONW=%%P"
)

if not defined PYTHONW (
    echo.
    echo  ERROR: Could not find pythonw.exe anywhere on this machine.
    echo  This usually means Python isn't really installed yet — on a fresh
    echo  Windows machine, typing "python" can silently open the Microsoft
    echo  Store instead of running Python, which fools detection like this.
    echo.
    echo  Run INSTALL.bat first, then try this again. If it still fails,
    echo  install Python manually from https://python.org/downloads
    echo  ^(check "Add Python to PATH" during install^), then re-run this.
    pause
    exit /b 1
)

:: Resolve the REAL Desktop folder via the Shell API — %USERPROFILE%\Desktop
:: can be wrong when OneDrive's "Known Folder Move" has redirected Desktop
:: elsewhere (a common setup on work/school Microsoft accounts). Using the
:: literal %USERPROFILE%\Desktop path in that case throws
:: DirectoryNotFoundException when saving the .lnk, since that folder isn't
:: actually there on disk anymore — this is what "worked on my computer but
:: not theirs" usually means for this exact error.
set "DESKTOP_DIR="
for /f "tokens=*" %%D in ('powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')" 2^>nul') do set "DESKTOP_DIR=%%D"
if not defined DESKTOP_DIR set "DESKTOP_DIR=%USERPROFILE%\Desktop"

:: Write a VBScript to create the shortcut with our lemon icon
set SHORTCUT=%DESKTOP_DIR%\SQUEEZE.lnk
set ICON=%~dp0squeeze_lemon.ico
set TARGET=%PYTHONW%
set ARGS=%~dp0launcher.pyw
set WORKDIR=%~dp0

powershell -Command "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath='%PYTHONW%'; $s.Arguments='\"%ARGS%\"'; $s.WorkingDirectory='%WORKDIR%'; $s.IconLocation='%ICON%'; $s.Description='SQUEEZE — Copyright Evidence Tool'; $s.Save()"

if exist "%SHORTCUT%" (
    echo  ✓ Shortcut created on your Desktop!
    echo  Just double-click SQUEEZE to launch it.
    echo.
) else (
    echo  Hmm, something went wrong.
    echo  Desktop folder used: %DESKTOP_DIR%
    echo  If that path looks wrong, or includes "OneDrive", try creating the
    echo  shortcut manually, or run this as Administrator.
    echo.
)
pause
