/* global window, document */

// Serialized into CLI run-code. Retain faults on the BrowserContext because CLI network logs are
// scoped to navigation; a later reload must not erase a failed request from the reviewed journey.
export async function installPolicy(page) {
  const context = page.context();
  if (context.__chessUxFaults)
    throw new Error("Policy already installed; reset the profile first.");
  context.__chessUxFaults = [];
  const record = (kind, detail) => context.__chessUxFaults.push({ kind, detail });
  const attach = (target) => {
    target.on("console", (message) => {
      if (
        message.type() === "error" ||
        (message.type() === "warning" && /^\[engine\]/.test(message.text()))
      ) {
        record(`console.${message.type()}`, message.text());
      }
    });
    target.on("pageerror", (error) => record("pageerror", `${error.name}: ${error.message}`));
    target.on("crash", () => record("crash", "Browser page crashed"));
  };
  context.pages().forEach(attach);
  context.on("page", attach);
  context.on("requestfailed", (request) =>
    record(
      "requestfailed",
      `${request.method()} ${request.url()}: ${request.failure()?.errorText}`,
    ),
  );
  context.on("response", (response) => {
    if (response.status() >= 400) record("http", `${response.status()} ${response.url()}`);
  });
  await context.route(
    (url) =>
      ["http:", "https:"].includes(url.protocol) &&
      !["127.0.0.1", "localhost"].includes(url.hostname),
    async (route) => {
      record("external", `${route.request().method()} ${route.request().url()}`);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "null",
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "*",
        },
      });
    },
  );
  await context.addInitScript(() => {
    try {
      localStorage.setItem("chess.cloudeval.enabled", "false");
    } catch {
      /* about:blank has no storage */
    }
  });
  return { policy: "installed" };
}

export async function seedPage(page, seed) {
  await page.goto(seed.url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__chess?.strategicFitMetadataStatus() === "ready", null, {
    timeout: 30_000,
  });
  await page.evaluate(({ pgn, color, fileName }) => {
    window.__chess.loadPgn(pgn, fileName);
    window.__chess.setColor(color);
  }, seed);
  await page.waitForFunction(
    ({ expectedPgn, color }) =>
      window.__chess.toPgn() === expectedPgn &&
      window.__chess.color() === color &&
      window.__chess.strategicFitMetadataStatus() === "ready",
    seed,
    { timeout: 30_000 },
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.locator(".board-wrap").waitFor({ state: "visible" });
  return page.evaluate(() => ({
    pgn: window.__chess.toPgn(),
    color: window.__chess.color(),
    documentId: window.__chess.documentId(),
    url: window.location.href,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    },
  }));
}
