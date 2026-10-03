/** Content-script entry point for the Content Protection module. Called once from
 * content/rights-manager.ts (which already runs on every facebook.com host), so this needs no
 * manifest entry or permission of its own. Answers the inspector and advance-to-next messages only;
 * every other message is left to the existing listeners. */
import { createContentProtectionAdapter, type ContentProtectionAdapterDeps } from "./adapter";
import {
  ADVANCE_TO_NEXT_MATCH_MESSAGE,
  INSPECT_CONTENT_PROTECTION_MESSAGE,
  type AdvanceResult,
  type ContentProtectionAdapter,
  type InspectResult,
} from "./types";

export function registerContentProtectionInspector(deps: ContentProtectionAdapterDeps): ContentProtectionAdapter {
  const adapter = createContentProtectionAdapter(deps);
  // A second advance request while one is still waiting would click Next twice and skip a match.
  let advancing = false;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === INSPECT_CONTENT_PROTECTION_MESSAGE) {
      adapter
        .inspect()
        .then((diagnostic) => sendResponse({ ok: true, diagnostic } satisfies InspectResult))
        .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies InspectResult));
      return true; // async sendResponse
    }

    if (message?.type === ADVANCE_TO_NEXT_MATCH_MESSAGE) {
      if (advancing) {
        sendResponse({ ok: false, reason: "error", error: "Already moving to the next match." } satisfies AdvanceResult);
        return false;
      }
      advancing = true;
      adapter
        .advanceToNextMatch()
        .catch((err: unknown): AdvanceResult => ({ ok: false, reason: "error", error: err instanceof Error ? err.message : String(err) }))
        .then((result) => sendResponse(result))
        .finally(() => {
          advancing = false;
        });
      return true;
    }

    return false;
  });

  return adapter;
}
