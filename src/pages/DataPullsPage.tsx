import { useState } from "react";
import type { KeyboardEvent } from "react";
import { api } from "../lib/api";
import { useAsync } from "../hooks/useAsync";
import { useRightsManagerAccounts } from "../hooks/useRightsManagerAccounts";
import { useClients } from "../hooks/useClients";
import { Breadcrumb } from "../components/Breadcrumb";
import { PlatformTag } from "../components/PlatformTag";
import { LoadingBlock, ErrorBlock, StateBlock } from "../components/StateBlock";
import { formatDisplayDate } from "../../shared/format";
import { TAKEDOWN_STATUS_LABELS, type DataPullListParams, type DataPullWithNames, type TakedownStatus } from "../../shared/types";

const PAGE_SIZE = 50;
const COLUMN_COUNT = 11;

interface Filters {
  rightsManagerAccountId: string;
  clientId: string;
  takedownStatus: string;
  search: string;
  pulledFrom: string;
  pulledTo: string;
}

const EMPTY_FILTERS: Filters = { rightsManagerAccountId: "", clientId: "", takedownStatus: "", search: "", pulledFrom: "", pulledTo: "" };

function toParams(f: Filters): DataPullListParams {
  return {
    rightsManagerAccountId: f.rightsManagerAccountId || undefined,
    clientId: f.clientId || undefined,
    takedownStatus: (f.takedownStatus || undefined) as TakedownStatus | "none" | undefined,
    search: f.search.trim() || undefined,
    pulledFrom: f.pulledFrom || undefined,
    pulledTo: f.pulledTo || undefined,
  };
}

const TAKEDOWN_BADGE_CLASS: Record<TakedownStatus, string> = {
  requested: "badge-amber",
  approved: "badge-success",
};

function DataPullRow({ pull }: { pull: DataPullWithNames }) {
  return (
    <tr>
      <td className="mono">{pull.metaMatchId}</td>
      <td>{pull.rightsManagerAccountName ?? <span className="text-secondary">—</span>}</td>
      <td>{pull.clientName ?? <span className="text-secondary">—</span>}</td>
      <td className="wrap">
        {pull.infringingUrl ? (
          <a href={pull.infringingUrl} target="_blank" rel="noreferrer">
            {pull.infringerName}
          </a>
        ) : (
          pull.infringerName
        )}
      </td>
      <td>
        <PlatformTag platform={pull.platform} />
      </td>
      <td>{pull.detectedAt ? formatDisplayDate(pull.detectedAt) : <span className="text-secondary">—</span>}</td>
      <td>{pull.videoViewCount !== null ? pull.videoViewCount.toLocaleString() : <span className="text-secondary">—</span>}</td>
      <td>{pull.pageFollowerCount !== null ? pull.pageFollowerCount.toLocaleString() : <span className="text-secondary">—</span>}</td>
      <td className="wrap">
        {pull.referenceFiles.length > 0 ? (
          <>
            <span className="truncate" title={pull.referenceFiles.map((f) => `${f.title} (ID ${f.id})`).join("\n")}>
              {pull.referenceFiles[0].title}
              {pull.referenceFiles.length > 1 ? ` +${pull.referenceFiles.length - 1}` : ""}
            </span>
            <div className="mono text-secondary" style={{ fontSize: 11 }}>
              {pull.referenceFiles[0].id}
            </div>
          </>
        ) : (
          <span className="text-secondary">—</span>
        )}
      </td>
      <td>
        {pull.takedownStatus ? (
          <span className={`badge ${TAKEDOWN_BADGE_CLASS[pull.takedownStatus]}`}>{TAKEDOWN_STATUS_LABELS[pull.takedownStatus]}</span>
        ) : (
          <span className="text-secondary">—</span>
        )}
      </td>
      <td title={`First pulled ${new Date(pull.firstPulledAt).toLocaleString()}`}>{new Date(pull.lastPulledAt).toLocaleString()}</td>
    </tr>
  );
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="pagination">
      <button className="btn btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span className="pagination-gap">
        Page {page} of {totalPages}
      </span>
      <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </div>
  );
}

