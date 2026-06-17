/**
 * Copy the browser Stockfish build into public/engine/ so Vite serves it at /engine/.
 * Runs on predev/prebuild. The single-threaded "lite" build needs no SharedArrayBuffer
 * (works without cross-origin isolation) and the wasm is ~7MB, not the 113MB full net.
 * The copied files are gitignored — regenerated from node_modules on install.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const binDir = join(dirname(require.resolve("stockfish/package.json")), "bin");
const outDir = join(here, "..", "public", "engine");

const FILES = ["stockfish-18-lite-single.js", "stockfish-18-lite-single.wasm"];

mkdirSync(outDir, { recursive: true });
for (const f of FILES) {
  const src = join(binDir, f);
  const dst = join(outDir, f);
  if (!existsSync(src)) {
    console.error(`[copy-engine] missing ${src}`);
    process.exit(1);
  }
  copyFileSync(src, dst);
}

// ECO openings table — the chat's identify_opening / congruence / batch_review parse it client-side.
// Served as a static asset (fetched once at runtime), same file the Node server reads.
const publicDir = join(here, "..", "public");
const openingsSrc = join(here, "..", "..", "mcp-server", "data", "openings.tsv");
if (existsSync(openingsSrc)) {
  copyFileSync(openingsSrc, join(publicDir, "openings.tsv"));
  console.log(`[copy-engine] copied ${FILES.length} engine files + openings.tsv → public/`);
} else {
  console.warn(`[copy-engine] openings.tsv not found at ${openingsSrc} — identify_opening will degrade`);
  console.log(`[copy-engine] copied ${FILES.length} engine files → public/engine/`);
}
