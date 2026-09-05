import { expect, test, type Page } from "./helpers/fixtures";
import { currentPath, openApp } from "./helpers/app";
import { clickMove, dragMove, tapMove } from "./helpers/board";
import {
  basicAccessibilityViolations,
  keyboardReachable,
  touchTargetViolations,
} from "./helpers/accessibility";

const BRANCHING_PGN = "1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) (2... Nf6 3. Nxe5) 3. Bb5 *";

const moveItem = (page: Page, path: readonly number[]) =>
  page.locator(`.move-tree [role="treeitem"][data-move-path="${path.join(",")}"]`);

const branchToggle = (page: Page, path: readonly number[]) =>
  page.locator(`.move-tree .collapse-toggle[data-branch-path="${path.join(",")}"]`);

const chessboard = (page: Page) => page.locator(".board-wrap .cg-wrap");

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

async function focusBoardCursor(page: Page): Promise<void> {
  await page.locator(".app").focus();
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => document.activeElement?.getAttribute("role") === "gridcell")) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error("Tab never reached a board gridcell");
}

const focusedSquare = (page: Page): Promise<string | null> =>
  page.evaluate(() => document.activeElement?.getAttribute("data-square") ?? null);

const boardDirty = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as unknown as { __chess: { dirty(): boolean } }).__chess.dirty());

const resetAnnouncements = (page: Page): Promise<void> =>
  page.evaluate(() =>
    (
      window as unknown as { __chess: { resetAnnouncementsForTesting(): Promise<void> } }
    ).__chess.resetAnnouncementsForTesting(),
  );

const announcementLog = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    (
      window as unknown as { __chess: { announcementLogForTesting(): Promise<string[]> } }
    ).__chess.announcementLogForTesting(),
  );

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

test("UX-003 board squares are keyboard reachable", async ({ page }) => {
  await openApp(page);
  await focusBoardCursor(page);
  const cursorCell = page.locator('.board-keyboard-layer [role="gridcell"][tabindex="0"]');
  await expect(cursorCell).toBeFocused();
  await expect(cursorCell).toHaveAttribute("data-square", "e1");
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement?.closest(".board-keyboard-layer") ?? null),
  ).toBeNull();
});

test(
  "WP-011 AC-1 AC-2 result rows are Tab-reachable and activate like clicks",
  { tag: "@smoke" },
  async ({ page }) => {
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
  },
);

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
  await expect(current).toHaveJSProperty("tagName", "DIV");
  await expect(current).toHaveAttribute("tabindex", "0");
  expect(
    await tree
      .locator('[role="treeitem"]:visible')
      .evaluateAll((items) =>
        items
          .filter((item) => (item as HTMLElement).tabIndex >= 0)
          .map((item) => item.getAttribute("data-move-path")),
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
  await expect(moveItem(page, secondVariationLeaf)).toBeFocused();
});

test("WP-011 AC-3 offers a tab stop from the start position, where no move is current", async ({
  page,
}) => {
  await openApp(page, { width: 1280, height: 800, pgn: BRANCHING_PGN });
  await setCurrentPath(page, []);
  expect(await currentPath(page)).toEqual([]);

  const tree = page.getByRole("tree", { name: "Repertoire moves" });
  expect(
    await tree
      .locator('[role="treeitem"]:visible')
      .evaluateAll((items) =>
        items
          .filter((item) => (item as HTMLElement).tabIndex >= 0)
          .map((item) => item.getAttribute("data-move-path")),
      ),
  ).toEqual(["0"]);

  await page.locator(".move-tree .current-line").click();
  await page.keyboard.press("Tab");
  await expect(moveItem(page, [0])).toBeFocused();
  expect(await currentPath(page)).toEqual([]);
});

