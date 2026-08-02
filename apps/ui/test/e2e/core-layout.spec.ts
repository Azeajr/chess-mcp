import { expect, test } from "playwright/test";
import { LONG_FILENAME, openApp } from "./helpers/app";
import { overflowViolations, touchTargetViolations } from "./helpers/accessibility";
import { VIEWPORTS } from "./helpers/viewports";

const NORMAL_PHONE_BASELINES = {
  chromium: {
    "360×740": { ".topbar": 163.75, ".board-wrap": 318, ".side-panel": 171.25, ".mobile-tabs": 33 },
    "390×844": { ".topbar": 163.75, ".board-wrap": 348, ".side-panel": 245.25, ".mobile-tabs": 33 },
  },
  firefox: {
    "360×740": { ".topbar": 173.8, ".board-wrap": 318, ".side-panel": 157.2, ".mobile-tabs": 37 },
    "390×844": { ".topbar": 173.8, ".board-wrap": 348, ".side-panel": 231.2, ".mobile-tabs": 37 },
  },
  webkit: {
    "360×740": { ".topbar": 180.75, ".board-wrap": 318, ".side-panel": 151.25, ".mobile-tabs": 36 },
    "390×844": {
      ".topbar": 147.75,
      ".board-wrap": 348,
      ".side-panel": 258.234375,
      ".mobile-tabs": 36,
    },
  },
} as const;

const PRE_EXISTING_800_OVERFLOW_WIDTHS = { chromium: 858, firefox: 849, webkit: 855 } as const;

const panelDimensions = (page: import("playwright/test").Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [".topbar", ".board-wrap", ".side-panel", ".mobile-tabs"].map((selector) => [
        selector,
        document.querySelector(selector)?.getBoundingClientRect().height,
      ]),
    ),
  );

test("UX-001 / WP-001 core panels retain usable height on short viewports", async ({
  page,
  browserName,
}) => {
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
    if (viewport.width === 800) {
      expect(
        viewportWidths.scrollWidth,
        "800×450 preserves the WP-002 overflow baseline",
      ).toBeLessThanOrEqual(PRE_EXISTING_800_OVERFLOW_WIDTHS[browserName]);
    } else {
      expect(viewportWidths.scrollWidth).toBe(viewportWidths.clientWidth);
    }

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

test.fixme("UX-002 no horizontal overflow across the viewport matrix and width sweep", async ({
  page,
}) => {
  for (const viewport of VIEWPORTS) {
    await openApp(page, { ...viewport, fileName: LONG_FILENAME });
    expect(await overflowViolations(page)).toEqual([]);
  }
  for (let width = 320; width <= 2560; width += 5) {
    await openApp(page, { width, height: 800, fileName: LONG_FILENAME });
    expect(await overflowViolations(page), `overflow at ${width}px`).toEqual([]);
  }
});

test.fixme("UX-014 all core controls meet pointer target minimums", async ({ page }) => {
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
