/** Automated Content Protection "Data pull": read the open match's data (same parser as the manual
 * "Capture this match" button), save it to the Data Pulls table, click Next, wait for the next
 * match, repeat. No screenshots -- a separate purpose from evidence capture, which stays manual.
 *
 * Runs here in the side panel rather than the content script because the API call needs the
 * extension's token -- which also means the side panel has to stay open for the run to continue.
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
import { ADVANCE_TO_NEXT_MATCH_MESSAGE, type AdvanceResult } from "../content-protection/types";
import type { ExtensionDataPullInput, ExtensionInfringementReportImportInput } from "../../../shared/types";
import { TAKEDOWN_STATUS_LABELS } from "../../../shared/types";

const MAX_CONSECUTIVE_ERRORS = 3;
/** Random dwell on each match before clicking Next. A fixed, fast rhythm (it was 0.75s -- a new
 * match every ~2-3s) is the clearest automation signal to Meta; a random 3-10s reads like someone
 * looking at the match and moving on. */
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
    // The Content Protection parser's postedAt is Meta's "Detected" date -- the page shows no
    // posting date -- so it's stored under its real meaning here.
    detectedAt: match.postedAt,
    matchDurationSec: match.matchDurationSec,
    videoViewCount: match.videoViewCount,
    pageFollowerCount: match.pageFollowerCount,
    referenceFiles: match.referenceFiles,
    takedownStatus: match.takedownStatus,
  };
}

/** The manual evidence send in popup/index.ts. Lives here only so the two send paths' field
 * mapping sits side by side. */
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

/** "updated" = this match was pulled before; its Data Pulls row was refreshed, not duplicated. */
type Outcome = "saved" | "updated" | "skipped" | "error";

interface LogEntry {
  at: string;
  matchId: string | null;
  outcome: Outcome;
  detail: string;
}

interface RunState {
  phase: "idle" | "running" | "stopping" | "finished";
  counts: Record<Outcome, number>;
  log: LogEntry[];
  step: string | null;
  endKind: "done" | "stopped" | "error" | null;
  endReason: string | null;
}

const run: RunState = {
  phase: "idle",
  counts: { saved: 0, updated: 0, skipped: 0, error: 0 },
  log: [],
  step: null,
  endKind: null,
  endReason: null,
};

export function isAutoCaptureRunning(): boolean {
  return run.phase === "running" || run.phase === "stopping";
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

function log(entry: Omit<LogEntry, "at">): void {
  run.counts[entry.outcome]++;
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

/** One match: read -> save to Data Pulls. Returns the captured match ID (null if skipped or
 * failed) and whether it counts as an error. */
async function processCurrentMatch(tabId: number, lastMatchId: string | null, deps: AutoCaptureDeps): Promise<{ matchId: string | null; error: boolean }> {
  setStep("Reading the match…", deps);
  const result = await sendToTab<CollectMatchResult>(
    tabId,
    { type: COLLECT_CURRENT_MATCH_MESSAGE, allowMissingPostLink: true },
    10_000,
    "reading the match"
  );

  if (!result.ok) {
    if (result.skipped) {
      log({ matchId: result.matchId ?? null, outcome: "skipped", detail: result.error });
      return { matchId: null, error: false };
    }
    log({ matchId: null, outcome: "error", detail: result.error });
    return { matchId: null, error: true };
  }

  const match = result.match;
  // The advance step already waits for a new match_id, so this should never trip -- it's here so a
  // stuck page can never produce the same record twice in a row under any circumstances.
  if (match.metaMatchId === lastMatchId) {
    throw new StopRun("error", `Still on match ${match.metaMatchId} after clicking Next — stopped so nothing gets saved twice.`);
  }

  checkStop();
  setStep(`Saving ${match.metaMatchId}…`, deps);
  const { config, ...ctx } = deps.getSendContext();
  try {
    const saved = await extensionApi.importDataPull(config, buildDataPullInput(match, ctx));
    const takedown = match.takedownStatus ? ` · ${TAKEDOWN_STATUS_LABELS[match.takedownStatus]}` : "";
    log({
      matchId: match.metaMatchId,
      outcome: saved.updated ? "updated" : "saved",
      detail: `${match.infringerName} · ${match.infringingUrl || "(no post link)"}${takedown}${saved.updated ? " · pulled before, row refreshed" : ""}`,
    });
    return { matchId: match.metaMatchId, error: false };
  } catch (err) {
    if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403)) {
      throw new StopRun("error", `Copyright Vault rejected the extension's token (${err.status}). Check Settings, then start again from this match.`);
    }
    log({ matchId: match.metaMatchId, outcome: "error", detail: `Save failed: ${err instanceof Error ? err.message : String(err)}` });
    return { matchId: match.metaMatchId, error: true };
  }
}

