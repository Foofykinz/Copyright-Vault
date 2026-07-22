import { useAsync } from "../hooks/useAsync";
import { api } from "../lib/api";
import { Breadcrumb } from "../components/Breadcrumb";
import { LoadingBlock, ErrorBlock } from "../components/StateBlock";
import { INFRINGEMENT_STATUS_LABELS, INFRINGEMENT_STATUSES, type DeadlineStatus } from "../../shared/types";

const DEADLINE_STATUS_LABELS: Record<DeadlineStatus, string> = {
  neutral: "On track",
  amber: "Due soon",
  urgent: "Urgent",
  expired: "Expired",
};
const DEADLINE_STATUSES: DeadlineStatus[] = ["neutral", "amber", "urgent", "expired"];

export function DashboardPage() {
  const { data, loading, error } = useAsync(() => api.stats.get(), []);
  const stats = data?.stats;

  return (
    <div>
      <Breadcrumb items={[{ label: "Dashboard" }]} />
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <div className="page-subtitle">Aggregate numbers across every client. No per-person activity here.</div>
        </div>
      </div>

      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}

      {stats && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="hint">Clients</div>
              <div className="stat-value">{stats.totalClients.toLocaleString()}</div>
            </div>
            <div className="stat-card">
              <div className="hint">Social Accounts</div>
              <div className="stat-value">{stats.totalSocialAccounts.toLocaleString()}</div>
            </div>
            <div className="stat-card">
              <div className="hint">Videos Logged</div>
              <div className="stat-value">{stats.totalVideos.toLocaleString()}</div>
            </div>
            <div className="stat-card">
              <div className="hint">Sent to Rights Manager</div>
              <div className="stat-value">{stats.totalSentToRightsManager.toLocaleString()}</div>
            </div>
            <div className="stat-card">
              <div className="hint">Infringements Tracked</div>
              <div className="stat-value">{stats.totalInfringementReports.toLocaleString()}</div>
            </div>
          </div>

          <div className="field" style={{ marginTop: 24 }}>
            <h2 className="page-subtitle">Videos by registration deadline</h2>
            <div className="stat-breakdown">
              {DEADLINE_STATUSES.map((s) => (
                <span key={s} className={`badge badge-${s}`}>
                  {DEADLINE_STATUS_LABELS[s]}: {stats.videosByDeadlineStatus[s].toLocaleString()}
                </span>
              ))}
            </div>
          </div>

          <div className="field" style={{ marginTop: 24 }}>
            <h2 className="page-subtitle">Infringements by status</h2>
            <div className="stat-breakdown">
              {INFRINGEMENT_STATUSES.map((s) => (
                <span key={s} className="badge badge-neutral">
                  {INFRINGEMENT_STATUS_LABELS[s]}: {stats.infringementsByStatus[s].toLocaleString()}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
