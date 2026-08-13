import { expect, test } from "playwright/test";
import { LONG_FILENAME, openApp } from "./helpers/app";
import { overflowViolations, touchTargetViolations } from "./helpers/accessibility";
import { VIEWPORTS } from "./helpers/viewports";

const NORMAL_PHONE_BASELINES = {
  chromium: {
    "360×740": {
      ".topbar": 112.34375,
      ".board-wrap": 318,
      ".side-panel": 222.65625,
      ".mobile-tabs": 33,
    },
    "390×844": {
      ".topbar": 112.34375,
      ".board-wrap": 348,
      ".side-panel": 296.65625,
      ".mobile-tabs": 33,
    },
  },
  firefox: {
    "360×740": {
      ".topbar": 118.4,
      ".board-wrap": 318,
      ".side-panel": 212.6,
      ".mobile-tabs": 37,
    },
    "390×844": {
      ".topbar": 118.4,
      ".board-wrap": 348,
      ".side-panel": 286.6,
      ".mobile-tabs": 37,
    },
  },
  webkit: {
    "360×740": {
      ".topbar": 126.34375,
      ".board-wrap": 318,
      ".side-panel": 205.65625,
      ".mobile-tabs": 36,
    },
    "390×844": {
      ".topbar": 98.953125,
      ".board-wrap": 348,
      ".side-panel": 307.03125,
      ".mobile-tabs": 36,
    },
  },
} as const;

const panelDimensions = (page: import("playwright/test").Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [".topbar", ".board-wrap", ".side-panel", ".mobile-tabs"].map((selector) => [
        selector,
        document.querySelector(selector)?.getBoundingClientRect().height,
      ]),
    ),
  );

async function installEngineLineFixture(page: import("playwright/test").Page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args, newTarget) {
        if (!String(args[0]).includes("stockfish-18-lite-single.js"))
          return Reflect.construct(target, args, newTarget);

        const worker = {
          onmessage: null as ((event: MessageEvent<string>) => void) | null,
          onerror: null as ((event: ErrorEvent) => void) | null,
          postMessage(message: unknown) {
            const command = String(message);
            if (!command.startsWith("go depth ")) return;
            const depth = Number(command.slice("go depth ".length));
            queueMicrotask(() => {
              worker.onmessage?.({
                data: `info depth ${depth} multipv 1 score cp 34 pv e2e4`,
              } as MessageEvent<string>);
              worker.onmessage?.({ data: "bestmove e2e4" } as MessageEvent<string>);
            });
          },
          terminate() {},
        };
        return worker;
      },
    });
  });
}

test("UX-001 / WP-001 core panels retain usable height on short viewports", async ({ page }) => {
  for (const viewport of [
    { width: 640, height: 400 },
    { width: 360, height: 640 },
    { width: 720, height: 500 },
    { width: 800, height: 450 },
  ]) {
    await openApp(page, viewport);
    if (viewport.width <= 720) await page.getByRole("tab", { name: "Analysis" }).click();
    expect(
      await page
        .locator(".side-panel")
        .evaluate((element) => element.getBoundingClientRect().height),
      `Analysis at ${viewport.width}×${viewport.height}`,
    ).toBeGreaterThanOrEqual(192);

    const tabs = await page.locator(".mobile-tabs").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, viewportHeight: window.innerHeight };
    });
    expect(tabs.top, `tabs top at ${viewport.width}×${viewport.height}`).toBeGreaterThanOrEqual(0);
    expect(tabs.bottom, `tabs bottom at ${viewport.width}×${viewport.height}`).toBeLessThanOrEqual(
      tabs.viewportHeight,
    );

    const viewportWidths = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(viewportWidths.scrollWidth).toBe(viewportWidths.clientWidth);

    if (viewport.width <= 720) {
      await page.getByRole("tab", { name: "Chat" }).click();
      expect(
        await page
          .locator(".chat-wrap")
          .evaluate((element) => element.getBoundingClientRect().height),
        `Chat at ${viewport.width}×${viewport.height}`,
      ).toBeGreaterThanOrEqual(192);
    }
  }
});

