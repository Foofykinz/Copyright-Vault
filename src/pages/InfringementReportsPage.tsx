import { useState, type FormEvent } from "react";
import { useClients } from "../hooks/useClients";
import { useInfringementReports, useInfringementReportMutations } from "../hooks/useInfringementReports";
import { Breadcrumb } from "../components/Breadcrumb";
import { PlatformTag } from "../components/PlatformTag";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LoadingBlock, StateBlock } from "../components/StateBlock";
import { formatDisplayDate } from "../../shared/format";
import {
  INFRINGEMENT_STATUS_LABELS,
  INFRINGEMENT_STATUSES,
  PLATFORMS,
  PLATFORM_LABELS,
  type InfringementReportWithNames,
  type InfringementStatus,
  type Platform,
} from "../../shared/types";

const TABS: (InfringementStatus | "all")[] = ["needs_review", "logged", "takedown", "ignored", "all"];
const TAB_LABELS: Record<InfringementStatus | "all", string> = { ...INFRINGEMENT_STATUS_LABELS, all: "All" };

function QuickAddForm({ onAdded }: { onAdded: () => void }) {
  const { clients } = useClients();
  const { create } = useInfringementReportMutations(onAdded);

  const [clientId, setClientId] = useState("");
  const [infringerName, setInfringerName] = useState("");
  const [infringingUrl, setInfringingUrl] = useState("");
  const [platform, setPlatform] = useState<Platform>("facebook");
  const [postedAt, setPostedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!infringerName.trim() || !infringingUrl.trim() || !postedAt) {
      setError("Infringer name, link, and posted date are required.");
      return;
    }
    setBusy(true);
    try {
      await create({
        clientId: clientId || null,
        infringerName: infringerName.trim(),
        infringingUrl: infringingUrl.trim(),
        platform,
        postedAt,
        notes: notes.trim() || null,
      });
      setClientId("");
      setInfringerName("");
      setInfringingUrl("");
      setPostedAt("");
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log infringement.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="quick-add-form">
      <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ width: 160 }} disabled={busy}>
        <option value="">Creator (optional)</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input
        type="text"
        placeholder="Infringer name"
        value={infringerName}
        onChange={(e) => setInfringerName(e.target.value)}
        disabled={busy}
        style={{ width: 160 }}
      />
      <input
        type="url"
        placeholder="Infringing link"
        value={infringingUrl}
        onChange={(e) => setInfringingUrl(e.target.value)}
        disabled={busy}
        style={{ flex: 1, minWidth: 200 }}
      />
      <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} disabled={busy} style={{ width: 130 }}>
        {PLATFORMS.map((p) => (
          <option key={p} value={p}>
            {PLATFORM_LABELS[p]}
          </option>
        ))}
      </select>
      <input type="date" value={postedAt} onChange={(e) => setPostedAt(e.target.value)} disabled={busy} title="Date posted" />
      <input
        type="text"
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        disabled={busy}
        style={{ width: 160 }}
      />
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Logging…" : "Log it"}
      </button>
      {error && <span className="field-error">{error}</span>}
    </form>
  );
}

function ReportRow({ report, onChanged }: { report: InfringementReportWithNames; onChanged: () => void }) {
  const { update, remove } = useInfringementReportMutations(onChanged);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <tr>
      <td>{report.clientName ?? <span className="text-secondary">—</span>}</td>
      <td className="wrap">{report.infringerName}</td>
      <td>
        <PlatformTag platform={report.platform} />
      </td>
      <td>
        <a href={report.infringingUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
          Open
        </a>
      </td>
      <td>{formatDisplayDate(report.postedAt)}</td>
      <td>{formatDisplayDate(report.createdAt)}</td>
      <td>{report.foundByName}</td>
      <td className="wrap">{report.notes || <span className="text-secondary">—</span>}</td>
      <td>
        <select
          value={report.status}
          onChange={(e) => void update(report.id, { status: e.target.value as InfringementStatus })}
        >
          {INFRINGEMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {INFRINGEMENT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </td>
      <td>
        <button className="btn btn-ghost btn-sm" onClick={() => setConfirmingDelete(true)}>
          Delete
        </button>
      </td>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete infringement report"
          message="This permanently deletes this logged infringement. This cannot be undone."
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={async () => {
            await remove(report.id);
            setConfirmingDelete(false);
          }}
        />
      )}
    </tr>
  );
}

export function InfringementReportsPage() {
  const [tab, setTab] = useState<InfringementStatus | "all">("needs_review");
  const { infringementReports, loading, refetch } = useInfringementReports(tab);

  return (
    <div>
      <Breadcrumb items={[{ label: "Infringements" }]} />
      <div className="page-header">
        <div>
          <h1 className="page-title">Infringements</h1>
          <div className="page-subtitle">Someone else's content that's actually a client's — logged here instead of Signal.</div>
        </div>
      </div>

      <QuickAddForm onAdded={refetch} />

      <div className="toolbar" style={{ marginTop: 16 }}>
        {TABS.map((t) => (
          <button key={t} className={`btn btn-sm ${tab === t ? "btn-primary" : ""}`} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingBlock />
      ) : infringementReports.length === 0 ? (
        <StateBlock title="Nothing here." />
      ) : (
        <div className="table-wrap">
          <table className="dense-table">
            <thead>
              <tr>
                <th>Creator</th>
                <th>Infringer</th>
                <th>Platform</th>
                <th>Link</th>
                <th>Posted</th>
                <th>Found</th>
                <th>Found By</th>
                <th>Notes</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {infringementReports.map((report) => (
                <ReportRow key={report.id} report={report} onChanged={refetch} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
