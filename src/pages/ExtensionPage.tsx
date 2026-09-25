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

interface SqueezeReleaseManifest extends ExtensionReleaseManifest {
  size: number;
}

// Squeeze is a separate, optional download: a missing release must never break the extension section.
async function fetchSqueezeManifest(): Promise<SqueezeReleaseManifest | null> {
  try {
    const res = await fetch("/tool-releases/squeeze/manifest.json");
    if (!res.ok) return null;
    const data = (await res.json()) as SqueezeReleaseManifest;
    return data && typeof data.version === "string" && data.zipFilename ? data : null;
  } catch {
    return null;
  }
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const { data: squeeze, loading: squeezeLoading } = useAsync(fetchSqueezeManifest, []);

  return (
    <div>
      <Breadcrumb items={[{ label: "Extensions & Tools" }]} />
      <div className="page-header">
        <div>
          <h1 className="page-title">Extensions &amp; Tools</h1>
          <p className="hint">
            <a href="#extension">Browser Extension</a> · <a href="#squeeze">Squeeze</a>
          </p>
        </div>
      </div>

      <h2 className="page-subtitle" id="extension">
        Copyright Vault Browser Extension
      </h2>

      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}

      {release && (
        <>
          <div className="summary-card">
            <div className="summary-grid">
              <div>
                <div className="hint">Current Version</div>
                <div className="summary-value">v{release.version}</div>
              </div>
              <div>
                <div className="hint">Released</div>
                <div className="summary-value">{formatDisplayDate(release.releaseDate)}</div>
              </div>
              <div>
                <div className="hint">Compatible</div>
                <div className="summary-value">{release.compatible}</div>
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

      <div className="field" id="squeeze" style={{ marginTop: 48 }}>
        <h2 className="page-subtitle">Squeeze</h2>
        <p className="hint">
          Downloads videos and compresses them under the Copyright Office's 450 MB limit, and batch-downloads
          Rights Manager CSVs. It runs on your own computer, so it uses your own browser logins.
        </p>

        {squeezeLoading && <LoadingBlock />}
        {!squeezeLoading && !squeeze && <p className="hint">No Squeeze release has been published yet.</p>}

        {squeeze && (
          <>
            <div className="summary-card">
              <div className="summary-grid">
                <div>
                  <div className="hint">Current Version</div>
                  <div className="summary-value">v{squeeze.version}</div>
                </div>
                <div>
                  <div className="hint">Released</div>
                  <div className="summary-value">{formatDisplayDate(squeeze.releaseDate)}</div>
                </div>
                <div>
                  <div className="hint">Compatible</div>
                  <div className="summary-value">{squeeze.compatible}</div>
                </div>
                {squeeze.size > 0 && (
                  <div>
                    <div className="hint">Download Size</div>
                    <div className="summary-value">{formatMegabytes(squeeze.size)}</div>
                  </div>
                )}
              </div>
              <a href={`/tool-releases/squeeze/${squeeze.zipFilename}`} className="btn btn-primary" download>
                Download Squeeze
              </a>
            </div>

            {squeeze.notes.length > 0 && (
              <div className="field" style={{ marginTop: 24 }}>
                <h3 className="page-subtitle">What's New</h3>
                <ul>
                  {squeeze.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <div className="field" style={{ marginTop: 24 }}>
          <h3 className="page-subtitle">Installing Squeeze (first time only)</h3>
          <ol className="extension-instructions">
            <li>Download the ZIP above and extract it somewhere permanent (for example your Documents folder).</li>
            <li>
              <strong>Windows:</strong> open the extracted <code>Squeeze</code> folder and double-click{" "}
              <code>INSTALL.bat</code>.
              <br />
              <strong>Mac:</strong> double-click <code>INSTALL.command</code>. If your Mac blocks it, right-click it and
              choose Open. <code>README_MAC.txt</code> in the folder has the details.
            </li>
            <li>When it finishes, use the Squeeze icon it puts on your Desktop to open the tool.</li>
          </ol>
        </div>

        <div className="field" style={{ marginTop: 24 }}>
          <h3 className="page-subtitle">Updating Squeeze</h3>
          <p>
            You don't need to come back here. When a new version is out, a banner appears at the top of Squeeze — click{" "}
            <strong>Update &amp; restart</strong> and it does the rest. Nothing is installed until you click, an update
            is refused while a download or encode is running, and your projects and settings are never touched. If
            anything goes wrong, Squeeze puts the previous version back on its own.
          </p>
          <p className="hint">
            Running an older Squeeze that has no banner? Download it here once and install it over the old one; from
            then on updates happen inside the app.
          </p>
        </div>
      </div>
    </div>
  );
}
