import { useState } from "react";
import type { KeyboardEvent } from "react";
import { api } from "../lib/api";
import { useRightsManagerArchive } from "../hooks/useRightsManagerArchive";
import { useRightsManagerAccounts } from "../hooks/useRightsManagerAccounts";
import { useClients } from "../hooks/useClients";
import { useInfringementReportMutations } from "../hooks/useInfringementReports";
import { Breadcrumb } from "../components/Breadcrumb";
import { PlatformTag } from "../components/PlatformTag";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { InfringementDetailsModal } from "../components/InfringementDetailsModal";
import { LoadingBlock, ErrorBlock, StateBlock } from "../components/StateBlock";
import { formatDisplayDate } from "../../shared/format";
import {
  INFRINGEMENT_STATUS_LABELS,
  INFRINGEMENT_STATUSES,
  PLATFORMS,
  PLATFORM_LABELS,
  type InfringementReportListParams,
  type InfringementReportWithNames,
  type InfringementStatus,
  type Platform,
} from "../../shared/types";

const PAGE_SIZE = 25;
const COLUMN_COUNT = 14;

interface DraftFilters {
  rightsManagerAccountId: string;
  clientId: string;
  infringerName: string;
  postedFrom: string;
  postedTo: string;
  platform: string;
  matchId: string;
  videoId: string;
  videoAvailable: boolean;
  viewsMin: string;
  viewsMax: string;
  followersMin: string;
  followersMax: string;
  status: string;
}

const EMPTY_FILTERS: DraftFilters = {
  rightsManagerAccountId: "",
  clientId: "",
  infringerName: "",
  postedFrom: "",
  postedTo: "",
  platform: "",
  matchId: "",
  videoId: "",
  videoAvailable: false,
  viewsMin: "",
  viewsMax: "",
  followersMin: "",
  followersMax: "",
  status: "",
};

function toParams(f: DraftFilters): InfringementReportListParams {
  return {
    rightsManagerAccountId: f.rightsManagerAccountId || undefined,
    clientId: f.clientId || undefined,
    infringerName: f.infringerName.trim() || undefined,
    postedFrom: f.postedFrom || undefined,
    postedTo: f.postedTo || undefined,
    platform: (f.platform || undefined) as Platform | undefined,
    matchId: f.matchId.trim() || undefined,
    videoId: f.videoId.trim() || undefined,
    videoAvailable: f.videoAvailable ? true : undefined,
    viewsMin: f.viewsMin.trim() ? Number(f.viewsMin) : undefined,
    viewsMax: f.viewsMax.trim() ? Number(f.viewsMax) : undefined,
    followersMin: f.followersMin.trim() ? Number(f.followersMin) : undefined,
    followersMax: f.followersMax.trim() ? Number(f.followersMax) : undefined,
    status: (f.status || undefined) as InfringementStatus | undefined,
  };
}

const STATUS_BADGE_CLASS: Record<InfringementStatus, string> = {
  needs_review: "badge-amber",
  logged: "badge-success",
  takedown: "badge-urgent",
  ignored: "badge-neutral",
};

