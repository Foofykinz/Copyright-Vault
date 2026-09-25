@echo off
setlocal enabledelayedexpansion
title SQUEEZE — First Time Setup
color 0A

echo.
echo  ============================================================
echo   SQUEEZE GPU — First Time Setup
echo  ============================================================
echo.

:: ── Check if running as admin ─────────────────────────────────────────────────
net session >nul 2>&1
if errorlevel 1 (
    echo  Requesting admin privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:: ── 1. PYTHON ────────────────────────────────────────────────────────────────
echo  [1/4] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo  Python not found. Downloading Python 3.12...
    :: -UseBasicParsing (same as the FFmpeg download below) — without it,
    :: Invoke-WebRequest renders a progress UI that can make this take many
    :: times longer than the download itself actually needs.
    powershell -Command "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.4/python-3.12.4-amd64.exe' -OutFile '%TEMP%\python_installer.exe' -UseBasicParsing"

    echo  Installing Python 3.12...
    :: Include_tcltk=1 is required — tkinter (used for folder picker) depends on it.
    :: Without this flag it may be silently skipped in a quiet install.
    "%TEMP%\python_installer.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_tcltk=1
    del "%TEMP%\python_installer.exe" >nul 2>&1

    :: Don't try to refresh PATH in this session via reg query — it's unreliable.
    :: The known per-user install path is deterministic on Windows 10/11, so just
    :: prepend it directly. This works whether the reg key has expanded or raw values.
    set "PY_HOME=%LOCALAPPDATA%\Programs\Python\Python312"
    set "PATH=!PY_HOME!;!PY_HOME!\Scripts;%PATH%"

    :: PrependPath=1 above is supposed to persist this to the user's permanent
    :: PATH, but that's silently failed to take effect on real machines before
    :: (Python installed and working inside THIS session, but invisible to
    :: every future one — a new terminal, the desktop shortcut, LAUNCH.bat —
    :: even after a reboot). Write it ourselves too, the same way the FFmpeg
    :: fallback below already does, so this doesn't depend on the installer's
    :: own PATH step actually working.
    setx PATH "!PY_HOME!;!PY_HOME!\Scripts;%PATH%" >nul 2>&1

    python --version >nul 2>&1
    if errorlevel 1 (
        echo.
        echo  ERROR: Python install failed or PATH could not be updated.
        echo  Please install manually from https://python.org/downloads
        echo  Make sure to check "Add Python to PATH" during install,
        echo  then re-run INSTALL.bat.
        pause & exit /b 1
    )
    echo  Python installed OK.
) else (
    for /f "tokens=*" %%V in ('python --version 2^>^&1') do echo  Found: %%V
)

:: Verify tkinter is present — it is required for the folder picker dialog.
python -c "import tkinter" >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ERROR: tkinter is not available in your Python install.
    echo  Uninstall Python, then reinstall from https://python.org/downloads
    echo  During install, make sure "tcl/tk and IDLE" is checked.
    pause & exit /b 1
)

:: ── 2. FFMPEG ────────────────────────────────────────────────────────────────
echo.
echo  [2/4] Checking FFmpeg...
ffmpeg -version >nul 2>&1
if not errorlevel 1 (
    echo  Found: FFmpeg already installed.
    goto :ffmpeg_done
)

:: winget is available on Windows 11 by default. Try it first.
:: NOTE: winget for Gyan.FFmpeg has a known bug where it sets PATH to the
:: package root instead of the \bin subfolder. We detect and fix this below.
echo  FFmpeg not found. Trying winget...
winget install --id Gyan.FFmpeg -e --silent --accept-package-agreements --accept-source-agreements >nul 2>&1

:: Give winget a moment to finish writing to the registry
timeout /t 3 /nobreak >nul 2>&1

