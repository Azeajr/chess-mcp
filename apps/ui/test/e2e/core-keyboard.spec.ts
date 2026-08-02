import { expect, test } from "playwright/test";
import { currentPath, openApp } from "./helpers/app";
import { keyboardReachable, touchTargetViolations } from "./helpers/accessibility";

test.fixme("UX-003 UX-004 board, move tree, and repertoire controls are keyboard reachable", async ({
  page,
}) => {
  await openApp(page);
  const app = page.locator(".app");
  expect(await keyboardReachable(app, ".cg-wrap")).toEqual([]);
  expect(await keyboardReachable(app, ".moves")).toEqual([]);
  expect(await keyboardReachable(app, ".rep-row")).toEqual([]);
});

test("WP-012 AC-1 visible dividers are named, valued Tab stops", async ({ page }) => {
  await openApp(page, { width: 1600, height: 900 });
  const app = page.locator(".app-main");
  const dividers = page.getByRole("separator");

  await expect(dividers).toHaveCount(2);
  expect(await keyboardReachable(app, ".divider")).toEqual([]);
  for (const divider of await dividers.all()) {
    await expect(divider).toHaveAttribute("aria-label", /Resize/u);
    await expect(divider).toHaveAttribute("aria-valuenow", /^\d+$/u);
    await expect(divider).toHaveAttribute("aria-valuemin", "240");
    await expect(divider).toHaveAttribute("aria-valuemax", "800");
  }
});

test("WP-012 AC-2 arrows, Shift, Home, and End resize once and persist on keyup", async ({
  page,
}) => {
  await openApp(page, { width: 1600, height: 900 });
  const divider = page.getByRole("separator", { name: "Resize the analysis panel", exact: true });
  const side = page.locator(".side-panel");
  const initialPath = await currentPath(page);

  await divider.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(side).toHaveCSS("width", "316px");
  await expect(divider).toHaveAttribute("aria-valuenow", "316");
  expect(await page.evaluate(() => localStorage.getItem("chess.layout.side"))).toBe("316");

  await page.keyboard.press("Shift+ArrowRight");
  await expect(side).toHaveCSS("width", "252px");
  expect(await page.evaluate(() => localStorage.getItem("chess.layout.side"))).toBe("252");

  await page.keyboard.press("Home");
  await expect(side).toHaveCSS("width", "240px");
  await page.keyboard.press("End");
  await expect(side).toHaveCSS("width", "800px");
  expect(await page.evaluate(() => localStorage.getItem("chess.layout.side"))).toBe("800");
  expect(await currentPath(page)).toEqual(initialPath);

  await page.reload();
  await expect(
    page.getByRole("separator", { name: "Resize the analysis panel", exact: true }),
  ).toHaveAttribute("aria-valuenow", "800");
  await expect(page.locator(".side-panel")).toHaveCSS("width", "800px");
});

test("WP-012 AC-3 Enter and double-click restore and persist default widths", async ({ page }) => {
  await openApp(page, { width: 1600, height: 900 });
  const analysisDivider = page.getByRole("separator", {
    name: "Resize the analysis panel",
    exact: true,
  });
  const sharedDivider = page.getByRole("separator", {
    name: "Resize the analysis and chat panels",
  });
  const side = page.locator(".side-panel");
  const chat = page.locator(".chat-wrap");

  await analysisDivider.focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(side).toHaveCSS("width", "300px");
  await expect(chat).toHaveCSS("width", "360px");
  expect(
    await page.evaluate(() => [
      localStorage.getItem("chess.layout.side"),
      localStorage.getItem("chess.layout.chat"),
    ]),
  ).toEqual(["300", "360"]);

  await sharedDivider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(side).toHaveCSS("width", "316px");
  await expect(chat).toHaveCSS("width", "344px");
  await sharedDivider.dblclick();
  await expect(side).toHaveCSS("width", "300px");
  await expect(chat).toHaveCSS("width", "360px");
});

test("WP-012 AC-4 AC-6 pointer capture preserves drag clamping outside the divider", async ({
  page,
}) => {
  await openApp(page, { width: 1600, height: 900 });
  const divider = page.getByRole("separator", { name: "Resize the analysis panel", exact: true });
  const side = page.locator(".side-panel");
  await divider.evaluate((element) => {
    element.addEventListener("pointerdown", (event) => {
      element.dataset.pointerCapture = element.hasPointerCapture(event.pointerId) ? "held" : "lost";
    });
    element.addEventListener("gotpointercapture", () => (element.dataset.pointerCapture = "held"));
    element.addEventListener(
      "lostpointercapture",
      () => (element.dataset.pointerCapture = "released"),
    );
  });
  const box = await divider.boundingBox();
  expect(box).not.toBeNull();

  await divider.hover({ position: { x: box!.width / 2, y: 20 } });
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 1, box!.y + 20);
  await expect(divider).toHaveAttribute("data-pointer-capture", "held");
  await page.mouse.move(1599, box!.y + box!.height / 2);
  await expect(side).toHaveCSS("width", "240px");
  await page.mouse.move(1, box!.y + box!.height / 2);
  await expect(side).toHaveCSS("width", "800px");
  await page.mouse.up();
  await expect(divider).toHaveAttribute("data-pointer-capture", "released");
  expect(await page.evaluate(() => localStorage.getItem("chess.layout.side"))).toBe("800");
});

test("WP-012 AC-5 divider hit areas meet pointer and touch target floors", async ({ page }) => {
  await openApp(page, { width: 1600, height: 900 });
  expect(await touchTargetViolations(page.locator(".workspace"), 24)).toEqual([]);

  const touchContext = await page
    .context()
    .browser()!
    .newContext({
      baseURL: "http://127.0.0.1:4173",
      hasTouch: true,
      viewport: { width: 390, height: 844 },
    });
  const touchPage = await touchContext.newPage();
  await openApp(touchPage, { width: 390, height: 844 });
  expect(await touchTargetViolations(touchPage.locator(".workspace"), 44)).toEqual([]);
  await touchContext.close();
});

test("WP-012 preserves phone board clamping and adjacent-panel click-through", async ({ page }) => {
  await openApp(page, { width: 390, height: 844 });
  const boardDivider = page.getByRole("separator", { name: "Resize the chessboard" });
  await boardDivider.focus();
  await page.keyboard.press("End");
  const widths = await page
    .locator(".workspace, .board-wrap")
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  expect(widths[1]).toBeLessThanOrEqual(widths[0]);
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => localStorage.getItem("chess.layout.board"))).toBeNull();

  await page.setViewportSize({ width: 1600, height: 900 });
  for (const divider of await page.getByRole("separator").all()) {
    const box = await divider.boundingBox();
    expect(box).not.toBeNull();
    const intercepted = await page.evaluate(
      ({ left, right, y }) =>
        [left, right].map((x) => Boolean(document.elementFromPoint(x, y)?.closest(".divider"))),
      { left: box!.x - 13, right: box!.x + box!.width + 13, y: box!.y + 10 },
    );
    expect(intercepted).toEqual([false, false]);
  }
});
