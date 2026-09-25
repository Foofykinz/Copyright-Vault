import type { Env } from "./env";
import { getClientOrThrow, getSocialAccountOrThrow, getVideoOrThrow } from "./db";
import { ValidationError } from "./http";
import { generateId, nowIso } from "./ids";
import { generateHunterQueries, normalizeSourceText } from "./hunterQueryPlanner";
import { searchYouTubeVideos, type YouTubeSearchResultItem } from "./hunterYoutubeSearch";
import { extractYouTubeVideoId, fetchVideoDetails, parseIsoDuration, YouTubeQuotaExceededError } from "./youtube";
import { scoreCandidate } from "./hunterScoring";
import { addCalendarDays, chronologyFromDates } from "../../shared/dates";
import { applyQuotaDelta, getOrCreateTodayQuota } from "./hunterQuota";
import {
  getClientYoutubeChannelIds,
  getHunterCandidate,
  getHunterChannelByYoutubeId,
  getHunterSourceSettings,
  getHunterYoutubeVideo,
  upsertHunterYoutubeVideo,
} from "./hunterDb";
import type { HunterCandidateWithVideo, HunterSearchRunDiagnostic, HuntSourceResult, HuntStatus } from "../../shared/types";

/**
 * search.list's publishedAfter is applied with a small lookback buffer BEFORE the source's own
 * publication date, rather than exactly at it. Using the exact source date as a hard floor would
 * mean YouTube never returns (and Hunter never sees) a candidate uploaded slightly before the source
 * -- directly contradicting the "do not automatically reject BEFORE SOURCE" requirement, since a
 * strict API-level filter discards them before chronology tracking ever gets a chance to run. The
 * buffer keeps the query's actual purpose (narrowing an otherwise unbounded search, not enforcing a
 * hard cutoff) while still surfacing a few genuinely-before-source candidates to be scored and
 * chronology-tagged rather than silently never fetched.
 */
const SOURCE_DATE_LOOKBACK_DAYS = 3;

const RESULTS_PER_QUERY = 20;

interface AccumulatedDiscovery {
  item: YouTubeSearchResultItem;
  queries: Set<string>;
}

/**
 * The end-to-end HUNT THIS SOURCE NOW pipeline: load one real Vault source, generate queries, search
 * YouTube, normalize + dedupe + score results, persist everything, and return a full diagnostic
 * response. This is the one place both the manual route (Phase 2) and the future scheduler
 * (Phase 4) call into, so the actual search/scoring/storage logic exists in exactly one place.
 */
