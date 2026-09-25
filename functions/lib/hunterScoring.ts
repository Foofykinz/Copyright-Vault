import type { HunterCandidatePriority, HunterChannelClassification, HunterChronology } from "../../shared/types";
import { formatViewCount } from "../../shared/format";
import { tokenize, weightedOverlap } from "./hunterTextSignals";

export interface ScoreCandidateInput {
  sourceNormalizedText: string;
  /** The full query strings actually sent to YouTube this Hunt — used for the "exact phrase match"
   * signal (a query string appearing verbatim in the candidate's title is the strongest signal). */
  sentQueries: string[];
  candidateTitle: string;
  candidateDescription: string | null;
  chronology: HunterChronology;
  daysFromSource: number | null;
  viewCount: number | null;
  /** Count of distinct queries (across this Hunt and any prior ones) that have surfaced this exact
   * candidate — the "found by multiple queries" signal. */
  discoveryQueryCount: number;
  channelClassification: HunterChannelClassification | null;
  confirmedIncidentCount: number;
  /** "same_video": literally the source's own YouTube upload. "same_channel": a different video, but
   * on a YouTube channel already known to belong to this source's client (see
   * functions/lib/hunterDb.ts's getClientYoutubeChannelIds) — e.g. a creator's own second angle/cut
   * of the same event, not third-party reuse. Both are suppressed from normal review the same way;
   * kept distinct only so the stored reason text says which case applies. */
  selfSourceKind: "same_video" | "same_channel" | null;
}

export interface ScoreCandidateResult {
  priority: HunterCandidatePriority;
  /** Explainable ranking score for sort order only — never surfaced as an infringement confidence
   * percentage. */
  priorityScore: number;
  priorityReasons: string[];
}

// Deliberately round, unoptimized thresholds for V1 — see the "don't overfit exact thresholds yet"
// instruction. Phase 5 revisits these against real reviewed outcomes.
const HIGH_THRESHOLD = 8;
const REVIEW_THRESHOLD = 4;
const MIN_QUERY_LENGTH_FOR_EXACT_MATCH = 8;

/** Below this, a candidate has no real text relevance to the source — real Phase 2.5 beta data
 * showed views + chronology + multi-query alone can otherwise add up to a REVIEW-tier score for a
 * completely unrelated, merely popular/recent video (a Roblox video and an unrelated ocean
 * documentary both reached score 5-6 on zero title/description overlap). This floor caps such a
 * candidate at LOW regardless of its raw score — those other signals amplify a plausible match,
 * they don't manufacture one. */
const MIN_RELEVANCE_FOR_ELEVATED_PRIORITY = 0.15;

/**
 * V1 candidate scoring: simple, deterministic, and every point is attached to a human-readable
 * reason (see priorityReasons). Never expresses a probability or confidence — priority is only ever
 * LOW / REVIEW / HIGH, an operational sort, not a legal or evidentiary judgment.
 */
export function scoreCandidate(input: ScoreCandidateInput): ScoreCandidateResult {
  let score = 0;
  const reasons: string[] = [];

  const sourceTokens = tokenize(input.sourceNormalizedText);
  const titleTokens = tokenize(input.candidateTitle || "");
  const descTokens = tokenize((input.candidateDescription || "").slice(0, 300));

  const titleLower = (input.candidateTitle || "").toLowerCase();
  const exactMatch = input.sentQueries.find(
    (q) => q.length >= MIN_QUERY_LENGTH_FOR_EXACT_MATCH && titleLower.includes(q.toLowerCase())
  );
  const titleOverlap = weightedOverlap(sourceTokens, titleTokens);
  const descOverlap = weightedOverlap(sourceTokens, descTokens);
  // Title carries more signal than description — same reasoning as youtube.ts's own caption mapping
  // (a YouTube creator's meaningful text lives in the title; the description is often boilerplate).
  const combinedOverlap = titleOverlap * 0.8 + descOverlap * 0.2;

  if (exactMatch) {
    score += 5;
    reasons.push(`exact distinctive phrase match in title: "${exactMatch}"`);
  } else if (combinedOverlap >= 0.5) {
    score += 3;
    reasons.push("strong word overlap between source caption and candidate title/description");
  } else if (combinedOverlap >= 0.25) {
    score += 1;
    reasons.push("some word overlap between source caption and candidate title/description");
  }

  if (input.chronology === "after_source") {
    score += 2;
    reasons.push(input.daysFromSource != null ? `uploaded ${input.daysFromSource} day(s) after source` : "uploaded after source");
  } else if (input.chronology === "same_day") {
    score += 2;
    reasons.push("uploaded the same day as source");
  } else if (input.chronology === "before_source") {
    // Never auto-rejected — chronology alone isn't authoritative (source dates can be wrong/late).
    reasons.push("uploaded before source publication date (chronology inconclusive, not excluded)");
  } else {
    reasons.push("chronology unknown (source or candidate date unavailable)");
  }

  if (input.viewCount != null) {
    if (input.viewCount >= 1_000_000) {
      score += 3;
      reasons.push(`${formatViewCount(input.viewCount)} views`);
    } else if (input.viewCount >= 100_000) {
      score += 2;
      reasons.push(`${formatViewCount(input.viewCount)} views`);
    } else if (input.viewCount >= 10_000) {
      score += 1;
      reasons.push(`${formatViewCount(input.viewCount)} views`);
    }
  }

  if (input.discoveryQueryCount > 1) {
    score += Math.min(input.discoveryQueryCount - 1, 3);
    reasons.push(`found by ${input.discoveryQueryCount} generated queries`);
  }

  if (input.channelClassification === "REPEAT_OFFENDER") {
    score += 5;
    const n = input.confirmedIncidentCount;
    reasons.push(`repeat-offender channel (${n} confirmed incident${n === 1 ? "" : "s"})`);
  } else if (input.channelClassification === "WATCHLIST") {
    score += 2;
    reasons.push("watchlisted channel");
  } else if (input.channelClassification === "ALLOWLIST") {
    reasons.push("allowlisted channel — suppressed from normal review");
  }

  if (input.selfSourceKind === "same_video") {
    reasons.push("this is the source's own YouTube upload — suppressed from normal review");
  } else if (input.selfSourceKind === "same_channel") {
    reasons.push("this is from the client's own known YouTube channel — suppressed from normal review");
  }

  let priority: HunterCandidatePriority = score >= HIGH_THRESHOLD ? "high" : score >= REVIEW_THRESHOLD ? "review" : "low";

  // Relevance floor: views/chronology/multi-query/channel-intelligence signals amplify an
  // already-plausible match, they can't manufacture one on their own out of an irrelevant result.
  const hasRelevanceSignal = Boolean(exactMatch) || combinedOverlap >= MIN_RELEVANCE_FOR_ELEVATED_PRIORITY;
  if (!hasRelevanceSignal && priority !== "low") {
    reasons.push("capped at low priority — no meaningful text overlap with the source caption despite other signals");
    priority = "low";
  }

  // Suppressed candidates don't need an urgent-looking priority regardless of their raw score.
  if (input.selfSourceKind || input.channelClassification === "ALLOWLIST") priority = "low";

  return { priority, priorityScore: score, priorityReasons: reasons };
}