test("WP-001 preserves normal phone-height geometry", async ({ page, browserName }) => {
  const baselines = NORMAL_PHONE_BASELINES[browserName];
  for (const [label, expected] of Object.entries(baselines)) {
    const [width, height] = label.split("×").map(Number);
    await openApp(page, { width, height });
    await page.getByRole("tab", { name: "Analysis" }).click();
    const actual = await panelDimensions(page);
    for (const [selector, expectedHeight] of Object.entries(expected)) {
      expect(
        Math.abs((actual[selector] ?? Number.NaN) - expectedHeight),
        `${browserName} ${selector} at ${label}`,
      ).toBeLessThanOrEqual(2);
    }
  }
});

test("WP-001 scrolls the Analysis panel through the workspace without remounting the board", async ({
  page,
}) => {
  for (const [index, viewport] of [
    { width: 640, height: 400 },
    { width: 360, height: 640 },
    { width: 720, height: 500 },
  ].entries()) {
    await openApp(page, viewport);
    await page.getByRole("tab", { name: "Analysis" }).click();
    if (index === 0) {
      await page.evaluate(() => {
        (window as Window & { wp001Board?: Element | null }).wp001Board =
          document.querySelector(".cg-wrap");
      });
    }

    const scroll = await page.locator(".workspace").evaluate((workspace) => {
      workspace.scrollTop = workspace.scrollHeight;
      const panel = document.querySelector(".side-panel")?.getBoundingClientRect();
      const container = workspace.getBoundingClientRect();
      return {
        scrollHeight: workspace.scrollHeight,
        clientHeight: workspace.clientHeight,
        scrollTop: workspace.scrollTop,
        panelBottom: panel?.bottom,
        workspaceBottom: container.bottom,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    expect(
      scroll.scrollHeight,
      `scrollHeight at ${viewport.width}×${viewport.height}`,
    ).toBeGreaterThan(scroll.clientHeight);
    expect(scroll.scrollTop, `scrollTop at ${viewport.width}×${viewport.height}`).toBeGreaterThan(
      0,
    );
    expect(
      scroll.panelBottom,
      `panel bottom at ${viewport.width}×${viewport.height}`,
    ).toBeLessThanOrEqual((scroll.workspaceBottom ?? 0) + 1);
    expect(scroll.scrollWidth, `horizontal overflow at ${viewport.width}×${viewport.height}`).toBe(
      scroll.clientWidth,
    );

    if (index === 0) {
      await page.getByRole("tab", { name: "Chat" }).click();
      expect(
        await page.evaluate(
          () =>
            document.querySelector(".cg-wrap") ===
            (window as Window & { wp001Board?: Element }).wp001Board,
        ),
      ).toBe(true);
    }
  }
});

test("UX-002 / WP-002 AC-1 has no horizontal overflow across the viewport matrix and width sweep", async ({
  page,
}) => {
  await openApp(page, { ...VIEWPORTS[0], fileName: LONG_FILENAME });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    expect(await overflowViolations(page)).toEqual([]);
  }
  for (let width = 320; width <= 2560; width += 5) {
    await page.setViewportSize({ width, height: 800 });
    expect(await overflowViolations(page), `overflow at ${width}px`).toEqual([]);
  }
});

test("WP-002 AC-2 keeps top-bar controls and repertoire actions inside the viewport", async ({
  page,
}) => {
  await openApp(page, { width: 768, height: 1024, fileName: LONG_FILENAME });
  const violations = await page
    .locator(".topbar button, .topbar select, .topbar input, .rep-section button")
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 &&
          rect.right <= window.innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= window.innerHeight
          ? []
          : [element.textContent?.trim() || element.getAttribute("aria-label") || element.tagName];
      }),
    );
  expect(violations).toEqual([]);
});

test("WP-002 AC-3 contains the filename and exposes its full value", async ({ page }) => {
  await openApp(page, { width: 768, height: 1024, fileName: LONG_FILENAME });
  const filename = page.locator(".topbar .moveno");
  await expect(filename).toHaveAttribute("title", LONG_FILENAME);
  const width = await filename.evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(768 * 0.4 + 0.01);
});

test("WP-002 AC-4 keeps the normal-width top bar on one row", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800, fileName: "twenty-character.pgn" });
  const rowCenters = await page
    .locator(".topbar > :not(.analysis-notice)")
    .evaluateAll((elements) => [
      ...new Set(
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return Math.round(rect.top + rect.height / 2);
        }),
      ),
    ]);
  expect(rowCenters).toHaveLength(1);
});

