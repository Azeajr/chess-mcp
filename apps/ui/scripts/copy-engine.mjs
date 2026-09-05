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

const publicDir = join(here, "..", "public");
const openingsSrc = join(here, "..", "..", "mcp-server", "data", "openings.tsv");
if (existsSync(openingsSrc)) {
  copyFileSync(openingsSrc, join(publicDir, "openings.tsv"));
  console.log(`[copy-engine] copied ${FILES.length} engine files + openings.tsv → public/`);
} else {
  console.warn(
    `[copy-engine] openings.tsv not found at ${openingsSrc} — identify_opening will degrade`,
  );
  console.log(`[copy-engine] copied ${FILES.length} engine files → public/engine/`);
}
