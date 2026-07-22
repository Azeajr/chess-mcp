import { expect, test, type Page } from "playwright/test";

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  setColor(color: "white" | "black"): void;
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

const DEEP_MULTI_ROUTE = `[Event "Strategic Fit preflight: deep route one"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bf4 O-O 6. e3 c5 7. Bd3 *

[Event "Strategic Fit preflight: deep route two"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 *`;

const TRANSPOSITIONS = `[Event "Strategic Fit preflight: move order one"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Nf3 Be7 *

[Event "Strategic Fit preflight: move order two"]
[Result "*"]

1. Nf3 d5 2. d4 Nf6 3. c4 e6 4. Nc3 Be7 *`;

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
  await page.getByRole("button", { name: "Open workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function analyze(dialog: ReturnType<Page["getByRole"]>) {
  const action = dialog.getByRole("button", {
    name: /Analyze strategic fit|Retry analysis|Analyze again/,
  });
  if (await action.isVisible()) await action.click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({ timeout: 15_000 });
}

async function expectNoQualityVerdict(dialog: ReturnType<Page["getByRole"]>) {
  await expect(dialog.getByText(/consistent|no issues/i)).toHaveCount(0);
}

async function installStrategicWorkerFixture(page: Page, mode: "phase-stall" | "custom-blocked") {
  await page.addInitScript((workerMode: "phase-stall" | "custom-blocked") => {
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args, newTarget) {
        if (!String(args[0]).includes("strategic-fit.worker")) {
          return Reflect.construct(target, args, newTarget);
        }
        const controlled = {
          onmessage: null as ((event: MessageEvent) => void) | null,
          onerror: null as ((event: ErrorEvent) => void) | null,
          postMessage(message: any) {
            if (message.type !== "analyze") return;
            const sendProgress = (
              phase: string,
              phaseIndex: number,
              state: "running" | "completed",
              label: string,
            ) => controlled.onmessage?.({
              data: {
                type: "progress",
                request_id: message.request_id,
                progress: {
                  analysis_version: "2.0.0",
                  run_id: "e2e-progress",
                  phase,
                  phase_index: phaseIndex,
                  phase_count: 6,
                  state,
                  completed_units: state === "completed" ? 1 : 0,
                  total_units: 1,
                  provisional_findings: true,
                  message: label,
                },
              },
            } as MessageEvent);
            sendProgress("normalizing-move-orders", 0, "running", "Normalizing move orders");
            sendProgress("normalizing-move-orders", 0, "completed", "Normalizing move orders");
            if (workerMode === "phase-stall") {
              sendProgress(
                "identifying-comparable-branches",
                1,
                "running",
                "Identifying comparable branches",
              );
              return;
            }
            const profile = message.payload.options.profile;
            const unavailableMetric = (metricId: string, unit: string) => ({
              analysis_version: "2.0.0",
              metric_id: metricId,
              state: "unavailable",
              value: null,
              unit,
              reason: "Strategic Fit metrics are unavailable because preflight blocked position analysis.",
              provenance: [],
            });
            controlled.onmessage?.({
              data: {
                type: "result",
                request_id: message.request_id,
                result: {
                  schema_version: "1.0.0",
                  analysis_version: "2.0.0",
                  report_id: "report:custom-blocked",
                  repertoire_revision: message.payload.metadata.repertoire_revision,
                  manifest: { components: {} },
                  profile,
                  preflight: {
                    analysis_version: "2.0.0",
                    state: "blocked",
                    issues: [
                      {
                        analysis_version: "2.0.0",
                        issue_id: "preflight:unsupported-custom-start",
                        code: "unsupported-custom-start",
                        kind: "error",
                        severity: "blocking",
                        message: "Strategic Fit cannot analyze a repertoire from a custom starting FEN.",
                        affected_route_ids: [],
                        affected_source_paths: [],
                        details: { supported_start: "standard-initial-position" },
                        provenance: [],
                      },
                      {
                        analysis_version: "2.0.0",
                        issue_id: "preflight:malformed-data",
                        code: "malformed-data",
                        kind: "error",
                        severity: "blocking",
                        message: "The repertoire setup headers are malformed.",
                        affected_route_ids: [],
                        affected_source_paths: [],
                        details: { reason: "Synthetic unsupported setup fixture." },
                        provenance: [],
                      },
                    ],
                    route_count: 0,
                    comparable_route_count: 0,
                    incomplete_route_count: 0,
                  },
                  trajectories: [],
                  cohorts: [],
                  summary: {
                    analysis_version: "2.0.0",
                    workload: "unavailable",
                    strategic_family_count: 0,
                    expected_concept_burden: null,
                    intentional_exception_count: 0,
                    unresolved_finding_count: 0,
                    insufficient_evidence_branch_count: 0,
                    metrics: {
                      analysis_version: "2.0.0",
                      strategic_entropy: unavailableMetric("strategic-entropy", "entropy"),
                      concept_reuse: unavailableMetric("concept-reuse", "fraction"),
                      exception_burden: unavailableMetric("exception-burden", "composite"),
                      forced_diversity_floor: unavailableMetric("forced-diversity-floor", "fraction"),
                      homogenization_cost: unavailableMetric("homogenization-cost", "composite"),
                      familiarity_adjusted_coverage: unavailableMetric(
                        "familiarity-adjusted-coverage",
                        "fraction",
                      ),
                      training_adjusted_workload: unavailableMetric("training-adjusted-workload", "score"),
                      repertoire_regret: unavailableMetric("repertoire-regret", "score"),
                      move_order_resilience: unavailableMetric("move-order-resilience", "fraction"),
                      concept_centrality: unavailableMetric("concept-centrality", "composite"),
                    },
                  },
                  findings: [],
                  finding_page: {
                    offset: 0,
                    limit: 5000,
                    total_count: 0,
                    returned_count: 0,
                    has_more: false,
                  },
                  provenance: {},
                },
              },
            } as MessageEvent);
          },
          terminate() {},
        };
        return controlled;
      },
    });
  }, mode);
}

