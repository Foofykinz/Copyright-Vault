#!/bin/bash
# SQUEEZE GPU — First Time Setup (macOS)
cd "$(dirname "$0")" || exit 1

# ── Native dialog helpers (so this doesn't feel like a raw terminal dump) ──────
notify() {
    osascript -e "display dialog \"$1\" with title \"SQUEEZE Setup\" buttons {\"OK\"} default button \"OK\"" >/dev/null 2>&1
}
fail() {
    osascript -e "display dialog \"$1\" with title \"SQUEEZE Setup — Problem\" buttons {\"OK\"} default button \"OK\" with icon caution" >/dev/null 2>&1
    echo
    echo "  ERROR: $1"
    read -r -p "Press Enter to close this window..."
    exit 1
}

echo
echo "============================================================"
echo "  SQUEEZE GPU — First Time Setup (macOS)"
echo "============================================================"
echo

# ── 1. Homebrew ────────────────────────────────────────────────────────────────
echo "[1/3] Checking Homebrew..."
if ! command -v brew >/dev/null 2>&1; then
    notify "SQUEEZE needs a few things installed first: Homebrew, Python, and FFmpeg.\n\nThis window will ask for your Mac login password (you won't see it as you type — that's normal). A separate Apple installer for 'Command Line Tools' may also pop up; just let it finish, it can take a few minutes.\n\nClick OK to begin — this can take 5-10 minutes."
    echo "  Homebrew not found. Installing..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Apple Silicon Homebrew lives in /opt/homebrew, Intel in /usr/local
    if [ -x /opt/homebrew/bin/brew ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [ -x /usr/local/bin/brew ]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
fi
if ! command -v brew >/dev/null 2>&1; then
    fail "Homebrew install failed. Install it manually from https://brew.sh, then double-click INSTALL.command again."
fi
echo "  Found: $(brew --version | head -1)"

# ── 2. Python 3 (with tkinter, needed for the folder picker) ──────────────────
echo
echo "[2/3] Checking Python 3..."
if ! command -v python3 >/dev/null 2>&1; then
    echo "  Python3 not found. Installing via Homebrew..."
    brew install python-tk
else
    echo "  Found: $(python3 --version)"
fi

python3 -c "import tkinter" >/dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "  tkinter not available — installing python-tk via Homebrew..."
    brew install python-tk
    python3 -c "import tkinter" >/dev/null 2>&1
    if [ $? -ne 0 ]; then
        fail "tkinter still isn't available. Open Terminal and run: brew install python-tk"
    fi
fi

# ── 3. FFmpeg ──────────────────────────────────────────────────────────────────
echo
echo "[3/3] Checking FFmpeg..."
if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "  FFmpeg not found. Installing via Homebrew..."
    brew install ffmpeg
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
    fail "FFmpeg install failed. Open Terminal and run: brew install ffmpeg"
fi
echo "  Found: $(ffmpeg -version | head -1)"

# ── 4. Python packages ─────────────────────────────────────────────────────────
echo
echo "Installing Python packages (Flask + yt-dlp)..."
python3 -m pip install --upgrade pip --quiet
python3 -m pip install flask yt-dlp --quiet
if [ $? -ne 0 ]; then
    fail "Package install failed. Open Terminal and run: python3 -m pip install flask yt-dlp"
fi
echo "  Packages installed OK."

echo
echo "============================================================"
echo "  Setup complete! Launching SQUEEZE now..."
echo "============================================================"
echo

notify "Setup complete! Click OK, then SQUEEZE will start and open in your browser.\n\nLeave the black Terminal window open while you use SQUEEZE — closing it will stop the app. Next time, just double-click LAUNCH.command (or the SQUEEZE shortcut if you made one)."

python3 squeeze.py
read -r -p "Press Enter to close this window..."
