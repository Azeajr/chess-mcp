import { expect, test, type Page } from "./helpers/fixtures";

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

const HEATMAP_REPERTOIRE = `[Event "Heatmap: Queen's Gambit"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bf4 O-O 6. e3 c5 7. Bd3 *

[Event "Heatmap: Ruy Lopez"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 *

[Event "Heatmap: Open Sicilian"]
[Result "*"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be2 e5 7. Nb3 *

[Event "Heatmap: French Advance"]
[Result "*"]

1. e4 e6 2. d4 d5 3. e5 c5 4. c3 Nc6 5. Nf3 Qb6 6. a3 Nh6 7. b4 *`;

async function bootstrap(page: Page, pgn: string, name: string) {
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await chess(page, (api, input) => api.loadPgn(input.pgn, input.name), { pgn, name });
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
  await page.getByRole("button", { name: "Open Strategic Fit" }).click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await dialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({
    timeout: 15_000,
  });
  return dialog;
}

test("the concept heatmap shows textual cells, untrained mastery, and finding selection", async ({
  page,
}) => {
  const dialog = await bootstrap(page, HEATMAP_REPERTOIRE, "heatmap-complete.pgn");
  const before = await chess(page, (api) => api.toPgn());
  const heatmap = dialog.locator(".concept-heatmap");
  await expect(heatmap).toHaveAttribute("data-heatmap-state", "available");
  await expect(heatmap).toHaveAttribute("data-heatmap-projection-version", "1.0.0");

  const columns = heatmap.locator("[data-heatmap-column]");
  const columnCount = await columns.count();
  expect(columnCount).toBeGreaterThan(0);
  await expect(heatmap.locator("[data-heatmap-mastery-state='untrained']")).toHaveCount(
    columnCount,
  );
  const masteryText = await columns.first().locator("[data-heatmap-mastery]").textContent();
  expect(masteryText).toBe("Untrained");
  expect(masteryText).not.toContain("0%");

  const cellWithFinding = heatmap
    .locator("[data-heatmap-cell]:not([data-heatmap-cell-findings='0'])")
    .first();
  await expect(cellWithFinding).toBeVisible();
  await expect(cellWithFinding).toContainText("%");
  await cellWithFinding.click();
  const detail = heatmap.locator("[data-heatmap-detail]");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("Expected frequency");
  await expect(detail.locator("[data-heatmap-detail-mastery]")).toHaveText("Untrained");
  await expect(detail.locator("[data-heatmap-detail-route]").first()).toBeVisible();

  const openFinding = detail.locator("[data-heatmap-open-finding]").first();
  const findingId = await openFinding.getAttribute("data-heatmap-open-finding");
  await openFinding.click();
  await expect(dialog.locator(".strategic-fit-workspace-body")).toHaveAttribute(
    "data-stage",
    "findings",
  );
  const findings = dialog.locator("#strategic-fit-pane-findings");
  await expect(findings.getByRole("status")).toContainText(
    "Findings for the selected heatmap cell",
  );
  await expect(findings.locator(`[data-finding-id='${findingId}']`)).toHaveAttribute(
    "data-finding-selected",
    "true",
  );

  expect(await chess(page, (api) => api.toPgn())).toBe(before);
});

test("heatmap sorting reorders concepts deterministically and keeps the screen-reader summary", async ({
  page,
}) => {
  const dialog = await bootstrap(page, HEATMAP_REPERTOIRE, "heatmap-sort.pgn");
  const heatmap = dialog.locator(".concept-heatmap");
  const columns = heatmap.locator("[data-heatmap-column]");
  const byConcept = await columns.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-heatmap-column")),
  );
  expect(byConcept).toEqual([...byConcept].sort());

  await heatmap.locator("[data-heatmap-sort]").selectOption("frequency");
  const byFrequency = await columns.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-heatmap-column")),
  );
  expect([...byFrequency].sort()).toEqual([...byConcept].sort());

  const summary = await heatmap.locator("[data-heatmap-screen-reader-summary]").textContent();
  expect(summary).toContain("Concept heatmap");
  expect(summary).toContain("no observed mastery");
});

test("the heatmap table stays contained and usable on a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await bootstrap(page, HEATMAP_REPERTOIRE, "heatmap-mobile.pgn");
  const heatmap = dialog.locator(".concept-heatmap");
  await heatmap.scrollIntoViewIfNeeded();
  await expect(heatmap.locator("[data-heatmap-table]")).toBeVisible();

  const scroll = heatmap.locator(".concept-heatmap-scroll");
  const overflow = await scroll.evaluate((element) => getComputedStyle(element).overflowX);
  expect(["auto", "scroll"]).toContain(overflow);
  const contained = await scroll.evaluate(
    (element) => element.clientWidth <= (element.closest(".concept-heatmap")?.clientWidth ?? 0) + 1,
  );
  expect(contained).toBe(true);

  const cell = heatmap.locator("[data-heatmap-cell]").first();
  const size = await cell.boundingBox();
  expect(size!.width).toBeGreaterThanOrEqual(44);
  expect(size!.height).toBeGreaterThanOrEqual(44);
  await cell.click();
  await expect(heatmap.locator("[data-heatmap-detail]")).toBeVisible();
});

test("a repertoire without concept evidence shows an explicit unavailable heatmap", async ({
  page,
}) => {
  const dialog = await bootstrap(page, "1. e4 *", "heatmap-unavailable.pgn");
  const heatmap = dialog.locator(".concept-heatmap");
  await expect(heatmap).toHaveAttribute("data-heatmap-state", "unavailable");
  await expect(heatmap.locator("[data-heatmap-unavailable]")).toContainText(
    "Not available for this report",
  );
  await expect(heatmap.locator("[data-heatmap-table]")).toHaveCount(0);
});
