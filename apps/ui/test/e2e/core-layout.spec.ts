import { expect, test } from "playwright/test";
import { LONG_FILENAME, openApp } from "./helpers/app";
import { overflowViolations, touchTargetViolations } from "./helpers/accessibility";
import { VIEWPORTS } from "./helpers/viewports";

test.fixme("UX-001 core panels retain usable height on short viewports", async ({ page }) => {
  for (const viewport of [
    { width: 640, height: 400 },
    { width: 360, height: 640 },
    { width: 720, height: 500 },
  ]) {
    await openApp(page, viewport);
    for (const selector of [".side-panel", ".chat-wrap", ".mobile-tabs"]) {
      const height = await page
        .locator(selector)
        .evaluate((element) => element.getBoundingClientRect().height);
      expect(height, `${selector} at ${viewport.width}×${viewport.height}`).toBeGreaterThan(0);
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
