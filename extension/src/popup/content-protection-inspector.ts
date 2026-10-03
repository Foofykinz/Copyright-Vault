/** Side panel half of the temporary "Content Protection Inspector" developer tool. Shown under a
 * collapsed "Developer" section on any facebook.com tab; asks the content script for a read-only
 * PageDiagnostic and renders it. Kept out of popup/index.ts apart from one render() hook, and
 * holds its own state, so removing it later is a two-line change there. */
import {
  FIELD_NAMES,
  INSPECT_CONTENT_PROTECTION_MESSAGE,
  NAVIGATION_KINDS,
  type ControlInfo,
  type InspectResult,
  type PageDiagnostic,
} from "../content-protection/types";

interface InspectorState {
  running: boolean;
  result: PageDiagnostic | null;
  error: string | null;
  copyStatus: string | null;
  /** <details> keys left open -- the whole panel is rebuilt on every render(), so open/closed
   * state has to live here rather than in the DOM. */
  open: Set<string>;
}

const inspector: InspectorState = {
  running: false,
  result: null,
  error: null,
  copyStatus: null,
  open: new Set(["page", "fields", "navigation"]),
};

// Generous: inspect() waits up to 3s for the page to settle before it even starts reading.
const INSPECT_TIMEOUT_MS = 15_000;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string | null)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) {
    if (child !== null) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function section(key: string, title: string, children: (Node | null)[]): HTMLDetailsElement {
  const details = h("details", { className: "inspector-section", open: inspector.open.has(key) }, [h("summary", { textContent: title }), ...children]);
  details.addEventListener("toggle", () => {
    if (details.open) inspector.open.add(key);
    else inspector.open.delete(key);
  });
  return details;
}

function kv(key: string, value: string | number | boolean | null | undefined): HTMLElement {
  return h("div", { className: "kv" }, [h("span", { className: "k", textContent: key }), h("span", { className: "v", textContent: value === null || value === undefined || value === "" ? "—" : String(value) })]);
}

function list(rows: HTMLElement[], emptyText: string): HTMLElement {
  return h("div", { className: "inspector-list" }, rows.length > 0 ? rows : [h("div", { className: "hint", textContent: emptyText })]);
}

function controlLine(c: ControlInfo): string {
  const role = c.role ?? c.tag;
  const name = c.accessibleName || c.text || "(no name)";
  const flags = [c.disabled ? "disabled" : "", c.outsideScope ? "outside scope" : "", c.ariaHidden ? "aria-hidden" : "", c.inViewport ? "" : "offscreen"].filter(Boolean);
  return `#${c.index} ${role} "${name}"${c.href ? ` → ${c.href}` : ""}${flags.length ? ` [${flags.join(", ")}]` : ""}`;
}

async function runInspect(getTabId: () => Promise<number | undefined>, rerender: () => void): Promise<void> {
  inspector.running = true;
  inspector.error = null;
  inspector.copyStatus = null;
  rerender();
  try {
    const tabId = await getTabId();
    if (tabId === undefined) throw new Error("No active tab found.");
    const response = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: INSPECT_CONTENT_PROTECTION_MESSAGE }) as Promise<InspectResult | undefined>,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), INSPECT_TIMEOUT_MS)),
    ]);
    if (!response) throw new Error("No response from the page — refresh the tab (the extension may have been updated since it loaded) and try again.");
    if (!response.ok) throw new Error(response.error);
    inspector.result = response.diagnostic;
  } catch (err) {
    inspector.error = `Inspect failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    inspector.running = false;
    rerender();
  }
}

async function copyJson(rerender: () => void): Promise<void> {
  if (!inspector.result) return;
  const json = JSON.stringify(inspector.result, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    inspector.copyStatus = `Copied ${Math.round(json.length / 1024)} KB of JSON.`;
  } catch {
    // Clipboard API can refuse when the panel isn't focused -- fall back to the old way.
    const area = h("textarea", { value: json });
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    inspector.copyStatus = ok ? `Copied ${Math.round(json.length / 1024)} KB of JSON.` : "Couldn't copy to the clipboard.";
  }
  rerender();
}

function renderResult(d: PageDiagnostic): HTMLElement[] {
  const out: HTMLElement[] = [];

  if (d.warnings.length > 0) {
    out.push(h("div", { className: "warning" }, d.warnings.map((w) => h("div", { textContent: `⚠ ${w}` }))));
  }

  out.push(
    section(
      "page",
      "Page",
      [
        kv("URL", d.page.url),
        kv("Title", d.page.title),
        kv("Captured", new Date(d.page.timestamp).toLocaleString()),
        kv("Viewport", `${d.page.viewport.width}×${d.page.viewport.height} @${d.page.viewport.devicePixelRatio}x`),
        kv("Recognized", d.detection.recognized),
        kv("Page kind", d.detection.pageKind),
        kv("match_id in URL", d.detection.matchIdInUrl),
        kv('"See post" link', d.detection.hasSeePostText),
        kv("DOM settled", `${d.domStability.stable ? "yes" : "no"} after ${d.domStability.waitedMs}ms`),
        kv("Scope", `${d.scope.strategy}: ${d.scope.roots.join(" | ")}`),
        kv("Inspect took", `${d.durationMs}ms`),
      ]
    )
  );

  const prod = d.productionExtraction;
  out.push(
    section(
      "production",
      `Current capture parser: ${prod === null ? "n/a" : prod.ok ? "OK" : "failed"}`,
      [
        prod === null
          ? h("div", { className: "hint", textContent: "Not on a Content Protection path." })
          : prod.ok
            ? h("pre", { className: "mono", textContent: JSON.stringify(prod.match, null, 2) })
            : h("div", { className: "error", textContent: prod.error }),
      ]
    )
  );

  const fieldRows = FIELD_NAMES.map((field) => {
    const candidates = d.fields[field];
    const best = candidates[0];
    const head = h("div", { className: "kv" }, [
      h("span", { className: "k", textContent: field }),
      h("span", {
        className: `v${best ? ` conf-${best.confidence}` : ""}`,
        textContent: best ? `${best.value}${best.normalized !== undefined && best.normalized !== null && String(best.normalized) !== best.value ? ` (${best.normalized})` : ""}` : "—",
      }),
    ]);
    if (candidates.length === 0) return head;
    return h("div", {}, [
      head,
      h(
        "div",
        { className: "sub" },
        candidates.map((c) => h("div", { textContent: `${c.confidence} · ${c.source} · ${c.value}${c.evidence ? ` — ${c.evidence}` : ""}` }))
      ),
    ]);
  });
  out.push(section("fields", "Match field discovery", [h("div", { className: "inspector-list tall" }, fieldRows)]));

  const navRows = NAVIGATION_KINDS.map((kind) => {
    const candidates = d.navigation[kind];
    return h("div", {}, [
      h("div", { className: "k", textContent: `${kind} (${candidates.length})` }),
      h(
        "div",
        { className: "sub" },
        candidates.length > 0
          ? candidates
              .slice(0, 6)
              .map((c) =>
                h("div", {
                  className: c.usable ? "" : "blocked",
                  textContent: `#${c.controlIndex} "${c.label}" · score ${c.score} · ${c.reason}${c.usable ? "" : ` · NOT USABLE: ${c.blockedReason}`}${c.selectorHints[0] ? ` · ${c.selectorHints[0].value}` : ""}`,
                })
              )
          : [h("div", { textContent: "none found" })]
      ),
    ]);
  });
  out.push(section("navigation", "Navigation discovery", navRows));

  out.push(
    section(
      "forbidden",
      `Never-click controls (${d.forbiddenControls.length})`,
      [
        h("div", { className: "hint", textContent: "Matched an enforcement/status-changing action. Automation will never click these." }),
        list(
          d.forbiddenControls.map((f) => h("div", { textContent: `#${f.controlIndex} "${f.label}" — ${f.reason}` })),
          "None found."
        ),
      ]
    )
  );

  out.push(
    section(
      "controls",
      `Controls (${d.controls.length}${d.controlsTruncated ? "+" : ""})`,
      [
        list(
          d.controls.map((c) =>
            h("div", { className: c.risk === "forbidden" ? "blocked" : "" }, [
              h("div", { textContent: controlLine(c) }),
              h("div", { className: "sub", textContent: c.selectorHints[0] ? `${c.selectorHints[0].strategy}: ${c.selectorHints[0].value}` : c.ancestry }),
            ])
          ),
          "No controls found."
        ),
      ]
    )
  );

  out.push(
    section(
      "semantic",
      `Semantic elements (dialogs ${d.semantic.counts.dialogs} · rows ${d.semantic.counts.rows} · list items ${d.semantic.counts.listItems} · headings ${d.semantic.counts.headings})`,
      [
        h("div", { className: "k", textContent: "Headings" }),
        list(
          d.semantic.headings.map((x) => h("div", { textContent: `${x.level ? `h${x.level} ` : ""}${x.text}` })),
          "None."
        ),
        h("div", { className: "k", textContent: "Dialogs" }),
        list(
          d.semantic.dialogs.map((x) => h("div", { textContent: `${x.accessibleName || "(unnamed)"} — ${x.textExcerpt}` })),
          "None."
        ),
        h("div", { className: "k", textContent: "Rows / list items" }),
        list(
          [...d.semantic.rows, ...d.semantic.listItems].map((x) => h("div", { textContent: `${x.role}: ${x.accessibleName ? `[${x.accessibleName}] ` : ""}${x.textExcerpt}` })),
          "None."
        ),
      ]
    )
  );

  out.push(
    section(
      "text",
      `Visible text blocks (${d.textBlocks.length}${d.textBlocksTruncated ? "+" : ""})`,
      [
        list(
          d.textBlocks.map((b) => h("div", { className: b.heading ? "heading-block" : "", textContent: b.text })),
          "No text found."
        ),
      ]
    )
  );

  out.push(
    section(
      "attributes",
      `Attributes (aria-label ${d.attributes.ariaLabels.length} · data-testid ${d.attributes.dataTestIds.length} · title ${d.attributes.titles.length})`,
      [
        h("div", { className: "k", textContent: "aria-label" }),
        list(d.attributes.ariaLabels.map((v) => h("div", { textContent: v })), "None."),
        h("div", { className: "k", textContent: "aria-labelledby" }),
        list(d.attributes.ariaLabelledBy.map((v) => h("div", { textContent: v.resolvedText || `(ids: ${v.ids})` })), "None."),
        h("div", { className: "k", textContent: "data-testid / data-pagelet" }),
        list([...d.attributes.dataTestIds, ...d.attributes.dataPagelets.map((p) => `pagelet: ${p}`)].map((v) => h("div", { textContent: v })), "None."),
        h("div", { className: "k", textContent: "title" }),
        list(d.attributes.titles.map((v) => h("div", { textContent: v })), "None."),
      ]
    )
  );

  return out;
}

export function renderContentProtectionInspector(opts: { getTabId: () => Promise<number | undefined>; rerender: () => void }): HTMLElement {
  const { getTabId, rerender } = opts;

  const inspectBtn = h("button", { textContent: inspector.running ? "Inspecting…" : "Inspect Current Match", disabled: inspector.running });
  inspectBtn.addEventListener("click", () => void runInspect(getTabId, rerender));

  const copyBtn = h("button", { textContent: "Copy diagnostic JSON", disabled: !inspector.result || inspector.running });
  copyBtn.addEventListener("click", () => void copyJson(rerender));

  const body: (HTMLElement | null)[] = [
    h("div", {
      className: "hint",
      textContent: "Read-only diagnostic of the open Content Protection match. Doesn't click anything on the page, and the JSON never includes cookies, tokens, or storage.",
    }),
    h("div", { className: "field-row-inline" }, [inspectBtn, copyBtn]),
    inspector.copyStatus ? h("div", { className: "hint", textContent: inspector.copyStatus }) : null,
    inspector.error ? h("div", { className: "error", textContent: inspector.error }) : null,
    ...(inspector.result ? renderResult(inspector.result) : []),
  ];

  return section("root", "Developer: Content Protection Inspector", body);
}
