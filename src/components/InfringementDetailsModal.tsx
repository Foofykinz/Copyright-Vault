import { useState } from "react";
import type { ReactNode } from "react";
import { Modal } from "./Modal";
import { PlatformTag } from "./PlatformTag";
import { formatDisplayDate } from "../../shared/format";
import { useInfringementReportMutations } from "../hooks/useInfringementReports";
import {
  INFRINGEMENT_STATUS_LABELS,
  INFRINGEMENT_STATUSES,
  type InfringementReportWithNames,
  type InfringementStatus,
} from "../../shared/types";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail-field">
      <div className="detail-field-label">{label}</div>
      <div className="detail-field-value">{children}</div>
    </div>
  );
}

const AVAILABILITY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Unknown" },
  { value: "true", label: "Available" },
  { value: "false", label: "Not available" },
];

/** Full-record view for a single Rights Manager match, opened via "Details" on the Copyright
 * Archive tab. Status and video availability are editable inline (auto-save on change, same
 * pattern as the row-level status dropdown on the Infringements tab); everything else here is
 * read-only, captured by the extension at import time. */
export function InfringementDetailsModal({
  report,
  onClose,
  onChanged,
}: {
  report: InfringementReportWithNames;
  onClose: () => void;
  onChanged: (updated: InfringementReportWithNames) => void;
}) {
  const { update } = useInfringementReportMutations();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStatusChange = async (status: InfringementStatus) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await update(report.id, { status }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update.");
    } finally {
      setBusy(false);
    }
  };

  const handleAvailabilityChange = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const videoAvailable = value === "" ? null : value === "true";
      onChanged(await update(report.id, { videoAvailable }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Match details" onClose={onClose} wide>
      {error && (
        <p className="error-text" style={{ marginBottom: 10 }}>
          {error}
        </p>
      )}
      <div className="detail-grid">
        <Field label="Right Manager account">{report.rightsManagerAccountName ?? "—"}</Field>
        <Field label="User">{report.clientName ?? "—"}</Field>
        <Field label="Page">
          <a href={report.infringingUrl} target="_blank" rel="noreferrer">
            {report.infringerName}
          </a>
        </Field>
        <Field label="Posted at">{formatDisplayDate(report.postedAt)}</Field>
        <Field label="Attributes">
          <PlatformTag platform={report.platform} />
          {report.isAccountPrivate && <span className="tag-pill" style={{ marginLeft: 6 }}>Private 🔒</span>}
        </Field>
        <Field label="Match ID">{report.metaMatchId ?? "—"}</Field>
        <Field label="Video ID">{report.metaVideoId ?? "—"}</Field>
        {/* Distinct from Match ID -- this is Meta's ID for the protected (reference) file the match
            was found against. One per line when a match carries more than one, same order as the
            Reference files list below. */}
        <Field label="Reference file ID">
          {report.referenceFiles && report.referenceFiles.length > 0
            ? report.referenceFiles.map((f) => <div key={f.id}>{f.id}</div>)
            : "—"}
        </Field>
        <Field label="Match duration">{report.matchDurationSec !== null ? `${report.matchDurationSec}s` : "—"}</Field>
        <Field label="Views">{report.videoViewCount !== null ? report.videoViewCount.toLocaleString() : "—"}</Field>
        <Field label="Followers">{report.pageFollowerCount !== null ? report.pageFollowerCount.toLocaleString() : "—"}</Field>
        <Field label="Infringer profile">
          {report.infringerProfileUrl ? (
            <a href={report.infringerProfileUrl} target="_blank" rel="noreferrer">
              Open profile
            </a>
          ) : (
            "—"
          )}
        </Field>
        <Field label="Video available">
          <select
            value={report.videoAvailable === null ? "" : String(report.videoAvailable)}
            onChange={(e) => void handleAvailabilityChange(e.target.value)}
            disabled={busy}
          >
            {AVAILABILITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            value={report.status}
            onChange={(e) => void handleStatusChange(e.target.value as InfringementStatus)}
            disabled={busy}
          >
            {INFRINGEMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {INFRINGEMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {report.referenceFiles && report.referenceFiles.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="detail-field-label">Reference files</div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {report.referenceFiles.map((f) => (
              <li key={f.id}>{f.title}</li>
            ))}
          </ul>
        </div>
      )}

      {report.notes && (
        <div style={{ marginTop: 14 }}>
          <div className="detail-field-label">Notes</div>
          <p style={{ margin: "6px 0 0" }}>{report.notes}</p>
        </div>
      )}

      {report.screenshotKey && (
        <div style={{ marginTop: 14 }}>
          <div className="detail-field-label">Screenshot</div>
          <img
            src={`/api/infringement-reports/${report.id}/screenshot`}
            alt="Match screenshot"
            style={{ maxWidth: "100%", borderRadius: 6, marginTop: 6, border: "1px solid var(--border)" }}
          />
        </div>
      )}
    </Modal>
  );
}
