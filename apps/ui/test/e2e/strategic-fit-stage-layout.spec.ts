import { expect, test, type Page } from "playwright/test";
import { installFindingWorkerFixture } from "./helpers/strategic-fit-worker-fixture";

/**
 * WP-033 (a) — one resolution render, a stage indicator at every width, and the stale block.
 *
 * The duplicate-render assertions are the point of this file: before this package the wide tier
 * rendered ResolutionActions/TrainException/CohortEditor into the evidence column *and* the
 * resolution pane, so the same controls existed twice in one accessibility tree.
 */

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

/** The four widths AC-1 names: phone, compact-tier boundary, just above it, and desktop. */
const WIDTHS = [
  { width: 390, height: 844, label: "phone" },
  { width: 820, height: 1000, label: "compact boundary" },
  { width: 1101, height: 800, label: "just above compact" },
  { width: 1440, height: 900, label: "desktop" },
] as const;

async function openWorkspace(page: Page, options: { withFindings?: boolean } = {}) {
  if (options.withFindings === true) await installFindingWorkerFixture(page);
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  if (options.withFindings === true) {
    // The fixture's frozen report is computed against this document.
    await chess(page, (api) => api.loadPgn("1. e4 e5 (1... c5) 2. Nf3 Nc6 *", "stage-layout.pgn"));
  }
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
  await page.getByRole("button", { name: "Open Strategic Fit" }).click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("WP-033 AC-1 a stage indicator showing the current stage exists at every width", async ({
  page,
}) => {
  test.slow();
  const dialog = await openWorkspace(page);

  for (const viewport of WIDTHS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const nav = dialog.locator(".strategic-fit-stage-nav");
    await expect(nav, `stage nav at ${viewport.label}`).toBeVisible();

    // Exactly one stage is marked current, and it agrees with the rendered body's stage.
    const current = nav.locator("[data-stage-state='current']");
    await expect(current, `current stage at ${viewport.label}`).toHaveCount(1);
    await expect(current).toHaveAttribute("aria-current", "step");

    const bodyStage = await dialog
      .locator(".strategic-fit-workspace-body")
      .getAttribute("data-stage");
    await expect(current).toHaveAttribute("id", `strategic-fit-stage-${bodyStage}`);
  }
});

/**
 * The resolution controls AC-2 governs. Every one is `1` at every width: the pane renders once,
 * and the wide tier no longer duplicates it into the evidence column.
 *
 * `toBe(1)` rather than `toBeLessThanOrEqual(1)` is the point. The original one-sided bound could
 * not tell "exactly once" from "not at all", and in fact ran entirely against zeros — the suite
 * never selected a finding, so `currentResolution()` was null and none of these controls existed
 * at any width. Deleting all three components outright would have kept the suite green.
 */
const RESOLUTION_CONTROLS = [
  ".strategic-fit-resolution-actions",
  ".strategic-fit-training",
  ".strategic-fit-cohort-editor",
  ".strategic-fit-review-actions",
] as const;

test("WP-033 AC-2 resolution controls render exactly once at every width", async ({ page }) => {
  test.slow();
  const dialog = await openWorkspace(page, { withFindings: true });
  await dialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({
    timeout: 20_000,
  });

  // Selecting a finding is what makes the resolution pane render at all. Assert the precondition
  // so this can never silently degrade back into counting zeros. One stage is on screen at every
  // width now, so reach the queue the way a reader does.
  await dialog.locator("#strategic-fit-stage-findings").click();
  await expect(dialog.locator("[data-finding-select]")).not.toHaveCount(0);
  await dialog.locator("[data-finding-select]").first().click();
  await expect(dialog.locator(".strategic-fit-review-actions")).toHaveCount(1, { timeout: 10_000 });

  for (const viewport of WIDTHS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    // Counted in the DOM rather than by visibility: a second hidden copy is still a duplicate in
    // the accessibility tree, which is exactly the defect UX-033 records.
    for (const selector of RESOLUTION_CONTROLS) {
      await expect(dialog.locator(selector), `${selector} at ${viewport.label}`).toHaveCount(1);
    }
  }
});

test("WP-033 AC-4 the compact tablist keyboard contract is unchanged", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await openWorkspace(page);

  const overview = dialog.getByRole("tab", { name: "Overview" });
  await overview.focus();
  await expect(overview).toHaveAttribute("aria-selected", "true");
  await expect(overview).toHaveAttribute("tabindex", "0");

  await page.keyboard.press("ArrowRight");
  const findings = dialog.getByRole("tab", { name: "Findings" });
  await expect(findings).toBeFocused();
  await expect(findings).toHaveAttribute("aria-selected", "true");
  // Roving tabindex: the stage that lost selection is no longer a Tab stop.
  await expect(overview).toHaveAttribute("tabindex", "-1");

  await page.keyboard.press("End");
  await expect(dialog.getByRole("tab", { name: "Resolution" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(overview).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(dialog.getByRole("tab", { name: "Resolution" })).toBeFocused();

  await expect(dialog.locator(".strategic-fit-workspace-pane:visible")).toHaveCount(1);
});
