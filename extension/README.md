# Viral DRM Collector (browser extension)

Collects a client's own videos from TikTok, X, Facebook, and Instagram and sends them to the Viral
DRM web app. This is the piece the web app's "Pull recent videos" button was waiting on.

## What it does and doesn't do

- **TikTok**: intercepts the internal API response TikTok's own page uses to render the "Videos"
  tab (not the separate "Reposts" tab, so reposts are excluded by construction), rather than
  reading embedded page data — TikTok no longer server-renders the video list at all, it's fetched
  client-side. Gives real caption, publish date, and view count. **Refresh the TikTok tab after
  installing/updating the extension** so the interceptor is in place before the page's own first
  request fires — it won't see anything from before it loaded.
- **X**: reads tweets from the DOM (no clean internal endpoint like TikTok/Facebook have) — but
  since X virtualizes its timeline and unmounts tweets scrolled far out of view, it polls the page
  continuously in the background and keeps a running list of everything ever seen, rather than
  only capturing whatever's on screen the instant you click Scan. Just scroll straight through and
  scan once at the end. Skips reposts and quote-tweet embeds, and only keeps tweets with a video.
  Caption and date are reliable; view count is best-effort (X doesn't always expose it in a stable
  way).
- **Facebook**: intercepts the GraphQL response Facebook's page uses to render a profile/Page
  timeline (`timeline_list_feed_units`), same technique as TikTok. Gives real caption and publish
  date. View count isn't in this response at all (not a bug — Facebook's feed query just doesn't
  carry it), so it stays manual, same as X. Shares/reposts are excluded automatically via
  Facebook's own `attached_story` field, which is only populated when a Story wraps someone else's
  post rather than being an original one. **Refresh the Facebook tab after installing/updating the
  extension**, same reason as TikTok — the interceptor only sees requests made after it loads.
- **Instagram**: intercepts the GraphQL response Instagram's page uses to render a profile timeline
  (`xdt_api__v1__feed__user_timeline_graphql_connection`), same technique as Facebook, but searches
  the whole response for anything shaped like a Relay connection (`{ edges, page_info }`) rather
  than one fixed field name, since different query variants (initial load vs. pagination) are
  likely to use different names for it — the same gap that initially made Facebook miss
  scroll-triggered content. Gives real caption and publish date. View count is present in the
  schema but not populated by this query, so it stays manual. **Collab posts count as the
  profile's own** if the profile is listed as either the primary `user` or a coauthor — Instagram
  posts co-authored between two accounts show up on both profiles' timelines. Videos inside
  carousels (mixed photo/video posts) are extracted too, but share the parent post's single
  permalink and caption — Instagram doesn't expose a distinct URL per carousel item, so if a
  carousel contains more than one video, only the first one sent will actually get stored (the
  rest will look like duplicates of it to the dedup check). **Refresh the Instagram tab after
  installing/updating the extension**, same reason as TikTok/Facebook.
- Nothing is sent automatically. Every scan populates a review list with checkboxes — you pick
  what actually gets sent.
- The UI is a **side panel**, not a popup — it stays open and docked while you scroll and interact
  with the page, and your selections/scan results survive if it does get closed.
- **Deduplication is enforced server-side** (by social account + video URL), not just in the
  extension's UI — the same video can never be inserted twice no matter how many times it's
  scanned or sent, even across different sessions or people. The extension also pre-filters
  already-imported videos out of the review list so you're not re-reviewing things you already have.
- **Date filtering**: choose "Since last pull" (only videos published after that account's last
  successful send) or a custom date range (e.g. `06/01/2026`–`06/30/2026` to backfill a specific
  month). This only changes what's shown/sendable from what's already been scanned — it doesn't
  change what the scan itself picks up off the page.

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

1. Open a client's TikTok profile (`tiktok.com/@handle`), X profile (`x.com/handle`), Facebook
   page/profile, or Instagram profile.
2. Click the extension icon to open the side panel (or it may already be open from before — it
   stays docked across page navigation). Pick the Client and Social Account (auto-filtered to the
   matching platform when possible).
3. Pick a date mode — "Since last pull" for routine incremental pulls, or "Custom date range" to
   backfill a specific window (e.g. all of June: `2026-06-01` to `2026-06-30`).
4. Click "Scan this page". Review the videos found — uncheck anything that shouldn't be sent.
   Already-imported videos are automatically excluded; videos outside the current date filter are
   captured but hidden until the filter covers them.
5. Click "Send N selected". Sent videos disappear from the list; anything that failed stays so you
   can retry.
6. Scroll down to load more of the profile's history before sending if you want the whole thing in
   one pass. On TikTok, Facebook, and Instagram that means scan again after scrolling; on X,
   capture happens continuously in the background, so you can scroll straight through and scan
   once at the end. The side panel stays open while you scroll, unlike a popup would.

## Rebuilding after changes

```
npm run build     # one-off build
npm run watch     # rebuild on save; reload the unpacked extension in the browser to pick it up
```

## Known fragility

None of these platforms' page structures or internal API response shapes are public or stable —
TikTok, X, and Meta can all change them without notice, which will break the corresponding content
script. If a scan stops finding videos, that's the most likely reason; the parsing logic in
`src/content/tiktok-network.ts` (TikTok's `/api/post/item_list` response shape),
`src/content/tiktok.ts`, `src/content/x.ts`, `src/content/facebook-network.ts` (Facebook's
`timeline_list_feed_units` response shape), `src/content/facebook.ts`,
`src/content/instagram-network.ts` (Instagram's `xdt_api__v1__feed__user_timeline_graphql_connection`
response shape), and `src/content/instagram.ts` will need updating to match whatever the platform
looks like at that point.
