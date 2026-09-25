import type { HunterGeneratedQuery, HunterQueryStrategy } from "../../shared/types";
import { CONNECTOR_WORDS, QUALIFIER_WORDS, STOPWORDS, tokenWeight, tokenize } from "./hunterTextSignals";

export interface NormalizedSourceText {
  original: string;
  normalized: string;
}

/** Whole-phrase social boilerplate — removed as phrases (word-boundary matched) rather than as
 * individual words, so e.g. "must see" is stripped but a caption that happens to contain "see" as
 * part of normal description isn't mangled. */
const PROMO_PATTERNS: RegExp[] = [
  /\bmust see\b/gi,
  /\bshare this\b/gi,
  /\bfollow for more\b/gi,
  /\blink in bio\b/gi,
  /\bbreaking\b/gi,
  /\bwatch\b/gi,
  /\bwow\b/gi,
  /\bomg\b/gi,
  /\bsubscribe\b/gi,
];

/** "#BuffaloBlizzard" -> "Buffalo Blizzard" (splits camelCase-style hashtags into real words);
 * "#flooding" -> "flooding" (single lowercase word passes through unchanged). Hashtag text is kept,
 * not discarded — only the "#" itself is noise. */
function splitHashtagWord(word: string): string {
  return word.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

/**
 * Cleans a source caption for query generation: strips URLs, @mentions, promotional boilerplate,
 * emoji/symbols, and excess punctuation/whitespace, while unpacking hashtags into words and
 * preserving everything else (including plain domain words like "tornado" or "flooding" — this
 * function has no concept of subject matter, it only removes low-information social-media noise).
 */
export function normalizeSourceText(raw: string | null | undefined): NormalizedSourceText {
  const original = raw ?? "";
  let text = original;

  text = text.replace(/https?:\/\/\S+/gi, " ").replace(/www\.\S+/gi, " ");
  text = text.replace(/@[\w.]+/g, " ");
  text = text.replace(/#(\w+)/g, (_match, word: string) => splitHashtagWord(word));
  for (const re of PROMO_PATTERNS) text = text.replace(re, " ");
  text = text.replace(/[\r\n]+/g, " ");
  text = text.replace(/[!?]{2,}/g, " ");
  // Possessive/contraction apostrophes first ("Thursday's" -> "Thursdays", "don't" -> "dont") so the
  // generic symbol strip below doesn't leave an orphan "s" token behind.
  text = text.replace(/['’]/g, "");
  // Strip everything that isn't a letter/number/hyphen/space (emoji, quotes, stray punctuation) —
  // hyphens survive so "I-35" and "287-mile" style tokens stay intact.
  text = text.replace(/[^\p{L}\p{N}\s-]/gu, " ");
  text = text.replace(/\s+/g, " ").trim();

  return { original, normalized: text };
}

/** Below this many non-stopword tokens, there isn't enough usable text to generate a meaningful
 * search — see INSUFFICIENT_SOURCE_METADATA in functions/lib/hunterRun.ts. */
export const MIN_CORE_TOKENS = 3;

/** True if `token` has at least one letter or digit — false for a bare "-" or similar punctuation
 * fragment left over when a truncated caption's trailing ellipsis gets stripped (e.g. a title
 * literally stored as "...Cape -…", where normalizeSourceText removes "…" but a lone "-" survives
 * tokenization). A token with nothing to search on should never reach a generated query. */
function hasSearchableContent(token: string): boolean {
  return /[\p{L}\p{N}]/u.test(token);
}

/** Stopwords and bare-punctuation fragments removed, then de-duplicated case-insensitively (keeping
 * first occurrence) — a caption whose hashtags echo a word already in its own text (e.g.
 * "...tornado... #tornado") shouldn't spend a search query's limited word budget repeating it. */
function coreTokens(tokens: string[]): string[] {
  const filtered = tokens.filter((t) => hasSearchableContent(t) && !STOPWORDS.has(t.toLowerCase()));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of filtered) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(t);
  }
  return result;
}

/** Groups consecutive capitalized tokens into one unit (e.g. "Fort", "Myers", "Beach" -> "Fort Myers
 * Beach") so a multi-word proper noun is scored and selected as a single distinctive detail instead
 * of being split apart — without it, a length-capped selection can grab "Fort" and drop "Myers
 * Beach". Purely casing-based; no gazetteer, no NER. */
function groupCapitalizedRuns(tokens: string[]): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (/^[A-Z]/.test(tokens[i]) && !CONNECTOR_WORDS.has(tokens[i].toLowerCase())) {
      let j = i + 1;
      while (j < tokens.length && /^[A-Z]/.test(tokens[j]) && !CONNECTOR_WORDS.has(tokens[j].toLowerCase())) j++;
      result.push(tokens.slice(i, j).join(" "));
      i = j;
    } else {
      result.push(tokens[i]);
      i++;
    }
  }
  return result;
}

/** Core tokens (stopwords removed, deduped, multi-word proper nouns grouped), condensed to at most
 * `cap` units by keeping the highest-weighted ones (connectors/qualifiers drop first) while
 * restoring their original order — so the result still reads as a phrase, not a keyword bag. */
function condensedTokens(tokens: string[], cap: number): string[] {
  const grouped = groupCapitalizedRuns(coreTokens(tokens));
  if (grouped.length <= cap) return grouped;
  const withIndex = grouped.map((t, i) => ({ t, i, w: tokenWeight(t) }));
  const top = [...withIndex].sort((a, b) => b.w - a.w).slice(0, cap);
  const topIndexes = new Set(top.map((x) => x.i));
  return withIndex.filter((x) => topIndexes.has(x.i)).map((x) => x.t);
}