test("WP-002 AC-5 preserves 44px top-bar touch targets", async ({ page }) => {
  const touchContext = await page
    .context()
    .browser()!
    .newContext({
      baseURL: "http://127.0.0.1:4173",
      hasTouch: true,
      viewport: { width: 1280, height: 800 },
    });
  const touchPage = await touchContext.newPage();
  await openApp(touchPage, { width: 1280, height: 800 });
  expect(await touchTargetViolations(touchPage.locator(".topbar"), 44)).toEqual([]);
  await touchContext.close();
});

test("UX-024 / WP-020 AC-1 removes the 1100px board-size cliff without transition drift", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem("chess.layout.side");
    localStorage.removeItem("chess.layout.chat");
  });
  await openApp(page, { width: 1100, height: 800 });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))),
  );
  const gridBoardWidth = await page
    .locator(".board-wrap")
    .evaluate((element) => element.getBoundingClientRect().width);

  await page.setViewportSize({ width: 1101, height: 800 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          localStorage.getItem("chess.layout.side") !== null &&
          localStorage.getItem("chess.layout.chat") !== null,
      ),
    )
    .toBe(true);
  const seeded = await page.evaluate(() => ({
    board: document.querySelector(".board-wrap")?.getBoundingClientRect().width ?? 0,
    side: localStorage.getItem("chess.layout.side"),
    chat: localStorage.getItem("chess.layout.chat"),
  }));
  expect(Math.abs(seeded.board - gridBoardWidth) / gridBoardWidth).toBeLessThanOrEqual(0.15);

  await page.setViewportSize({ width: 1100, height: 800 });
  await page.setViewportSize({ width: 1101, height: 800 });
  await expect
    .poll(() =>
      page.evaluate(() => ({
        side: localStorage.getItem("chess.layout.side"),
        chat: localStorage.getItem("chess.layout.chat"),
      })),
    )
    .toEqual({ side: seeded.side, chat: seeded.chat });
});

test("WP-020 AC-2 keeps visible panels above tier minimums through a continuous resize sweep", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem("chess.layout.side");
    localStorage.removeItem("chess.layout.chat");
  });
  await openApp(page, { width: 320, height: 1100 });
  for (let width = 320; width <= 2560; width += 5) {
    await page.setViewportSize({ width, height: 1100 });
    const violations = await page.locator(".side-panel, .chat-wrap").evaluateAll((panels) =>
      panels.flatMap((panel) => {
        const rect = panel.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return [];
        return rect.width >= 240 && rect.height >= 192
          ? []
          : [{ className: panel.className, width: rect.width, height: rect.height }];
      }),
    );
    expect(violations, `panel minimums at ${width}px`).toEqual([]);
  }
});

test("WP-020 AC-5 honours layout widths persisted by the pre-change build", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("chess.layout.side", "333");
    localStorage.setItem("chess.layout.chat", "350");
  });
  await openApp(page, { width: 1100, height: 800 });
  await page.setViewportSize({ width: 1101, height: 800 });
  await expect
    .poll(() =>
      page.evaluate(() => ({
        sideRendered: document.querySelector(".side-panel")?.getBoundingClientRect().width,
        chatRendered: document.querySelector(".chat-wrap")?.getBoundingClientRect().width,
        sideStored: localStorage.getItem("chess.layout.side"),
        chatStored: localStorage.getItem("chess.layout.chat"),
      })),
    )
    .toEqual({ sideRendered: 333, chatRendered: 350, sideStored: "333", chatStored: "350" });
});