async function runLoop(tabId: number, deps: AutoCaptureDeps): Promise<void> {
  let lastMatchId: string | null = null;
  let consecutiveErrors = 0;
  let handled = 0;

  for (;;) {
    checkStop();

    // Chrome heavily throttles background tabs (timers, rendering), so a match could load slowly or
    // half-render there -- stop rather than read a page that may not have caught up.
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new StopRun("error", "The Content Protection tab was closed.");
    if (!tab.active) throw new StopRun("stopped", "You switched away from the Content Protection tab, so the run stopped. Switch back and press Start to continue from this match.");

    const detected = await sendToTab<DetectRightsManagerPageResult>(tabId, { type: DETECT_RIGHTS_MANAGER_PAGE_MESSAGE }, 5000, "checking the page");
    if (!detected.recognized || detected.kind !== "content_protection") {
      throw new StopRun("error", "This no longer looks like a Content Protection match page (logged out, or Meta changed the page?). Stopped.");
    }

    const { matchId, error } = await processCurrentMatch(tabId, lastMatchId, deps);
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

async function start(deps: AutoCaptureDeps): Promise<void> {
  if (isAutoCaptureRunning()) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  Object.assign(run, {
    phase: "running",
    counts: { saved: 0, updated: 0, skipped: 0, error: 0 },
    log: [],
    step: null,
    endKind: null,
    endReason: null,
  } satisfies RunState);
  deps.rerender();

  try {
    await runLoop(tab.id, deps);
  } catch (err) {
    run.endKind = err instanceof StopRun ? err.kind : "error";
    run.endReason = err instanceof Error ? err.message : String(err);
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

const OUTCOME_ICONS: Record<Outcome, string> = { saved: "✅", updated: "↺", skipped: "⏭", error: "⚠" };

/** Start/Stop + live progress. `disabledReason` (e.g. no Rights Manager account chosen, a match
 * being reviewed manually) blocks Start without hiding the last run's results. */
export function renderAutoCapture(deps: AutoCaptureDeps, disabledReason: string | null): HTMLElement {
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
    const startBtn = h("button", { className: "primary", textContent: "Start Data Pull", disabled: disabledReason !== null });
    startBtn.addEventListener("click", () => void start(deps));
    container.appendChild(startBtn);
    container.appendChild(
      h("div", {
        className: "hint",
        textContent:
          disabledReason ??
          `Saves this match's data to Data Pulls (no screenshot), then clicks Next and repeats — up to ${MAX_MATCHES_PER_RUN} matches per run, pausing ${MIN_PAUSE_MS / 1000}–${MAX_PAUSE_MS / 1000}s on each. Skips non-public reels. Never clicks anything except Next.`,
      })
    );
  }

  if (run.phase !== "idle") {
    const c = run.counts;
    container.appendChild(h("div", { className: "hint", textContent: `New ${c.saved} · Updated ${c.updated} · Skipped ${c.skipped} · Errors ${c.error}` }));
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
              h("div", { className: "sub", textContent: `${e.at} · ${OUTCOME_ICONS[e.outcome]} ${e.outcome}${e.matchId ? ` · ${e.matchId}` : ""}` }),
              h("div", { className: "caption expanded", textContent: e.detail }),
            ]),
          ])
        )
      )
    );
  }
  return container;
}
