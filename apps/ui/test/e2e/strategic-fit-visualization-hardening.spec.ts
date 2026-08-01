import { expect, test, type Page } from "playwright/test";

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  toPgn(): string;
  strategicFitMetadataStatus(): string;
  selectStrategicFitProfile(mode: "balanced"): unknown;
};

const chess = <T>(page: Page, fn: (api: ChessHarness, arg: T) => unknown, arg?: T) =>
  page.evaluate(
    ({ source, arg }) =>
      Function(
        "api",
        "arg",
        `return (${source})(api, arg)`,
      )((window as unknown as { __chess: ChessHarness }).__chess, arg),
    { source: fn.toString(), arg },
  );

const FIRST = [
  "a6",
  "b6",
  "c6",
  "d5",
  "d6",
  "h6",
  "h5",
  "g6",
  "a5",
  "b5",
  "c5",
  "f5",
  "Na6",
  "Nc6",
];
const FIFTH = [
  "Bg5",
  "Bf4",
  "Qc2",
  "a3",
  "Nd2",
  "g3",
  "h3",
  "Rb1",
  "Bd2",
  "Qb3",
  "h4",
  "a4",
  "Qd3",
  "Rg1",
  "Ne5",
  "Qd2",
];

/** 416 legal branches: comfortably past the 300-point map drawing limit. */
function largeRepertoire(): string {
  const games: string[] = [];
  for (const first of FIRST) {
    for (const fifth of FIFTH) {
      for (const black of ["O-O", "h6"]) {
        if (black === "h6" && (first === "h6" || first === "h5")) continue;
        games.push(
          `[Event "Large ${first} ${fifth} ${black}"]\n[Result "*"]\n\n` +
            `1. d4 ${first} 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. ${fifth} ${black} ` +
            `6. e3 Ne4 7. Be2 Nxc3 8. bxc3 *`,
        );
      }
    }
  }
  return games.join("\n\n");
}

const LARGE_REPERTOIRE = largeRepertoire();

const MODEST_REPERTOIRE = `[Event "Hardening: Queen's Gambit"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bf4 O-O 6. e3 c5 7. Bd3 *

[Event "Hardening: Ruy Lopez"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 *

[Event "Hardening: Open Sicilian"]
[Result "*"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be2 e5 7. Nb3 *

[Event "Hardening: French Advance"]
[Result "*"]

1. e4 e6 2. d4 d5 3. e5 c5 4. c3 Nc6 5. Nf3 Qb6 6. a3 Nh6 7. b4 *`;

async function bootstrap(page: Page, pgn: string, name: string, timeout = 15_000) {
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await chess(page, (api, input) => api.loadPgn(input.pgn, input.name), { pgn, name });
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
  await page.getByRole("button", { name: "Open workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await dialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({ timeout });
  return dialog;
}

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("a large fixture aggregates the map, bounds the branch list, and stays interactive", async ({
  page,
}) => {
  test.slow();
  const dialog = await bootstrap(page, LARGE_REPERTOIRE, "hardening-large.pgn", 25_000);
  const before = await chess(page, (api) => api.toPgn());
  const map = dialog.locator(".strategic-map");

  await expect(map).toHaveAttribute("data-map-render-mode", "clusters");
  const plotted = Number(await map.getAttribute("data-map-point-count"));
  expect(plotted).toBeGreaterThan(300);
  const drawn = Number(await map.getAttribute("data-map-drawn-marks"));
  expect(drawn).toBeLessThan(plotted);
  expect(drawn).toBeLessThanOrEqual(300);
  await expect(map.locator("[data-map-point]")).toHaveCount(0);
  await expect(map.locator("[data-map-aggregation]")).toContainText("position clusters");

  const listTable = map.locator("[data-map-list]");
  await expect(listTable).toHaveAttribute("data-map-rows-shown", "100");
  await expect(listTable).toHaveAttribute("data-map-rows-total", String(plotted));
  // Task 12.3: the window still holds 100 branches; only its mounted rows are bounded.
  const mountedRows = Number(await listTable.getAttribute("data-map-rows-mounted"));
  expect(mountedRows).toBeLessThanOrEqual(60);
  await expect(map.locator("[data-map-list] tbody tr[data-map-row]")).toHaveCount(mountedRows);

  // Interaction still responds: a cluster opens its own branch list and a member selects.
  const cluster = map.locator("[data-map-cluster]").first();
  await cluster.click();
  const clusterDetail = map.locator("[data-map-cluster-detail]");
  await expect(clusterDetail).toBeVisible({ timeout: 5_000 });
  const member = clusterDetail.locator("[data-map-cluster-member]").first();
  const memberRoute = await member.getAttribute("data-map-cluster-member");
  await member.click();
  await expect(map.locator("[data-map-detail]")).toHaveAttribute("data-map-detail", memberRoute!);

  await map.locator("[data-map-show-all-rows]").click();
  await expect(listTable).toHaveAttribute("data-map-rows-shown", String(plotted));
  // Every branch is now in the list, and the DOM still mounts only a scrolling window of it.
  const expandedRows = Number(await listTable.getAttribute("data-map-rows-mounted"));
  expect(expandedRows).toBeLessThanOrEqual(60);
  await expect(map.locator("[data-map-list] tbody tr[data-map-row]")).toHaveCount(expandedRows);
  await expect(listTable).toHaveAttribute("aria-rowcount", String(plotted));

  expect(await chess(page, (api) => api.toPgn())).toBe(before);
});

test("the decision flow scales to its container on resize without overflowing the page", async ({
  page,
}) => {
  const dialog = await bootstrap(page, MODEST_REPERTOIRE, "hardening-resize.pgn");
  const scroll = dialog.locator(".decision-flow-scroll");
  await expect(scroll).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  const wide = Number(await scroll.getAttribute("data-flow-scale"));
  expect(wide).toBeGreaterThan(0);
  expect(wide).toBeLessThanOrEqual(1);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 420, height: 900 });
  await expect
    .poll(async () => Number(await scroll.getAttribute("data-flow-scale")))
    .toBeLessThanOrEqual(wide);
  const narrow = Number(await scroll.getAttribute("data-flow-scale"));
  expect(narrow).toBeGreaterThanOrEqual(0.6);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  // The outline table equivalent survives every width.
  await expect(dialog.locator("[data-flow-outline] tbody tr").first()).toBeVisible();
});

