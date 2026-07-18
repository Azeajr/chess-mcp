import { expect, test, type Page } from "playwright/test";

type Metric = {
  state: "available" | "partial" | "unavailable";
  value: number | null;
  reason: string | null;
};

type OverviewSummary = {
  workload: "low" | "moderate" | "high" | "unavailable";
  strategic_family_count: number;
  expected_concept_burden: number | null;
  intentional_exception_count: number;
  unresolved_finding_count: number;
  insufficient_evidence_branch_count: number;
  metrics: {
    strategic_entropy: Metric;
    concept_reuse: Metric;
    forced_diversity_floor: Metric;
    familiarity_adjusted_coverage: Metric;
  };
};

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  toPgn(): string;
  strategicFitMetadataStatus(): string;
  selectStrategicFitProfile(mode: "balanced"): unknown;
  strategicFitLifecycle(): {
    status: string;
    current_result: {
      report_id: string;
      result: {
        preflight: { state: "ready" | "degraded" | "blocked" };
        summary: OverviewSummary;
      };
    } | null;
  };
};

const chess = <T>(page: Page, fn: (api: ChessHarness, arg: T) => unknown, arg?: T) => page.evaluate(
  ({ source, arg }) => Function("api", "arg", `return (${source})(api, arg)`)(
    (window as unknown as { __chess: ChessHarness }).__chess,
    arg,
  ),
  { source: fn.toString(), arg },
);

const COMPLETE_REPERTOIRE = `[Event "Strategic Fit overview: family one"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bf4 O-O 6. e3 c5 7. Bd3 *

[Event "Strategic Fit overview: family two"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 *`;

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

const summary = (page: Page) => chess(page, (api) =>
  api.strategicFitLifecycle().current_result?.result.summary ?? null
) as Promise<OverviewSummary>;

test("complete overview reconciles canonical report values and carries metric queue intent", async ({ page }) => {
  const dialog = await bootstrap(page, COMPLETE_REPERTOIRE, "overview-complete.pgn");
  const before = await chess(page, (api) => api.toPgn());
  const canonical = await summary(page);
  const overview = dialog.getByRole("region", { name: "Strategic overview" });
  await expect(overview).toHaveAttribute("data-overview-preflight-state", "ready");

  const item = (id: string) => overview.locator(`[data-overview-item='${id}']`);
  await expect(item("strategic-workload")).toHaveAttribute("data-report-value", canonical.workload);
  await expect(item("strategic-families")).toHaveAttribute(
    "data-report-value",
    String(canonical.strategic_family_count),
  );
  await expect(item("intentional-exceptions")).toHaveAttribute(
    "data-report-value",
    String(canonical.intentional_exception_count),
  );
  await expect(item("unresolved-findings")).toHaveAttribute(
    "data-report-value",
    String(canonical.unresolved_finding_count),
  );
  await expect(item("incomplete-branches")).toHaveAttribute(
    "data-report-value",
    String(canonical.insufficient_evidence_branch_count),
  );
  for (const [id, metric] of [
    ["concept-reuse", canonical.metrics.concept_reuse],
    ["forced-diversity-floor", canonical.metrics.forced_diversity_floor],
    ["familiar-plan-coverage", canonical.metrics.familiarity_adjusted_coverage],
  ] as const) {
    await expect(item(id)).toHaveAttribute("data-metric-state", metric.state);
    await expect(item(id)).toHaveAttribute(
      "data-report-value",
      metric.value === null ? "" : String(metric.value),
    );
  }
  await expect(overview.locator(".strategic-fit-overview-entropy")).toHaveAttribute(
    "data-metric-state",
    canonical.metrics.strategic_entropy.state,
  );
  await expect(item("strategic-entropy")).toHaveAttribute(
    "data-report-value",
    canonical.metrics.strategic_entropy.value === null
      ? ""
      : String(canonical.metrics.strategic_entropy.value),
  );
  await expect(item("familiar-plan-coverage")).toHaveAttribute("data-metric-state", "unavailable");
  await expect(item("familiar-plan-coverage").locator("[data-overview-value]")).toHaveText("Unavailable");
  await expect(item("familiar-plan-coverage")).toContainText(
    canonical.metrics.familiarity_adjusted_coverage.reason ?? "",
  );

  await overview.getByText("How strategic workload is distributed").click();
  await expect(overview.locator(".strategic-fit-overview-entropy > p").first())
    .toContainText("Lower entropy is not universally better");
  const screenReaderSummary = overview.locator("[data-overview-screen-reader-summary]");
  await expect(screenReaderSummary).toContainText("Strategic workload");
  await expect(screenReaderSummary).toContainText("Familiar-plan coverage: Unavailable");
  await expect(screenReaderSummary).toContainText("Lower entropy is not universally better");

  await overview.getByRole("button", { name: "Review opponent-forced findings" }).click();
  await expect(dialog.locator(".strategic-fit-workspace-body")).toHaveAttribute("data-stage", "findings");
  const findings = dialog.locator("#strategic-fit-pane-findings");
  await expect(findings).toHaveAttribute("data-queue-filter", "classification:forced-diversity");
  await expect(findings).toBeFocused();
  await expect(findings.getByRole("status")).toContainText("Review opponent-forced findings");
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
});

