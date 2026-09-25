import { Modal } from "./Modal";
import { formatDisplayDate, formatViewCount } from "../../shared/format";
import type { HunterCandidateWithVideo, HunterCandidatePriority, HuntSourceResult } from "../../shared/types";

const PRIORITY_BADGE_CLASS: Record<HunterCandidatePriority, string> = {
  high: "badge-urgent",
  review: "badge-amber",
  low: "badge-neutral",
};

const CHRONOLOGY_LABELS: Record<HunterCandidateWithVideo["chronology"], string> = {
  after_source: "After source",
  same_day: "Same day as source",
  before_source: "Before source",
  unknown: "Unknown",
};

function CandidateCard({ candidate }: { candidate: HunterCandidateWithVideo }) {
  const v = candidate.youtubeVideo;
  return (
    <div className={`hunter-candidate-card${candidate.suppressedReason ? " hunter-candidate-suppressed" : ""}`}>
      {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" className="hunter-candidate-thumb" />}
      <div className="hunter-candidate-body">
        <div className="flex-row" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <span className={`badge ${PRIORITY_BADGE_CLASS[candidate.priority]}`}>{candidate.priority.toUpperCase()}</span>
          {candidate.suppressedReason && (
            <span className="badge badge-neutral" title="Suppressed from normal review">
              {candidate.suppressedReason === "self_source" ? "SOURCE'S OWN UPLOAD" : "ALLOWLISTED"}
            </span>
          )}
          {candidate.newlyDiscovered && <span className="badge badge-success">NEW</span>}
          <span className="text-secondary" style={{ fontSize: 11 }}>
            score {candidate.priorityScore}
          </span>
        </div>
        <div className="truncate" title={v.title ?? undefined} style={{ fontWeight: 500, marginTop: 4 }}>
          {v.title || "(untitled)"}
        </div>
        <div className="text-secondary" style={{ fontSize: 12 }}>
          {v.channelTitle || "Unknown channel"} · {v.viewCount != null ? `${formatViewCount(v.viewCount)} views` : "views unknown"} ·{" "}
          {v.publishedAt ? formatDisplayDate(v.publishedAt) : "date unknown"}
        </div>
        <div className="text-secondary" style={{ fontSize: 12 }}>
          {CHRONOLOGY_LABELS[candidate.chronology]} · found by {candidate.discoveryQueries.length} quer
          {candidate.discoveryQueries.length === 1 ? "y" : "ies"}
        </div>
        <ul className="hunter-reasons">
          {candidate.priorityReasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        {v.youtubeVideoId && (
          <a
            href={`https://www.youtube.com/watch?v=${v.youtubeVideoId}`}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-sm"
          >
            Open on YouTube
          </a>
        )}
      </div>
    </div>
  );
}

export function HunterHuntResultsModal({ result, onClose }: { result: HuntSourceResult; onClose: () => void }) {
  const statusBadge =
    result.status === "SUCCESS" ? "badge-success" : result.status === "PARTIAL_SUCCESS" ? "badge-amber" : "badge-urgent";
  const visibleCandidates = result.candidates.filter((c) => !c.suppressedReason);
  const suppressedCandidates = result.candidates.filter((c) => c.suppressedReason);

  return (
    <Modal title="Hunt results" onClose={onClose} wide>
      <div className="hunter-results">
        <div className="flex-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <span className={`badge ${statusBadge}`}>{result.status.replace("_", " ")}</span>
          {result.error && <span className="error-text">{result.error}</span>}
          <span className="text-secondary" style={{ fontSize: 12 }}>
            {result.searchSummary.completed}/{result.searchSummary.attempted} queries completed
            {result.searchSummary.failed > 0 && `, ${result.searchSummary.failed} failed`}
            {result.searchSummary.skippedDueToBudget > 0 && `, ${result.searchSummary.skippedDueToBudget} skipped (budget)`}
          </span>
        </div>

        <details className="hunter-diagnostics" open={result.candidates.length === 0}>
          <summary>What Hunter did (source text, queries, per-query results)</summary>
          <div className="hunter-diagnostics-body">
            <div>
              <div className="text-secondary" style={{ fontSize: 11 }}>
                ORIGINAL CAPTION
              </div>
              <div className="wrap">{result.sourceText.original || "(empty)"}</div>
            </div>
            <div>
              <div className="text-secondary" style={{ fontSize: 11 }}>
                NORMALIZED FOR SEARCH
              </div>
              <div className="wrap">{result.sourceText.normalized || "(empty)"}</div>
            </div>
            <div>
              <div className="text-secondary" style={{ fontSize: 11 }}>
                GENERATED QUERIES
              </div>
              <table className="dense-table">
                <thead>
                  <tr>
                    <th>Strategy</th>
                    <th>Query</th>
                    <th>Results</th>
                    <th>New</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.generatedQueries.map((q) => {
                    const run = result.searchRuns.find((r) => r.query === q.query);
                    return (
                      <tr key={q.query}>
                        <td>{q.strategy.replace(/_/g, " ")}</td>
                        <td className="wrap">{q.query}</td>
                        <td>{run?.resultCount ?? "—"}</td>
                        <td>{run?.uniqueCandidatesFromThisQuery ?? "—"}</td>
                        <td>
                          {run?.skippedReason
                            ? "skipped (budget)"
                            : run?.succeeded
                              ? "ok"
                              : run?.error
                                ? `error: ${run.error}`
                                : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="text-secondary" style={{ fontSize: 11 }}>
              Search budget today: {result.quota.searchCallsMade}/{result.quota.searchCallsBudget} calls used
              {result.quota.searchQuotaExhaustedAt && " — YouTube reported quota exhaustion during this Hunt"}
            </div>
          </div>
        </details>

        {visibleCandidates.length === 0 && suppressedCandidates.length === 0 ? (
          <div className="state-block">
            <div className="state-block-title">No candidates found.</div>
            <div className="text-secondary">Nothing matched these searches yet — Hunter will find this again on a future run if anything changes.</div>
          </div>
        ) : (
          <>
            {visibleCandidates.length > 0 && (
              <div className="hunter-candidate-list">
                {visibleCandidates.map((c) => (
                  <CandidateCard key={c.id} candidate={c} />
                ))}
              </div>
            )}
            {suppressedCandidates.length > 0 && (
              <details>
                <summary>{suppressedCandidates.length} suppressed (source's own upload / allowlisted channel)</summary>
                <div className="hunter-candidate-list">
                  {suppressedCandidates.map((c) => (
                    <CandidateCard key={c.id} candidate={c} />
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
