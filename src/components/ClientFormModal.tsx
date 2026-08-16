import { useState, type FormEvent } from "react";
import { Modal } from "./Modal";
import { AffiliationTagPicker } from "./AffiliationTagPicker";
import type { Client, CreateClientInput } from "../../shared/types";

interface ClientFormModalProps {
  client?: Client | null;
  onSave: (input: CreateClientInput) => Promise<unknown>;
  onClose: () => void;
}

export function ClientFormModal({ client, onSave, onClose }: ClientFormModalProps) {
  const [name, setName] = useState(client?.name ?? "");
  const [affiliationTagId, setAffiliationTagId] = useState<string | null>(client?.affiliationTagId ?? null);
  const [notes, setNotes] = useState(client?.notes ?? "");
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
      await onSave({ name: name.trim(), affiliationTagId, notes: notes.trim() || null });
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
        <div className="field">
          <label>Affiliation</label>
          <AffiliationTagPicker value={affiliationTagId} onChange={setAffiliationTagId} />
        </div>
        <div className="field">
          <label htmlFor="client-notes">Notes</label>
          <textarea
            id="client-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Anything the team should know about this client…"
          />
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
