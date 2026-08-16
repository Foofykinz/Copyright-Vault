import { Link, useSearchParams } from "react-router-dom";
import { useDeadlines } from "../hooks/useDeadlines";
import { Breadcrumb } from "../components/Breadcrumb";
import { PlatformTag } from "../components/PlatformTag";
import { DeadlineBadge } from "../components/DeadlineBadge";
import { LoadingBlock, ErrorBlock, StateBlock } from "../components/StateBlock";
import { formatDisplayDate } from "../../shared/format";
import type { DeadlineStatus } from "../../shared/types";

type Tab = DeadlineStatus | "attention";

const TABS: { value: Tab; label: string }[] = [
  { value: "attention", label: "Needs Attention" },
  { value: "amber", label: "Due Soon" },
  { value: "urgent", label: "Urgent" },
  { value: "expired", label: "Expired" },
];

export function DeadlinesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("status") as Tab | null) ?? "attention";
  const { videos, loading, error } = useDeadlines(tab === "attention" ? undefined : tab);

  return (
    <div>
      <Breadcrumb items={[{ label: "Dashboard", to: "/dashboard" }, { label: "Deadlines" }]} />
      <div className="page-header">
        <div>
          <h1 className="page-title">Deadlines</h1>
          <div className="page-subtitle">Every video across every client that's coming due, without opening each one.</div>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.value}
            className={`btn btn-sm ${tab === t.value ? "btn-primary" : ""}`}
            onClick={() => setSearchParams(t.value === "attention" ? {} : { status: t.value })}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}

      {!loading && !error && videos.length === 0 && <StateBlock title="Nothing in this list." />}

      {!loading && !error && videos.length > 0 && (
        <div className="table-wrap">
          <table className="dense-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Caption / Title</th>
                <th>Platform</th>
                <th>Published</th>
                <th>Deadline</th>
                <th>Days Left</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {videos.map((video) => (
                <tr key={video.id}>
                  <td>
                    <Link to={`/clients/${video.clientId}/social/${video.socialAccountId}`}>{video.clientName}</Link>
                  </td>
                  <td className="wrap">{video.caption || <span className="text-secondary">—</span>}</td>
                  <td>
                    <PlatformTag platform={video.platform} />
                  </td>
                  <td>{formatDisplayDate(video.publicationDate)}</td>
                  <td>{formatDisplayDate(video.registrationDeadline)}</td>
                  <td>
                    <DeadlineBadge daysRemaining={video.daysRemaining} status={video.deadlineStatus} />
                  </td>
                  <td>
                    <a href={video.videoUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                      Open
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