test("UX-010 / WP-015 keeps the move tree and analysis visible before side-panel scrolling", async ({
  page,
}) => {
  await installEngineLineFixture(page);
  for (const viewport of [
    { width: 1024, height: 600 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
  ]) {
    await openApp(page, viewport);
    const moveTree = await page.locator(".side-panel .move-tree").evaluate((tree) => {
      const sidePanel = tree.closest(".side-panel");
      const treeBody = tree.querySelector(".tree-body");
      const treeRect = tree.getBoundingClientRect();
      const treeBodyRect = treeBody?.getBoundingClientRect();
      const visibleMoves = Array.from(
        tree.querySelectorAll<HTMLElement>(".tree-body .move"),
      ).filter((move) => {
        const rect = move.getBoundingClientRect();
        return (
          rect.top >= (treeBodyRect?.top ?? Number.POSITIVE_INFINITY) &&
          rect.bottom <=
            Math.min(treeBodyRect?.bottom ?? Number.NEGATIVE_INFINITY, window.innerHeight)
        );
      }).length;

      return {
        sideScrollTop: sidePanel?.scrollTop,
        top: treeRect.top,
        visibleMoves,
      };
    });
    expect(moveTree.sideScrollTop, `side scroll at ${viewport.width}×${viewport.height}`).toBe(0);
    expect(
      moveTree.top,
      `move tree top at ${viewport.width}×${viewport.height}`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      moveTree.visibleMoves,
      `visible move rows at ${viewport.width}×${viewport.height}`,
    ).toBeGreaterThanOrEqual(3);
  }

  await openApp(page, { width: 1280, height: 800 });
  await page.getByRole("button", { name: "Turn on evaluation" }).click();
  const engineLine = page.locator(".analysis .line").first();
  await expect(engineLine).toBeVisible({ timeout: 10_000 });
  const engineLinePosition = await engineLine.evaluate((line) => {
    const rect = line.getBoundingClientRect();
    return {
      sideScrollTop: line.closest(".side-panel")?.scrollTop,
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
    };
  });
  expect(engineLinePosition.sideScrollTop).toBe(0);
  expect(engineLinePosition.top).toBeGreaterThanOrEqual(0);
  expect(engineLinePosition.bottom).toBeLessThanOrEqual(engineLinePosition.viewportHeight);
});

test("WP-015 defaults mobile to Moves and preserves exactly one mounted panel group", async ({
  page,
}) => {
  await openApp(page, { width: 390, height: 844 });
  await expect(page.getByRole("tab", { name: "Moves" })).toHaveAttribute("aria-selected", "true");

  await page.evaluate(() => {
    (window as Window & { wp015Panels?: Record<string, Element | null> }).wp015Panels = {
      analysis: document.querySelector(".analysis"),
      repertoire: document.querySelector(".rep-panel"),
      moves: document.querySelector(".move-tree"),
      chat: document.querySelector(".chat-wrap"),
    };
  });

  for (const tab of ["Moves", "Analysis", "Chat"] as const) {
    await page.getByRole("tab", { name: tab }).click();
    const state = await page.evaluate(() => {
      const isVisible = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        return Boolean(element && getComputedStyle(element).display !== "none");
      };
      const panels = (window as Window & { wp015Panels?: Record<string, Element | null> })
        .wp015Panels;
      const mounted = panels
        ? Object.entries(panels).every(
            ([name, element]) =>
              document.querySelector(
                `.${name === "repertoire" ? "rep-panel" : name === "moves" ? "move-tree" : name === "chat" ? "chat-wrap" : "analysis"}`,
              ) === element,
          )
        : false;
      const analysis =
        isVisible(".analysis") && isVisible(".rep-panel") && !isVisible(".move-tree");
      const moves = isVisible(".move-tree") && !isVisible(".analysis") && !isVisible(".rep-panel");
      const chat = isVisible(".chat-wrap");
      return { mounted, visibleGroups: [analysis, moves, chat].filter(Boolean).length };
    });
    expect(state.mounted, `${tab} keeps panels mounted`).toBe(true);
    expect(state.visibleGroups, `${tab} shows one panel group`).toBe(1);
  }
});

test("WP-015 AC-5 has no horizontal overflow across the viewport matrix", async ({ page }) => {
  await openApp(page, VIEWPORTS[0]);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    expect(
      await overflowViolations(page),
      `overflow at ${viewport.width}×${viewport.height}`,
    ).toEqual([]);
  }
});

test("UX-014 all core controls meet pointer target minimums", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  const app = page.locator(".app");
  expect(await touchTargetViolations(app, 24)).toEqual([]);

  const touchContext = await page
    .context()
    .browser()!
    .newContext({
      baseURL: "http://127.0.0.1:4173",
      hasTouch: true,
      viewport: { width: 1280, height: 800 },
    });
  const touchPage = await touchContext.newPage();
  await openApp(touchPage, { width: 1280, height: 800 });
  expect(await touchTargetViolations(touchPage.locator(".app"), 44)).toEqual([]);
  await touchContext.close();
});
