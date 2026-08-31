import { expect, test, type Page } from "playwright/test";
import { RICH_PGN } from "./helpers/app";

/**
 * WP-031 — the three evidence states of a completed Strategic Fit report.
 *
 * These fixtures drive the real analysis rather than injecting a report, so the state under test is
 * the one the analysis actually produces. The distinction that matters is depth: a route must reach
 * the comparable-ply threshold to be compared against another, so shallow lines yield a report with
 * zero comparable routes no matter how many of them there are.
 */

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

/**
 * Several routes, none deep enough to compare: every line stops at ply 4, well short of the
 * threshold. This is the shape that produced the audit finding — six routes, zero comparable.
 */
const SHALLOW_PGN = [
  '[Event "Shallow one"]\n[Result "*"]\n\n1. d4 d5 2. c4 e6 *',
  '[Event "Shallow two"]\n[Result "*"]\n\n1. d4 Nf6 2. c4 e6 *',
  '[Event "Shallow three"]\n[Result "*"]\n\n1. d4 d5 2. Nf3 Nf6 *',
].join("\n\n");

/** Two comparable routes plus one shallow route: findings remain useful, but evidence is limited. */
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

/** The preflight counts, read from the rendered pane so AC-4 compares what the user sees. */
async function preflightCounts(dialog: ReturnType<Page["getByRole"]>) {
  const pane = dialog.locator(".strategic-fit-preflight, [data-preflight]").first();
  return (await pane.count()) > 0 ? ((await pane.textContent()) ?? "") : "";
}

test("WP-031 AC-1 zero comparable routes render one terminal state with remedies", async ({
  page,
}) => {
  // This exercises two complete real analyses (initial run + Analyze again), not a fixture seam.
  test.slow();
  await bootstrap(page);
  await loadProfile(page, SHALLOW_PGN, "wp031-shallow.pgn");
  const dialog = await openWorkspace(page);
  await analyze(dialog);

  // The evidence state the analysis actually reached.
  await expect(dialog.locator("[data-evidence-state='none']")).toBeVisible();

  // AC-1: the header no longer claims an unqualified success.
  await expect(dialog.getByText("Analysis complete", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/limited evidence/i).first()).toBeVisible();

  // One terminal state, naming the current counts.
  const terminal = dialog.locator("[data-strategic-fit-evidence-state='none']");
  await expect(terminal).toBeVisible();
  await expect(terminal).toContainText(/routes/i);
  await expect(terminal).toContainText(/0 of them/i);

  // At least two remedies.
  const remedies = terminal.locator("[data-remedy]");
  expect(await remedies.count()).toBeGreaterThanOrEqual(2);

  // `Analyze again` is present and works: clicking it starts another run that completes.
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

  // Comparable routes exist, so the findings pane still renders rather than the terminal state.
  await expect(dialog.locator("[data-strategic-fit-evidence-state='none']")).toHaveCount(0);
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

  // AC-5 positive control: the terminal state must not appear for a repertoire that has evidence.
  await expect(dialog.locator("[data-strategic-fit-evidence-state='none']")).toHaveCount(0);

  // AC-3: with full evidence the header reads the plain completed label and no banner appears.
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

  await expect(dialog.locator("[data-strategic-fit-evidence-state='none']")).toBeVisible();

  // WP-032 collapses completed preflight by default. Expand it before verifying that the original
  // counts and issue list remain intact beneath the disclosure.
  const preflightSummary = dialog.locator("[data-preflight-collapsed='true'] button");
  await expect(preflightSummary).toBeVisible();
  await preflightSummary.click();

  // The preflight pane still reports its counts: the terminal state replaces the findings,
  // evidence, and resolution panes, not the payload that explains why.
  const counts = await preflightCounts(dialog);
  expect(counts).toMatch(/route/i);

  // And the raw route numbers are still on screen somewhere in the dialog.
  await expect(dialog.getByText(/Comparable routes/i).first()).toBeVisible();
});
