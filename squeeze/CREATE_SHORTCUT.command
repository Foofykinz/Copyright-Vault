#!/bin/bash
# SQUEEZE — Create Desktop Shortcut (macOS)
# Builds a double-clickable SQUEEZE.app on the Desktop that starts the server
# in the background with no visible Terminal window (mirrors the Windows
# .lnk shortcut built by CREATE_SHORTCUT.bat).
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"

echo
echo "  Creating SQUEEZE desktop shortcut..."
echo

if ! command -v python3 >/dev/null 2>&1; then
    echo "  Python3 not found — run INSTALL.command first."
    read -r -p "Press Enter to exit..."
    exit 1
fi

APP="$HOME/Desktop/SQUEEZE.app"
ICNS="$HERE/squeeze_lemon.icns"

# ── Build a .icns icon from lemon_preview.png (if not already built) ──────────
if [ ! -f "$ICNS" ] && [ -f "$HERE/lemon_preview.png" ]; then
    ICONSET="$HERE/squeeze_lemon.iconset"
    mkdir -p "$ICONSET"
    for size in 16 32 128 256 512; do
        sips -z "$size" "$size" "$HERE/lemon_preview.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null 2>&1
        double=$((size * 2))
        sips -z "$double" "$double" "$HERE/lemon_preview.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null 2>&1
    done
    iconutil -c icns "$ICONSET" -o "$ICNS" 2>/dev/null
    rm -rf "$ICONSET"
fi

# ── Compile an AppleScript app that launches SQUEEZE silently in the background ─
SCRIPT_FILE=$(mktemp /tmp/squeeze_launch.XXXXXX.applescript)
cat > "$SCRIPT_FILE" <<EOF
do shell script "cd " & quoted form of "$HERE" & " && nohup python3 launcher.pyw > /tmp/squeeze_launch.log 2>&1 &"
EOF

rm -rf "$APP"
osacompile -o "$APP" "$SCRIPT_FILE"
rm -f "$SCRIPT_FILE"

if [ -f "$ICNS" ] && [ -d "$APP" ]; then
    cp "$ICNS" "$APP/Contents/Resources/applet.icns"
fi

if [ -d "$APP" ]; then
    echo "  Shortcut created on your Desktop: SQUEEZE.app"
    echo "  Just double-click SQUEEZE to launch it."
    echo
    echo "  NOTE: the first time you open it, macOS Gatekeeper may warn that"
    echo "  it's from an unidentified developer — right-click the app and"
    echo "  choose Open once to approve it."
    osascript -e 'display dialog "A SQUEEZE icon was added to your Desktop.\n\nFrom now on, just double-click it to launch SQUEEZE — no Terminal needed.\n\nThe very first time you open it, macOS may say it'"'"'s from an unidentified developer. If so, right-click the icon and choose Open once to approve it." with title "SQUEEZE" buttons {"OK"} default button "OK"' >/dev/null 2>&1
else
    echo "  Hmm, something went wrong creating the shortcut."
    osascript -e 'display dialog "Something went wrong creating the shortcut. Check the Terminal window for details." with title "SQUEEZE" buttons {"OK"} default button "OK" with icon caution' >/dev/null 2>&1
fi
echo
read -r -p "Press Enter to exit..."
