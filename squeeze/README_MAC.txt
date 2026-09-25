SQUEEZE — Mac Setup Instructions
=================================

FIRST TIME ONLY:

0. If double-clicking "INSTALL.command" does nothing, or opens it in a text
   editor instead of running it, the "allow this to run" setting got lost
   when the folder was copied over from Windows. Fix it once with:
     - Open the "Terminal" app (Cmd+Space, type Terminal, press Return)
     - Type: cd  (with a space after it), then drag the SQUEEZE folder
       into the Terminal window, then press Return
     - Type this exactly, then press Return:
         chmod +x INSTALL.command LAUNCH.command CREATE_SHORTCUT.command
     - Now double-click "INSTALL.command" again — it'll work this time.

1. Double-click "INSTALL.command"

   - macOS will probably block it with a message like "cannot be opened
     because it is from an unidentified developer." That's normal for any
     script that didn't come from the App Store.
     To get past it: right-click (or Control-click) "INSTALL.command" and
     choose "Open", then click "Open" again in the dialog that appears.
     You only need to do this once.

   - A black Terminal window will open and start installing things
     (Homebrew, Python, and FFmpeg). This can take 5-10 minutes the first
     time. It will ask for your Mac login password at one point — type it
     and press Return (you won't see the letters appear, that's normal).

   - A separate Apple window may pop up about installing "Command Line
     Tools" — just let it run, it can take a few minutes on its own.

   - When it's done, a popup will say "Setup complete!" and SQUEEZE will
     open automatically in your web browser.

2. (Optional but recommended) Double-click "CREATE_SHORTCUT.command"

   - IMPORTANT: approving INSTALL.command in step 1 does NOT approve this
     file — every ".command" file needs its own one-time approval. If it's
     blocked, use the same right-click-then-Open trick as step 1.
   - This adds a SQUEEZE icon to your Desktop so you never need to touch
     Terminal or these ".command" files again.
   - The very first time you double-click the new SQUEEZE Desktop icon,
     macOS may block it too — right-click it, choose "Open", once.

3. The first time you click "Choose Folder" (Export, or Batch Download),
   macOS may show a permission popup asking to let SQUEEZE/Terminal
   control "System Events". Click OK/Allow — this is what lets the folder
   picker window pop to the front instead of getting stuck behind other
   windows. You only need to approve this once.

EVERY TIME AFTER THAT:

   - Just double-click the SQUEEZE icon on your Desktop (from step 2).
   - Or, if you skipped step 2, double-click "LAUNCH.command" instead —
     remember it needs its own one-time right-click-then-Open approval too,
     separate from INSTALL.command (see step 2's note above).
   - Leave the black window (if one appears) open while you use SQUEEZE —
     closing it stops the app. Closing the browser tab is fine; SQUEEZE
     shuts itself down automatically a few minutes later.

IF SOMETHING GOES WRONG:

   - Re-run "INSTALL.command" — it's safe to run again any time.
   - Make sure you're connected to the internet (needed for installing
     Homebrew/FFmpeg the first time, and for downloading videos).
   - "Choose Folder" opens but nothing happens when you pick a folder:
     this almost always means the picker window opened behind another
     window instead of coming to the front. Look for a bouncing Python
     icon in the Dock and click it to bring the picker forward before
     choosing a folder. If you're repeatedly asked to approve "System
     Events" control, check System Settings > Privacy & Security >
     Automation and make sure Terminal/Python is allowed there.
   - A ".command" file seems blocked but you're sure you already
     approved it: check System Settings > Privacy & Security — there's
     often an "Open Anyway" button there for the specific blocked file,
     which works as an alternative to the right-click-then-Open trick.
