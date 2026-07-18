# Baseline behavior (pre-hardening)

Documents current, working behavior as of commit-tag `pre-hardening-baseline`, before the Phase 1
security hardening changes (fail-closed auth, debug-global removal, message-relay nonce, folders-
in-response fix). Use this as the reference to compare against after each change — if any of these
stop being true, something regressed.

There is no automated test suite in this project yet. These are manual test cases; `npm run build`
and `npm run typecheck` (both projects) are the only automated checks currently available.

## Authentication (current, pre-hardening)

- `EXTENSION_API_TOKEN` is **not currently set** as a production secret (confirmed via
  `wrangler secret list`, 2026-07-19). `requireBearerToken()` fails open when the secret is unset —
  meaning `/api/extension/videos` and `/api/youtube/channel-videos` currently accept **any**
  request, with or without an `Authorization` header, with or without a matching token.
- The extension's own Settings screen has an "Extension API token" field, but whatever value is
  stored there is not currently being enforced server-side at all.

## TikTok scan

- Open `tiktok.com/@handle`, scroll to load videos, click "Scan this page."
- Captures items via the `/api/post/item_list` interceptor (`content-tiktok-network.js`, MAIN
  world) → relayed to `content-tiktok.js` (isolated world) via `window.postMessage`.
- Only items whose `item.author.uniqueId` (normalized: strip leading `@`, lowercase) matches the
  current page's handle are included — verified both at capture time and again in `scan()`.
- Switching to a different TikTok profile (SPA navigation, no reload) clears previously captured
  items — a scan afterward only reflects the new profile.
- Gives real caption (from `desc`), publish date (`createTime`), and view count (`stats.playCount`).

## X (Twitter) scan

- Open `x.com/handle`, scroll through the profile, click "Scan this page" once at the end (capture
  is continuous in the background via DOM polling, no network interception).
- Only captures while the current URL matches a recognized profile route
  (`/handle`, `/handle/with_replies`, `/handle/media`, `/handle/likes`) — capturing is fully
  disabled elsewhere on x.com (home feed, search, individual status pages, etc.).
- Skips reposts (`socialContext` text matching "repost") and nested quote-tweet embeds (a video
  only counts as the tweet's own if it isn't nested inside an embedded quoted sub-article).
- Tweet author must match the current profile handle, checked both at capture time and again in
  `scan()`.
- Switching profiles clears previously captured tweets.
- Caption and date are reliable; view count is best-effort, parsed from the analytics link if present.

## Facebook scan

- Open a Facebook profile/Page, scroll, click "Scan this page."
- Captures Story-shaped nodes from `/api/graphql/` responses (`content-facebook-network.js`, MAIN
  world) → relayed to `content-facebook.js` (isolated world).
- Only captures while on a recognized profile/Page route — refuses to accumulate on non-profile
  Facebook pages (home feed, watch, groups, etc.).
- Each Story's ownership is verified via its `actors` field (numeric ID match, or the actor's own
  permalink resolving to the current profile's handle) — never by display name. A Story whose
  ownership can't be established is excluded, not assumed.
- Shares/reposts excluded via the `attached_story` field (populated only when a Story wraps someone
  else's post).
- Switching profiles/Pages clears previously captured Stories.
- Gives real caption and publish date. View count stays manual (not present in this response).

## Instagram scan

- Open an Instagram profile, scroll, click "Scan this page."
- Captures Relay-connection-shaped data from `/graphql/query` responses (`content-instagram-network.js`,
  MAIN world) → relayed to `content-instagram.js` (isolated world).
- Only accumulates while on a recognized profile route; refuses to accumulate elsewhere.
- A post counts as the profile's own if the profile is listed as the primary `user` or a coauthor.
- Videos inside carousels are extracted individually; they share the parent post's permalink/caption.
- After scan, a separate enrichment pass fetches `/api/v1/media/<pk>/info/` for date-filtered videos
  without a view count yet (up to 3 concurrent requests, cached by pk, no automatic retry on
  failure — a failed lookup just leaves that video's count blank).
- Switching profiles clears previously captured posts.

## YouTube scan

- Account-driven, not tab-driven: select the client + YouTube social account in the side panel,
  pick a date range, click "Scan channel" — works regardless of which tab is active.
- Calls `POST /api/youtube/channel-videos` (official Data API only — `channels.list` →
  `playlistItems.list` → `videos.list`).
- Every video is classified as exactly one of Short / Live / Regular Upload (live signals take
  precedence, then confirmed-Shorts-ID membership, else upload).
- Results render as three separate, counted, select-all-able groups in the review list.
- A scan summary block shows channel title, date range, totals per category, and a classification-
  status line ("Complete" / "Older Shorts may appear under Regular Uploads" /
  "Shorts lookup failed; some Shorts may appear under Regular Uploads").
- Switching to a different social account clears previously scanned videos (`clearScanState()`),
  regardless of platform — this applies to all platforms, not just YouTube.
- Caption is sourced from the video's title (not description); `youtubeCategory` and `thumbnailUrl`
  are sent through to the backend on import and persisted.

## Sending selected videos (all platforms)

- Only videos passing the current date filter and individually checked are sent.
- Hard block if the selected account's platform doesn't match the active tab's detected platform —
  bypassed for YouTube (account-driven, not tab-driven).
- Soft block (profile-URL mismatch) requires an explicit checkbox acknowledgment before sending —
  also bypassed for YouTube.
- Each send is a `POST /api/extension/videos` call; duplicates (same `social_account_id` +
  `video_url`) are detected server-side and reported as `duplicate: true` rather than re-inserted.
- A successful send (new or duplicate) updates the social account's `last_pull_at`.
- A failed send leaves that video in the list so it can be retried; it does not block the rest of
  the batch.

## Backend: video-by-id endpoints (current, pre-fix)

- `GET /api/videos/:id` and `PATCH /api/videos/:id` currently **always return `folders: []`**,
  regardless of actual folder membership — hardcoded, not queried. This is a known bug being fixed
  in Phase 1 (item D). No caller currently relies on this field from these two endpoints directly
  (`VideoTableRow` always triggers a parent refetch via `onUpdated()` rather than using the PATCH
  response's `folders` value), so this hasn't caused a visible UI issue — but it needs to actually
  reflect real folder membership once fixed.
- The video list endpoint (`GET /api/social-accounts/:id/videos`) and combination-folder detail
  endpoint (`GET /api/combination-folders/:id`) both correctly compute real folder membership via
  a join — these are unaffected by the bug above and must remain unchanged.
