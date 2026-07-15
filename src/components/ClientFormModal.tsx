import { useState, type FormEvent } from "react";
import { Modal } from "./Modal";
import type { Client } from "../../shared/types";

interface ClientFormModalProps {
  client?: Client | null;
  onSave: (name: string) => Promise<unknown>;
  onClose: () => void;
}

export function ClientFormModal({ client, onSave, onClose }: ClientFormModalProps) {
  const [name, setName] = useState(client?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length === 0) {
      setError("Client name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(name.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save client.");
      setBusy(false);
    }
  };

  return (
    <Modal title={client ? "Edit Client" : "Add Client"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="client-name">Client name</label>
          <input
            id="client-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={200}
          />
          {error && <span className="field-error">{error}</span>}
        </div>
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