test("reduced motion leaves every visualization without animation or transition", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dialog = await bootstrap(page, MODEST_REPERTOIRE, "hardening-motion.pgn");

  const durations = await dialog.evaluate((root) => {
    const selectors = [
      ".strategic-map-chart",
      ".strategic-map-point",
      ".concept-heatmap-cell",
      ".concept-heatmap-table",
      ".decision-flow-chart",
      ".decision-flow-node",
    ];
    return selectors.flatMap((selector) => {
      const element = root.querySelector(selector);
      if (element === null) return [];
      const style = getComputedStyle(element);
      return [[selector, style.animationDuration, style.transitionDuration] as const];
    });
  });

  expect(durations.length).toBeGreaterThan(0);
  for (const [selector, animation, transition] of durations) {
    expect(animation, `${selector} animation`).toBe("0s");
    expect(transition, `${selector} transition`).toBe("0s");
  }
});

test("the phone layout keeps table equivalents, touch targets, and no page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await bootstrap(page, MODEST_REPERTOIRE, "hardening-mobile.pgn");

  await expect(dialog.locator("[data-map-list] tbody tr").first()).toBeVisible();
  await dialog.locator("[data-flow-cohort-select]").scrollIntoViewIfNeeded();
  await expect(dialog.locator("[data-flow-outline] tbody tr").first()).toBeVisible();
  await expect(dialog.locator("[data-heatmap-table] tbody tr").first()).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  const printToggle = dialog.locator("[data-strategic-fit-print-export-toggle]");
  const box = await printToggle.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // A wide table scrolls inside its own container rather than pushing the page sideways.
  const heatmapScrolls = await dialog
    .locator(".concept-heatmap-scroll")
    .evaluate((element) => element.scrollWidth >= element.clientWidth);
  expect(heatmapScrolls).toBe(true);
});

test("keyboard reaches the chart marks, the outline, and the print and export toggle", async ({
  page,
}) => {
  const dialog = await bootstrap(page, MODEST_REPERTOIRE, "hardening-keyboard.pgn");
  const map = dialog.locator(".strategic-map");

  const point = map.locator("[data-map-point]").first();
  await point.focus();
  await page.keyboard.press("Enter");
  await expect(point).toHaveAttribute("aria-pressed", "true");
  await expect(map.locator("[data-map-detail]")).toBeVisible();

  const outlineButton = dialog.locator("[data-flow-outline] tbody tr button").first();
  await outlineButton.focus();
  await page.keyboard.press("Enter");
  await expect(outlineButton).toHaveAttribute("aria-pressed", "true");

  const printToggle = dialog.locator("[data-strategic-fit-print-export-toggle]");
  await printToggle.focus();
  await page.keyboard.press("Enter");
  await expect(printToggle).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator("[data-strategic-fit-print-note]")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(printToggle).toHaveAttribute("aria-pressed", "false");
});

test("print and export view completes every table equivalent and keeps a stable print snapshot", async ({
  page,
}) => {
  const dialog = await bootstrap(page, MODEST_REPERTOIRE, "hardening-print.pgn");
  const map = dialog.locator(".strategic-map");

  await map.locator(".strategic-map-axes summary").click();
  await map.locator(".strategic-map-axes summary").click();
  await expect(map.locator(".strategic-map-axes")).not.toHaveAttribute("open", "");

  await dialog.locator("[data-strategic-fit-print-export-toggle]").click();
  await expect(map).toHaveAttribute("data-map-print-export", "true");
  await expect(dialog.locator(".decision-flow")).toHaveAttribute("data-flow-print-export", "true");
  await expect(map.locator(".strategic-map-axes")).toHaveAttribute("open", "");

  const listTable = map.locator("[data-map-list]");
  const shown = await listTable.getAttribute("data-map-rows-shown");
  expect(shown).toBe(await listTable.getAttribute("data-map-rows-total"));

  await page.emulateMedia({ media: "print" });
  await expect(map.locator(".strategic-map-controls")).toBeHidden();
  await expect(map.locator("[data-map-chart]")).toBeVisible();
  await expect(map.locator("[data-map-list] tbody tr").first()).toBeVisible();
  await expect(map).toHaveScreenshot("strategic-map-print.png", {
    animations: "disabled",
    caret: "hide",
  });
  await page.emulateMedia({ media: "screen" });
});