test("six frozen phases expose current, completed, pending, cancelled, and reduced-motion states", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installStrategicWorkerFixture(page, "phase-stall");
  await bootstrap(page);
  await loadProfile(page, DEEP_MULTI_ROUTE, "phase-progress.pgn");
  const dialog = await openWorkspace(page);
  await dialog.getByRole("button", { name: "Analyze strategic fit" }).click();

  const phases = dialog.locator("[data-phase]");
  await expect(phases).toHaveCount(6);
  await expect(phases.locator(".strategic-fit-analysis-phase-name")).toHaveText([
    "Normalizing move orders",
    "Identifying comparable branches",
    "Extracting strategic patterns",
    "Measuring learning burden",
    "Attributing differences to decisions",
    "Ranking findings",
  ]);
  await expect(phases.nth(0)).toHaveAttribute("data-phase-state", "completed");
  await expect(phases.nth(0)).toContainText("Completed");
  await expect(phases.nth(1)).toHaveAttribute("data-phase-state", "running");
  await expect(phases.nth(1)).toContainText("Current");
  await expect(phases.nth(2)).toContainText("Pending");
  await expect(dialog.getByRole("status")).toContainText("Current phase: Identifying comparable branches");
  await expect(dialog.getByRole("progressbar")).toHaveAttribute("max", "6");
  await expect(dialog.getByText(/0\/0/)).toHaveCount(0);

  const motion = await phases.nth(1).evaluate((element) => {
    const style = getComputedStyle(element);
    return { animationName: style.animationName, transitionDuration: style.transitionDuration };
  });
  expect(motion).toEqual({ animationName: "none", transitionDuration: "0s" });

  await dialog.getByRole("button", { name: "Cancel analysis" }).click();
  await expect(dialog.locator("[data-analysis-state='cancelled']")).toBeVisible();
  await expect(phases.nth(1)).toHaveAttribute("data-phase-state", "cancelled");
  await expect(phases.nth(1)).toContainText("Cancelled");
  await expect(phases.nth(2)).toContainText("Not run after cancellation");
});

test("empty input blocks after normalization and never claims dependent phases ran", async ({ page }) => {
  await bootstrap(page);
  await loadProfile(page, "*", "empty.pgn");
  const dialog = await openWorkspace(page);
  await analyze(dialog);

  await expect(dialog.locator("[data-preflight-state='blocked']")).toBeVisible();
  await expect(dialog.locator("[data-preflight-code='empty-repertoire']")).toContainText("Empty repertoire");
  await expect(dialog.locator("[data-preflight-code='empty-repertoire']")).toContainText("Blocking");
  await expect(dialog.locator("[data-preflight-code='empty-repertoire']")).toContainText("Input error");
  const phases = dialog.locator("[data-phase]");
  await expect(phases.nth(0)).toHaveAttribute("data-phase-state", "completed");
  for (let index = 1; index < 6; index++) {
    await expect(phases.nth(index)).toHaveAttribute("data-phase-state", "pending");
    await expect(phases.nth(index)).toContainText("Not run — blocked by preflight");
  }
  await expect(dialog.getByText(/five dependent phases were not run/i).first()).toBeVisible();
  await expect(dialog.getByRole("definition").nth(0)).toHaveText("0");
  await expectNoQualityVerdict(dialog);

  await chess(page, (api) => api.setColor("black"));
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({ timeout: 15_000 });
  await expect(dialog.locator("[data-reanalysis-scope='full-scan']")).toBeVisible();
  await expect(phases.nth(0)).toHaveAttribute("data-phase-state", "completed");
  for (let index = 1; index < 6; index++) {
    await expect(phases.nth(index)).toHaveAttribute("data-phase-state", "pending");
    await expect(phases.nth(index)).toContainText("Not run — blocked by preflight");
  }
  await expect(dialog.locator("[data-phase-state='cancelled']")).toHaveCount(0);
  await expect(dialog.getByRole("status")).toContainText(
    "Preflight blocked analysis after normalization. One of six phases completed; five dependent phases were not run.",
  );
});

