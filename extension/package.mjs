/**
 * Packages the already-built extension/dist/ into a distributable ZIP for the Copyright Vault
 * web app's Extension page, and writes the release manifest that page reads (version, date,
 * compatibility, notes). Run `npm run build` first — this script doesn't build for you.
 *
 * Output goes to ../public/extension-releases/, which Vite copies verbatim into the root app's
 * dist/ on its next `npm run build` — no separate "upload" step, just the normal deploy.
 */
import archiver from "archiver";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(dirname, "dist");
const manifestPath = path.join(distDir, "manifest.json");
const releaseNotesPath = path.join(dirname, "RELEASE_NOTES.md");
const outputDir = path.join(dirname, "..", "public", "extension-releases");

if (!existsSync(manifestPath)) {
  console.error("extension/dist/manifest.json not found — run `npm run build` first.");
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!version) {
  console.error("extension/dist/manifest.json has no version field.");
  process.exit(1);
}

const zipFilename = `copyright-vault-extension-v${version}.zip`;

if (existsSync(outputDir)) {
  // Only one release is distributed at a time (per spec: "always download the newest") — clear
  // any previous ZIP so an old download link can't linger alongside the new one.
  for (const file of readdirSync(outputDir)) {
    if (file.endsWith(".zip")) rmSync(path.join(outputDir, file));
  }
} else {
  mkdirSync(outputDir, { recursive: true });
}

// One bullet per non-empty line, "- "/"* " prefixes stripped — lets RELEASE_NOTES.md read as a
// normal markdown bullet list while still being trivial to parse.
const notes = existsSync(releaseNotesPath)
  ? readFileSync(releaseNotesPath, "utf8")
      .split("\n")
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean)
  : [];

const output = createWriteStream(path.join(outputDir, zipFilename));
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => {
  const releaseManifest = {
    version,
    releaseDate: new Date().toISOString().slice(0, 10),
    compatible: "Chrome / Edge (Windows & macOS)",
    notes,
    zipFilename,
  };
  writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify(releaseManifest, null, 2));
  console.log(`Packaged ${zipFilename} (${archive.pointer()} bytes). Release manifest written to public/extension-releases/manifest.json.`);
  console.log("Next: from the project root, run `npm run deploy` to publish it.");
});
archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);
// dist/ contents go at the ZIP root (not nested under a "dist" folder) — manifest.json must be at
// the top level for Chrome's "Load unpacked" folder-select to find it. Source maps are excluded
// per the no-source-artifacts requirement; everything else in dist/ is already build output only
// (no source, no node_modules, no secrets — dist/ never contained those to begin with).
archive.glob("**/*", { cwd: distDir, ignore: ["**/*.map"] });
archive.finalize();
