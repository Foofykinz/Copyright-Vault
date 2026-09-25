"""
SQUEEZE launcher — double-click to run.
.pyw extension = Python runs with no console window on Windows.
Starts squeeze.py in the background and opens the browser.
"""
import subprocess, sys, os, time, webbrowser, threading
from pathlib import Path

HERE = Path(__file__).parent

# Make sure squeeze.py exists next to this launcher
squeeze = HERE / "squeeze.py"
if not squeeze.exists():
    import tkinter as tk
    from tkinter import messagebox
    root = tk.Tk(); root.withdraw()
    messagebox.showerror("SQUEEZE", "squeeze.py not found!\nMake sure launcher.pyw is in the same folder as squeeze.py.")
    sys.exit(1)

# Launch squeeze.py using pythonw (no console) — same Python that's running this.
# pythonw.exe only exists on Windows; macOS/Linux just use the running interpreter.
if sys.platform == "win32":
    pythonw = Path(sys.executable).parent / "pythonw.exe"
    if not pythonw.exists():
        pythonw = sys.executable  # fallback
else:
    pythonw = sys.executable

proc = subprocess.Popen(
    [str(pythonw), str(squeeze)],
    cwd=str(HERE),
    creationflags=0x08000000 if sys.platform == "win32" else 0,  # CREATE_NO_WINDOW
)

# Open browser after a short delay so Flask has time to start.
# --no-browser is passed by the self-updater when it restarts Squeeze: the browser tab is
# still open from before and reloads itself, so opening another one would just be a duplicate.
# SQUEEZE_PORT mirrors squeeze.py's override (default 7842) so a test copy can run beside a real one.
PORT = int(os.environ.get("SQUEEZE_PORT", "7842"))

def open_browser():
    time.sleep(2.2)
    webbrowser.open(f"http://localhost:{PORT}")

if "--no-browser" not in sys.argv:
    threading.Thread(target=open_browser, daemon=True).start()

# Keep this process alive so double-clicking the icon keeps working
proc.wait()