test("small, shallow, incomplete, and insufficient evidence remains a meaningful degraded report", async ({ page }) => {
  await bootstrap(page);
  await loadProfile(page, "1. e4 e5 *", "small.pgn");
  const dialog = await openWorkspace(page);
  await analyze(dialog);

  await expect(dialog.locator("[data-preflight-state='degraded']")).toBeVisible();
  for (const code of ["single-route", "shallow-route", "incomplete-route", "insufficient-comparable-positions"]) {
    await expect(dialog.locator(`[data-preflight-code='${code}']`)).toBeVisible();
  }
  await expect(dialog.locator("[data-preflight-code='single-route']")).toContainText("Evidence limitation");
  await expect(dialog.locator("[data-preflight-code='incomplete-route']")).toContainText("Input warning");
  await expect(dialog.getByLabel("Preflight route evidence counts")).toContainText("Routes found1");
  await expect(dialog.locator("[data-phase-state='completed']")).toHaveCount(6);
  await expectNoQualityVerdict(dialog);
});

test("transpositions, terminal routes, and offline opening evidence remain visibly qualified", async ({ page }) => {
  await page.route("**/openings.tsv", (route) => route.abort());
  await bootstrap(page);
  await loadProfile(page, TRANSPOSITIONS, "transpositions.pgn");
  const dialog = await openWorkspace(page);
  await analyze(dialog);

  const transposition = dialog.locator("[data-preflight-code='transposition-detected']");
  await expect(transposition).toContainText("Transposition detected");
  await expect(transposition).toContainText("Informational");
  await expect(transposition).toContainText("Input warning");
  const transpositionEvidence = transposition.locator("details");
  await expect(transpositionEvidence).not.toHaveAttribute("open", "");
  await transpositionEvidence.getByText("Evidence details", { exact: true }).click();
  await expect(transpositionEvidence.getByText("Affected repertoire paths", { exact: true })).toBeVisible();
  await expect(dialog.locator("[data-preflight-code='missing-opening-classification']"))
    .toContainText("Missing opening classification");
  await expectNoQualityVerdict(dialog);

  await loadProfile(page, "1. f3 e5 2. g4 Qh4# *", "terminal.pgn");
  await analyze(dialog);
  await expect(dialog.locator("[data-preflight-code='terminal-tactical-route']"))
    .toContainText("Terminal tactical route");
  await expectNoQualityVerdict(dialog);
});

test("custom-start and malformed blocking evidence is explicit and withholds unsafe counts", async ({ page }) => {
  await installStrategicWorkerFixture(page, "custom-blocked");
  await bootstrap(page);
  await loadProfile(page, DEEP_MULTI_ROUTE, "custom-start-fixture.pgn");
  const dialog = await openWorkspace(page);
  await analyze(dialog);

  await expect(dialog.locator("[data-preflight-code='unsupported-custom-start']"))
    .toContainText("Unsupported custom starting position");
  await expect(dialog.locator("[data-preflight-code='malformed-data']"))
    .toContainText("Malformed repertoire data");
  await expect(dialog.getByText("Route counts are withheld because the input could not be enumerated safely."))
    .toBeVisible();
  await expect(dialog.getByLabel("Preflight route evidence counts")).toHaveCount(0);
  const incompleteOverview = dialog.locator("[data-overview-item='incomplete-branches']");
  await expect(incompleteOverview).toHaveAttribute("data-metric-state", "unavailable");
  await expect(incompleteOverview.locator("[data-overview-value]")).toHaveText("Unavailable");
  await expect(incompleteOverview).toContainText(
    "Incomplete-branch count is unavailable because preflight could not enumerate routes safely.",
  );
  await expect(incompleteOverview).not.toContainText("0");
  await expect(dialog.locator("[data-phase-state='completed']")).toHaveCount(1);
  await expect(dialog.locator("[data-phase-state='pending']")).toHaveCount(5);
  await expectNoQualityVerdict(dialog);
});

test("ready preflight is explicit about analyzability without becoming a quality verdict", async ({ page }) => {
  await bootstrap(page);
  await loadProfile(page, DEEP_MULTI_ROUTE, "ready.pgn");
  const dialog = await openWorkspace(page);
  await analyze(dialog);

  await expect(dialog.locator("[data-preflight-state='ready']")).toBeVisible();
  await expect(dialog.getByText("Preflight ready", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/confirms analyzability, not strategic quality/i)).toBeVisible();
  await expect(dialog.locator("[data-phase-state='completed']")).toHaveCount(6);
  await expectNoQualityVerdict(dialog);
});
