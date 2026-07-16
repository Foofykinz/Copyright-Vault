import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(dirname, "dist");
const watch = process.argv.includes("--watch");

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
cpSync(path.join(dirname, "public"), outdir, { recursive: true });

const shared = {
  bundle: true,
  outdir,
  sourcemap: true,
  target: "chrome110",
  logLevel: "info",
};

// The background service worker ("type": "module" in manifest.json) and the side panel page
// (loaded via <script type="module">) can both be real ES modules.
const esmEntryPoints = {
  background: path.join(dirname, "src/background/index.ts"),
  popup: path.join(dirname, "src/popup/index.ts"),
};

// Static content_scripts are injected as classic (non-module) scripts, so these must be
// self-contained IIFEs with no top-level import/export statements.
const iifeEntryPoints = {
  "content-tiktok": path.join(dirname, "src/content/tiktok.ts"),
  "content-tiktok-network": path.join(dirname, "src/content/tiktok-network.ts"),
  "content-x": path.join(dirname, "src/content/x.ts"),
  "content-facebook-network-debug": path.join(dirname, "src/content/facebook-network-debug.ts"),
};

if (watch) {
  const esmCtx = await context({ ...shared, entryPoints: esmEntryPoints, format: "esm" });
  const iifeCtx = await context({ ...shared, entryPoints: iifeEntryPoints, format: "iife" });
  await Promise.all([esmCtx.watch(), iifeCtx.watch()]);
  console.log("Watching extension source for changes…");
} else {
  await build({ ...shared, entryPoints: esmEntryPoints, format: "esm" });
  await build({ ...shared, entryPoints: iifeEntryPoints, format: "iife" });
}