function ArchiveRow({
  report,
  onDetails,
  onDelete,
  onStatusChange,
}: {
  report: InfringementReportWithNames;
  onDetails: () => void;
  onDelete: () => void;
  onStatusChange: (status: InfringementStatus) => void;
}) {
  const referenceTitles = report.referenceFiles?.map((f) => f.title) ?? [];

  return (
    <tr>
      <td className="mono text-secondary" title={report.id}>
        {report.id.slice(0, 8)}
      </td>
      <td>{report.rightsManagerAccountName ?? <span className="text-secondary">—</span>}</td>
      <td>{report.clientName ?? <span className="text-secondary">—</span>}</td>
      <td className="wrap">
        <a href={report.infringingUrl} target="_blank" rel="noreferrer">
          {report.infringerName}
        </a>
      </td>
      <td>{formatDisplayDate(report.postedAt)}</td>
      <td>
        <PlatformTag platform={report.platform} />
        {report.isAccountPrivate && (
          <span className="tag-pill" style={{ marginLeft: 4 }} title="Private account — Meta withholds the infringer's identity">
            🔒
          </span>
        )}
      </td>
      <td className="mono">{report.metaMatchId ?? <span className="text-secondary">—</span>}</td>
      <td className="mono">{report.metaVideoId ?? <span className="text-secondary">—</span>}</td>
      <td style={{ textAlign: "center" }}>
        {report.videoAvailable === null ? <span className="text-secondary">—</span> : report.videoAvailable ? "✅" : "❌"}
      </td>
      <td>{report.videoViewCount !== null ? report.videoViewCount.toLocaleString() : <span className="text-secondary">—</span>}</td>
      <td>{report.pageFollowerCount !== null ? report.pageFollowerCount.toLocaleString() : <span className="text-secondary">—</span>}</td>
      <td className="wrap">
        {referenceTitles.length > 0 ? (
          <>
            {/* Tooltip lists every file with its ID; the cell itself shows the first file's title and,
                on its own line, its ID (plus a "+N" if the match carries more than one). */}
            <span className="truncate" title={(report.referenceFiles ?? []).map((f) => `${f.title} (ID ${f.id})`).join("\n")}>
              {referenceTitles[0]}
              {referenceTitles.length > 1 ? ` +${referenceTitles.length - 1}` : ""}
            </span>
            <div className="mono text-secondary" style={{ fontSize: 11 }}>
              {report.referenceFiles?.[0]?.id}
            </div>
          </>
        ) : (
          <span className="text-secondary">—</span>
        )}
      </td>
      <td>
        <select
          className={`badge ${STATUS_BADGE_CLASS[report.status]}`}
          value={report.status}
          onChange={(e) => onStatusChange(e.target.value as InfringementStatus)}
        >
          {INFRINGEMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {INFRINGEMENT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </td>
      <td>
        <div className="flex-row">
          <button className="btn btn-ghost btn-sm" onClick={onDetails}>
            Details
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onDelete}>
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

/** Windowed page list, e.g. [1, 2, "…", 24, 25] for page 1 of 25 — always the first two pages,
 * the last two, and a small window around the current page, with "…" filling any gap. */
function buildPageList(page: number, totalPages: number): (number | "…")[] {
  const keep = new Set<number>([1, 2, totalPages - 1, totalPages, page - 1, page, page + 1]);
  const sorted = [...keep].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="pagination">
      <button className="btn btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      {buildPageList(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="pagination-gap">
            …
          </span>
        ) : (
          <button key={p} className={`btn btn-sm ${p === page ? "btn-primary" : ""}`} onClick={() => onChange(p)}>
            {p}
          </button>
        )
      )}
      <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </div>
  );
}

