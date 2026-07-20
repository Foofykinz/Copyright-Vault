import { useState, type FormEvent } from "react";
import { api } from "../lib/api";

/** Forced full-page password change shown after logging in with a temporary password — no
 * cancel option, since must_change_password stays true server-side until this succeeds. */
export function ChangePasswordPage({ onChanged }: { onChanged: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.auth.changePassword(currentPassword, newPassword);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password.");
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-title">Set a new password</div>
        <p className="auth-subtitle">You're using a temporary password. Choose your own before continuing.</p>
        <div className="field">
          <label htmlFor="cp-current">Temporary password</label>
          <input
            id="cp-current"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
          />
        </div>
        <div className="field">
          <label htmlFor="cp-new">New password</label>
          <input
            id="cp-new"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
          />
        </div>
        <div className="field">
          <label htmlFor="cp-confirm">Confirm new password</label>
          <input
            id="cp-confirm"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
          />
          {error && <span className="field-error">{error}</span>}
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Saving…" : "Set password"}
        </button>
      </form>
    </div>
  );
}
