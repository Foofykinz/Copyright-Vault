import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useClient } from "../hooks/useClients";
import { useCombinationFolders, useCombinationFolderMutations } from "../hooks/useCombinationFolders";
import { Breadcrumb } from "../components/Breadcrumb";
import { ClientTabs } from "../components/ClientTabs";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DeadlineBadge } from "../components/DeadlineBadge";
import { LoadingBlock, StateBlock } from "../components/StateBlock";
import { formatDisplayDate } from "../../shared/format";
import type { CombinationFolderWithComputed } from "../../shared/types";

export function ClientCombinationFoldersPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { client } = useClient(clientId);
  const { combinationFolders, loading, refetch } = useCombinationFolders(clientId);
  const { remove } = useCombinationFolderMutations(refetch);
  const [removing, setRemoving] = useState<CombinationFolderWithComputed | null>(null);

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Clients", to: "/" },
          { label: client?.name ?? "…", to: `/clients/${clientId}` },
          { label: "Combination Folders" },
        ]}
      />
      {clientId && <ClientTabs clientId={clientId} />}
      <div className="page-header">
        <div>
          <h1 className="page-title">Combination Folders</h1>
          <div className="page-subtitle">Groups of this client's videos staged for combining in Squeeze.</div>
        </div>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : combinationFolders.length === 0 ? (
        <StateBlock title="No Combination Folders yet.">
          <p>Select videos from a social account page and add them to a new folder.</p>
        </StateBlock>
      ) : (
        <div className="table-wrap">
          <table className="dense-table">
            <thead>
              <tr>
                <th>Folder</th>
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
                    <Link to={`/clients/${clientId}/combination-folders/${folder.id}`} className="flex-row">
                      <span className="color-dot" style={{ background: folder.color }} />
                      {folder.name}
                    </Link>
                  </td>
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
          message={`This deletes "${removing.name}". Videos inside it are not deleted — they remain in their original social account. This cannot be undone.`}
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
