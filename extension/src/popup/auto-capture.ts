/** Automated Content Protection run. For each match: read it (same parser as the manual "Capture
 * this match" button), save its data to Data Pulls, and -- when it qualifies -- save an evidence
 * record with a screenshot to the Copyright Archive. Then click Next, wait for the next match,
 * repeat.
 *
 * Evidence is skipped (Data Pulls row only) when the match shows a takedown requested/approved
 * (team's call, 2026-10-07), when there's no post link to log, or when the archive already has the
 * match (checked before the screenshot, so re-runs don't take screenshots for nothing).
 *
 * Runs here in the side panel rather than the content script because the screenshot
 * (chrome.tabs.captureVisibleTab) and the API calls need extension-page privileges -- which also
 * means the side panel has to stay open for the run to continue.
 *
 * Never clicks anything itself: the only page interaction is ADVANCE_TO_NEXT_MATCH_MESSAGE, which
 * the content script answers by clicking an element named exactly "Next" (see
 * content-protection/adapter.ts). Stops on: last match, Stop, an auth failure, a page that no longer
 * looks like a Content Protection match, the user switching tabs, or MAX_CONSECUTIVE_ERRORS. */
import { extensionApi, ApiRequestError } from "../lib/api";
import type { ExtensionConfig } from "../lib/storage";
import {
  COLLECT_CURRENT_MATCH_MESSAGE,
  DETECT_RIGHTS_MANAGER_PAGE_MESSAGE,
  type CapturedMatch,
  type CollectMatchResult,
  type DetectRightsManagerPageResult,
} from "../lib/rights-manager-scraped";
import {
  ADVANCE_TO_NEXT_MATCH_MESSAGE,
  SHOW_MATCHING_FOOTAGE_MESSAGE,
  type AdvanceResult,
  type ShowFootageResult,
} from "../content-protection/types";
import type { ExtensionDataPullInput, ExtensionInfringementReportImportInput } from "../../../shared/types";
import { TAKEDOWN_STATUS_LABELS } from "../../../shared/types";

const MAX_CONSECUTIVE_ERRORS = 3;
/** Random dwell on each match before clicking Next. A fixed, fast rhythm (it was 0.75s -- a new
 * match every ~2-3s) is the clearest automation signal to Meta; a random 3-10s reads like someone
 * looking at the match and moving on. The screenshot adds its own time on top. */
const MIN_PAUSE_MS = 3_000;
const MAX_PAUSE_MS = 10_000;
/** Matches handled per run before it stops on its own (Start continues from where it left off) --
 * keeps any one burst of activity on the account modest, and keeps someone checking in. */
const MAX_MATCHES_PER_RUN = 50;
const MAX_LOG_ENTRIES = 200;

export interface SendContext {
  config: ExtensionConfig;
  rightsManagerAccountId: string;
  clientId: string | null;
}

export interface AutoCaptureDeps {
  getSendContext(): SendContext;
  captureScreenshot(tabId: number, windowId: number): Promise<string>;
  rerender(): void;
}

function buildDataPullInput(match: CapturedMatch, ctx: Omit<SendContext, "config">): ExtensionDataPullInput {
  return {
    rightsManagerAccountId: ctx.rightsManagerAccountId,
    clientId: ctx.clientId || null,
    metaMatchId: match.metaMatchId,
    infringerName: match.infringerName,
    // Empty only when a takedown notice explains the missing post link (see CollectMatchOptions).
    infringingUrl: match.infringingUrl || null,
    infringerProfileUrl: match.infringerProfileUrl,
    platform: match.platform,
    // Meta's real "Detected" date, or null when the page shows none -- never the capture-time
    // fallback the evidence record uses.
    detectedAt: match.detectedAt,
    matchDurationSec: match.matchDurationSec,
    videoViewCount: match.videoViewCount,
    pageFollowerCount: match.pageFollowerCount,
    referenceFiles: match.referenceFiles,
    takedownStatus: match.takedownStatus,
    monetized: match.monetized,
  };
}

/** Shared with the manual evidence send in popup/index.ts so an automated evidence record is
 * exactly what a manual one would be. */
