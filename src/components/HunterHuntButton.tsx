import { useState } from "react";
import { api, ApiRequestError } from "../lib/api";
import { HunterHuntResultsModal } from "./HunterHuntResultsModal";
import type { HuntSourceResult } from "../../shared/types";

/**
 * HUNT THIS SOURCE NOW — the Phase 2 trigger. Rendered only where the caller has already checked
 * user.hunterAccess (see VideoTableRow); that's convenience only, the real enforcement is server-side
 * (requireHunterAccess on every /api/hunter/* route) regardless of what this button does.
 */
export function HunterHuntButton({ videoId }: { videoId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HuntSourceResult | null>(null);

  const runHunt = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.hunter.hunt(videoId);
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Hunt failed unexpectedly.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        className="btn btn-ghost btn-sm"
        onClick={runHunt}
        disabled={loading}
        title="Search YouTube for possible reuse of this video (private — Vault Hunter)"
      >
        {loading ? "Hunting…" : "Hunt This Source Now"}
      </button>
      {error && (
        <span className="error-text" style={{ fontSize: 11 }} title={error}>
          {error}
        </span>
      )}
      {result && <HunterHuntResultsModal result={result} onClose={() => setResult(null)} />}
    </>
  );
}
