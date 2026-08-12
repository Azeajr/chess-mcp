import { expect, test, type Page } from "playwright/test";
import { currentPath, openApp } from "./helpers/app";
import {
  basicAccessibilityViolations,
  keyboardReachable,
  touchTargetViolations,
} from "./helpers/accessibility";

const BRANCHING_PGN = "1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) (2... Nf6 3. Nxe5) 3. Bb5 *";

const moveItem = (page: Page, path: readonly number[]) =>
  page.locator(`.move-tree [role="treeitem"][data-move-path="${path.join(",")}"]`);

const setCurrentPath = (page: Page, path: number[]) =>
  page.evaluate(
    (nextPath) =>
      (
        window as unknown as {
          __chess: { goto(path: number[]): void };
        }
      ).__chess.goto(nextPath),
    path,
  );

async function addRepertoireRowFixtures(page: Page, count = 1): Promise<void> {
  await page
    .locator("details.rep-section")
    .filter({ hasText: "Gaps" })
    .first()
    .evaluate((panel, fixtureCount) => {
      const fixture = document.createElement("div");
      fixture.dataset.wp011Fixture = "true";
      fixture.setAttribute("aria-label", "WP-011 result-row fixtures");
      for (let index = 0; index < fixtureCount; index += 1) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "rep-row";
        row.textContent = `Fixture result ${index + 1}`;
        row.dataset.keyboardTarget = "fixture";
        row.addEventListener("click", () => {
          row.dataset.activations = String(Number(row.dataset.activations ?? "0") + 1);
        });
        fixture.append(row);
      }
      panel.append(fixture);
    }, count);
}

async function addAuditRows(page: Page, count = 1): Promise<void> {
  await page.evaluate(async (fixtureCount) => {
    const { setCommandStateForTesting } = await import("/src/store/commands.ts");
    setCommandStateForTesting("audit_repertoire_moves", {
      status: "completed",
      result: {
        findings: Array.from({ length: fixtureCount }, (_, index) => ({
          path: ["e4", "e5", "Nf3"],
          classification: "inaccuracy",
          prescribed: "Nf3",
          best_move: "Nc3",
          cp_loss: 90 + index,
        })),
      },
    });
  }, count);
  await page
    .locator("details.rep-section")
    .filter({ hasText: "Prescribed-move audit" })
    .first()
    .evaluate((section) => ((section as HTMLDetailsElement).open = true));
}

test.fixme("UX-003 board squares are keyboard reachable", async ({ page }) => {
  await openApp(page);
  const app = page.locator(".app");
  expect(await keyboardReachable(app, ".cg-wrap")).toEqual([]);
});

test("WP-011 AC-1 AC-2 result rows are Tab-reachable and activate like clicks", async ({
  page,
}) => {
  await openApp(page, { width: 1280, height: 800, pgn: BRANCHING_PGN });
  await addAuditRows(page, 8);
  const app = page.locator(".app");
  const row = page.locator(".rep-panel .rep-row").first();

  await expect(row).toHaveJSProperty("tagName", "BUTTON");
  expect(await keyboardReachable(app, ".rep-row")).toEqual([]);

  await row.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => currentPath(page)).toEqual([0, 0, 0]);
  await setCurrentPath(page, []);
  await row.focus();
  await page.keyboard.press("Space");
  await expect.poll(() => currentPath(page)).toEqual([0, 0, 0]);
});