export async function huntSource(db: D1Database, env: Env, videoId: string, userId: string): Promise<HuntSourceResult> {
  const video = await getVideoOrThrow(db, videoId);
  const client = await getClientOrThrow(db, video.clientId);
  const socialAccount = await getSocialAccountOrThrow(db, video.socialAccountId);

  const apiKey = env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new ValidationError("YOUTUBE_API_KEY is not configured on the server.", { apiKey: "missing" });
  }

  const originalText = video.caption ?? "";
  const { normalized } = normalizeSourceText(originalText);
  const name = client.name || socialAccount.accountName || null;
  const generatedQueries = generateHunterQueries({ normalizedText: normalized, name });

  // Not enough usable text to build even one meaningful query -- e.g. an empty/near-empty caption.
  // Caught here, before any YouTube API call is made, per the Source Validation requirement.
  if (generatedQueries.length === 0) {
    throw new ValidationError("INSUFFICIENT_SOURCE_METADATA", {
      sourceText: "not_enough_usable_text",
    });
  }

  const quotaBefore = await getOrCreateTodayQuota(db, env);
  let remainingSearchBudget = quotaBefore.searchCallsBudget - quotaBefore.searchCallsMade;

  const publishedAfter = (() => {
    try {
      const lookback = addCalendarDays(video.publicationDate, -SOURCE_DATE_LOOKBACK_DAYS);
      return `${lookback}T00:00:00Z`;
    } catch {
      return undefined; // malformed source date -- fall back to an unrestricted search rather than fail
    }
  })();

  const searchRuns: HunterSearchRunDiagnostic[] = [];
  const discovered = new Map<string, AccumulatedDiscovery>();
  let attempted = 0;
  let completed = 0;
  let failed = 0;
  let skippedDueToBudget = 0;
  let searchCallsMadeThisRun = 0;
  let apiErrorsThisRun = 0;
  let quotaExhaustedThisRun = false;
  let stopSearching = false;

  for (const gq of generatedQueries) {
    if (stopSearching || remainingSearchBudget <= 0) {
      searchRuns.push({
        query: gq.query,
        strategy: gq.strategy,
        attempted: false,
        succeeded: false,
        resultCount: null,
        uniqueCandidatesFromThisQuery: 0,
        error: null,
        skippedReason: "search_budget_exhausted",
      });
      skippedDueToBudget++;
      continue;
    }

    attempted++;
    const runId = generateId();
    const startedAt = nowIso();
    await db
      .prepare(
        `INSERT INTO hunter_search_runs (id, source_video_id, query, trigger, triggered_by_user_id, started_at, created_at)
         VALUES (?, ?, ?, 'manual', ?, ?, ?)`
      )
      .bind(runId, videoId, gq.query, userId, startedAt, startedAt)
      .run();

    try {
      const results = await searchYouTubeVideos({ query: gq.query, publishedAfter, maxResults: RESULTS_PER_QUERY }, apiKey);
      searchCallsMadeThisRun++;
      remainingSearchBudget--;
      completed++;

      let uniqueFromThisQuery = 0;
      for (const item of results) {
        const existing = discovered.get(item.videoId);
        if (existing) existing.queries.add(gq.query);
        else {
          discovered.set(item.videoId, { item, queries: new Set([gq.query]) });
          uniqueFromThisQuery++;
        }
      }

      await db
        .prepare(
          `UPDATE hunter_search_runs SET finished_at = ?, api_result_count = ?, unique_candidates_count = ?, duplicate_count = ? WHERE id = ?`
        )
        .bind(nowIso(), results.length, uniqueFromThisQuery, results.length - uniqueFromThisQuery, runId)
        .run();

      searchRuns.push({
        query: gq.query,
        strategy: gq.strategy,
        attempted: true,
        succeeded: true,
        resultCount: results.length,
        uniqueCandidatesFromThisQuery: uniqueFromThisQuery,
        error: null,
      });
    } catch (err) {
      // The network call itself was made even though it failed, so it still counts against the
      // search.list budget -- YouTube's own quota bucket doesn't refund failed calls either.
      searchCallsMadeThisRun++;
      remainingSearchBudget--;
      failed++;
      apiErrorsThisRun++;
      const message = err instanceof Error ? err.message : "Unknown search error.";

      await db.prepare(`UPDATE hunter_search_runs SET finished_at = ?, error = ? WHERE id = ?`).bind(nowIso(), message, runId).run();

      searchRuns.push({
        query: gq.query,
        strategy: gq.strategy,
        attempted: true,
        succeeded: false,
        resultCount: null,
        uniqueCandidatesFromThisQuery: 0,
        error: message,
      });

      // Only a genuine YouTube-reported quota exhaustion halts the whole Hunt -- any other single
      // query failure just fails that query and the loop continues to the next one.
      if (err instanceof YouTubeQuotaExceededError) {
        quotaExhaustedThisRun = true;
        stopSearching = true;
      }
    }
  }

  // ---- Metadata enrichment + candidate persistence ----

  const uniqueVideoIds = [...discovered.keys()];
  const candidateResults: HunterCandidateWithVideo[] = [];
  let newUniqueCandidatesCount = 0;
  let totalCandidateTouches = 0;
  let otherApiCallsMadeThisRun = 0;

  if (uniqueVideoIds.length > 0) {
    let rawDetails: any[] = [];
    try {
      rawDetails = await fetchVideoDetails(uniqueVideoIds, apiKey);
      otherApiCallsMadeThisRun += Math.ceil(uniqueVideoIds.length / 50);
    } catch {
      // Metadata enrichment failing shouldn't erase the search results themselves -- candidates
      // below fall back to the bare fields search.list already gave us.
      apiErrorsThisRun++;
    }

    const detailsById = new Map<string, any>();
    for (const raw of rawDetails) if (raw?.id) detailsById.set(raw.id, raw);

    const ownYoutubeVideoId = video.platform === "youtube" ? extractYouTubeVideoId(video.videoUrl) : null;
    const ownChannelIds = await getClientYoutubeChannelIds(db, video.clientId);
    const now = nowIso();
    const sentQueries = generatedQueries.map((q) => q.query);

    for (const youtubeVideoId of uniqueVideoIds) {
      const acc = discovered.get(youtubeVideoId)!;
      const raw = detailsById.get(youtubeVideoId);

      const title: string = raw?.snippet?.title ?? acc.item.title;
      const description: string | null = raw?.snippet?.description ?? null;
      const channelId: string | null = raw?.snippet?.channelId ?? acc.item.channelId ?? null;
      const channelTitle: string | null = raw?.snippet?.channelTitle ?? acc.item.channelTitle ?? null;
      const publishedAt: string | null = raw?.snippet?.publishedAt ?? acc.item.publishedAt ?? null;
      const viewCount: number | null = raw?.statistics?.viewCount !== undefined ? Number(raw.statistics.viewCount) : null;
      const thumbnails = raw?.snippet?.thumbnails ?? {};
      const thumbnailUrl: string | null = thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url ?? null;
      const durationSeconds = parseIsoDuration(raw?.contentDetails?.duration);
      const videoUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;

      await upsertHunterYoutubeVideo(
        db,
        { youtubeVideoId, title, description, channelId, channelTitle, publishedAt, viewCount, thumbnailUrl, durationSeconds, videoUrl },
        now
      );

      const channel = channelId ? await getHunterChannelByYoutubeId(db, channelId) : null;
      const { chronology, daysFromSource } = chronologyFromDates(video.publicationDate, publishedAt);
      const isSameVideo = ownYoutubeVideoId != null && youtubeVideoId === ownYoutubeVideoId;
      const isOwnChannel = !isSameVideo && channelId != null && ownChannelIds.has(channelId);
      const selfSourceKind: "same_video" | "same_channel" | null = isSameVideo ? "same_video" : isOwnChannel ? "same_channel" : null;
      const suppressedReason: HunterCandidateWithVideo["suppressedReason"] = selfSourceKind
        ? "self_source"
        : channel?.classification === "ALLOWLIST"
          ? "allowlisted_channel"
          : null;

      const existingCandidate = await getHunterCandidate(db, videoId, youtubeVideoId);
      const mergedQueries = new Set<string>(existingCandidate?.discoveryQueries ?? []);
      for (const q of acc.queries) mergedQueries.add(q);
      const discoveryQueries = [...mergedQueries];

      const { priority, priorityScore, priorityReasons } = scoreCandidate({
        sourceNormalizedText: normalized,
        sentQueries,
        candidateTitle: title,
        candidateDescription: description,
        chronology,
        daysFromSource,
        viewCount,
        discoveryQueryCount: discoveryQueries.length,
        channelClassification: channel?.classification ?? null,
        confirmedIncidentCount: channel?.confirmedIncidentCount ?? 0,
        selfSourceKind,
      });

      const reviewStatus = existingCandidate?.reviewStatus ?? "new";
      const reviewerNotes = existingCandidate?.reviewerNotes ?? null;
      const reviewedByUserId = existingCandidate?.reviewedByUserId ?? null;
      const reviewedAt = existingCandidate?.reviewedAt ?? null;
      const mediaComparisonStatus = existingCandidate?.mediaComparisonStatus ?? "NOT_RUN";

      let candidateId: string;
      let firstDiscoveredAt: string;
      let createdAt: string;
      const newlyDiscovered = !existingCandidate;

      if (existingCandidate) {
        candidateId = existingCandidate.id;
        firstDiscoveredAt = existingCandidate.firstDiscoveredAt;
        createdAt = existingCandidate.createdAt;
        // Never touches review_status/reviewer_notes/reviewed_by_user_id/reviewed_at -- rediscovery
        // must never overwrite a human's review decision.
        await db
          .prepare(
            `UPDATE hunter_candidates SET
               last_seen_at = ?, discovery_queries = ?, chronology = ?, priority = ?, priority_score = ?,
               priority_reasons = ?, suppressed_reason = ?, updated_at = ?
             WHERE id = ?`
          )
          .bind(now, JSON.stringify(discoveryQueries), chronology, priority, priorityScore, JSON.stringify(priorityReasons), suppressedReason, now, candidateId)
          .run();
      } else {
        candidateId = generateId();
        firstDiscoveredAt = now;
        createdAt = now;
        newUniqueCandidatesCount++;
        await db
          .prepare(
            `INSERT INTO hunter_candidates
              (id, source_video_id, client_id, youtube_video_id, first_discovered_at, last_seen_at,
               discovery_queries, chronology, priority, priority_score, priority_reasons, review_status,
               suppressed_reason, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`
          )
          .bind(
            candidateId,
            videoId,
            video.clientId,
            youtubeVideoId,
            firstDiscoveredAt,
            now,
            JSON.stringify(discoveryQueries),
            chronology,
            priority,
            priorityScore,
            JSON.stringify(priorityReasons),
            suppressedReason,
            createdAt,
            now
          )
          .run();
      }
      totalCandidateTouches++;

      const youtubeVideoCached = await getHunterYoutubeVideo(db, youtubeVideoId);
      candidateResults.push({
        id: candidateId,
        sourceVideoId: videoId,
        clientId: video.clientId,
        youtubeVideoId,
        firstDiscoveredAt,
        lastSeenAt: now,
        discoveryQueries,
        chronology,
        priority,
        priorityScore,
        priorityReasons,
        reviewStatus,
        reviewerNotes,
        reviewedByUserId,
        reviewedAt,
        mediaComparisonStatus,
        suppressedReason,
        createdAt,
        updatedAt: now,
        youtubeVideo: youtubeVideoCached!,
        newlyDiscovered,
      });
    }
  }

  candidateResults.sort((a, b) => b.priorityScore - a.priorityScore);

  const overallStatus: HuntStatus =
    attempted === 0 ? "FAILED" : completed === attempted ? "SUCCESS" : completed > 0 ? "PARTIAL_SUCCESS" : "FAILED";
  const topLevelError =
    attempted === 0 ? "No searches could run — today's Hunter search budget is already exhausted." : undefined;

  // ---- Persist source-level tracking + quota usage ----

  const settingsNow = nowIso();
  const existingSettings = await getHunterSourceSettings(db, videoId);
  const isProductive = newUniqueCandidatesCount > 0;
  const searchStatus = quotaExhaustedThisRun || attempted === 0 ? "quota_blocked" : overallStatus === "FAILED" ? "error" : "ok";
  const lastError = searchRuns.find((r) => r.error)?.error ?? null;

  await db
    .prepare(
      `INSERT INTO hunter_source_settings
        (video_id, hunter_enabled, first_searched_at, last_searched_at, search_priority, search_status,
         last_search_result_count, productive_search_count, consecutive_empty_runs, last_error,
         enabled_at, enabled_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (video_id) DO UPDATE SET
         first_searched_at = excluded.first_searched_at,
         last_searched_at = excluded.last_searched_at,
         search_status = excluded.search_status,
         last_search_result_count = excluded.last_search_result_count,
         productive_search_count = excluded.productive_search_count,
         consecutive_empty_runs = excluded.consecutive_empty_runs,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`
    )
    .bind(
      videoId,
      existingSettings?.hunterEnabled ? 1 : 0,
      existingSettings?.firstSearchedAt ?? settingsNow,
      settingsNow,
      existingSettings?.searchPriority ?? "medium",
      searchStatus,
      totalCandidateTouches,
      (existingSettings?.productiveSearchCount ?? 0) + (isProductive ? 1 : 0),
      isProductive ? 0 : (existingSettings?.consecutiveEmptyRuns ?? 0) + 1,
      lastError,
      existingSettings?.enabledAt ?? null,
      existingSettings?.enabledByUserId ?? null,
      existingSettings?.createdAt ?? settingsNow,
      settingsNow
    )
    .run();

  await applyQuotaDelta(db, quotaBefore.searchDate, {
    searchCallsMade: searchCallsMadeThisRun,
    otherApiCallsMade: otherApiCallsMadeThisRun,
    apiErrors: apiErrorsThisRun,
    sourcesSearched: 1,
    candidatesDiscovered: totalCandidateTouches,
    uniqueCandidatesDiscovered: newUniqueCandidatesCount,
    searchQuotaExhausted: quotaExhaustedThisRun,
  });
  const quotaAfter = await getOrCreateTodayQuota(db, env);

  return {
    status: overallStatus,
    error: topLevelError,
    source: video,
    sourceText: { original: originalText, normalized },
    generatedQueries,
    searchSummary: { attempted, completed, failed, skippedDueToBudget },
    searchRuns,
    candidates: candidateResults,
    quota: quotaAfter,
  };
}
