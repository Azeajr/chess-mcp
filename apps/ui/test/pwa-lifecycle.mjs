/* global window, indexedDB, Worker */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { expect } from "playwright/test";

/**
 * WP-019 required automated validation: publish production build A, then production build B at
 * the same origin and exercise the real generated service-worker lifecycle. This is deliberately
 * separate from the dev-seam spec: a green mock cannot prove Workbox actually leaves B waiting.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const uiDist = path.join(root, "apps/ui/dist");
const workspace = mkdtempSync(path.join(tmpdir(), "chess-mcp-pwa-"));
const deployed = path.join(workspace, "deployed");

const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".tsv", "text/tab-separated-values; charset=utf-8"],
]);

function build(id) {
  // Flagged A/B builds must never replace the ordinary, validated deployment artifact.
  const output = path.join(workspace, `build-${id}`);
  execFileSync(
    "pnpm",
    ["--filter", "@chess-mcp/ui", "build", "--outDir", output, "--emptyOutDir"],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        VITE_PWA_LIFECYCLE_TEST: "1",
        VITE_PWA_TEST_BUILD_ID: id,
      },
    },
  );
  return output;
}

function publish(source) {
  const next = `${deployed}-next`;
  rmSync(next, { recursive: true, force: true });
  cpSync(source, next, { recursive: true });
  rmSync(deployed, { recursive: true, force: true });
  cpSync(next, deployed, { recursive: true });
  rmSync(next, { recursive: true, force: true });
}

async function savedDocument(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("chess-repertoire", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction("kv").objectStore("kv").get("workingRepertoire");
          read.onsuccess = () => {
            db.close();
            resolve(read.result);
          };
          read.onerror = () => {
            db.close();
            reject(read.error);
          };
        };
      }),
  );
}

async function playMove(page, from, to) {
  await page.locator(`.board-keyboard-layer [data-square="${from}"]`).focus();
  await page.keyboard.press("Enter");
  await page.locator(`.board-keyboard-layer [data-square="${to}"]`).focus();
  await page.keyboard.press("Enter");
}

async function verifyOfflineProduction(browser, origin) {
  const context = await browser.newContext({ serviceWorkers: "allow" });
  try {
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.waitForFunction(
      async () => (await navigator.serviceWorker.getRegistration())?.active?.state === "activated",
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    assert.deepEqual(
      await page.evaluate(() => ({
        dev: typeof window.__chess,
        lifecycle: typeof window.__pwaLifecycleTest,
      })),
      { dev: "undefined", lifecycle: "undefined" },
    );

    await playMove(page, "e2", "e4");
    await expect.poll(async () => (await savedDocument(page))?.pgn ?? "").toContain("1. e4");
    const beforeReload = await savedDocument(page);

    await context.setOffline(true);
    await page.reload({ waitUntil: "load" });
    await expect(page.locator(".move-tree")).toContainText("e4");
    assert.equal((await savedDocument(page)).documentId, beforeReload.documentId);
    assert.equal((await savedDocument(page)).pgn, beforeReload.pgn);

    // Edit through the real board while offline, then prove that the edit survives a reload.
    await playMove(page, "e7", "e5");
    await expect.poll(async () => (await savedDocument(page))?.pgn ?? "").toContain("1. e4 e5");
    const edited = await savedDocument(page);
    assert.equal(edited.documentId, beforeReload.documentId);
    assert.ok(edited.revision > beforeReload.revision);
    await page.reload({ waitUntil: "load" });
    await expect(page.locator(".move-tree")).toContainText("e5");
    assert.equal((await savedDocument(page)).pgn, edited.pgn);

    const cached = await page.evaluate(async () => {
      const statuses = {};
      for (const asset of [
        "/manifest.webmanifest",
        "/openings.tsv",
        "/engine/stockfish-18-lite-single.wasm",
      ]) {
        const response = await fetch(asset);
        statuses[asset] = {
          status: response.status,
          bytes: (await response.arrayBuffer()).byteLength,
        };
      }
      return statuses;
    });
    for (const [asset, result] of Object.entries(cached)) {
      assert.equal(result.status, 200, `${asset} is available offline`);
      assert.ok(result.bytes > 0, `${asset} contains data`);
    }

    // A new worker cannot satisfy this with the app's persisted evaluation cache.
    const bestmove = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const worker = new Worker("/engine/stockfish-18-lite-single.js");
          const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error("Offline engine timed out"));
          }, 20_000);
          const finish = (error, line) => {
            clearTimeout(timer);
            worker.terminate();
            if (error) reject(error);
            else resolve(line);
          };
          worker.onerror = (event) => finish(new Error(event.message));
          worker.onmessage = (event) => {
            const line = String(event.data);
            if (line === "uciok") worker.postMessage("isready");
            if (line === "readyok") {
              worker.postMessage("position startpos");
              worker.postMessage("go depth 1");
            }
            if (line.startsWith("bestmove ")) finish(null, line);
          };
          worker.postMessage("uci");
        }),
    );
    assert.match(bestmove, /^bestmove [a-h][1-8][a-h][1-8]/);
    console.log(
      "PWA offline confirmed: ordinary build, reload, document restoration, local edit, cached assets, fresh engine",
    );
  } finally {
    await context.close();
  }
}

function staticServer() {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    let target = path.resolve(deployed, relative);
    if (
      !target.startsWith(path.resolve(deployed)) ||
      !existsSync(target) ||
      statSync(target).isDirectory()
    ) {
      relative = "index.html";
      target = path.join(deployed, relative);
    }
    response.setHeader(
      "Content-Type",
      mime.get(path.extname(target)) ?? "application/octet-stream",
    );
    // Updates must never be hidden behind the test server's HTTP cache.
    response.setHeader("Cache-Control", "no-store");
    if (relative === "sw.js") response.setHeader("Service-Worker-Allowed", "/");
    response.end(readFileSync(target));
  });
}

let browser;
let server;
try {
  publish(uiDist);

  server = staticServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;

  browser = await chromium.launch({ headless: true });
  await verifyOfflineProduction(browser, origin);

  publish(build("A"));
  const context = await browser.newContext({ serviceWorkers: "allow" });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.waitForSelector(".app[data-build-id='A']");

  // First install activates normally because there is no previous worker. Reload once so A is the
  // controlling worker before publishing B.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForSelector(".app[data-build-id='A']");

  // A real running operation must hold the prompt back even after B has installed and is waiting.
  // No opening lookup ran before disconnecting, so an in-memory table cannot hide missing precache.
  await context.setOffline(true);
  const opening = await page.evaluate(() => window.__pwaLifecycleTest.identifyOpening("1. e4 *"));
  assert.deepEqual(opening, { eco: "B00", name: "King's Pawn Game", ply: 1 });
  const cloud = await page.evaluate(() => window.__pwaLifecycleTest.cloudEvaluation());
  assert.equal(cloud.available, false, "online-only evaluation reports unavailability offline");
  await context.setOffline(false);

  await page.evaluate(() => {
    window.__pwaLifecycleTest.startOperation();
  });

  publish(build("B"));
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  });
  await page.waitForFunction(() => window.__pwaLifecycleTest.snapshot().pending);

  assert.equal(await page.locator(".ui-toast").count(), 0, "running operation defers the prompt");
  assert.equal(
    await page.locator(".app").getAttribute("data-build-id"),
    "A",
    "B does not activate itself",
  );

  await page.evaluate(() => {
    window.__pwaLifecycleTest.settleOperation();
  });
  const updateToast = page.locator(".ui-toast", { hasText: "A new version is ready." });
  await updateToast.waitFor({ state: "visible" });

  // Later dismisses only this page. Reloading A re-registers against the still-waiting B worker and
  // the prompt returns, proving the pending worker was not discarded.
  await updateToast.getByRole("button", { name: "Later" }).click();
  assert.equal(await updateToast.count(), 0);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".app[data-build-id='A']");
  await updateToast.waitFor({ state: "visible" });

  // Only Reload sends skipWaiting and transitions the app itself from build A to build B.
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    updateToast.getByRole("button", { name: "Reload" }).click(),
  ]);
  await page.waitForSelector(".app[data-build-id='B']");
  assert.equal(await page.locator(".app").getAttribute("data-build-id"), "B");

  console.log(
    "PWA lifecycle confirmed: A controlled, B waited, operation deferred, Later persisted, Reload transitioned to B",
  );
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  rmSync(workspace, { recursive: true, force: true });
}
