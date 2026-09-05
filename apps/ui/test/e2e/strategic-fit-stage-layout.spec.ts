import { expect, test, type Page } from "playwright/test";
import { installFindingWorkerFixture } from "./helpers/strategic-fit-worker-fixture";

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

    const current = nav.locator("[data-stage-state='current']");
    await expect(current, `current stage at ${viewport.label}`).toHaveCount(1);
    await expect(current).toHaveAttribute("aria-current", "step");

    const bodyStage = await dialog
      .locator(".strategic-fit-workspace-body")
      .getAttribute("data-stage");
    await expect(current).toHaveAttribute("id", `strategic-fit-stage-${bodyStage}`);
  }
});

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

  await dialog.locator("#strategic-fit-stage-findings").click();
  await expect(dialog.locator("[data-finding-select]")).not.toHaveCount(0);
  await dialog.locator("[data-finding-select]").first().click();
  await expect(dialog.locator(".strategic-fit-review-actions")).toHaveCount(1, { timeout: 10_000 });

  for (const viewport of WIDTHS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
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
  await expect(overview).toHaveAttribute("tabindex", "-1");

  await page.keyboard.press("End");
  await expect(dialog.getByRole("tab", { name: "Resolution" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(overview).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(dialog.getByRole("tab", { name: "Resolution" })).toBeFocused();

  await expect(dialog.locator(".strategic-fit-workspace-pane:visible")).toHaveCount(1);
});
