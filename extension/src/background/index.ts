import { QUICK_CAPTURE_AND_SEND_MESSAGE } from "../lib/rights-manager-scraped";

// Makes clicking the toolbar icon open the side panel (which stays open while the user scrolls
// and interacts with the page) instead of a transient popup, which Chrome tears down — along with
// all its in-memory state — the instant it loses focus.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => console.error(err));

const QUICK_CAPTURE_COMMAND = "quick-capture-and-send";

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== QUICK_CAPTURE_COMMAND) return;
  if (!tab?.id || tab.windowId === undefined) return;

  // Harmless no-op if the panel's already open (the common case -- it's meant to stay open across
  // navigation), and required if it isn't.
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (err) {
    console.error("[viral-drm] Quick-capture shortcut: couldn't open the side panel.", err);
    return;
  }

  // The panel's own script needs to have registered its message listener before this can be
  // delivered -- a no-op delay when it was already open (first attempt succeeds immediately), but
  // opening it fresh takes a moment to load. Retries rather than a single fire-and-forget send, so
  // a shortcut press right after the panel was closed doesn't just silently do nothing.
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await chrome.runtime.sendMessage({ type: QUICK_CAPTURE_AND_SEND_MESSAGE });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  console.error("[viral-drm] Quick-capture shortcut: the side panel never became ready to receive it.");
});
