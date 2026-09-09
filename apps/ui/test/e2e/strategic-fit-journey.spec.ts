import { expect, test, type Page } from "./helpers/fixtures";
import { installFindingWorkerFixture } from "./helpers/strategic-fit-worker-fixture";

// Findings from the Strategic Fit completion journey (docs/UX_REVIEW.md).

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  toPgn(): string;
  strategicFitMetadata(): { resolutions: { state: string }[] };
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

const REPERTOIRE = "1. e4 e5 (1... c5) 2. Nf3 Nc6 *";

async function bootstrap(page: Page, name: string) {
  await installFindingWorkerFixture(page);
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await chess(page, (api, input) => api.loadPgn(input.pgn, input.name), {
    pgn: REPERTOIRE,
    name,
  });
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
  return page;
}

async function analyze(page: Page) {
  await page.getByRole("button", { name: "Open Strategic Fit" }).click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await dialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({
    timeout: 30_000,
  });
  return dialog;
}

test("a recorded resolution holds and says so", async ({ page }) => {
  test.slow();
  await bootstrap(page, "strategic-fit-journey-resolution.pgn");
  const before = await chess(page, (api) => api.toPgn());
  const dialog = await analyze(page);

  // Selecting a result opens its Branch story, including the decision controls directly after the
  // explanation.
  await dialog.locator("#strategic-fit-stage-findings").click();
  await dialog
    .getByRole("button", { name: /^Review finding/ })
    .first()
    .click();
  const save = dialog.getByRole("button", { name: "Save resolution" });
  await expect(save).toBeVisible();
  await save.click();

  // Recording a resolution takes its finding out of review and produces a new report, and both used
  // to wipe the message the transition composed: the pane emptied to "No resolution selected" with
  // no word of what had just been recorded.
  const lastAction = dialog.locator("[data-resolution-last-action]");
  await expect(lastAction).toBeVisible();
  await expect(lastAction).toContainText("The repertoire was not changed.");

  // The resolution also has to survive the reanalysis it triggers. That run recomputes the
  // finding's evidence with the decision applied, and reopening it on that basis threw the first
  // resolution away — only a second identical attempt held.
  await expect
    .poll(() => chess(page, (api) => api.strategicFitMetadata().resolutions.length), {
      timeout: 15_000,
    })
    .toBe(1);
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
});

test("saving an artifact says whether the file arrived", async ({ page }) => {
  await bootstrap(page, "strategic-fit-journey-transfer.pgn");

  const transfer = page.locator("details.strategic-fit-transfer");
  await transfer.evaluate((node: HTMLDetailsElement) => {
    node.open = true;
  });
  await transfer.getByRole("button", { name: "Generate metadata JSON" }).click();

  const save = transfer.getByRole("button", { name: "Save metadata JSON" });
  await expect(save).toBeVisible();

  const download = page.waitForEvent("download");
  await save.click();
  await download;

  // Pressing Save changed nothing on screen, so a browser that refused the download looked exactly
  // like one that took it.
  const status = transfer.locator("[data-artifact-save]");
  await expect(status).toHaveAttribute("data-artifact-save", "saved");
  await expect(status).toContainText("Saved");

  await page.evaluate(() => {
    URL.createObjectURL = () => {
      throw new Error("blocked for the test");
    };
  });
  await save.click();
  await expect(status).toHaveAttribute("data-artifact-save", "blocked");
  await expect(status).toContainText("blocked the download");
});