:: winget PATH bug workaround: find the actual ffmpeg.exe under the winget packages dir
:: and prepend the correct \bin folder ourselves.
set "WGPKG=%LOCALAPPDATA%\Microsoft\WinGet\Packages"
if exist "%WGPKG%" (
    for /r "%WGPKG%" %%F in (ffmpeg.exe) do (
        set "FFMPEG_BIN=%%~dpF"
    )
)
if defined FFMPEG_BIN (
    set "PATH=!FFMPEG_BIN!;%PATH%"
)

ffmpeg -version >nul 2>&1
if not errorlevel 1 (
    echo  FFmpeg installed via winget OK.
    :: winget's own PATH registration isn't reliably visible to future
    :: sessions (same underlying issue as the Python step above) — persist
    :: the real \bin folder we just found ourselves rather than trusting it.
    if defined FFMPEG_BIN setx PATH "!FFMPEG_BIN!;%PATH%" >nul 2>&1
    goto :ffmpeg_done
)

:: winget failed or PATH still not right — download directly from BtbN builds.
echo  winget did not work. Downloading FFmpeg directly...
powershell -Command ^
    "$url='https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';" ^
    "Invoke-WebRequest -Uri $url -OutFile '%TEMP%\ffmpeg.zip' -UseBasicParsing"

echo  Extracting FFmpeg...
powershell -Command "Expand-Archive '%TEMP%\ffmpeg.zip' -DestinationPath '%~dp0ffmpeg_tmp' -Force"
del "%TEMP%\ffmpeg.zip" >nul 2>&1

:: Move the bin folder next to this script
for /d %%D in ("%~dp0ffmpeg_tmp\ffmpeg-*") do (
    if exist "%%D\bin\ffmpeg.exe" (
        xcopy "%%D\bin" "%~dp0ffmpeg\bin\" /E /I /Q >nul
    )
)
rmdir /s /q "%~dp0ffmpeg_tmp" >nul 2>&1

:: Add the local ffmpeg\bin to PATH for this session and permanently for the user
set "PATH=%~dp0ffmpeg\bin;%PATH%"
setx PATH "%~dp0ffmpeg\bin;%PATH%" >nul 2>&1

ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ERROR: FFmpeg install failed.
    echo  Please install manually: https://ffmpeg.org/download.html
    echo  Extract it, put the \bin folder somewhere, and add it to your PATH.
    pause & exit /b 1
)
echo  FFmpeg installed from direct download OK.

:ffmpeg_done

:: ── 3. PYTHON PACKAGES ───────────────────────────────────────────────────────
echo.
echo  [3/4] Installing Python packages (Flask + yt-dlp)...
python -m pip install --upgrade pip --quiet
python -m pip install flask yt-dlp --quiet
if errorlevel 1 (
    echo  ERROR: Package install failed.
    echo  Try running: python -m pip install flask yt-dlp
    pause & exit /b 1
)
echo  Packages installed OK.

:: ── 4. DENO ──────────────────────────────────────────────────────────────────
:: YouTube now requires solving a proof-of-origin challenge before it will
:: hand over actual video data — yt-dlp needs an external JS runtime to do
:: that (Deno is the one it looks for automatically, zero config, if it's
:: anywhere on PATH). Without it, YouTube fetches fail with a plain
:: "HTTP Error 403: Forbidden" while every other site keeps working fine,
:: which is exactly what makes it so easy to miss on a dev machine that
:: already happens to have Deno/Node installed for other reasons.
echo.
echo  [4/4] Checking Deno (needed by yt-dlp for YouTube downloads)...
deno --version >nul 2>&1
if not errorlevel 1 (
    echo  Found: Deno already installed.
    goto :deno_done
)

echo  Deno not found. Trying winget...
winget install --id DenoLand.Deno -e --silent --accept-package-agreements --accept-source-agreements >nul 2>&1
timeout /t 3 /nobreak >nul 2>&1

