import { useAsync } from "../hooks/useAsync";
import { Breadcrumb } from "../components/Breadcrumb";
import { LoadingBlock, ErrorBlock } from "../components/StateBlock";
import { formatDisplayDate } from "../../shared/format";

interface ExtensionReleaseManifest {
  version: string;
  releaseDate: string;
  compatible: string;
  notes: string[];
  zipFilename: string;
}

async function fetchReleaseManifest(): Promise<ExtensionReleaseManifest> {
  const res = await fetch("/extension-releases/manifest.json");
  if (!res.ok) throw new Error("No extension release has been published yet.");
  return res.json() as Promise<ExtensionReleaseManifest>;
}

function ScreenshotPlaceholder({ label }: { label: string }) {
  return (
    <div className="screenshot-placeholder">
      <span>{label}</span>
    </div>
  );
}

export function ExtensionPage() {
  const { data: release, loading, error } = useAsync(fetchReleaseManifest, []);

  return (
    <div>
      <Breadcrumb items={[{ label: "Extension" }]} />
      <div className="page-header">
        <div>
          <h1 className="page-title">Copyright Vault Browser Extension</h1>
        </div>
      </div>

      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}

      {release && (
        <>
          <div className="extension-summary-card">
            <div className="extension-summary-grid">
              <div>
                <div className="hint">Current Version</div>
                <div className="extension-summary-value">v{release.version}</div>
              </div>
              <div>
                <div className="hint">Released</div>
                <div className="extension-summary-value">{formatDisplayDate(release.releaseDate)}</div>
              </div>
              <div>
                <div className="hint">Compatible</div>
                <div className="extension-summary-value">{release.compatible}</div>
              </div>
            </div>
            <a href={`/extension-releases/${release.zipFilename}`} className="btn btn-primary" download>
              Download Latest Extension
            </a>
          </div>

          {release.notes.length > 0 && (
            <div className="field" style={{ marginTop: 24 }}>
              <h2 className="page-subtitle">Release Notes</h2>
              <ul>
                {release.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="field" style={{ marginTop: 24 }}>
        <h2 className="page-subtitle">Updating the Extension</h2>
        <ol className="extension-instructions">
          <li>Download the newest ZIP using the button above.</li>
          <li>
            Extract the ZIP somewhere on your computer.
            <br />
            <strong>Do NOT</strong> attempt to load the ZIP directly into Chrome.
          </li>
          <li>Open Chrome.</li>
          <li>
            Go to: <code>chrome://extensions</code>
          </li>
          <li>Make sure Developer Mode is enabled (top-right toggle).</li>
          <li>
            Find <strong>Copyright Vault</strong> in your list of extensions.
          </li>
          <li>
            Click <strong>Remove</strong> — or, if you'd rather keep the same install location, replace the
            contents of the existing extension folder with the newly extracted files instead.
          </li>
          <li>
            Click <strong>Load unpacked</strong>.
          </li>
          <li>
            Select the newly extracted extension folder.
            <br />
            <strong>Important:</strong> choose the folder that directly contains <code>manifest.json</code> — not the ZIP
            file, and not a parent folder.
          </li>
          <li>Confirm the extension loads successfully (no errors shown on its card).</li>
          <li>
            Open the extension and check its version number against the version shown at the top of this page.
          </li>
        </ol>
        <p className="hint">Once the numbers match, you're running the latest version.</p>
      </div>

      <div className="field" style={{ marginTop: 24 }}>
        <h2 className="page-subtitle">Screenshots</h2>
        <div className="extension-screenshot-grid">
          <ScreenshotPlaceholder label="chrome://extensions page" />
          <ScreenshotPlaceholder label="Developer Mode toggle" />
          <ScreenshotPlaceholder label='"Load unpacked" button' />
          <ScreenshotPlaceholder label="Selecting the extension folder" />
        </div>
      </div>
    </div>
  );
}
