# Viral DRM Collector (browser extension)

Collects a client's own videos from TikTok and X and sends them to the Viral DRM web app. This is
the piece the web app's "Pull recent videos" button was waiting on.

## What it does and doesn't do

- **TikTok**: reads the structured data TikTok embeds in the page for a profile's own "Videos" tab
  (not the separate "Reposts" tab, so reposts are excluded by construction). Gives real caption,
  publish date, and view count.
- **X**: reads whatever tweets are currently rendered on a profile/timeline page. Skips reposts and
  quote-tweet embeds, and only keeps tweets that contain a video. Caption and date are reliable;
  view count is best-effort (X doesn't always expose it in a stable way).
- **Instagram / Facebook**: not implemented yet — both platforms' web apps are the most obfuscated
  and change the most often, so a scraper for them needs more dedicated upkeep than the other two.
  Keep using manual entry for these until a later pass adds them.
- Nothing is sent automatically. Every scan populates a review list with checkboxes — you pick
  what actually gets sent.
- X only renders tweets currently scrolled into view, so scan, scroll down, and scan again to pick
  up more from a long profile — results accumulate until you send them.
- The UI is a **side panel**, not a popup — it stays open and docked while you scroll and interact
  with the page, and your selections/scan results survive if it does get closed.

## Setup

1. **Get a YouTube API key** — not needed for this extension; that's only used by the web app's
   own auto-fill. Skip.
2. **Set an extension API token** on the Worker, if you haven't already:
   ```
   npx wrangler secret put EXTENSION_API_TOKEN
   ```
   Pick any long random string — you'll paste the same value into the extension's settings.
3. **Build the extension**:
   ```
   cd extension
   npm install
   npm run build
   ```
   This produces `extension/dist/`.
4. **Load it in Chrome/Edge**:
   - Go to `chrome://extensions` (or `edge://extensions`)
   - Enable "Developer mode"
   - Click "Load unpacked" and select `extension/dist`
5. **Pin the icon**: click the puzzle-piece icon 🧩 in the toolbar, find "Viral DRM Collector", and
   click its pin so it shows directly in the toolbar instead of being buried in that menu.
6. **Connect it**: click the extension's toolbar icon — this opens the side panel on the right side
   of the browser window (not a dropdown popup). In Settings enter:
   - API base URL — your Worker's URL, e.g. `https://viral-drm.yourname.workers.dev`
   - Extension API token — the same value you set in step 2
   - Click Connect. The browser will ask you to confirm permission to talk to that URL — accept it.

## Using it

1. Open a client's TikTok profile (`tiktok.com/@handle`) or X profile (`x.com/handle`).
2. Click the extension icon to open the side panel (or it may already be open from before — it
   stays docked across page navigation). Pick the Client and Social Account (auto-filtered to the
   matching platform when possible).
3. Click "Scan this page". Review the videos found — uncheck anything that shouldn't be sent.
4. Click "Send N selected". Sent videos disappear from the list; anything that failed stays so you
   can retry.
5. On TikTok, scroll down to load more videos and scan again before sending if you want the whole
   history in one pass. The side panel stays open while you scroll, unlike a popup would.

## Rebuilding after changes

```
npm run build     # one-off build
npm run watch     # rebuild on save; reload the unpacked extension in the browser to pick it up
```

## Known fragility

TikTok's and X's page structure isn't a public API — both companies can and do change their
frontend without notice, which will break the corresponding content script. If a scan stops
finding videos, that's the most likely reason; the parsing logic in
`src/content/tiktok.ts` and `src/content/x.ts` will need updating to match whatever the page
looks like at that point.