:: Same winget PATH quirk as FFmpeg above — locate deno.exe under the winget
:: packages dir and prepend its folder ourselves for this session.
set "DENO_BIN="
set "WGPKG=%LOCALAPPDATA%\Microsoft\WinGet\Packages"
if exist "%WGPKG%" (
    for /r "%WGPKG%" %%F in (deno.exe) do (
        set "DENO_BIN=%%~dpF"
    )
)
if defined DENO_BIN (
    set "PATH=!DENO_BIN!;%PATH%"
)

deno --version >nul 2>&1
if not errorlevel 1 (
    echo  Deno installed via winget OK.
    if defined DENO_BIN setx PATH "!DENO_BIN!;%PATH%" >nul 2>&1
    goto :deno_done
)

:: winget failed or isn't available — fall back to Deno's own installer script.
echo  winget did not work. Installing Deno directly...
powershell -Command "irm https://deno.land/install.ps1 | iex" >nul 2>&1
set "PATH=%USERPROFILE%\.deno\bin;%PATH%"

deno --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  WARNING: Could not install Deno automatically. YouTube downloads
    echo  will fail with "HTTP Error 403: Forbidden" until this is fixed —
    echo  every other site SQUEEZE supports will still work fine in the
    echo  meantime. To fix it manually: install from https://deno.com then
    echo  re-run this script.
    timeout /t 5 /nobreak >nul 2>&1
    goto :deno_done
)
echo  Deno installed OK.

:deno_done

:: ── DESKTOP SHORTCUT ─────────────────────────────────────────────────────────
:: Create it here rather than making the user run CREATE_SHORTCUT.bat
:: separately afterward. That matters because this whole script runs
:: elevated (UAC) — a fresh Python install's PATH update doesn't reliably
:: reach a brand new, non-elevated process until the next logon/reboot, so
:: CREATE_SHORTCUT.bat run on its own right after a first-time install can
:: fail with "Could not find pythonw.exe" even though Python is right there.
:: Doing it in THIS process sidesteps that entirely, since PATH here is
:: already correct from the Python step above.
echo.
echo  Creating desktop shortcut...
set "PYTHONW="
for /f "tokens=*" %%P in ('python -c "import sys,os; print(os.path.join(os.path.dirname(sys.executable),'pythonw.exe'))" 2^>nul') do set "PYTHONW=%%P"
if defined PYTHONW if not exist "!PYTHONW!" set "PYTHONW="
if not defined PYTHONW (
    for /f "tokens=*" %%P in ('where pythonw 2^>nul') do if not defined PYTHONW set "PYTHONW=%%P"
)
if defined PYTHONW (
    set "DESKTOP_DIR="
    for /f "tokens=*" %%D in ('powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')" 2^>nul') do set "DESKTOP_DIR=%%D"
    if not defined DESKTOP_DIR set "DESKTOP_DIR=%USERPROFILE%\Desktop"
    set "SHORTCUT=!DESKTOP_DIR!\SQUEEZE.lnk"
    set "ICON=%~dp0squeeze_lemon.ico"
    set "ARGS=%~dp0launcher.pyw"
    set "WORKDIR=%~dp0"
    powershell -Command "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut('!SHORTCUT!'); $s.TargetPath='!PYTHONW!'; $s.Arguments='\"!ARGS!\"'; $s.WorkingDirectory='!WORKDIR!'; $s.IconLocation='!ICON!'; $s.Description='SQUEEZE — Copyright Evidence Tool'; $s.Save()"
    if exist "!SHORTCUT!" (
        echo  Desktop shortcut created.
    ) else (
        echo  Could not create the desktop shortcut automatically — run
        echo  CREATE_SHORTCUT.bat manually if you want one.
    )
) else (
    echo  Could not locate pythonw.exe to create a shortcut — run
    echo  CREATE_SHORTCUT.bat manually later if you want one.
)

:: ── DONE ─────────────────────────────────────────────────────────────────────
echo.
echo  ============================================================
echo   Setup complete! Launching SQUEEZE now...
echo  ============================================================
echo.

cd /d "%~dp0"
python squeeze.py
pause