/** Match data collected by the extension's automated "Data pull" clickthrough of Content
 * Protection -- separate from the Copyright Archive's evidence captures (no screenshots, no review
 * status). One row per match; re-pulling a match refreshes its row. */
export function DataPullsPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  const { rightsManagerAccounts } = useRightsManagerAccounts();
  const { clients } = useClients();
  const params = toParams(applied);
  const { data, loading, error } = useAsync(() => api.dataPulls.list({ ...params, page, pageSize: PAGE_SIZE }), [JSON.stringify(params), page]);
  const dataPulls = data?.dataPulls ?? [];
  const total = data?.total ?? 0;

  const update = <K extends keyof Filters>(key: K, value: Filters[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const apply = () => {
    setApplied(draft);
    setPage(1);
  };
  const clear = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  };
  const submitOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") apply();
  };

  return (
    <div>
      <Breadcrumb items={[{ label: "Data Pulls" }]} />
      <div className="page-header">
        <div>
          <h1 className="page-title">Data Pulls</h1>
          <div className="page-subtitle">
            {total.toLocaleString()} match{total === 1 ? "" : "es"} pulled from Content Protection by the extension's automated data pull.
          </div>
        </div>
        <div className="page-actions">
          <a className="btn btn-primary" href={api.dataPulls.exportUrl(params)} download>
            Export CSV
          </a>
        </div>
      </div>

      <div className="filter-bar flex-row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <select value={draft.rightsManagerAccountId} onChange={(e) => update("rightsManagerAccountId", e.target.value)}>
          <option value="">All Rights Manager accounts</option>
          {rightsManagerAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select value={draft.clientId} onChange={(e) => update("clientId", e.target.value)}>
          <option value="">All users</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={draft.takedownStatus} onChange={(e) => update("takedownStatus", e.target.value)}>
          <option value="">Any takedown status</option>
          <option value="requested">{TAKEDOWN_STATUS_LABELS.requested}</option>
          <option value="approved">{TAKEDOWN_STATUS_LABELS.approved}</option>
          <option value="none">No takedown</option>
        </select>
        <input type="text" placeholder="Page name or Match ID" value={draft.search} onChange={(e) => update("search", e.target.value)} onKeyDown={submitOnEnter} />
        <label className="flex-row" style={{ gap: 4 }}>
          Pulled
          <input type="date" value={draft.pulledFrom} onChange={(e) => update("pulledFrom", e.target.value)} />
          to
          <input type="date" value={draft.pulledTo} onChange={(e) => update("pulledTo", e.target.value)} />
        </label>
        <button className="btn btn-primary btn-sm" onClick={apply}>
          Filter
        </button>
        <button className="btn btn-ghost btn-sm" onClick={clear}>
          Clear
        </button>
      </div>

      {error && <ErrorBlock message={error} />}

      <div className="table-wrap">
        <table className="dense-table archive-table">
          <thead>
            <tr>
              <th>Match ID</th>
              <th>Right Manager</th>
              <th>User</th>
              <th>Page</th>
              <th>Platform</th>
              <th>Detected</th>
              <th>Views</th>
              <th>Followers</th>
              <th>Reference files</th>
              <th>Takedown</th>
              <th>Last pulled</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={COLUMN_COUNT}>
                  <LoadingBlock />
                </td>
              </tr>
            )}
            {!loading && dataPulls.length === 0 && (
              <tr>
                <td colSpan={COLUMN_COUNT}>
                  <StateBlock title="No data pulls yet." />
                </td>
              </tr>
            )}
            {!loading && dataPulls.map((pull) => <DataPullRow key={pull.id} pull={pull} />)}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={data?.totalPages ?? 1} onChange={setPage} />
    </div>
  );
}
