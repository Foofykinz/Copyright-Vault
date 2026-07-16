import { useLocalStorageState } from "../hooks/useLocalStorageState";

const EXTENSION_SETUP_URL = "https://github.com/Foofykinz/Copyright-Vault/tree/main/extension";

export function ExtensionInstallBanner() {
  const [dismissed, setDismissed] = useLocalStorageState("extensionBannerDismissed", false);

  if (dismissed) return null;

  return (
    <div className="extension-banner">
      <span>
        Pull videos automatically from TikTok and X with the Viral DRM Collector browser extension.{" "}
        <a href={EXTENSION_SETUP_URL} target="_blank" rel="noreferrer">
          Setup instructions
        </a>
      </span>
      <button className="btn btn-ghost btn-sm" onClick={() => setDismissed(true)} aria-label="Dismiss">
        Dismiss
      </button>
    </div>
  );
}
