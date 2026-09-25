/**
 * Small, deliberately conservative word lists and deterministic text heuristics shared by Vault
 * Hunter's query planner (functions/lib/hunterQueryPlanner.ts) and candidate scoring
 * (functions/lib/hunterScoring.ts). No domain vocabulary lives here — Vault Hunter must stay
 * content-agnostic (tornadoes, floods, hail, wildfires, or any other newsworthy footage all go
 * through the exact same logic), so words like "tornado," "flooding," "snow," or "storm" are
 * intentionally absent from every list below. They're weak alone but useful combined with other
 * detail (a location, a road, a number), so nothing here treats them as noise to strip.
 */

/** True low-information social-media noise — safe to drop entirely. */
export const STOPWORDS = new Set([
  "video",
  "viral",
  "watch",
  "wow",
  "amazing",
  "crazy",
  "today",
  "share",
  "subscribe",
  "breaking",
  "omg",
  "must",
  "see",
  "follow",
  "more",
  "like",
  "comment",
  "check",
  "out",
  "now",
  "new",
  "guys",
  "everyone",
  "please",
  "link",
  "bio",
]);

/** Prepositions/articles/conjunctions — structurally necessary in a sentence, not searchable on
 * their own. Deprioritized (not removed from the normalized text), so they can still appear in the
 * near-verbatim "distinctive phrase" query while dropping out of the condensed ones first. */
export const CONNECTOR_WORDS = new Set([
  "a",
  "an",
  "the",
  "in",
  "on",
  "at",
  "of",
  "to",
  "for",
  "and",
  "or",
  "but",
  "with",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "near",
  "over",
  "during",
  "after",
  "before",
  "while",
  "when",
  "into",
  "onto",
  "up",
  "down",
  "off",
  "than",
  "then",
  "so",
  "just",
  "some",
]);

/** Generic hype/intensifier adjectives — carry little search-distinguishing value on their own. */
export const QUALIFIER_WORDS = new Set([
  "massive",
  "huge",
  "big",
  "entire",
  "completely",
  "totally",
  "extreme",
  "historic",
  "incredible",
  "insane",
  "unbelievable",
  "absolute",
  "absolutely",
  "literally",
  "extremely",
]);

export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * Heuristic distinctiveness weight for one token — or one capitalized-run unit, e.g. "Massive Waves"
 * (see groupCapitalizedRuns in hunterQueryPlanner.ts). Favors things that read as specific/technical
 * (numbers, longer words, words capitalized in the source) over short common vocabulary.
 * Deliberately simple — no named-entity recognition, no dictionary, no per-domain word list — so it
 * behaves the same regardless of what kind of footage the caption describes.
 */
export function tokenWeight(token: string): number {
  // Checked per-word, not against the whole joined string — otherwise a merged unit like "Massive
  // Waves" never matches QUALIFIER_WORDS' exact-string "massive" entry and silently skips the
  // penalty a lone "Massive" would have gotten.
  const words = token.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 1 && STOPWORDS.has(words[0])) return 0;
  let weight = 1;
  if (/\d/.test(token)) weight += 3;
  if (/^[A-Z]/.test(token)) weight += 2;
  if (token.length >= 7) weight += 1;
  if (words.some((w) => CONNECTOR_WORDS.has(w))) weight -= 2;
  if (words.some((w) => QUALIFIER_WORDS.has(w))) weight -= 1;
  return Math.max(weight, 0.1);
}

/** Fraction (0..1) of `sourceTokens`' total weight that also appears in `targetTokens` — i.e. "how
 * much of the source's distinctive vocabulary shows up in this candidate," weighted so a shared rare
 * word counts far more than a shared common one. */
export function weightedOverlap(sourceTokens: string[], targetTokens: string[]): number {
  if (sourceTokens.length === 0) return 0;
  const targetSet = new Set(targetTokens.map((t) => t.toLowerCase()));
  let matched = 0;
  let total = 0;
  for (const t of sourceTokens) {
    const w = tokenWeight(t);
    total += w;
    if (targetSet.has(t.toLowerCase())) matched += w;
  }
  return total === 0 ? 0 : matched / total;
}
