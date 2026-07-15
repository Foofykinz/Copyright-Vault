import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useClient } from "../hooks/useClients";
import { useCombinationFolder, useCombinationFolderMutations } from "../hooks/useCombinationFolders";
import { Breadcrumb } from "../components/Breadcrumb";
import { VideoTable } from "../components/VideoTable";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { DeadlineBadge } from "../components/DeadlineBadge";
import { LoadingBlock, ErrorBlock, StateBlock } from "../components/StateBlock";
import { formatDisplayDate } from "../../shared/format";

export function CombinationFolderPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const { combinationFolder, videos, loading, error, refetch } = useCombinationFolder(folderId);
  const { client } = useClient(combinationFolder?.clientId);
  const { rename, remove } = useCombinationFolderMutations(refetch);
  const navigate = useNavigate();

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;
  if (!combinationFolder) return <StateBlock title="Combination Folder not found." />;

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Combination Folders", to: "/folders" },
          { label: combinationFolder.name },
        ]}
      />
      <div className="page-header">
        <div>
          <h1 className="page-title flex-row">
            <span className="color-dot" style={{ background: combinationFolder.color }} />
            {combinationFolder.name}
          </h1>
          <div className="page-subtitle">
            {client?.name ?? "—"} · {combinationFolder.videoCount} video{combinationFolder.videoCount === 1 ? "" : "s"}
          </div>
        </div>
        <div className="page-actions">
          <button
            className="btn"
            onClick={() => {
              setNameDraft(combinationFolder.name);
              setRenaming(true);
            }}
          >
            Rename
          </button>
          <button className="btn btn-danger" onClick={() => setConfirmingDelete(true)}>
            Delete
          </button>
        </div>
      </div>

      <div className="stats-strip">
        <div className="stat-tile">
          <div className="stat-tile-label">Earliest publication</div>
          <div className="stat-tile-value" style={{ fontSize: 14 }}>
            {combinationFolder.earliestPublicationDate ? formatDisplayDate(combinationFolder.earliestPublicationDate) : "—"}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">Registration deadline</div>
          <div className="stat-tile-value" style={{ fontSize: 14 }}>
            {combinationFolder.registrationDeadline ? formatDisplayDate(combinationFolder.registrationDeadline) : "—"}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">Days remaining</div>
          <div className="stat-tile-value">
            {combinationFolder.daysRemaining !== null && combinationFolder.deadlineStatus ? (
              <DeadlineBadge daysRemaining={combinationFolder.daysRemaining} status={combinationFolder.deadlineStatus} />
            ) : (
              "—"
            )}
          </div>
        </div>
      </div>

      {videos.length === 0 ? (
        <StateBlock title="This folder has no videos yet.">
          <p>Select videos from a client's social account page and add them here.</p>
        </StateBlock>
      ) : (
        <VideoTable videos={videos} clientId={combinationFolder.clientId} onChanged={refetch} removeFromFolderId={combinationFolder.id} />
      )}

      {renaming && (
        <Modal title="Rename Combination Folder" onClose={() => setRenaming(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!nameDraft.trim()) return;
              await rename(combinationFolder.id, nameDraft.trim());
              setRenaming(false);
            }}
          >
            <div className="field">
              <label htmlFor="folder-name">Folder name</label>
              <input id="folder-name" type="text" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus maxLength={200} />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setRenaming(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete Combination Folder"
          message={`This deletes "${combinationFolder.name}". Videos inside it are not deleted — they remain in their original client/social/month location. This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={async () => {
            await remove(combinationFolder.id);
            navigate("/folders");
          }}
        />
      )}
    </div>
  );
}
