/** Builds the serializable PageDiagnostic for "Inspect Current Match". Read-only: waits for the SPA
 * to settle, takes one PageModel snapshot, and describes it. Never clicks, focuses, scrolls, or
 * reads anything outside the page's visible DOM -- no cookies, storage, request headers, or tokens
 * are touched anywhere in this module, and every URL goes through sanitizeUrl(). */
import type { CollectMatchResult } from "../lib/rights-manager-scraped";
import { DIAGNOSTIC_SCHEMA_VERSION, type HeadingInfo, type PageDiagnostic, type SemanticElementInfo } from "./types";
import { buildPageModel, isExcludedRegion, queryIncludingSelf, type PageModel } from "./page-model";
import { detectContentProtectionPage } from "./detector";
import { discoverFields } from "./extractor";
import { discoverNavigation } from "./navigation";
import { cleanText, isElementVisible, redactText, truncate, waitForStableDOM } from "./dom";
import { accessibleName, buildSelectorHints, describeAncestry, resolveLabelledBy, roleOf } from "./selectors";

function semanticElements(roots: Element[], selector: string, limit: number, excerptLength: number): { items: SemanticElementInfo[]; total: number } {
  const items: SemanticElementInfo[] = [];
  let total = 0;
  for (const root of roots) {
    for (const el of queryIncludingSelf(root, selector)) {
      if (isExcludedRegion(el) || !isElementVisible(el)) continue;
      total++;
      if (items.length >= limit) continue;
      const { role } = roleOf(el);
      items.push({
        role: role ?? el.tagName.toLowerCase(),
        tag: el.tagName.toLowerCase(),
        accessibleName: redactText(truncate(cleanText(el.getAttribute("aria-label")) || resolveLabelledBy(el) || "", 120)),
        textExcerpt: redactText(truncate(cleanText((el as HTMLElement).innerText ?? el.textContent), excerptLength)),
        childCount: el.children.length,
        ancestry: describeAncestry(el, 3),
        selectorHints: buildSelectorHints(el, { name: accessibleName(el) }).slice(0, 3),
      });
    }
  }
  return { items, total };
}

/** Scope roots already include any visible non-private dialog outside role="main" (a match could
 * open as an overlay), so this only needs to look within them. */
function dialogs(roots: Element[]): { items: SemanticElementInfo[]; total: number } {
  return semanticElements(roots, '[role="dialog"], [role="alertdialog"], dialog[open]', 20, 300);
}

function headings(roots: Element[]): HeadingInfo[] {
  const out: HeadingInfo[] = [];
  for (const root of roots) {
    for (const el of queryIncludingSelf(root, '[role="heading"], h1, h2, h3, h4, h5, h6')) {
      if (isExcludedRegion(el) || !isElementVisible(el)) continue;
      const text = cleanText((el as HTMLElement).innerText ?? el.textContent);
      if (!text) continue;
      const level = el.getAttribute("aria-level") ?? (/^H[1-6]$/.test(el.tagName) ? el.tagName[1] : null);
      out.push({ text: redactText(truncate(text, 200)), level: level ? Number(level) : null, ancestry: describeAncestry(el, 3) });
      if (out.length >= 100) return out;
    }
  }
  return out;
}

function attributeInventory(roots: Element[]): PageDiagnostic["attributes"] {
  const ariaLabels = new Set<string>();
  const ariaLabelledBy = new Map<string, string>();
  const dataTestIds = new Set<string>();
  const dataPagelets = new Set<string>();
  const titles = new Set<string>();
  for (const root of roots) {
    for (const el of queryIncludingSelf(root, "[aria-label], [aria-labelledby], [data-testid], [data-pagelet], [title]")) {
      if (isExcludedRegion(el) || !isElementVisible(el)) continue;
      const label = cleanText(el.getAttribute("aria-label"));
      if (label && ariaLabels.size < 300) ariaLabels.add(redactText(truncate(label, 160)));
      const ids = el.getAttribute("aria-labelledby");
      if (ids && ariaLabelledBy.size < 100) ariaLabelledBy.set(ids, redactText(truncate(resolveLabelledBy(el) ?? "", 160)));
      const testId = el.getAttribute("data-testid");
      if (testId && dataTestIds.size < 200) dataTestIds.add(testId);
      const pagelet = el.getAttribute("data-pagelet");
      if (pagelet && dataPagelets.size < 100) dataPagelets.add(pagelet);
      const title = cleanText(el.getAttribute("title"));
      // "Meaningful" = says something, and isn't just repeating the element's own visible text.
      if (title.length >= 2 && title !== cleanText(el.textContent) && titles.size < 100) titles.add(redactText(truncate(title, 160)));
    }
  }
  return {
    ariaLabels: [...ariaLabels],
    ariaLabelledBy: [...ariaLabelledBy].map(([ids, resolvedText]) => ({ ids, resolvedText })),
    dataTestIds: [...dataTestIds],
    dataPagelets: [...dataPagelets],
    titles: [...titles],
  };
}