export function RightsManagerArchivePage() {
  const [showFilters, setShowFilters] = useState(true);
  const [draft, setDraft] = useState<DraftFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<DraftFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [detailsReport, setDetailsReport] = useState<InfringementReportWithNames | null>(null);
  const [deletingReport, setDeletingReport] = useState<InfringementReportWithNames | null>(null);

  const { rightsManagerAccounts } = useRightsManagerAccounts();
  const { clients } = useClients();
  const appliedParams = toParams(applied);
  const { infringementReports, total, totalPages, loading, error, refetch } = useRightsManagerArchive(appliedParams, page, PAGE_SIZE);
  const { update, remove } = useInfringementReportMutations(refetch);

  const updateDraft = <K extends keyof DraftFilters>(key: K, value: DraftFilters[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const applyFilters = () => {
    setApplied(draft);
    setPage(1);
  };

  const clearFilters = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  };

  const submitOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") applyFilters();
  };

  return (
    <div>
      <Breadcrumb items={[{ label: "Rights Manager" }]} />
      <div className="page-header">
        <div>
          <h1 className="page-title">Copyright Archive</h1>
          <div className="page-subtitle">
            {total.toLocaleString()} Rights Manager match{total === 1 ? "" : "es"} collected by the extension.
          </div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setShowFilters((s) => !s)}>
            Filters
          </button>
          <a className="btn btn-primary" href={api.infringementReports.exportUrl({ ...appliedParams, source: "rights_manager" })} download>
            Export
          </a>
        </div>
      </div>

      {error && <ErrorBlock message={error} />}

      <div className="table-wrap">
        <table className="dense-table archive-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Right Manager</th>
              <th>User</th>
              <th>Page</th>
              <th>Posted at</th>
              <th>Attributes</th>
              <th>Match ID</th>
              <th>Video ID</th>
              <th>Video Available</th>
              <th>Views</th>
              <th>Followers</th>
              <th>Reference files</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
            {showFilters && (
              <tr className="filter-row">
                <td></td>
                <td>
                  <select value={draft.rightsManagerAccountId} onChange={(e) => updateDraft("rightsManagerAccountId", e.target.value)}>
                    <option value="">All</option>
                    {rightsManagerAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={draft.clientId} onChange={(e) => updateDraft("clientId", e.target.value)}>
                    <option value="">All</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="text"
                    placeholder="Filter Page"
                    value={draft.infringerName}
                    onChange={(e) => updateDraft("infringerName", e.target.value)}
                    onKeyDown={submitOnEnter}
                  />
                </td>
                <td>
                  <div className="filter-range">
                    <input type="date" value={draft.postedFrom} onChange={(e) => updateDraft("postedFrom", e.target.value)} />
                    <input type="date" value={draft.postedTo} onChange={(e) => updateDraft("postedTo", e.target.value)} />
                  </div>
                </td>
                <td>
                  <select value={draft.platform} onChange={(e) => updateDraft("platform", e.target.value)}>
                    <option value="">All</option>
                    {PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {PLATFORM_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="text"
                    placeholder="Filter Match ID"
                    value={draft.matchId}
                    onChange={(e) => updateDraft("matchId", e.target.value)}
                    onKeyDown={submitOnEnter}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    placeholder="Filter Video ID"
                    value={draft.videoId}
                    onChange={(e) => updateDraft("videoId", e.target.value)}
                    onKeyDown={submitOnEnter}
                  />
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={draft.videoAvailable}
                    onChange={(e) => updateDraft("videoAvailable", e.target.checked)}
                    title="Only show matches with an available video"
                  />
                </td>
                <td>
                  <div className="filter-range">
                    <input type="number" placeholder="From" value={draft.viewsMin} onChange={(e) => updateDraft("viewsMin", e.target.value)} />
                    <input type="number" placeholder="To" value={draft.viewsMax} onChange={(e) => updateDraft("viewsMax", e.target.value)} />
                  </div>
                </td>
                <td>
                  <div className="filter-range">
                    <input
                      type="number"
                      placeholder="From"
                      value={draft.followersMin}
                      onChange={(e) => updateDraft("followersMin", e.target.value)}
                    />
                    <input type="number" placeholder="To" value={draft.followersMax} onChange={(e) => updateDraft("followersMax", e.target.value)} />
                  </div>
                </td>
                <td></td>
                <td>
                  <select value={draft.status} onChange={(e) => updateDraft("status", e.target.value)}>
                    <option value="">All</option>
                    {INFRINGEMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {INFRINGEMENT_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <div className="flex-row">
                    <button className="btn btn-primary btn-sm" onClick={applyFilters}>
                      Filter
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={clearFilters}>
                      Clear
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={COLUMN_COUNT}>
                  <LoadingBlock />
                </td>
              </tr>
            )}
            {!loading && infringementReports.length === 0 && (
              <tr>
                <td colSpan={COLUMN_COUNT}>
                  <StateBlock title="No matches found." />
                </td>
              </tr>
            )}
            {!loading &&
              infringementReports.map((report) => (
                <ArchiveRow
                  key={report.id}
                  report={report}
                  onDetails={() => setDetailsReport(report)}
                  onDelete={() => setDeletingReport(report)}
                  onStatusChange={(status) => void update(report.id, { status })}
                />
              ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />

      {detailsReport && (
        <InfringementDetailsModal
          report={detailsReport}
          onClose={() => setDetailsReport(null)}
          onChanged={(updated) => {
            setDetailsReport(updated);
            refetch();
          }}
        />
      )}

      {deletingReport && (
        <ConfirmDialog
          title="Delete match"
          message={`This permanently deletes the match against "${deletingReport.infringerName}". This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeletingReport(null)}
          onConfirm={async () => {
            await remove(deletingReport.id);
            setDeletingReport(null);
          }}
        />
      )}
    </div>
  );
}