test("WP-011 AC-3 uses one roving tree tab stop and DV-2 traversal without board navigation", async ({
  page,
}) => {
  const branch = [0, 0, 0];
  const firstVariation = [...branch, 1];
  const secondVariation = [...branch, 2];
  const secondVariationLeaf = [...secondVariation, 0];
  await openApp(page, { width: 1280, height: 800, pgn: BRANCHING_PGN });
  await setCurrentPath(page, branch);

  const tree = page.getByRole("tree", { name: "Repertoire moves" });
  const current = moveItem(page, branch);
  await expect(current).toHaveAttribute("tabindex", "0");
  expect(
    await tree
      .locator("button:visible")
      .evaluateAll((buttons) =>
        buttons
          .filter((button) => (button as HTMLButtonElement).tabIndex >= 0)
          .map((button) => button.getAttribute("data-move-path")),
      ),
  ).toEqual([branch.join(",")]);

  const before = await currentPath(page);
  await current.focus();
  await page.keyboard.press("ArrowRight");
  await expect(moveItem(page, firstVariation)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(moveItem(page, secondVariation)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(moveItem(page, secondVariationLeaf)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(moveItem(page, secondVariation)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(moveItem(page, [0])).toBeFocused();
  await page.keyboard.press("End");
  await expect(moveItem(page, secondVariationLeaf)).toBeFocused();
  expect(await currentPath(page)).toEqual(before);

  await page.keyboard.press("Enter");
  await expect.poll(() => currentPath(page)).toEqual(secondVariationLeaf);
  await expect(page.locator(".chat-log")).toContainText("Focused: Nxe5");
});

test("WP-011 AC-4 current state and branch expansion remain truthful", async ({ page }) => {
  const branch = [0, 0, 0];
  const firstVariation = [...branch, 1];
  await openApp(page, { width: 1280, height: 800, pgn: BRANCHING_PGN });
  await setCurrentPath(page, branch);

  const current = moveItem(page, branch);
  const toggle = page.locator(`[aria-controls="move-tree-group-${branch.join("-")}"]`);
  const group = page.locator(`#move-tree-group-${branch.join("-")}`);
  await expect(current).toHaveAttribute("aria-current", "true");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(group).toBeHidden();

  await current.focus();
  await page.keyboard.press("ArrowRight");
  await expect(moveItem(page, firstVariation)).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(group).toBeVisible();

  await page.keyboard.press("Enter");
  await expect.poll(() => currentPath(page)).toEqual(firstVariation);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(group).toBeVisible();
});

test("WP-011 preserves the current-line strip and preview glow", async ({ page }) => {
  const branch = [0, 0, 0];
  const mainlineReply = [...branch, 0];
  await openApp(page, { width: 1280, height: 800, pgn: BRANCHING_PGN });
  await setCurrentPath(page, branch);
  await page.evaluate((path) => {
    (
      window as unknown as {
        __chess: { stagePreviewLine(path: number[], moves: string[]): { ok: boolean } };
      }
    ).__chess.stagePreviewLine(path, ["Nc6"]);
  }, branch);

  await expect(page.locator(".current-line")).toContainText("1. e4 e5 2. Nf3");
  await expect(moveItem(page, mainlineReply)).toHaveClass(/move-preview/u);
  await expect(page.locator(".current-line .move")).toHaveCount(branch.length);
});

test("WP-011 AC-5 compact and touch target floors hold for rows and the move tree", async ({
  page,
}) => {
  await openApp(page, { width: 1280, height: 800, pgn: BRANCHING_PGN });
  await addAuditRows(page, 8);
  expect(await touchTargetViolations(page.locator(".rep-panel"), 24)).toEqual([]);
  expect(await touchTargetViolations(page.locator(".move-tree"), 24)).toEqual([]);

  const context = await page
    .context()
    .browser()!
    .newContext({
      baseURL: "http://127.0.0.1:4173",
      hasTouch: true,
      viewport: { width: 1280, height: 800 },
    });
  const touchPage = await context.newPage();
  await openApp(touchPage, { width: 1280, height: 800, pgn: BRANCHING_PGN });
  await addAuditRows(touchPage, 8);
  expect(await touchTargetViolations(touchPage.locator(".rep-panel"), 44)).toEqual([]);
  expect(await touchTargetViolations(touchPage.locator(".move-tree"), 44)).toEqual([]);
  await context.close();
});

test("WP-011 AC-6 target floors preserve the repertoire panel density bound", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  await addRepertoireRowFixtures(page, 8);
  const panel = page.locator(".rep-panel");
  const fixtureRows = panel.locator('[data-wp011-fixture="true"] .rep-row');
  const enhancedHeight = await panel.evaluate((element) => element.getBoundingClientRect().height);

  await fixtureRows.evaluateAll((rows) => {
    for (const row of rows as HTMLButtonElement[]) row.style.minHeight = "0";
  });
  const baselineHeight = await panel.evaluate((element) => element.getBoundingClientRect().height);
  await fixtureRows.evaluateAll((rows) => {
    for (const row of rows as HTMLButtonElement[]) row.style.removeProperty("min-height");
  });

  expect(enhancedHeight).toBeLessThanOrEqual(baselineHeight * 1.15);
});

test("WP-011 AC-7 AC-8 does not nest buttons and retains side-panel accessibility", async ({
  page,
}) => {
  await openApp(page, { width: 1280, height: 800, pgn: BRANCHING_PGN });
  await addAuditRows(page, 1);
  expect(
    await page
      .locator(".app-main")
      .evaluate((root) =>
        [...root.querySelectorAll("button button")].map((button) => button.outerHTML),
      ),
  ).toEqual([]);
  expect(await basicAccessibilityViolations(page.locator(".side-panel"))).toEqual([]);
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