export function buildImportInput(match: CapturedMatch, screenshotDataUrl: string | null, ctx: Omit<SendContext, "config">): ExtensionInfringementReportImportInput {
  return {
    clientId: ctx.clientId || null,
    rightsManagerAccountId: ctx.rightsManagerAccountId,
    infringerName: match.infringerName,
    infringingUrl: match.infringingUrl,
    platform: match.platform,
    postedAt: match.postedAt,
    notes: match.notes || null,
    metaMatchId: match.metaMatchId,
    metaVideoId: match.metaVideoId,
    matchDurationSec: match.matchDurationSec,
    videoViewCount: match.videoViewCount,
    pageFollowerCount: match.pageFollowerCount,
    isAccountPrivate: match.isAccountPrivate,
    infringerProfileUrl: match.infringerProfileUrl,
    referenceFiles: match.referenceFiles,
    screenshotDataUrl,
    videoAvailable: match.videoAvailable,
  };
}

/** One log line per match; "ok" covers every non-error result, the detail says what happened to
 * each half. */
type Outcome = "ok" | "skipped" | "error";

interface LogEntry {
  at: string;
  matchId: string | null;
  outcome: Outcome;
  detail: string;
}

interface Counts {
  dataNew: number;
  dataUpdated: number;
  evidenceSaved: number;
  evidenceAlready: number;
  evidenceNotNeeded: number;
  nonPublic: number;
  errors: number;
}

const EMPTY_COUNTS: Counts = { dataNew: 0, dataUpdated: 0, evidenceSaved: 0, evidenceAlready: 0, evidenceNotNeeded: 0, nonPublic: 0, errors: 0 };

interface RunState {
  phase: "idle" | "running" | "stopping" | "finished";
  /** false = "Data pull only" mode: Data Pulls rows only, no screenshots or evidence records. Fixed
   * for the whole run at Start. */
  withEvidence: boolean;
  counts: Counts;
  log: LogEntry[];
  step: string | null;
  endKind: "done" | "stopped" | "error" | null;
  endReason: string | null;
}

const run: RunState = {
  phase: "idle",
  withEvidence: true,
  counts: { ...EMPTY_COUNTS },
  log: [],
  step: null,
  endKind: null,
  endReason: null,
};

export function isAutoCaptureRunning(): boolean {
  return run.phase === "running" || run.phase === "stopping";
}

/** Which automated mode the current (or last) run is in -- lets the side panel keep showing the
 * right mode while a run is going. */
export function autoCaptureRunHasEvidence(): boolean {
  return run.withEvidence;
}

class StopRun extends Error {
  constructor(
    readonly kind: "done" | "stopped" | "error",
    message: string
  ) {
    super(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(entry: Omit<LogEntry, "at">): void {
  run.log.unshift({ ...entry, at: new Date().toLocaleTimeString() });
  if (run.log.length > MAX_LOG_ENTRIES) run.log.length = MAX_LOG_ENTRIES;
}

function setStep(step: string | null, deps: AutoCaptureDeps): void {
  run.step = step;
  deps.rerender();
}

function checkStop(): void {
  if (run.phase === "stopping") throw new StopRun("stopped", "Stopped.");
}

/** The pre-Next pause, counting down in the panel. Checks for Stop every quarter second so pressing
 * Stop doesn't mean waiting out the rest of the pause. */
async function humanPause(deps: AutoCaptureDeps): Promise<void> {
  const total = MIN_PAUSE_MS + Math.random() * (MAX_PAUSE_MS - MIN_PAUSE_MS);
  const until = Date.now() + total;
  let shownSeconds = -1;
  while (Date.now() < until) {
    checkStop();
    const seconds = Math.ceil((until - Date.now()) / 1000);
    if (seconds !== shownSeconds) {
      shownSeconds = seconds;
      setStep(`Next match in ${seconds}s…`, deps);
    }
    await sleep(250);
  }
}

/** sendMessage with a timeout (chrome.tabs.sendMessage has none of its own). A rejected send --
 * no content script, the tab reloaded or navigated away -- ends the run: the page isn't one this
 * can safely keep driving. */
async function sendToTab<T>(tabId: number, message: unknown, timeoutMs: number, what: string): Promise<T> {
  let result: T | undefined;
  try {
    result = await Promise.race([
      chrome.tabs.sendMessage(tabId, message) as Promise<T | undefined>,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
    ]);
  } catch (err) {
    throw new StopRun("error", `Lost contact with the page while ${what} (${err instanceof Error ? err.message : String(err)}). If the page reloaded, refresh it and start again from the next match.`);
  }
  if (result === undefined) throw new StopRun("error", `The page didn't respond while ${what}.`);
  return result;
}

/** An auth failure ends the run outright -- every later save would fail the same way. */
function rethrowIfAuthFailure(err: unknown): void {
  if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403)) {
    throw new StopRun("error", `Copyright Vault rejected the extension's token (${err.status}). Check Settings, then start again from this match.`);
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function screenshotWithRetry(tabId: number, windowId: number, deps: AutoCaptureDeps): Promise<string> {
  try {
    return await deps.captureScreenshot(tabId, windowId);
  } catch {
    await sleep(1000);
    return deps.captureScreenshot(tabId, windowId);
  }
}

/** Right before an evidence screenshot: has the content script click the first "Matching
 * segments" chip so the match's video shows the matched footage, then pause on it. Shared with the
 * manual capture in popup/index.ts. Never throws -- a failure means a screenshot without the
 * footage, which the caller flags rather than losing the record over. */
export async function showMatchingFootage(tabId: number): Promise<ShowFootageResult> {
  try {
    const result = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: SHOW_MATCHING_FOOTAGE_MESSAGE }) as Promise<ShowFootageResult | undefined>,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 15_000)),
    ]);
    return result ?? { ok: false, error: "The page didn't respond." };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

