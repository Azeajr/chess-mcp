import { expect, test, type Page } from "playwright/test";
import { RICH_PGN } from "./helpers/app";

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  setColor(color: "white" | "black"): void;
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

const SHALLOW_PGN = [
  '[Event "Shallow one"]\n[Result "*"]\n\n1. d4 d5 2. c4 e6 *',
  '[Event "Shallow two"]\n[Result "*"]\n\n1. d4 Nf6 2. c4 e6 *',
  '[Event "Shallow three"]\n[Result "*"]\n\n1. d4 d5 2. Nf3 Nf6 *',
].join("\n\n");

const LIMITED_PGN = [
  '[Event "Limited deep one"]\n[Result "*"]\n\n1. d4 Nf6 2. Nf3 e6 3. Bf4 c5 4. e3 Nc6 5. c3 d5 6. Nbd2 Bd6 7. Bg3 *',
  '[Event "Limited deep two"]\n[Result "*"]\n\n1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bf4 O-O 6. e3 c5 7. Bd3 *',
  '[Event "Limited shallow"]\n[Result "*"]\n\n1. d4 d5 2. Nf3 Nf6 *',
].join("\n\n");

async function bootstrap(page: Page) {
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
}

async function loadProfile(page: Page, pgn: string, name: string) {
  await chess(page, (api, input) => api.loadPgn(input.pgn, input.name), { pgn, name });
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
}

async function openWorkspace(page: Page) {
  await page.getByRole("button", { name: "Open Strategic Fit" }).click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function analyze(dialog: ReturnType<Page["getByRole"]>) {
  const action = dialog.getByRole("button", {
    name: /Analyze strategic fit|Retry analysis|Analyze again/,
  });
  await expect(action).toBeVisible();
  await action.click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({
    timeout: 20_000,
  });
}

async function showFindings(dialog: ReturnType<Page["getByRole"]>) {
  await dialog.locator("#strategic-fit-stage-findings").click();
  await expect(dialog.locator(".strategic-fit-workspace-body")).toHaveAttribute(
    "data-stage",
    "findings",
  );
}

async function preflightCounts(dialog: ReturnType<Page["getByRole"]>) {
  const pane = dialog.locator(".strategic-fit-preflight, [data-preflight]").first();
  return (await pane.count()) > 0 ? ((await pane.textContent()) ?? "") : "";
}

test("WP-031 AC-1 zero comparable routes render one terminal state with remedies", async ({
  page,
}) => {
  test.slow();
  await bootstrap(page);
  await loadProfile(page, SHALLOW_PGN, "wp031-shallow.pgn");
  const dialog = await openWorkspace(page);
  await analyze(dialog);

  await expect(dialog.locator("[data-evidence-state='none']")).toBeVisible();

  await expect(dialog.getByText("Analysis complete", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/limited evidence/i).first()).toBeVisible();

  await showFindings(dialog);
  const terminal = dialog.locator("[data-strategic-fit-evidence-state='none']");
  await expect(terminal).toBeVisible();
  await expect(terminal).toContainText(/routes/i);
  await expect(terminal).toContainText(/0 of them/i);

  const remedies = terminal.locator("[data-remedy]");
  expect(await remedies.count()).toBeGreaterThanOrEqual(2);

  const again = terminal.getByRole("button", { name: "Analyze again" });
  await expect(again).toBeVisible();
  await again.click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({
    timeout: 20_000,
  });
  await expect(dialog.locator("[data-strategic-fit-evidence-state='none']")).toBeVisible();
});

test("WP-031 AC-2 a degraded report with comparable routes keeps findings and adds a banner", async ({
  page,
}) => {
  await bootstrap(page);
  await loadProfile(page, LIMITED_PGN, "wp031-limited.pgn");
  const dialog = await openWorkspace(page);
  await analyze(dialog);

  await expect(dialog.locator("[data-evidence-state='limited']")).toBeVisible();
  await expect(dialog.getByText("Analysis finished — limited evidence").first()).toBeVisible();
  await expect(dialog.locator("[data-limited-evidence-banner]")).toBeVisible();

  await expect(dialog.locator("[data-strategic-fit-evidence-state='none']")).toHaveCount(0);
  await showFindings(dialog);
  await expect(dialog.locator("#strategic-fit-pane-findings")).toBeVisible();
});

test("WP-031 AC-3 AC-5 a deep multi-route repertoire reaches a full-evidence report", async ({
  page,
}) => {
  test.slow();
  await bootstrap(page);
  await loadProfile(page, RICH_PGN, "wp031-rich.pgn");
  const dialog = await openWorkspace(page);
  await analyze(dialog);

  await expect(dialog.locator("[data-strategic-fit-evidence-state='none']")).toHaveCount(0);

  await expect(dialog.locator("[data-evidence-state='full']")).toBeVisible();
  await expect(dialog.getByText("Analysis complete", { exact: true }).first()).toBeVisible();
  await expect(dialog.locator("[data-limited-evidence-banner]")).toHaveCount(0);
});

test("WP-031 AC-4 the preflight counts and issue list survive the terminal state", async ({
  page,
}) => {
  await bootstrap(page);
  await loadProfile(page, SHALLOW_PGN, "wp031-shallow-counts.pgn");
  const dialog = await openWorkspace(page);
  await analyze(dialog);

  await showFindings(dialog);
  await expect(dialog.locator("[data-strategic-fit-evidence-state='none']")).toBeVisible();

  const preflightSummary = dialog.locator("[data-preflight-collapsed='true'] button");
  await expect(preflightSummary).toBeVisible();
  await preflightSummary.click();

  const counts = await preflightCounts(dialog);
  expect(counts).toMatch(/route/i);

  await expect(dialog.getByText(/Comparable routes/i).first()).toBeVisible();
});