test("WP-011 AC-4 current state and branch expansion remain truthful", async ({ page }) => {
  const branch = [0, 0, 0];
  const firstVariation = [...branch, 1];
  await openApp(page, { width: 1280, height: 800, pgn: BRANCHING_PGN });
  await setCurrentPath(page, branch);

  const current = moveItem(page, branch);
  const toggle = branchToggle(page, branch);
  const group = page.locator(`#move-tree-group-${branch.join("-")}`);
  const owner = moveItem(page, [...branch, 0]);
  await expect(current).toHaveAttribute("aria-current", "true");
  await expect(owner).toHaveAttribute("aria-controls", `move-tree-group-${branch.join("-")}`);
  await expect(owner).toHaveAttribute("aria-owns", `move-tree-group-${branch.join("-")}`);
  await expect(owner).toHaveAttribute("aria-expanded", "true");
  await expect(owner).toHaveAttribute("aria-label", "Nc6, repertoire tree item, level 1, expanded");
  await toggle.click();
  await expect(owner).toHaveAttribute("aria-expanded", "false");
  await expect(owner).toHaveAttribute(
    "aria-label",
    "Nc6, repertoire tree item, level 1, collapsed",
  );
  await expect(group).toBeHidden();

  await current.focus();
  await page.keyboard.press("ArrowRight");
  await expect(moveItem(page, firstVariation)).toBeFocused();
  await expect(owner).toHaveAttribute("aria-expanded", "true");
  await expect(group).toBeVisible();

  await page.keyboard.press("Enter");
  await expect.poll(() => currentPath(page)).toEqual(firstVariation);
  await toggle.click();
  await expect(owner).toHaveAttribute("aria-expanded", "true");
  await expect(group).toBeVisible();
});

test("WP-011 AC-3 reports variation depth as the level, not ply depth", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800, pgn: BRANCHING_PGN });

  for (const path of [[0], [0, 0], [0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0, 0]]) {
    await expect(moveItem(page, path)).toHaveAttribute("aria-level", "1");
  }
  for (const path of [
    [0, 0, 0, 1],
    [0, 0, 0, 1, 0],
    [0, 0, 0, 2],
    [0, 0, 0, 2, 0],
  ]) {
    await expect(moveItem(page, path)).toHaveAttribute("aria-level", "2");
  }

  const mainlineReply = moveItem(page, [0, 0, 0, 0]);
  await expect(mainlineReply).not.toHaveAttribute("aria-posinset");
  await expect(mainlineReply).not.toHaveAttribute("aria-setsize");
  await expect(moveItem(page, [0, 0, 0, 1])).toHaveAttribute("aria-posinset", "1");
  await expect(moveItem(page, [0, 0, 0, 1])).toHaveAttribute("aria-setsize", "2");
  await expect(moveItem(page, [0, 0, 0, 2])).toHaveAttribute("aria-posinset", "2");
  await expect(moveItem(page, [0, 0, 0, 2])).toHaveAttribute("aria-setsize", "2");
});

