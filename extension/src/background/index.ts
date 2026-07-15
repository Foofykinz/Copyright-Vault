// Makes clicking the toolbar icon open the side panel (which stays open while the user scrolls
// and interacts with the page) instead of a transient popup, which Chrome tears down — along with
// all its in-memory state — the instant it loses focus.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => console.error(err));