function clock(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** What the footage step did, for the log / review card -- always stated, success included, so every
 * record shows whether its screenshot should have the matching footage in it. */
export function footageNote(footage: ShowFootageResult): string {
  if (!footage.ok) return `⚠ matching footage not shown (${footage.error})`;
  return footage.playing
    ? `footage playing at ${clock(footage.at)}`
    : `⚠ footage at ${clock(footage.at)} but not playing (Facebook may show its ▶ over it)`;
}

/** Why this match gets no evidence record, or null when it should get one. */
function evidenceNotNeededReason(match: CapturedMatch): string | null {
  if (match.takedownStatus) return `${TAKEDOWN_STATUS_LABELS[match.takedownStatus]} — not needed`;
  if (!match.infringingUrl) return "no post link — not needed";
  return null;
}

/** One match: read -> Data Pulls -> (maybe) screenshot + evidence. Returns the match ID (null if
 * skipped or unreadable) and whether anything failed. */
async function processCurrentMatch(tabId: number, windowId: number, lastMatchId: string | null, deps: AutoCaptureDeps): Promise<{ matchId: string | null; error: boolean }> {
  setStep("Reading the match…", deps);
  const result = await sendToTab<CollectMatchResult>(
    tabId,
    { type: COLLECT_CURRENT_MATCH_MESSAGE, allowMissingPostLink: true },
    10_000,
    "reading the match"
  );

  if (!result.ok) {
    if (result.skipped) {
      run.counts.nonPublic++;
      log({ matchId: result.matchId ?? null, outcome: "skipped", detail: result.error });
      return { matchId: null, error: false };
    }
    run.counts.errors++;
    log({ matchId: null, outcome: "error", detail: result.error });
    return { matchId: null, error: true };
  }

  const match = result.match;
  // The advance step already waits for a new match_id, so this should never trip -- it's here so a
  // stuck page can never produce the same record twice in a row under any circumstances.
  if (match.metaMatchId === lastMatchId) {
    throw new StopRun("error", `Still on match ${match.metaMatchId} after clicking Next — stopped so nothing gets saved twice.`);
  }

  const { config, ...ctx } = deps.getSendContext();
  const parts: string[] = [`${match.infringerName}`];
  let failed = false;

  // -- Data Pulls (every readable match)
  checkStop();
  setStep(`Saving ${match.metaMatchId} to Data Pulls…`, deps);
  try {
    const saved = await extensionApi.importDataPull(config, buildDataPullInput(match, ctx));
    if (saved.updated) run.counts.dataUpdated++;
    else run.counts.dataNew++;
    parts.push(`Data: ${saved.updated ? "updated" : "saved"}`);
  } catch (err) {
    rethrowIfAuthFailure(err);
    failed = true;
    parts.push(`Data: FAILED (${errorText(err)})`);
  }

  // -- Evidence (Copyright Archive, with screenshot) -- not at all in "Data pull only" mode
  const notNeeded = run.withEvidence ? evidenceNotNeededReason(match) : null;
  if (!run.withEvidence) {
    // Data pull only: nothing to say about evidence on each line.
  } else if (notNeeded) {
    run.counts.evidenceNotNeeded++;
    parts.push(`Evidence: ${notNeeded}`);
  } else {
    try {
      checkStop();
      setStep(`Checking the archive for ${match.metaMatchId}…`, deps);
      const { exists } = await extensionApi.infringementReportExists(config, match.metaMatchId);
      if (exists) {
        run.counts.evidenceAlready++;
        parts.push("Evidence: already logged");
      } else {
        setStep(`Showing the matching footage for ${match.metaMatchId}…`, deps);
        const footage = await showMatchingFootage(tabId);
        parts.push(footageNote(footage));
        checkStop();
        setStep(`Screenshot of ${match.metaMatchId}…`, deps);
        const screenshot = await screenshotWithRetry(tabId, windowId, deps);
        checkStop();
        setStep(`Saving ${match.metaMatchId} to the Copyright Archive…`, deps);
        const saved = await extensionApi.importInfringementReport(config, buildImportInput(match, screenshot, ctx));
        if (saved.duplicate) run.counts.evidenceAlready++;
        else run.counts.evidenceSaved++;
        parts.push(saved.duplicate ? "Evidence: already logged" : `Evidence: saved with screenshot${match.detectedAt ? "" : " (no detected date — dated by capture)"}`);
      }
    } catch (err) {
      if (err instanceof StopRun) throw err;
      rethrowIfAuthFailure(err);
      failed = true;
      parts.push(`Evidence: FAILED (${errorText(err)})`);
    }
  }

  if (match.takedownStatus) parts.push(TAKEDOWN_STATUS_LABELS[match.takedownStatus]);
  if (failed) run.counts.errors++;
  log({ matchId: match.metaMatchId, outcome: failed ? "error" : "ok", detail: parts.join(" · ") });
  return { matchId: match.metaMatchId, error: failed };
}

async function runLoop(tabId: number, windowId: number, deps: AutoCaptureDeps): Promise<void> {
  let lastMatchId: string | null = null;
  let consecutiveErrors = 0;
  let handled = 0;

  for (;;) {
    checkStop();

    // captureVisibleTab screenshots whatever tab is showing -- if the user switched away, a
    // screenshot now would capture the wrong page.
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new StopRun("error", "The Content Protection tab was closed.");
    // Also matters in data-pull-only mode: Chrome throttles background tabs, so a match could be read
    // before it had finished loading.
    if (!tab.active) {
      throw new StopRun(
        "stopped",
        `You switched away from the Content Protection tab, so the run stopped${run.withEvidence ? " (a screenshot would have captured the wrong page)" : ""}. Switch back and press Start to continue from this match.`
      );
    }

    const detected = await sendToTab<DetectRightsManagerPageResult>(tabId, { type: DETECT_RIGHTS_MANAGER_PAGE_MESSAGE }, 5000, "checking the page");
    if (!detected.recognized || detected.kind !== "content_protection") {
      throw new StopRun("error", "This no longer looks like a Content Protection match page (logged out, or Meta changed the page?). Stopped.");
    }

    const { matchId, error } = await processCurrentMatch(tabId, windowId, lastMatchId, deps);
    if (matchId) lastMatchId = matchId;
    consecutiveErrors = error ? consecutiveErrors + 1 : 0;
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) throw new StopRun("error", `${MAX_CONSECUTIVE_ERRORS} errors in a row — stopped. See the log below.`);
    handled++;

    await humanPause(deps);
    setStep("Moving to the next match…", deps);
    const advanced = await sendToTab<AdvanceResult>(tabId, { type: ADVANCE_TO_NEXT_MATCH_MESSAGE }, 60_000, "moving to the next match");
    if (!advanced.ok) {
      if (advanced.reason === "last_match") throw new StopRun("done", advanced.error);
      throw new StopRun("error", advanced.error);
    }
    // Checked after moving on, not before, so pressing Start again begins on a match this run
    // hasn't handled yet instead of re-capturing the last one.
    if (handled >= MAX_MATCHES_PER_RUN) {
      throw new StopRun("done", `Reached the ${MAX_MATCHES_PER_RUN}-match limit for one run. Take a breather, then press Start to keep going from this match.`);
    }
  }
}

