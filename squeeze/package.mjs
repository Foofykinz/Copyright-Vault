/**
 * Packages Squeeze into a release ZIP + manifest.json for the Copyright Vault's Extensions & Tools
 * page, and for Squeeze's own self-updater (squeeze/squeeze_update.py).
 *
 *   npm run package:squeeze                       # from the repo root
 *   node squeeze/package.mjs --src <dir> --out <dir>   # (tests) package some other folder elsewhere
 *
 * Output goes to public/tool-releases/squeeze/, which Vite copies verbatim into dist/ on the next
 * `npm run build` -- so publishing is just the normal `npm run deploy`. Only ONE release is kept
 * there at a time (an older ZIP would just be a stale download link).
 *
 * The manifest carries a SHA-256 for every file. The updater refuses anything that doesn't match,
 * so a truncated download or a mangled file can never replace a working install.
 */
import archiver from "archiver";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);

const srcDir = path.resolve(arg("--src") ?? here);
const outDir = path.resolve(arg("--out") ?? path.join(here, "..", "public", "tool-releases", "squeeze"));

// Never shipped: build tooling, notes, and anything that's a user's own data or scratch.
const EXCLUDE_NAMES = new Set([
  "package.mjs", "RELEASE_NOTES.md", ".gitattributes", "node_modules", "squeeze_work", "squeeze_rights_work",
  "_update", "__pycache__", "squeeze_settings.json", ".DS_Store", "Thumbs.db",
]);
const EXCLUDE_SUFFIXES = [".pyc", ".updtmp", ".log"];
const REQUIRED = ["squeeze.py", "squeeze_update.py", "launcher.pyw", "VERSION", "ui/index.html", "INSTALL.bat", "INSTALL.command"];

function walk(dir, base = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_NAMES.has(entry.name) || EXCLUDE_SUFFIXES.some((s) => entry.name.endsWith(s))) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

const fail = (msg) => {
  console.error(`\n  x ${msg}\n`);
  process.exit(1);
};

if (!existsSync(path.join(srcDir, "VERSION"))) fail(`No VERSION file in ${srcDir}`);
const version = readFileSync(path.join(srcDir, "VERSION"), "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`VERSION must look like 2.1.0, got "${version}"`);

const files = walk(srcDir);
for (const req of REQUIRED) if (!files.includes(req)) fail(`Required file missing from the package: ${req}`);

// A Python syntax error must never reach a release: catch it here, before anything is written.
const py = ["python", "py", "python3"].find((cmd) => spawnSync(cmd, ["--version"]).status === 0);
if (!py) {
  console.warn("  ! Python not found -- skipping the syntax check of the .py files.");
} else {
  for (const f of files.filter((n) => /\.(py|pyw)$/.test(n))) {
    const check = spawnSync(py, ["-c", "import ast,sys; ast.parse(open(sys.argv[1],encoding='utf-8').read())", path.join(srcDir, f)], { encoding: "utf8" });
    if (check.status !== 0) fail(`Python syntax error in ${f}:\n${check.stderr}`);
  }
}

// Release notes: one bullet per non-empty line of RELEASE_NOTES.md, "- " prefix stripped.
const notesPath = path.join(srcDir, "RELEASE_NOTES.md");
const notes = existsSync(notesPath)
  ? readFileSync(notesPath, "utf8").split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean)
  : [];
if (notes.length === 0) console.warn("  ! No RELEASE_NOTES.md (or it's empty) -- the release will show no notes.");

if (existsSync(outDir)) for (const f of readdirSync(outDir)) if (f.startsWith("squeeze-v") && f.endsWith(".zip")) rmSync(path.join(outDir, f));
mkdirSync(outDir, { recursive: true });

const zipFilename = `squeeze-v${version}.zip`;
const zipPath = path.join(outDir, zipFilename);

const hashes = {};
const output = createWriteStream(zipPath);
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => {
  const zipBytes = readFileSync(zipPath);
  const manifest = {
    version,
    releaseDate: new Date().toISOString().slice(0, 10),
    compatible: "Windows 10/11 and macOS",
    notes,
    zipFilename,
    sha256: createHash("sha256").update(zipBytes).digest("hex"),
    size: zipBytes.length,
    files: hashes,
  };
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\n  Packaged ${zipFilename} (${zipBytes.length} bytes, ${files.length} files) -> ${outDir}`);
  console.log("  Next: from the project root, run `npm run deploy` to publish it.\n");
});
archive.on("error", (err) => fail(err.message));
archive.pipe(output);

for (const rel of files) {
  const data = readFileSync(path.join(srcDir, rel));
  hashes[rel] = createHash("sha256").update(data).digest("hex");
  // The .command scripts need the executable bit inside the ZIP, or a Mac unzips them as plain
  // documents and they won't run when double-clicked (the manual `chmod +x` step in README_MAC).
  const mode = rel.endsWith(".command") ? 0o755 : 0o644;
  archive.append(data, { name: `Squeeze/${rel}`, mode, date: statSync(path.join(srcDir, rel)).mtime });
}

await archive.finalize();