function buildWarnings(diagnostic: Omit<PageDiagnostic, "warnings" | "durationMs">, model: PageModel): string[] {
  const warnings: string[] = [];
  const { detection } = diagnostic;
  if (!detection.isMetaHost) warnings.push("Not a facebook.com page.");
  else if (!detection.isContentProtectionPath) warnings.push(`URL path doesn't contain the known Content Protection path -- Meta may have moved it.`);
  if (detection.isContentProtectionPath && !detection.matchIdInUrl) warnings.push("No match_id in the URL -- this may be the overview/list page rather than an open match.");
  if (diagnostic.scope.strategy === "body") warnings.push('No role="main" found; inspected the whole body (minus Facebook\'s top bar).');
  if (diagnostic.scope.iframes.length > 0) warnings.push(`${diagnostic.scope.iframes.length} iframe(s) in scope -- content inside them isn't inspected.`);
  if (!diagnostic.domStability.stable) warnings.push("The page never fully stopped changing during the wait (a playing video can cause this) -- inspected anyway.");
  if (model.controlsTruncated) warnings.push("Control list was truncated.");
  if (model.textBlocksTruncated) warnings.push("Text block list was truncated.");
  if (diagnostic.navigation.next.filter((c) => c.usable).length === 0) warnings.push('No usable "next match" control found.');
  if (diagnostic.navigation.next.some((c) => !c.usable && c.blockedReason?.startsWith("forbidden"))) {
    warnings.push('A "next"-looking control was ruled out because it also matches a forbidden action.');
  }
  for (const field of ["metaMatchId", "infringingUrl", "infringerName"] as const) {
    if (diagnostic.fields[field].length === 0) warnings.push(`No candidates found for ${field}.`);
  }
  if (diagnostic.productionExtraction && !diagnostic.productionExtraction.ok) {
    warnings.push(`Production parser failed on this page: ${diagnostic.productionExtraction.error}`);
  }
  return warnings;
}

export async function inspectPage(deps: { extractCurrentMatch: () => CollectMatchResult }): Promise<PageDiagnostic> {
  const started = performance.now();
  const domStability = await waitForStableDOM({ quietMs: 400, timeoutMs: 3000 });

  const detection = detectContentProtectionPage();
  const model = buildPageModel();
  const fields = discoverFields(model);
  const navigation = discoverNavigation(model.controls);
  const rows = semanticElements(model.roots, '[role="row"], tr', 60, 200);
  const listItems = semanticElements(model.roots, '[role="listitem"], li', 80, 160);
  const dialogInfo = dialogs(model.roots);
  const headingInfo = headings(model.roots);

  let productionExtraction: CollectMatchResult | null = null;
  if (detection.isContentProtectionPath) {
    try {
      productionExtraction = deps.extractCurrentMatch();
    } catch (err) {
      productionExtraction = { ok: false, error: `Threw: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const partial: Omit<PageDiagnostic, "warnings" | "durationMs"> = {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    tool: "content-protection-inspector",
    extensionVersion: chrome.runtime.getManifest().version,
    page: {
      url: location.href,
      title: document.title,
      timestamp: new Date().toISOString(),
      readyState: document.readyState,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
      },
    },
    detection,
    domStability,
    scope: model.scope,
    controls: model.controls.map((r) => r.info),
    controlsTruncated: model.controlsTruncated,
    semantic: {
      dialogs: dialogInfo.items,
      rows: rows.items,
      listItems: listItems.items,
      headings: headingInfo,
      counts: { dialogs: dialogInfo.total, rows: rows.total, listItems: listItems.total, headings: headingInfo.length },
    },
    attributes: attributeInventory(model.roots),
    textBlocks: model.textBlocks.map((r) => r.block),
    textBlocksTruncated: model.textBlocksTruncated,
    fields,
    navigation,
    forbiddenControls: model.controls
      .filter((r) => r.info.risk === "forbidden")
      .map((r) => ({ controlIndex: r.info.index, label: truncate(r.info.accessibleName || r.info.text || r.info.tag, 80), reason: r.info.riskReason ?? "" })),
    productionExtraction,
  };

  return { ...partial, warnings: buildWarnings(partial, model), durationMs: Math.round(performance.now() - started) };
}
