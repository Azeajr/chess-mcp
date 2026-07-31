import { expect, test, type Page } from "playwright/test";

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  toPgn(): string;
  strategicFitMetadataStatus(): string;
  selectStrategicFitProfile(mode: "balanced"): unknown;
};

const chess = <T>(page: Page, fn: (api: ChessHarness, arg: T) => unknown, arg?: T) => page.evaluate(
  ({ source, arg }) => Function("api", "arg", `return (${source})(api, arg)`)(
    (window as unknown as { __chess: ChessHarness }).__chess,
    arg,
  ),
  { source: fn.toString(), arg },
);

const MAP_REPERTOIRE = `[Event "Map: Queen's Gambit"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bf4 O-O 6. e3 c5 7. Bd3 *

[Event "Map: Ruy Lopez"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 *

[Event "Map: Open Sicilian"]
[Result "*"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be2 e5 7. Nb3 *

[Event "Map: French Advance"]
[Result "*"]

1. e4 e6 2. d4 d5 3. e5 c5 4. c3 Nc6 5. Nf3 Qb6 6. a3 Nh6 7. b4 *`;

async function bootstrap(page: Page, pgn: string, name: string) {
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await chess(page, (api, input) => api.loadPgn(input.pgn, input.name), { pgn, name });
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
  await page.getByRole("button", { name: "Open workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await dialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({ timeout: 15_000 });
  return dialog;
}

test("the strategic map plots explainable points and selection syncs with the finding queue", async ({ page }) => {
  const dialog = await bootstrap(page, MAP_REPERTOIRE, "map-complete.pgn");
  const before = await chess(page, (api) => api.toPgn());
  const map = dialog.locator(".strategic-map");
  await expect(map).toHaveAttribute("data-map-state", /available|single-axis/u);
  await expect(map).toHaveAttribute("data-map-projection-version", "1.0.0");

  const points = map.locator("[data-map-point]");
  const pointCount = await points.count();
  expect(pointCount).toBeGreaterThan(0);
  await expect(map.locator("[data-map-list] tbody tr")).toHaveCount(pointCount);

  await map.getByText("How positions are calculated").click();
  await expect(map.locator("[data-map-axis='x']")).toContainText("strategic distance");
  await expect(map.locator("[data-map-excluded-family='learning-concepts']")).toBeVisible();

  const unresolvedPoint = map.locator("[data-map-point][data-map-resolution='unresolved-finding']").first();
  await expect(unresolvedPoint).toBeVisible();
  await unresolvedPoint.click();
  const detail = map.locator("[data-map-detail]");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("Why this branch sits here");
  await expect(detail.locator("[data-map-breakdown='x'] [data-map-feature]").first()).toBeVisible();

  const openFinding = detail.locator("[data-map-open-finding]").first();
  const findingId = await openFinding.getAttribute("data-map-open-finding");
  await openFinding.click();
  await expect(dialog.locator(".strategic-fit-workspace-body")).toHaveAttribute("data-stage", "findings");
  const findings = dialog.locator("#strategic-fit-pane-findings");
  await expect(findings.getByRole("status")).toContainText("Findings for the selected map branch");
  await expect(
    findings.locator(`[data-finding-id='${findingId}']`),
  ).toHaveAttribute("data-finding-selected", "true");

  expect(await chess(page, (api) => api.toPgn())).toBe(before);
});

test("map filters, zoom, and keyboard selection work through the list equivalent", async ({ page }) => {
  const dialog = await bootstrap(page, MAP_REPERTOIRE, "map-filters.pgn");
  const map = dialog.locator(".strategic-map");
  const points = map.locator("[data-map-point]");
  const allCount = await points.count();
  expect(allCount).toBeGreaterThan(1);

  const cohortFilter = map.locator("[data-map-cohort-filter]");
  const firstCohort = await cohortFilter.locator("option").nth(1).getAttribute("value");
  await cohortFilter.selectOption(firstCohort!);
  expect(await points.count()).toBeLessThan(allCount);
  await cohortFilter.selectOption("all");
  await expect(points).toHaveCount(allCount);

  await map.locator("[data-map-zoom]").fill("2");
  await expect(map.locator("[data-map-chart]")).toHaveAttribute("viewBox", "25 25 50 50");

  const firstRowButton = map.locator("[data-map-list] tbody tr button").first();
  await firstRowButton.focus();
  await page.keyboard.press("Enter");
  await expect(firstRowButton).toHaveAttribute("aria-pressed", "true");
  await expect(map.locator("[data-map-detail]")).toBeVisible();

  const svgPoint = points.nth(1);
  await svgPoint.focus();
  await page.keyboard.press("Enter");
  const focusedRoute = await svgPoint.getAttribute("data-map-point");
  await expect(map.locator(`[data-map-row='${focusedRoute}']`)).toHaveAttribute("data-selected", "true");
  await expect(map.locator("[data-map-detail]")).toHaveAttribute("data-map-detail", focusedRoute!);
});

test("a repertoire without comparable evidence shows an explicit unavailable map", async ({ page }) => {
  const dialog = await bootstrap(page, "1. e4 *", "map-unavailable.pgn");
  const map = dialog.locator(".strategic-map");
  await expect(map).toHaveAttribute("data-map-state", "unavailable");
  await expect(map.locator("[data-map-unavailable]")).toContainText("Strategic map unavailable");
  await expect(map.locator("[data-map-chart]")).toHaveCount(0);
  await map.getByText("Why branches are excluded", { exact: false }).click();
  await expect(map.locator("[data-map-exclusion]").first()).toBeVisible();
});

test("the strategic map keeps a stable visual baseline", async ({ page }) => {
  const dialog = await bootstrap(page, MAP_REPERTOIRE, "map-visual.pgn");
  const map = dialog.locator(".strategic-map");
  await expect(map).toHaveAttribute("data-map-state", /available|single-axis/u);
  await map.locator(".strategic-map-list summary").click();
  await expect(map.locator("[data-map-chart]")).toBeVisible();
  await expect(map.locator(".strategic-map-chart")).toHaveScreenshot("strategic-map-chart.png", {
    animations: "disabled",
    caret: "hide",
  });
});
