import { useState } from "react";
import { useParams } from "react-router-dom";
import { useClient } from "../hooks/useClients";
import { useRightsManagerHistory } from "../hooks/useRightsManagerHistory";
import { Breadcrumb } from "../components/Breadcrumb";
import { ClientTabs } from "../components/ClientTabs";
import { PlatformTag } from "../components/PlatformTag";
import { LoadingBlock, ErrorBlock, StateBlock } from "../components/StateBlock";
import { formatDisplayDate } from "../../shared/format";
import type { RightsManagerBatchWithVideos } from "../../shared/types";

function BatchRow({ batch }: { batch: RightsManagerBatchWithVideos }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div className="flex-row" style={{ justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 600 }}>{batch.name}</div>
          <div className="hint">
            {formatDisplayDate(batch.createdAt)} · {batch.videoCount} video{batch.videoCount === 1 ? "" : "s"}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Hide videos" : "Show videos"}
        </button>
      </div>

      {expanded && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="dense-table">
            <thead>
              <tr>
                <th>Published</th>
                <th>Caption / Title</th>
                <th>Platform</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {batch.videos.map((video) => (
                <tr key={video.id}>
                  <td>{formatDisplayDate(video.publicationDate)}</td>
                  <td className="wrap">{video.caption || <span className="text-secondary">—</span>}</td>
                  <td>
                    <PlatformTag platform={video.platform} />
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

export function RightsManagerHistoryPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { client } = useClient(clientId);
  const { batches, loading, error } = useRightsManagerHistory(clientId);

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Clients", to: "/" },
          { label: client?.name ?? "…", to: `/clients/${clientId}` },
          { label: "Rights Manager History" },
        ]}
      />
      {clientId && <ClientTabs clientId={clientId} />}
      <div className="page-header">
        <div>
          <h1 className="page-title">Rights Manager History</h1>
          <div className="page-subtitle">Every "Mark as sent to Rights Manager" batch for this client.</div>
        </div>
      </div>

      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}

      {!loading && !error && batches.length === 0 && (
        <StateBlock title="Nothing sent to Rights Manager yet.">
          <p>Select videos from a social account page and use "Mark as sent to Rights Manager" to start a history here.</p>
        </StateBlock>
      )}

      {batches.map((batch) => (
        <BatchRow key={batch.id} batch={batch} />
      ))}
    </div>
  );
}
