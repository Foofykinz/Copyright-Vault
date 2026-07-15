import { useState, type FormEvent } from "react";
import { Modal } from "./Modal";
import { PLATFORMS, PLATFORM_LABELS, type Platform, type SocialAccount } from "../../shared/types";

interface SocialAccountFormValues {
  platform: Platform;
  accountName: string;
  profileUrl: string;
}

interface SocialAccountFormModalProps {
  account?: SocialAccount | null;
  onSave: (values: SocialAccountFormValues) => Promise<unknown>;
  onClose: () => void;
}

export function SocialAccountFormModal({ account, onSave, onClose }: SocialAccountFormModalProps) {
  const [platform, setPlatform] = useState<Platform>(account?.platform ?? "instagram");
  const [accountName, setAccountName] = useState(account?.accountName ?? "");
  const [profileUrl, setProfileUrl] = useState(account?.profileUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (accountName.trim().length === 0) {
      setError("Account/display name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({ platform, accountName: accountName.trim(), profileUrl: profileUrl.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save social account.");
      setBusy(false);
    }
  };

  return (
    <Modal title={account ? "Edit Social Account" : "Add Social Account"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="account-platform">Platform</label>
          <select id="account-platform" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="account-name">Account / display name</label>
          <input
            id="account-name"
            type="text"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            autoFocus
            maxLength={200}
          />
        </div>
        <div className="field">
          <label htmlFor="account-url">Profile URL (optional)</label>
          <input
            id="account-url"
            type="url"
            placeholder="https://…"
            value={profileUrl}
            onChange={(e) => setProfileUrl(e.target.value)}
          />
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
