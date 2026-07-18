import { Link } from "react-router-dom";
import { useLocalStorageState } from "../hooks/useLocalStorageState";

export function ExtensionInstallBanner() {
  const [dismissed, setDismissed] = useLocalStorageState("extensionBannerDismissed", false);

  if (dismissed) return null;

  return (
    <div className="extension-banner">
      <span>
        Pull videos automatically from TikTok, X, Facebook, Instagram, and YouTube with the Copyright Vault browser
        extension. <Link to="/extension">Download it here</Link>
      </span>
      <button className="btn btn-ghost btn-sm" onClick={() => setDismissed(true)} aria-label="Dismiss">
        Dismiss
      </button>
    </div>
  );
}