test("WP-011 AC-4 keeps branch collapsing keyboard-operable from inside the tree", async ({
  page,
}) => {
  const branch = [0, 0, 0];
  const mainlineReply = [...branch, 0];
  await openApp(page, { width: 1280, height: 800, pgn: BRANCHING_PGN });
  await setCurrentPath(page, branch);

  const toggle = branchToggle(page, branch);
  const group = page.locator(`#move-tree-group-${branch.join("-")}`);
  await expect(toggle).toHaveAttribute("tabindex", "-1");
  await expect(toggle).toHaveAttribute("aria-hidden", "true");

  const item = moveItem(page, mainlineReply);
  await item.focus();
  const before = await currentPath(page);
  await page.keyboard.press(" ");
  await expect(item).toHaveAttribute("aria-expanded", "false");
  await expect(group).toBeHidden();
  await expect(item).toBeFocused();

  await page.keyboard.press(" ");
  await expect(item).toHaveAttribute("aria-expanded", "true");
  await expect(group).toBeVisible();
  expect(await currentPath(page)).toEqual(before);
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
  watchContext,
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
  await watchContext(context);
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

test("WP-012 AC-5 divider hit areas meet pointer and touch target floors", async ({
  page,
  watchContext,
}) => {
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
  await watchContext(touchContext);
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

test("WP-014 AC-1 entering the board announces the position and shows a visible cursor", async ({
  page,
}) => {
  await openApp(page);
  await resetAnnouncements(page);
  await focusBoardCursor(page);

  const cell = page.locator('.board-keyboard-layer [role="gridcell"][tabindex="0"]');
  await expect(cell).toBeFocused();
  const log = await announcementLog(page);
  expect(log.some((message) => /^Chessboard\. White to move\.$/u.test(message))).toBe(true);

  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const style = getComputedStyle(el);
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
  });
  expect(outline?.style).not.toBe("none");
  expect(outline?.width ?? 0).toBeGreaterThan(0);
});

test("WP-014 AC-2 arrow keys move the cursor one square in the on-screen direction (white)", async ({
  page,
}) => {
  await openApp(page, { color: "white" });
  await focusBoardCursor(page);
  expect(await focusedSquare(page)).toBe("e1");
  await page.keyboard.press("ArrowUp");
  expect(await focusedSquare(page)).toBe("e2");
  await page.keyboard.press("ArrowRight");
  expect(await focusedSquare(page)).toBe("f2");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowDown");
  expect(await focusedSquare(page)).toBe("e1");
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowLeft");
  expect(await focusedSquare(page)).toBe("a1");
});

test("WP-014 AC-2 arrow keys stay screen-relative on a flipped board", async ({ page }) => {
  await openApp(page, { color: "black" });
  await focusBoardCursor(page);
  expect(await focusedSquare(page)).toBe("e8");
  await page.keyboard.press("ArrowUp");
  expect(await focusedSquare(page)).toBe("e7");
  await page.keyboard.press("ArrowLeft");
  expect(await focusedSquare(page)).toBe("f7");
});

test("WP-014 AC-3 selecting a piece announces its legal destinations; an illegal target is refused", async ({
  page,
}) => {
  await openApp(page);
  await focusBoardCursor(page);
  await resetAnnouncements(page);

  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  const selectLog = await announcementLog(page);
  expect(selectLog.some((message) => /^2 legal destinations\.$/u.test(message))).toBe(true);
  await expect(page.locator('[data-square="e3"]')).toHaveClass(/legal-dest/u);
  await expect(page.locator('[data-square="e4"]')).toHaveClass(/legal-dest/u);
  await expect(page.locator('[data-square="d3"]')).not.toHaveClass(/legal-dest/u);

  const pathBefore = await currentPath(page);
  await resetAnnouncements(page);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  expect(await focusedSquare(page)).toBe("e5");
  await page.keyboard.press("Enter");
  const refusalLog = await announcementLog(page);
  expect(refusalLog.some((message) => /e5 is not a legal destination\./u.test(message))).toBe(true);
  expect(await currentPath(page)).toEqual(pathBefore);
  await expect(page.locator('[data-square="e2"]')).toHaveClass(/selected/u);
});

test("WP-014 AC-4 a keyboard move produces the same tree mutation, path, and dirty state as a drag", async ({
  page,
}) => {
  await openApp(page, { pgn: "*" });
  await focusBoardCursor(page);
  expect(await currentPath(page)).toEqual([]);
  expect(await boardDirty(page)).toBe(false);

  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");

  await expect.poll(() => currentPath(page)).toEqual([0]);
  expect(await boardDirty(page)).toBe(true);
  await page.evaluate(() => (window as unknown as { __chess: { undo(): void } }).__chess.undo());
  await expect.poll(() => currentPath(page)).toEqual([]);
});

test("WP-014 AC-5 a keyboard promotion opens the dialog with focus inside and completing it plays the promotion", async ({
  page,
}) => {
  await openApp(page, { pgn: "1. e4 f5 2. exf5 g6 3. fxg6 d5 4. gxh7 Nc6 *" });
  await setCurrentPath(page, [0, 0, 0, 0, 0, 0, 0, 0]);
  await focusBoardCursor(page);
  expect(await focusedSquare(page)).toBe("c6");

  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  expect(await focusedSquare(page)).toBe("h7");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  expect(await focusedSquare(page)).toBe("g8");

  const pathBeforeConfirm = await currentPath(page);
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const queenButton = page.getByRole("button", { name: "Promote to queen" });
  await expect(queenButton).toBeFocused();
  expect(await currentPath(page)).toEqual(pathBeforeConfirm);

  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect.poll(() => currentPath(page)).toEqual([...pathBeforeConfirm, 0]);
});

test("WP-014 AC-6 Escape clears the selection without changing the position or the cursor", async ({
  page,
}) => {
  await openApp(page);
  await focusBoardCursor(page);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-square="e2"]')).toHaveClass(/selected/u);
  const pathBefore = await currentPath(page);

  await page.keyboard.press("Escape");
  await expect(page.locator('[data-square="e2"]')).not.toHaveClass(/selected/u);
  expect(await currentPath(page)).toEqual(pathBefore);
  expect(await focusedSquare(page)).toBe("e2");
});

test("WP-014 AC-7 click-to-move is unchanged with the keyboard layer unfocused", async ({
  page,
}) => {
  await openApp(page, { pgn: "*" });
  const before = await focusedSquare(page);
  expect(before).toBeNull();
  await clickMove(chessboard(page), "e2", "e4");
  await expect.poll(() => currentPath(page)).toEqual([0]);
  expect(await focusedSquare(page)).toBeNull();
});

test("WP-014 AC-7 pointer drag is unchanged with the keyboard layer unfocused", async ({
  page,
}) => {
  await openApp(page, { pgn: "*" });
  await dragMove(chessboard(page), "e2", "e4");
  await expect.poll(() => currentPath(page)).toEqual([0]);
});

test("WP-014 AC-7 touch move is unchanged with the keyboard layer unfocused", async ({
  page,
  watchContext,
}) => {
  const context = await page
    .context()
    .browser()!
    .newContext({
      baseURL: "http://127.0.0.1:4173",
      hasTouch: true,
      viewport: { width: 1280, height: 800 },
    });
  await watchContext(context);
  const touchPage = await context.newPage();
  await openApp(touchPage, { pgn: "*" });
  await tapMove(chessboard(touchPage), "e2", "e4");
  await expect.poll(() => currentPath(touchPage)).toEqual([0]);
  await context.close();
});

test("WP-014 AC-8 the board cursor does not fire while a dialog is open", async ({ page }) => {
  await openApp(page);
  await focusBoardCursor(page);
  const before = await focusedSquare(page);

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.getAttribute("role"))).not.toBe(
    "gridcell",
  );
  const pathBefore = await currentPath(page);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  expect(await currentPath(page)).toEqual(pathBefore);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }),
  );
  await focusBoardCursor(page);
  expect(await focusedSquare(page)).toBe(before);
});

