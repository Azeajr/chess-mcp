import { expect, test, type Page } from "./helpers/fixtures";
import { RICH_PGN } from "./helpers/app";

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
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

async function completedWorkspace(page: Page, width = 1280, height = 800) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await chess(page, (api, pgn) => api.loadPgn(pgn, "wp032-disclosure.pgn"), RICH_PGN);
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
  await page.getByRole("button", { name: "Open Strategic Fit" }).click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await dialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({
    timeout: 20_000,
  });
  return dialog;
}

test("WP-032 AC-1 completed disclosures put the first finding inside a 1280x800 viewport", async ({
  page,
}) => {
  test.slow();
  const dialog = await completedWorkspace(page);

  await expect(dialog.locator("[data-progress-collapsed='true']")).toBeVisible();
  await expect(dialog.locator("[data-preflight-collapsed='true']")).toBeVisible();

  await dialog.locator("#strategic-fit-stage-findings").click();
  const firstFinding = dialog.locator("[data-finding-id]").first();
  await expect(firstFinding).toBeVisible();
  const geometry = await firstFinding.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const pane = element.closest("#strategic-fit-pane-findings");
    return {
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
      paneScrollTop: pane?.scrollTop ?? -1,
    };
  });
  expect(geometry.paneScrollTop).toBe(0);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.top).toBeLessThan(geometry.viewportHeight);
});

test("WP-032 AC-2 active analysis keeps the full six-phase progress display", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await chess(page, (api, pgn) => api.loadPgn(pgn, "wp032-running.pgn"), RICH_PGN);
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
  await page.getByRole("button", { name: "Open Strategic Fit" }).click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await dialog.getByRole("button", { name: "Analyze strategic fit" }).click();

  const progress = dialog.locator(".strategic-fit-analysis-progress-card");
  await expect(progress).toHaveAttribute("data-progress-collapsed", "false");
  await expect(progress.locator(".strategic-fit-analysis-phase-list li")).toHaveCount(6);
});

test("WP-032 AC-3 both completed summaries expand and collapse from the keyboard", async ({
  page,
}) => {
  const dialog = await completedWorkspace(page);

  const phases = dialog.getByRole("button", { name: /All six phases completed/ });
  await expect(phases).toHaveAttribute("aria-expanded", "false");
  await phases.focus();
  await page.keyboard.press("Enter");
  const hidePhases = dialog.getByRole("button", { name: /Hide phase details/ });
  await expect(hidePhases).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.locator(".strategic-fit-analysis-phase-list li")).toHaveCount(6);
  await hidePhases.focus();
  await page.keyboard.press("Space");
  await expect(phases).toHaveAttribute("aria-expanded", "false");

  const preflight = dialog.getByRole("button", { name: /routes.*comparable.*incomplete/i });
  await expect(preflight).toHaveAttribute("aria-expanded", "false");
  await preflight.focus();
  await page.keyboard.press("Enter");
  const hidePreflight = dialog.getByRole("button", { name: /Hide evidence-check details/ });
  await expect(hidePreflight).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.getByRole("list", { name: "Evidence-check findings" })).toBeVisible();
});

test("WP-032 AC-4 print/export and beforeprint force both disclosures fully open", async ({
  page,
}) => {
  const dialog = await completedWorkspace(page);
  const progress = dialog.locator(".strategic-fit-analysis-progress-card");
  const preflight = dialog.locator(".strategic-fit-preflight");

  await expect(progress).toHaveAttribute("data-progress-collapsed", "true");
  await expect(preflight).toHaveAttribute("data-preflight-collapsed", "true");

  await dialog.locator("[data-strategic-fit-print-export-toggle]").click();
  await expect(progress).toHaveAttribute("data-progress-collapsed", "false");
  await expect(preflight).toHaveAttribute("data-preflight-collapsed", "false");
  await expect(dialog.locator(".strategic-fit-analysis-phase-list li")).toHaveCount(6);
  await dialog.locator("[data-strategic-fit-print-export-toggle]").click();

  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(progress).toHaveAttribute("data-progress-collapsed", "false");
  await expect(preflight).toHaveAttribute("data-preflight-collapsed", "false");
  await page.emulateMedia({ media: "print" });
  await expect(dialog.locator(".strategic-fit-analysis-phase-list li")).toHaveCount(6);
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(progress).toHaveAttribute("data-progress-collapsed", "true");
  await expect(preflight).toHaveAttribute("data-preflight-collapsed", "true");
});
