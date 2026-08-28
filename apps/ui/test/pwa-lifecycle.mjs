/* global window */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

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
  execFileSync("pnpm", ["--filter", "@chess-mcp/ui", "build"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_PWA_LIFECYCLE_TEST: "1",
      VITE_PWA_TEST_BUILD_ID: id,
    },
  });
}

function publish() {
  const next = `${deployed}-next`;
  rmSync(next, { recursive: true, force: true });
  cpSync(uiDist, next, { recursive: true });
  rmSync(deployed, { recursive: true, force: true });
  cpSync(next, deployed, { recursive: true });
  rmSync(next, { recursive: true, force: true });
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
  build("A");
  publish();

  server = staticServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;

  browser = await chromium.launch({ headless: true });
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
  await page.evaluate(() => {
    window.__pwaLifecycleTest.startOperation();
  });

  build("B");
  publish();
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
