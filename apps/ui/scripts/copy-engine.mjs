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
const binDir = join(dirname(require.resolve("stockfish/package.json")), "bin");
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "engine");

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
console.log(`[copy-engine] copied ${FILES.length} files → public/engine/`);
