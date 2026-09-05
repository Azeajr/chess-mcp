import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const dist = path.resolve(import.meta.dirname, "../dist");

test("production manifest and referenced assets support the offline contract", async () => {
  const manifestPath = path.join(dist, "manifest.webmanifest");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.name, "Chess Repertoire");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, "manifest has an icon");

  const files = await readdir(dist, { recursive: true });
  const sw = await readFile(path.join(dist, "sw.js"), "utf8");
  const offlineAssets = new Set([
    "index.html",
    "manifest.webmanifest",
    "openings.tsv",
    "engine/stockfish-18-lite-single.js",
    "engine/stockfish-18-lite-single.wasm",
    ...files.filter((name) => name.startsWith("assets/") && /\.(js|css)$/.test(name)),
  ]);
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, "https://pwa.test/manifest.webmanifest");
    assert.equal(url.origin, "https://pwa.test", "icons are local assets");
    offlineAssets.add(url.pathname.slice(1));
  }
  for (const asset of offlineAssets) {
    assert.ok(files.includes(asset), `${asset} exists in the production build`);
    assert.ok((await readFile(path.join(dist, asset))).length > 0, `${asset} is not empty`);
    assert.ok(sw.includes(JSON.stringify(asset)), `${asset} is precached`);
  }
  const html = await readFile(path.join(dist, "index.html"), "utf8");
  assert.match(html, /<link[^>]+rel="manifest"[^>]+href="\/manifest.webmanifest"/);
  for (const asset of files.filter((name) => /^assets\/index-.*\.js$/.test(name))) {
    const source = await readFile(path.join(dist, asset), "utf8");
    assert.ok(!source.includes("__pwaLifecycleTest"), "deployable output has no lifecycle bridge");
    assert.ok(!source.includes("__chess"), "deployable output has no dev bridge");
  }
  assert.ok(
    files.some((name) => /^workbox-.*\.js$/.test(name)),
    "Workbox runtime was emitted",
  );
});
