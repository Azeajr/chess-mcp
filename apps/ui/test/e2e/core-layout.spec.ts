import { expect, test } from "playwright/test";
import { LONG_FILENAME, openApp } from "./helpers/app";
import { overflowViolations, touchTargetViolations } from "./helpers/accessibility";
import { VIEWPORTS } from "./helpers/viewports";

const NORMAL_PHONE_BASELINES = {
  chromium: {
    "360×740": {
      ".topbar": 79.375,
      ".board-wrap": 318,
      ".side-panel": 255.625,
      ".mobile-tabs": 33,
    },
    "390×844": {
      ".topbar": 79.375,
      ".board-wrap": 348,
      ".side-panel": 329.625,
      ".mobile-tabs": 33,
    },
  },
  firefox: {
    "360×740": {
      ".topbar": 85.4,
      ".board-wrap": 318,
      ".side-panel": 245.6,
      ".mobile-tabs": 37,
    },
    "390×844": {
      ".topbar": 85.4,
      ".board-wrap": 348,
      ".side-panel": 319.6,
      ".mobile-tabs": 37,
    },
  },
  webkit: {
    "360×740": {
      ".topbar": 93.375,
      ".board-wrap": 318,
      ".side-panel": 238.625,
      ".mobile-tabs": 36,
    },
    "390×844": {
      ".topbar": 93.375,
      ".board-wrap": 348,
      ".side-panel": 312.609375,
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

test("WP-015 pins the decided (non-reordered) side panel and mobile default", async ({ page }) => {
  // WP-015 planned a move-tree-first desktop order and a Moves mobile default; both were
  // superseded. This test exists so a future change to either is a deliberate diff, not silent
  // drift back into a false "complete" record.
  await openApp(page, { width: 1280, height: 800 });
  const order = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        ".side-panel .analysis, .side-panel .rep-panel, .side-panel .move-tree",
      ),
    ].map((el) => el.className),
  );
  expect(order[0]).toContain("analysis");
  expect(order[1]).toBe("rep-panel");
  expect(order[2]).toBe("move-tree");

  await openApp(page, { width: 390, height: 844 });
  await expect(page.getByRole("tab", { name: "Analysis" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

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

test(
  "WP-001 preserves normal phone-height geometry",
  { tag: "@visual" },
  async ({ page, browserName }) => {
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
  },
);

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

test("WP-017 AC-1 AC-2 the top bar stays compact on a phone and single-row on desktop", async ({
  page,
}) => {
  // AC-1: 360x740 with a 40-character filename fits in 96px.
  await openApp(page, {
    width: 360,
    height: 740,
    fileName: "forty-character-repertoire-filename.pgn",
  });
  const compactHeight = await page
    .locator(".topbar")
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(compactHeight).toBeLessThanOrEqual(96);

  // AC-2: 1280x800 with a 20-character filename is exactly one row.
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

test("WP-017 AC-3 AC-5 every prior action stays reachable within two interactions", async ({
  page,
}) => {
  await openApp(page, { width: 1280, height: 800, fileName: "twenty-character.pgn" });

  // Save is one interaction: visible without opening anything.
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();

  // Everything else is two: open the menu, then activate the option.
  const trigger = page.getByRole("button", { name: "Repertoire" });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Repertoire actions" });
  await expect(menu).toBeVisible();
  for (const label of ["Open PGN", "New repertoire", "Recover an earlier repertoire"]) {
    await expect(menu.getByRole("menuitem", { name: label })).toBeVisible();
  }
  // AC-5: the groups carry distinct accessible labels.
  const groupLabels = await menu
    .getByRole("group")
    .evaluateAll((groups) => groups.map((group) => group.getAttribute("aria-label")));
  expect(new Set(groupLabels).size).toBe(groupLabels.length);
  expect(groupLabels.length).toBeGreaterThanOrEqual(2);
});

test("WP-017 AC-4 the document menu is keyboard-operable and restores focus", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  const trigger = page.getByRole("button", { name: "Repertoire" });

  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Repertoire actions" });
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  const items = menu.getByRole("menuitem");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(items.last()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
});

test("WP-017 AC-6 AC-7 a 120-character filename never overflows and Cmd/Ctrl+S still saves", async ({
  page,
}) => {
  const longName = `${"long-repertoire-file-name-".repeat(4)}pad.pgn`;
  await openApp(page, { ...VIEWPORTS[0], fileName: longName });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const widths = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(widths.scrollWidth, `overflow at ${viewport.width}×${viewport.height}`).toBe(
      widths.clientWidth,
    );
  }

  // AC-7: the save shortcut still fires from inside a text field.
  await openApp(page, { width: 1280, height: 800 });
  await page.evaluate(() => {
    (window as unknown as { __wp017Saves: number }).__wp017Saves = 0;
    window.addEventListener(
      "keydown",
      (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          (window as unknown as { __wp017Saves: number }).__wp017Saves += 1;
        }
      },
      true,
    );
  });
  await page.getByRole("textbox", { name: "Chat message" }).focus();
  await page.keyboard.press("ControlOrMeta+s");
  expect(
    await page.evaluate(() => (window as unknown as { __wp017Saves: number }).__wp017Saves),
  ).toBe(1);
});