async function start(deps: AutoCaptureDeps, withEvidence: boolean): Promise<void> {
  if (isAutoCaptureRunning()) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || tab.windowId === undefined) return;

  Object.assign(run, {
    phase: "running",
    withEvidence,
    counts: { ...EMPTY_COUNTS },
    log: [],
    step: null,
    endKind: null,
    endReason: null,
  } satisfies RunState);
  deps.rerender();

  try {
    await runLoop(tab.id, tab.windowId, deps);
  } catch (err) {
    run.endKind = err instanceof StopRun ? err.kind : "error";
    run.endReason = errorText(err);
  } finally {
    run.phase = "finished";
    run.step = null;
    deps.rerender();
  }
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, children: (Node | string | null)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) if (child !== null) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  return node;
}

const OUTCOME_ICONS: Record<Outcome, string> = { ok: "✅", skipped: "⏭", error: "⚠" };

/** Start/Stop + live progress. `withEvidence` is the mode Start would begin (Data Pulls + evidence,
 * or data pull only); a run in progress keeps its own. `disabledReason` (e.g. no Rights Manager
 * account chosen, a match being reviewed manually) blocks Start without hiding the last run's
 * results. */
export function renderAutoCapture(deps: AutoCaptureDeps, disabledReason: string | null, withEvidence: boolean): HTMLElement {
  const container = h("div", { className: "field auto-capture" });
  const running = isAutoCaptureRunning();

  if (running) {
    const stopBtn = h("button", { textContent: run.phase === "stopping" ? "Stopping after this step…" : "Stop", disabled: run.phase === "stopping" });
    stopBtn.addEventListener("click", () => {
      run.phase = "stopping";
      deps.rerender();
    });
    container.append(stopBtn, h("div", { className: "hint", textContent: run.step ?? "Working…" }));
    container.appendChild(h("div", { className: "warning", textContent: "Keep this tab in front and this panel open until it finishes." }));
  } else {
    const startBtn = h("button", {
      className: "primary",
      textContent: withEvidence ? "Start Automated Capture" : "Start Data Pull",
      disabled: disabledReason !== null,
    });
    startBtn.addEventListener("click", () => void start(deps, withEvidence));
    container.appendChild(startBtn);
    const what = withEvidence
      ? "saves its data to Data Pulls, and saves an evidence record with a screenshot to the Copyright Archive (skipped when a takedown is already requested/approved, or it's already logged)"
      : "saves its data to Data Pulls only — no screenshots, nothing added to the Copyright Archive";
    container.appendChild(
      h("div", {
        className: "hint",
        textContent:
          disabledReason ??
          `For each match: ${what}. Then clicks Next — up to ${MAX_MATCHES_PER_RUN} matches per run, pausing ${MIN_PAUSE_MS / 1000}–${MAX_PAUSE_MS / 1000}s on each. Skips non-public reels. Never clicks anything except Next.`,
      })
    );
  }

  if (run.phase !== "idle") {
    const c = run.counts;
    container.appendChild(
      h("div", { className: "hint" }, [
        h("div", { textContent: `Data Pulls: ${c.dataNew} new · ${c.dataUpdated} updated` }),
        run.withEvidence
          ? h("div", { textContent: `Evidence: ${c.evidenceSaved} saved · ${c.evidenceAlready} already logged · ${c.evidenceNotNeeded} not needed` })
          : h("div", { textContent: "Evidence: off (data pull only)" }),
        h("div", { textContent: `Non-public skipped ${c.nonPublic} · Errors ${c.errors}` }),
      ])
    );
  }
  if (run.phase === "finished" && run.endReason) {
    container.appendChild(h("div", { className: run.endKind === "error" ? "error" : "hint", textContent: `${run.endKind === "done" ? "Finished: " : ""}${run.endReason}` }));
  }
  if (run.log.length > 0) {
    container.appendChild(
      h(
        "div",
        { className: "video-list" },
        run.log.map((e) =>
          h("div", { className: "video-row" }, [
            h("div", { className: "meta" }, [
              h("div", { className: "sub", textContent: `${e.at} · ${OUTCOME_ICONS[e.outcome]}${e.matchId ? ` · ${e.matchId}` : ""}` }),
              h("div", { className: "caption expanded", textContent: e.detail }),
            ]),
          ])
        )
      )
    );
  }
  return container;
}
