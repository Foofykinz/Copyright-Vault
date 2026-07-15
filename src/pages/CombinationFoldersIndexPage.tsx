import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useClients } from "../hooks/useClients";
import { useAllCombinationFolders, useCombinationFolderMutations } from "../hooks/useCombinationFolders";
import { Breadcrumb } from "../components/Breadcrumb";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DeadlineBadge } from "../components/DeadlineBadge";
import { LoadingBlock, StateBlock } from "../components/StateBlock";
import { formatDisplayDate } from "../../shared/format";
import type { CombinationFolderWithComputed } from "../../shared/types";

export function CombinationFoldersIndexPage() {
  const { combinationFolders, loading, refetch } = useAllCombinationFolders();
  const { clients } = useClients();
  const { remove } = useCombinationFolderMutations(refetch);
  const [removing, setRemoving] = useState<CombinationFolderWithComputed | null>(null);

  const clientNameById = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);

  return (
    <div>
      <Breadcrumb items={[{ label: "Combination Folders" }]} />
      <div className="page-header">
        <div>
          <h1 className="page-title">Combination Folders</h1>
          <div className="page-subtitle">Groups of videos staged for combining in Squeeze.</div>
        </div>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : combinationFolders.length === 0 ? (
        <StateBlock title="No Combination Folders yet.">
          <p>Select videos from a client's social account page and add them to a new folder.</p>
        </StateBlock>
      ) : (
        <div className="table-wrap">
          <table className="dense-table">
            <thead>
              <tr>
                <th>Folder</th>
                <th>Client</th>
                <th>Videos</th>
                <th>Earliest Publication</th>
                <th>Registration Deadline</th>
                <th>Days Left</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {combinationFolders.map((folder) => (
                <tr key={folder.id}>
                  <td>
                    <Link to={`/folders/${folder.id}`} className="flex-row">
                      <span className="color-dot" style={{ background: folder.color }} />
                      {folder.name}
                    </Link>
                  </td>
                  <td>{clientNameById.get(folder.clientId) ?? "—"}</td>
                  <td>{folder.videoCount}</td>
                  <td>{folder.earliestPublicationDate ? formatDisplayDate(folder.earliestPublicationDate) : "—"}</td>
                  <td>{folder.registrationDeadline ? formatDisplayDate(folder.registrationDeadline) : "—"}</td>
                  <td>
                    {folder.daysRemaining !== null && folder.deadlineStatus ? (
                      <DeadlineBadge daysRemaining={folder.daysRemaining} status={folder.deadlineStatus} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm btn-danger" onClick={() => setRemoving(folder)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {removing && (
        <ConfirmDialog
          title="Delete Combination Folder"
          message={`This deletes "${removing.name}". Videos inside it are not deleted — they remain in their original client/social/month location. This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await remove(removing.id);
            setRemoving(null);
          }}
        />
      )}
    </div>
  );
}
