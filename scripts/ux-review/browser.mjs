/* global window, document, getComputedStyle */

// Serialized into CLI run-code. Retain faults on the BrowserContext because CLI network logs are
// scoped to navigation; a later reload must not erase a failed request from the reviewed journey.
export async function installPolicy(page, config) {
  const context = page.context();
  if (context.__chessUxFaults)
    throw new Error("Policy already installed; reset the profile first.");
  context.__chessUxFaults = [];
  context.__chessUxWarnings = [];
  const record = (kind, detail) =>
    context.__chessUxFaults.push({ at: new Date().toISOString(), kind, detail });
  const attach = (target) => {
    target.on("console", (message) => {
      if (
        message.type() === "error" ||
        (message.type() === "warning" && /^\[engine\]/.test(message.text()))
      ) {
        record(`console.${message.type()}`, message.text());
      } else if (message.type() === "warning") {
        context.__chessUxWarnings.push({
          at: new Date().toISOString(),
          detail: message.text(),
          location: message.location(),
        });
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
    (url) => ["http:", "https:"].includes(url.protocol) && url.origin !== config.origin,
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
  // Guard automatic reloads as well as explicit CLI navigation after a server turnover.
  await context.route(
    (url) => url.origin === config.origin,
    async (route) => {
      if (!route.request().isNavigationRequest()) return route.continue();
      try {
        const response = await context.request.get(config.identityUrl, { timeout: 2_000 });
        const identity = await response.json();
        if (
          !response.ok() ||
          identity.root !== config.identity.root ||
          identity.token !== config.identity.token
        )
          throw new Error("Review server identity changed; stop/start to reseed.");
        await route.continue();
      } catch (error) {
        record("infrastructure", error.message);
        await route.abort("blockedbyclient");
      }
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

// A --full-page capture grows with the PAGE. A pane that scrolls inside itself keeps its offscreen
// content out of the image, so the capture equals the viewport shot and looks complete while it is
// not. Report those panes so the reviewer scrolls and captures them instead of trusting the image.
export async function scanClippedRegions(page) {
  return page.evaluate(() => {
    const slack = 2; // sub-pixel rounding from device scale factors, not real hidden content
    const label = (element) => {
      const described =
        element.getAttribute("aria-label") ??
        element
          .getAttribute("aria-labelledby")
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ");
      if (described?.trim()) return described.trim().slice(0, 60);
      const heading = element.querySelector("h1, h2, h3, h4, h5, h6");
      if (heading?.textContent?.trim()) return heading.textContent.trim().slice(0, 60);
      return element.className?.toString().split(/\s+/)[0] || element.tagName.toLowerCase();
    };
    const regions = [];
    for (const element of document.querySelectorAll("*")) {
      if (element === document.body || element === document.documentElement) continue;
      if (element.offsetParent === null) continue; // display:none or detached
      const hidden = element.scrollHeight - element.clientHeight;
      if (hidden <= slack) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden") continue;
      if (!["auto", "scroll", "overlay"].includes(style.overflowY)) continue;
      regions.push({ name: label(element), hidden, shown: element.clientHeight });
    }
    return regions;
  });
}
