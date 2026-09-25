#!/bin/bash
# SQUEEZE GPU — Copyright Evidence Tool (macOS launcher)
cd "$(dirname "$0")" || exit 1

fail() {
    osascript -e "display dialog \"$1\" with title \"SQUEEZE\" buttons {\"OK\"} default button \"OK\" with icon caution" >/dev/null 2>&1
    echo "  $1"
    read -r -p "Press Enter to close this window..."
    exit 1
}

if ! command -v python3 >/dev/null 2>&1; then
    fail "Run INSTALL.command first (double-click it) — Python isn't set up yet."
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
    fail "Run INSTALL.command first (double-click it) — FFmpeg isn't set up yet."
fi

python3 squeeze.py
read -r -p "Press Enter to close this window..."
