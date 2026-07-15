import { useState, type FormEvent } from "react";
import { Modal } from "./Modal";
import { useCombinationFolders, useCombinationFolderMutations } from "../hooks/useCombinationFolders";

interface CombinationFolderAssignModalProps {
  clientId: string;
  videoIds: string[];
  onDone: () => void;
  onClose: () => void;
}

export function CombinationFolderAssignModal({ clientId, videoIds, onDone, onClose }: CombinationFolderAssignModalProps) {
  const { combinationFolders, loading } = useCombinationFolders(clientId);
  const { create, addVideos } = useCombinationFolderMutations();

  const [mode, setMode] = useState<"existing" | "new">(combinationFolders.length > 0 ? "existing" : "new");
  const [existingFolderId, setExistingFolderId] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "existing") {
      if (!existingFolderId) return setError("Choose a Combination Folder.");
      setBusy(true);
      try {
        await addVideos(existingFolderId, videoIds);
        onDone();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add videos to folder.");
        setBusy(false);
      }
      return;
    }

    if (!newFolderName.trim()) return setError("Folder name is required.");
    setBusy(true);
    try {
      await create(clientId, newFolderName.trim(), videoIds);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder.");
      setBusy(false);
    }
  };

  return (
    <Modal title={`Add ${videoIds.length} video${videoIds.length === 1 ? "" : "s"} to Combination Folder`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>
            <input
              type="radio"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              disabled={combinationFolders.length === 0}
              style={{ marginRight: 6 }}
            />
            Add to existing folder
          </label>
          {mode === "existing" && (
            <select
              value={existingFolderId}
              onChange={(e) => setExistingFolderId(e.target.value)}
              disabled={loading || combinationFolders.length === 0}
              style={{ marginTop: 6 }}
            >
              <option value="">Select a folder…</option>
              {combinationFolders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.videoCount} video{f.videoCount === 1 ? "" : "s"})
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="field">
          <label>
            <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} style={{ marginRight: 6 }} />
            Create new folder
          </label>
          {mode === "new" && (
            <input
              type="text"
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              maxLength={200}
              style={{ marginTop: 6 }}
              autoFocus
            />
          )}
        </div>
        {error && <span className="field-error">{error}</span>}
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
