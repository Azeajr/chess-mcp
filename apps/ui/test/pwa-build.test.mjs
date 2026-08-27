import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

/**
 * WP-019 AC-4: assertions over the output of the real production PWA build.
 * Run after `pnpm --filter @chess-mcp/ui build`; a missing build is a failure rather than a skip.
 */
const dist = path.resolve(import.meta.dirname, "../dist");

test("production output remains installable and precaches Stockfish wasm", async () => {
  const manifestPath = path.join(dist, "manifest.webmanifest");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.name, "Chess Repertoire");
  assert.equal(manifest.display, "standalone");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, "manifest has an icon");

  const files = await readdir(dist, { recursive: true });
  const wasm = files.find((name) => name.endsWith(".wasm"));
  assert.ok(wasm, "production output contains the Stockfish wasm");

  const sw = await readFile(path.join(dist, "sw.js"), "utf8");
  assert.ok(sw.includes(wasm), `${wasm} is present in the generated precache manifest`);
  assert.ok(
    files.some((name) => /^workbox-.*\.js$/.test(name)),
    "Workbox runtime was emitted",
  );
});