test("degraded overview retains partial values, reasons, and insufficient-evidence navigation", async ({ page }) => {
  const dialog = await bootstrap(page, "1. e4 e5 *", "overview-degraded.pgn");
  const canonical = await summary(page);
  const overview = dialog.getByRole("region", { name: "Strategic overview" });
  await expect(overview).toHaveAttribute("data-overview-preflight-state", "degraded");
  const item = (id: string) => overview.locator(`[data-overview-item='${id}']`);

  await expect(item("incomplete-branches")).toHaveAttribute(
    "data-report-value",
    String(canonical.insufficient_evidence_branch_count),
  );
  await expect(item("concept-reuse")).toHaveAttribute(
    "data-metric-state",
    canonical.metrics.concept_reuse.state,
  );
  if (canonical.metrics.concept_reuse.reason) {
    await expect(item("concept-reuse")).toContainText(canonical.metrics.concept_reuse.reason);
  }
  for (const value of await overview
    .locator(".strategic-fit-overview-item[data-metric-state='unavailable'] [data-overview-value]")
    .allTextContents()) {
    expect(value).toBe("Unavailable");
  }

  expect(canonical.insufficient_evidence_branch_count).toBeGreaterThan(0);
  await overview.getByRole("button", { name: "Review insufficient-evidence findings" }).click();
  await expect(dialog.locator("#strategic-fit-pane-findings"))
    .toHaveAttribute("data-queue-filter", "evidence:insufficient");
  await expect(dialog.locator("#strategic-fit-pane-findings").getByRole("status"))
    .toContainText("Review insufficient-evidence findings");
});

test("blocked overview labels unavailable analysis values instead of zero", async ({ page }) => {
  const dialog = await bootstrap(page, "*", "overview-blocked.pgn");
  const overview = dialog.getByRole("region", { name: "Strategic overview" });
  await expect(overview).toHaveAttribute("data-overview-preflight-state", "blocked");

  for (const id of [
    "strategic-workload",
    "strategic-families",
    "concept-reuse",
    "forced-diversity-floor",
    "intentional-exceptions",
    "unresolved-findings",
    "familiar-plan-coverage",
  ]) {
    const item = overview.locator(`[data-overview-item='${id}']`);
    await expect(item).toHaveAttribute("data-metric-state", "unavailable");
    await expect(item.locator("[data-overview-value]")).toHaveText("Unavailable");
    await expect(item).not.toContainText("0%");
  }
  await expect(overview.locator("[data-overview-item='incomplete-branches'] [data-overview-value]"))
    .toHaveText("0");
  await expect(overview.locator("[data-overview-screen-reader-summary]"))
    .toContainText("Preflight blocked position analysis");
  await expect(overview.getByRole("button")).toHaveCount(0);
});