function normalizeForDedupe(query: string): string {
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Drops trailing connector/qualifier words left dangling by a word-cap truncation (e.g. a caption
 * cut off mid-phrase ending in "...makes landfall near") — never trims below one token. */
function trimTrailingWeakWords(tokens: string[]): string[] {
  const result = [...tokens];
  while (result.length > 1) {
    const last = result[result.length - 1].toLowerCase();
    if (CONNECTOR_WORDS.has(last) || QUALIFIER_WORDS.has(last)) result.pop();
    else break;
  }
  return result;
}

function queryTokenSet(query: string): Set<string> {
  return new Set(query.toLowerCase().split(/\s+/).filter(Boolean));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Two generated queries this similar aren't worth spending two separate real search.list calls on
 * — one of them is almost certainly a near-identical trim/rewording of the other. */
const NEAR_DUPLICATE_JACCARD_THRESHOLD = 0.85;

export interface QueryPlannerInput {
  normalizedText: string;
  /** Client or social-account name, for the client-assisted query — either may be passed; caller
   * picks whichever is more specific/available. */
  name?: string | null;
}

const MAX_QUERY_A_WORDS = 12;
const MAX_QUERY_B_WORDS = 8;
const MAX_QUERY_D_PHRASE_WORDS = 5;
const MAX_QUERIES = 4;

/**
 * Deterministic V1 search planner. Identifies the most distinctive searchable content in a source
 * caption using only generic text heuristics (length, digits, capitalization, a short conservative
 * stopword/connector/qualifier list) — no named-entity recognition, no per-subject-matter rules, no
 * predefined event categories. The same logic runs unchanged whether the source is a tornado, a
 * flood, a wildfire, or an unrelated newsworthy clip.
 */
export function generateHunterQueries(input: QueryPlannerInput): HunterGeneratedQuery[] {
  const tokens = tokenize(input.normalizedText);
  const core = coreTokens(tokens);
  if (core.length < MIN_CORE_TOKENS) return [];

  const queries: HunterGeneratedQuery[] = [];
  const seen = new Set<string>();
  const keptTokenSets: Set<string>[] = [];
  const tryAdd = (query: string, strategy: HunterQueryStrategy, reason: string) => {
    const key = normalizeForDedupe(query);
    if (!key || seen.has(key)) return;
    const tokenSet = queryTokenSet(key);
    // Near-duplicate check: skip a query that's almost the same bag of words as one already kept,
    // rather than spending a second real search.list call on essentially the same search.
    for (const existing of keptTokenSets) {
      if (jaccardSimilarity(tokenSet, existing) >= NEAR_DUPLICATE_JACCARD_THRESHOLD) return;
    }
    seen.add(key);
    keptTokenSets.push(tokenSet);
    queries.push({ query: query.trim(), strategy, reason });
  };

  // A -- distinctive source phrase: the cleaned caption, close to verbatim, capped in length.
  const phraseA = trimTrailingWeakWords(core.slice(0, MAX_QUERY_A_WORDS)).join(" ");
  tryAdd(phraseA, "distinctive_phrase", "Longest cleaned phrase from the source caption, kept close to its original wording.");

  // B -- condensed descriptive: same content, connectors/qualifiers dropped first, shorter overall.
  const phraseB = trimTrailingWeakWords(condensedTokens(tokens, MAX_QUERY_B_WORDS)).join(" ");
  tryAdd(phraseB, "condensed_descriptive", "Shortened version of the caption favoring its most descriptive words.");

  // C -- event/action + distinguishing detail: the leading content words (usually the action/subject
  // in these captions) combined with whatever scores as most distinctive later in the caption (often
  // a place, road, or number) -- not sentence reordering via grammar rules, just weight + position.
  // Capitalized runs are grouped first so a multi-word place name is treated as one detail.
  const strongRaw = core.filter((t) => !CONNECTOR_WORDS.has(t.toLowerCase()) && !QUALIFIER_WORDS.has(t.toLowerCase()));
  const strong = groupCapitalizedRuns(strongRaw);
  if (strong.length >= 2) {
    const actionPart = strong.slice(0, Math.min(3, strong.length));
    const rest = strong.slice(actionPart.length).map((t, i) => ({ t, i, w: tokenWeight(t) }));
    const restOrdered = [...rest]
      .sort((a, b) => b.w - a.w)
      .slice(0, 3)
      .sort((a, b) => a.i - b.i)
      .map((x) => x.t);
    const combined = trimTrailingWeakWords([...actionPart, ...restOrdered]);
    tryAdd(
      combined.join(" "),
      "event_action_detail",
      "Leading action/subject words combined with the most distinctive detail found elsewhere in the caption."
    );
  }

  // D -- client/account assisted: name + a short distinctive phrase. Skipped if the name is already
  // part of the caption (Query A already covers it) or if there's no name to use.
  const name = (input.name || "").trim();
  if (name && !phraseA.toLowerCase().includes(name.toLowerCase())) {
    const distinctivePhrase = trimTrailingWeakWords(condensedTokens(tokens, MAX_QUERY_D_PHRASE_WORDS)).join(" ");
    if (distinctivePhrase) {
      tryAdd(
        `${name} ${distinctivePhrase}`,
        "client_assisted",
        `Creator/client name ("${name}") combined with a short distinctive phrase from the caption.`
      );
    }
  }

  return queries.slice(0, MAX_QUERIES);
}