test("WP-014 AC-9 M-2 the pointer-free journey: navigate to move 6, add a variation, save", async ({
  page,
}) => {
  const pgn = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 *";
  await openApp(page, { pgn });
  await page.evaluate(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => ({
        name: "wp014-m2.pgn",
        createWritable: async () => ({
          write: async () => undefined,
          close: async () => undefined,
        }),
      }),
    });
    (window as unknown as { __wp014Pointers: number }).__wp014Pointers = 0;
    for (const type of ["pointerdown", "mousedown", "touchstart", "click"]) {
      document.addEventListener(
        type,
        () => {
          (window as unknown as { __wp014Pointers: number }).__wp014Pointers += 1;
        },
        { capture: true },
      );
    }
  });

  await page.locator('.move-tree [role="treeitem"][data-move-path="0"]').focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await expect(
    page.locator('.move-tree [role="treeitem"][data-move-path="0,0,0,0,0,0"]'),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => currentPath(page)).toEqual([0, 0, 0, 0, 0, 0]);

  await page.locator('.board-keyboard-layer [role="gridcell"][data-square="a6"]').focus();
  expect(await focusedSquare(page)).toBe("a6");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  expect(await focusedSquare(page)).toBe("b5");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  expect(await focusedSquare(page)).toBe("c6");
  await page.keyboard.press("Enter");

  await expect.poll(() => currentPath(page)).toEqual([0, 0, 0, 0, 0, 0, 1]);
  expect(await boardDirty(page)).toBe(true);

  await page.keyboard.press("Control+s");
  await expect.poll(() => boardDirty(page)).toBe(false);

  expect(
    await page.evaluate(() => (window as unknown as { __wp014Pointers: number }).__wp014Pointers),
  ).toBe(0);
});
