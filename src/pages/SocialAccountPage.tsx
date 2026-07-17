import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useClient } from "../hooks/useClients";
import { useVideoMutations, useVideos } from "../hooks/useVideos";
import { Breadcrumb } from "../components/Breadcrumb";
import { VideoTable } from "../components/VideoTable";
import { ManualVideoEntryModal } from "../components/ManualVideoEntryModal";
import { LoadingBlock, ErrorBlock, StateBlock } from "../components/StateBlock";
import { formatDisplayDate, MONTH_NAMES } from "../../shared/format";

export function SocialAccountPage() {
  const { clientId, accountId } = useParams<{ clientId: string; accountId: string }>();
  const { client } = useClient(clientId);
  const { socialAccount, videos, loading, error, refetch } = useVideos(accountId);
  const { create } = useVideoMutations(accountId ?? "", refetch);

  const [selectedYear, setSelectedYear] = useState<number | "all">("all");
  const [selectedMonth, setSelectedMonth] = useState<number | "all">("all");
  const [addingVideo, setAddingVideo] = useState(false);
  const [pullMessage, setPullMessage] = useState<string | null>(null);

  const groups = useMemo(() => {
    const byYear = new Map<number, Map<number, number>>();
    for (const v of videos) {
      const y = Number(v.publicationDate.slice(0, 4));
      const m = Number(v.publicationDate.slice(5, 7));
      if (!byYear.has(y)) byYear.set(y, new Map());
      const byMonth = byYear.get(y)!;
      byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
    }
    return [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, monthMap]) => ({
        year,
        months: [...monthMap.entries()].sort((a, b) => b[0] - a[0]).map(([month, count]) => ({ month, count })),
        total: [...monthMap.values()].reduce((sum, c) => sum + c, 0),
      }));
  }, [videos]);

  const filteredVideos = useMemo(() => {
    if (selectedYear === "all") return videos;
    return videos.filter((v) => {
      const y = Number(v.publicationDate.slice(0, 4));
      if (y !== selectedYear) return false;
      if (selectedMonth === "all") return true;
      const m = Number(v.publicationDate.slice(5, 7));
      return m === selectedMonth;
    });
  }, [videos, selectedYear, selectedMonth]);

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;
  if (!socialAccount) return <StateBlock title="Social account not found." />;

  const headingLabel =
    selectedYear === "all" ? "All videos" : selectedMonth === "all" ? String(selectedYear) : `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}`;

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Clients", to: "/" },
          { label: client?.name ?? "…", to: `/clients/${clientId}` },
          { label: socialAccount.accountName },
        ]}
      />
      <div className="page-header">
        <div>
          <h1 className="page-title">{socialAccount.accountName}</h1>
          <div className="page-subtitle">{headingLabel}</div>
        </div>
        <div className="page-actions">
          {socialAccount.profileUrl ? (
            <a href={socialAccount.profileUrl} target="_blank" rel="noreferrer" className="btn">
              Open profile
            </a>
          ) : (
            <button
              className="btn"
              onClick={() => setPullMessage("Add a profile URL to this social account first (from the client page), then open it to use the extension.")}
            >
              Open profile
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setAddingVideo(true)}>
            + Add Video
          </button>
        </div>
      </div>

      <div className="hint" style={{ marginBottom: 12 }}>
        Last pulled: {socialAccount.lastPullAt ? formatDisplayDate(socialAccount.lastPullAt) : "Never"}
        {(socialAccount.platform === "tiktok" ||
          socialAccount.platform === "x" ||
          socialAccount.platform === "facebook" ||
          socialAccount.platform === "instagram") &&
          " · Open the profile above, then use the Viral DRM Collector extension to scan and send videos."}
      </div>

      {pullMessage && <div className="inline-info">{pullMessage}</div>}

      <div className="content-with-nav">
        <nav className="month-nav" aria-label="Filter by year and month">
          <ul className="month-nav-list">
            <li>
              <div
                className={`month-nav-item ${selectedYear === "all" ? "active" : ""}`}
                onClick={() => {
                  setSelectedYear("all");
                  setSelectedMonth("all");
                }}
              >
                <span>All videos</span>
                <span className="month-nav-count">{videos.length}</span>
              </div>
            </li>
          </ul>
          {groups.map((g) => (
            <div key={g.year}>
              <div className="month-nav-year">{g.year}</div>
              <ul className="month-nav-list">
                {g.months.map(({ month, count }) => (
                  <li key={month}>
                    <div
                      className={`month-nav-item ${selectedYear === g.year && selectedMonth === month ? "active" : ""}`}
                      onClick={() => {
                        setSelectedYear(g.year);
                        setSelectedMonth(month);
                      }}
                    >
                      <span>{MONTH_NAMES[month - 1]}</span>
                      <span className="month-nav-count">{count}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {groups.length === 0 && <div className="sidebar-empty">No videos yet.</div>}
        </nav>

        <VideoTable
          videos={filteredVideos}
          clientId={clientId ?? ""}
          onChanged={refetch}
          emptyMessage={videos.length === 0 ? "No videos yet. Add the first one manually." : "No videos match the current filters."}
        />
      </div>

      {addingVideo && (
        <ManualVideoEntryModal socialAccount={socialAccount} onSave={(input) => create(input)} onClose={() => setAddingVideo(false)} />
      )}
    </div>
  );
}
