import { expect, test, type Page } from "playwright/test";

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  toPgn(): string;
  currentPath(): number[];
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

async function installFindingWorkerFixture(page: Page) {
  await page.addInitScript(() => {
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
            const analysisVersion = "2.0.0";
            const classifications = [
              "genuine-inconsistency",
              "forced-diversity",
              "intentional-diversity",
              "productive-diversity",
              "mixed-strategic-profile",
              "uncertain",
              "data-quality-issue",
              "transpositional-equivalence",
              "genuine-inconsistency",
              "forced-diversity",
              "intentional-diversity",
              "productive-diversity",
            ];
            const category: Record<string, string> = {
              "genuine-inconsistency": "Different center plan",
              "forced-diversity": "Opponent-forced strategic exception",
              "intentional-diversity": "Intentional strategic diversity",
              "productive-diversity": "Productive strategic diversity",
              "mixed-strategic-profile": "Multiple supported strategic modes",
              uncertain: "Incomplete strategic evidence",
              "data-quality-issue": "Strategic data-quality issue",
              "transpositional-equivalence": "Equivalent move orders",
            };
            const resolutions = [
              "unresolved",
              "insufficient-evidence",
              "keep-intentionally",
              "train-as-exception",
              "defer",
              "insufficient-evidence",
              "exclude-from-analysis",
              "automatically-resolved-by-another-edit",
              "change-repertoire",
              "unresolved",
              "reclassify-cohort",
              "unresolved",
            ];
            const priorityLabels = [
              "review-now", "review-now", "review-later", "informational",
              "review-now", "insufficient-evidence", "insufficient-evidence", "informational",
              "review-later", "review-now", "review-later", "informational",
            ];
            const openings = [
              "Sicilian · Alapin", "French · Advance", "Queen's Gambit · Exchange",
              "Caro-Kann · Classical", "English · Four Knights", "French · Advance",
              "Sicilian · Alapin", "Ruy Lopez · Berlin", "Queen's Gambit · Exchange",
              "French · Advance", "Caro-Kann · Classical", "English · Four Knights",
            ];
            const confidenceComponents = [
              "classifier-confidence",
              "checkpoint-completeness",
              "effective-sample-size",
              "temporal-persistence",
              "cohort-coherence",
              "opening-data-quality",
              "causal-attribution-quality",
            ];
            const source = (
              sourceId: string,
              kind: string,
              state: "available" | "partial" | "unavailable" = "available",
              reason: string | null = null,
            ) => ({
              source_id: sourceId,
              kind,
              state,
              version: "2.0.0",
              snapshot: "e2e-fixture",
              reason,
            });
            const finding = (index: number) => {
              const id = `finding:${String(index + 1).padStart(2, "0")}`;
              const classification = classifications[index]!;
              const optionalUnavailable = index === 1;
              return {
                schema_version: "1.0.0",
                analysis_version: analysisVersion,
                finding_id: id,
                semantic_finding_id: `semantic:${id}`,
                repertoire_revision: message.payload.metadata.repertoire_revision,
                classification,
                plain_language_category: category[classification],
                opening_scope: openings[index],
                affected_line_summary: index === 0 ? "Alapin, 6...Nf6 branch" : `Fixture line ${index + 1}`,
                explanation: index === 0
                  ? "This branch produces a closed center while the weighted baseline produces an open IQP position."
                  : `Plain-language explanation for fixture finding ${index + 1}.`,
                references: {
                  position_ids: [`position:${id}:a`, `position:${id}:b`],
                  decision_ids: [`decision:${id}:a`, `decision:${id}:b`],
                  route_ids: [`route:${id}:a`, `route:${id}:b`],
                  source_san_paths: index === 0
                    ? [
                        ["e4", "c5", "c3", "Nf6"],
                        ["e4", "c5", "Nf3", "e6", "c3"],
                        ["e4", "c5", "c3", "d5"],
                      ]
                    : [["e4", "e5", `fixture-${index + 1}`]],
                },
                weighted_baseline_percentage: 78 - index,
                expected_frequency: optionalUnavailable ? null : 0.24 - index * 0.01,
                learning_burden: 0.4,
                confidence: {
                  analysis_version: analysisVersion,
                  score: index === 1 ? 39 : 90 - index * 5,
                  label: index === 1 || index >= 8 ? "low" : index < 4 ? "high" : "moderate",
                  components: confidenceComponents
                    .slice(0, index === 1 ? 5 : confidenceComponents.length)
                    .map((component, componentIndex) => ({
                      component,
                      score: 0.92 - componentIndex * 0.06,
                      weight: 1,
                      explanation: `Fixture explanation for ${component}.`,
                    })),
                  applied_caps: index === 1
                    ? [{
                        reason: "effective-sample-below-four",
                        maximum_score: 39,
                        explanation: "Effective sample size is below four, so confidence cannot exceed 39.",
                      }]
                    : [],
                  explanation: index === 1
                    ? "Low confidence: the component score is limited by a small comparison set."
                    : "High-confidence fixture comparison supported across the reported components.",
                },
                difference: {
                  analysis_version: analysisVersion,
                  distance: index === 0 ? 0.6 : 0.8 - index * 0.02,
                  magnitude: index < 4 ? "major" : index < 8 ? "moderate" : "minor",
                  persistence: 0.8,
                  new_concept_count: 1,
                  stable_from_ply: 12,
                },
                objective_quality: optionalUnavailable
                  ? {
                      analysis_version: analysisVersion,
                      state: "unavailable",
                      verdict: "unknown",
                      repertoire_pov_cp: null,
                      loss_from_best_cp: null,
                      engine_depth: null,
                      engine_lines: null,
                      database_performance: null,
                      theoretical_status: null,
                      reason: "No engine verification was requested for this base scan.",
                      provenance: [source(
                        "engine:fixture",
                        "engine",
                        "unavailable",
                        "No engine verification was requested for this base scan.",
                      )],
                    }
                  : {
                      analysis_version: analysisVersion,
                      state: "available",
                      verdict: index === 6 ? "dubious" : "sound",
                      repertoire_pov_cp: 20,
                      loss_from_best_cp: 10,
                      engine_depth: 20,
                      engine_lines: 3,
                      database_performance: null,
                      theoretical_status: null,
                      reason: null,
                      provenance: [source("engine:fixture", "engine")],
                    },
                replacement_priority: {
                  analysis_version: analysisVersion,
                  kind: "replacement",
                  score: index < 2 ? 0.95 : 0.9 - index * 0.04,
                  label: priorityLabels[index],
                  confidence: 0.8,
                  difference: 0.7,
                  expected_frequency: 0.2,
                  learning_burden: 0.4,
                  preference_mismatch: 0.6,
                  actionability: 0.8,
                },
                training_priority: {
                  analysis_version: analysisVersion,
                  kind: "training",
                  score: index % 2 === 0 ? 0.8 : 0.4,
                  label: index % 2 === 0 ? "review-now" : "review-later",
                  confidence: 0.8,
                  difference: 0.7,
                  expected_frequency: 0.2,
                  learning_burden: 0.4,
                  preference_mismatch: 0.6,
                  actionability: 0.8,
                },
                evidence: {
                  analysis_version: analysisVersion,
                  cohort_id: "cohort:fixture",
                  baseline_mode_ids: ["mode:fixture"],
                  representative_route_ids: [`route:${id}:a`],
                  dimensions: index === 0
                    ? [
                        {
                          dimension_id: "center-dynamics.center-state",
                          typical_value: "open-iqp",
                          affected_value: "closed",
                          contribution: 0.3,
                          explanation: "Center state contributes 30% of normalized distance.",
                        },
                        {
                          dimension_id: "center-dynamics.primary-break",
                          typical_value: "d4-d5",
                          affected_value: "f2-f4",
                          contribution: 0.2,
                          explanation: "Primary break contributes 20% of normalized distance.",
                        },
                        {
                          dimension_id: "king-and-piece-setup.king-setup",
                          typical_value: "short-castling",
                          affected_value: "long-castling",
                          contribution: 0.1,
                          explanation: "King setup contributes 10% of normalized distance.",
                        },
                      ]
                    : index === 1
                      ? [{
                          dimension_id: "learning-concepts.unique-concepts",
                          typical_value: null,
                          affected_value: ["new-plan"],
                          contribution: 0.2,
                          explanation: "Available concept evidence contributes 20%.",
                        }]
                      : [{
                          dimension_id: "dynamic-character.tactical-level",
                          typical_value: "moderate",
                          affected_value: "high",
                          contribution: 0.8 - index * 0.02,
                          explanation: "Tactical character accounts for the reported distance.",
                        }],
                  comparison_basis: {
                    effective_branches: index === 1 ? 2 : 14,
                    weighted_reference_games: index === 1 ? null : 2840,
                    structural_classification_coverage: index === 1 ? 0.72 : 0.91,
                    analysis_window: [10, 20],
                    taxonomy_version: index === 1 ? null : "opening-taxonomy:1.0.0",
                    profile_mode: "balanced",
                  },
                  causality: {
                    analysis_version: analysisVersion,
                    controllability: 0.8,
                    label: index % 2 === 0 ? "mostly-player-controlled" : "mostly-opponent-forced",
                    player_contribution: 0.8,
                    opponent_contribution: 0.2,
                    likely_causal_decision_ids: [`decision:${id}:a`],
                    timeline: [],
                    explanation: "Fixture attribution.",
                  },
                  data_quality_issue_ids: index === 1 ? ["issue:opening-evidence"] : [],
                  provenance: index === 1
                    ? [source(
                        "structure:fixture",
                        "structure-classifier",
                        "partial",
                        "One affected route has partial structural evidence.",
                      )]
                    : [source("structure:fixture", "structure-classifier")],
                },
                resolution_state: resolutions[index],
                provisional: false,
                provenance: {
                  schema_version: "1.0.0",
                  analysis_version: analysisVersion,
                  repertoire_revision: message.payload.metadata.repertoire_revision,
                  generated_at: "2026-07-18T00:00:00.000Z",
                  deterministic: true,
                  sources: [source("core:fixture", "deterministic-core")],
                },
              };
            };
            const findings = Array.from({ length: 12 }, (_, index) => finding(index));
            const metric = (metricId: string, unit: string, value: unknown) => ({
              analysis_version: analysisVersion,
              metric_id: metricId,
              state: "available",
              value,
              unit,
              reason: null,
              provenance: [],
            });
            controlled.onmessage?.({
              data: {
                type: "result",
                request_id: message.request_id,
                result: {
                  schema_version: "1.0.0",
                  analysis_version: analysisVersion,
                  report_id: `report:findings:${message.payload.metadata.repertoire_revision}`,
                  repertoire_revision: message.payload.metadata.repertoire_revision,
                  manifest: {
                    schema_version: "1.0.0",
                    analysis_version: analysisVersion,
                    components: {},
                  },
                  profile: message.payload.options.profile,
                  preflight: {
                    analysis_version: analysisVersion,
                    state: "degraded",
                    issues: [{
                      analysis_version: analysisVersion,
                      issue_id: "issue:opening-evidence",
                      code: "missing-opening-classification",
                      kind: "evidence-limitation",
                      severity: "degraded",
                      message: "Opening classification is incomplete for one affected route.",
                      affected_route_ids: ["route:finding:02:a"],
                      affected_source_paths: [["e4", "e5"]],
                      details: {},
                      provenance: [],
                    }],
                    route_count: 12,
                    comparable_route_count: 12,
                    incomplete_route_count: 0,
                  },
                  trajectories: [],
                  cohorts: [],
                  summary: {
                    analysis_version: analysisVersion,
                    workload: "moderate",
                    strategic_family_count: 6,
                    expected_concept_burden: 2.4,
                    intentional_exception_count: 2,
                    unresolved_finding_count: 3,
                    insufficient_evidence_branch_count: 2,
                    metrics: {
                      analysis_version: analysisVersion,
                      strategic_entropy: metric("strategic-entropy", "entropy", 1.4),
                      concept_reuse: metric("concept-reuse", "fraction", 0.65),
                      exception_burden: metric("exception-burden", "composite", {
                        expected_frequency: 0.2,
                        training_cost: 0.3,
                      }),
                      forced_diversity_floor: metric("forced-diversity-floor", "fraction", 0.2),
                      homogenization_cost: metric("homogenization-cost", "composite", {
                        evaluation_loss_cp: null,
                        popularity_loss: null,
                        coverage_loss: null,
                      }),
                      familiarity_adjusted_coverage: metric("familiarity-adjusted-coverage", "fraction", 0.7),
                      training_adjusted_workload: metric("training-adjusted-workload", "score", 0.5),
                      repertoire_regret: metric("repertoire-regret", "score", 0.2),
                      move_order_resilience: metric("move-order-resilience", "fraction", 0.8),
                      concept_centrality: metric("concept-centrality", "composite", []),
                    },
                  },
                  findings,
                  finding_page: {
                    offset: 0,
                    limit: findings.length,
                    total_count: findings.length,
                    returned_count: findings.length,
                    has_more: false,
                  },
                  provenance: { generated_at: "2026-07-18T00:00:00.000Z", sources: [] },
                },
              },
            } as MessageEvent);
          },
          terminate() {},
        };
        return controlled;
      },
    });
  });
}

async function bootstrap(page: Page, repertoireColor: "white" | "black" = "white") {
  await installFindingWorkerFixture(page);
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await chess(page, (api) => api.loadPgn("1. e4 e5 2. Nf3 Nc6 *", "finding-queue.pgn"));
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await chess(page, (api, color) => api.setColor(color), repertoireColor);
  await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
  const before = await chess(page, (api) => api.toPgn());
  const pathBefore = await chess(page, (api) => [...api.currentPath()]);
  await page.getByRole("button", { name: "Open workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await dialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible();
  return { dialog, before, pathBefore };
}

test("finding queue renders frozen card fields, stable pages, composed filters, and keyboard selection", async ({ page }) => {
  const { dialog, before, pathBefore } = await bootstrap(page);
  const pane = dialog.locator("#strategic-fit-pane-findings");
  const queue = pane.getByRole("region", { name: "Strategic Fit finding queue" });
  await expect(queue).toHaveAttribute("data-queue-status", "ready");
  await expect(queue.locator("[data-finding-id]")).toHaveCount(6);
  await expect(queue.locator(".strategic-fit-queue-summary p")).toContainText(
    "Showing 1–6 of 12 matching findings · 12 in this report",
  );

  const first = queue.locator("[data-finding-id='finding:01']");
  await expect(first).toContainText("Different center plan");
  await expect(first).toContainText("Avoidable inconsistency");
  await expect(first).toContainText("Sicilian · Alapin");
  await expect(first).toContainText("Alapin, 6...Nf6 branch");
  await expect(first).toContainText("78% weighted baseline");
  await expect(first).toContainText("24% expected frequency");
  await expect(first).toContainText("Major difference");
  await expect(first).toContainText("High confidence · 90/100");
  await expect(first).toContainText("Mostly player-controlled");
  await expect(first).toContainText("Verified: objectively sound");
  await expect(first).toContainText("Unresolved");
  await first.getByText("3 source lines").click();
  await expect(first.locator(".strategic-fit-finding-paths li")).toHaveText([
    "e4 c5 c3 Nf6",
    "e4 c5 Nf3 e6 c3",
    "e4 c5 c3 d5",
  ]);

  const unavailable = queue.locator("[data-finding-id='finding:02']");
  await expect(unavailable).toContainText("Expected frequency unavailable");
  await expect(unavailable).toContainText("Objective soundness unavailable");
  await expect(unavailable).toContainText("No engine verification was requested");

  await first.locator("[data-finding-select]").click();
  const evidencePane = dialog.locator("#strategic-fit-pane-evidence");
  await expect(evidencePane).toBeFocused();
  const firstEvidence = evidencePane.locator("[data-evidence-finding-id='finding:01']");
  await expect(firstEvidence).toBeVisible();
  await expect(firstEvidence.locator("[data-dimension-id]")).toHaveCount(3);
  await expect(firstEvidence.locator("[data-dimension-id='center-dynamics.center-state']"))
    .toContainText("Open iqp");
  await expect(firstEvidence.locator("[data-dimension-id='center-dynamics.center-state']"))
    .toContainText("Closed");
  await expect(firstEvidence.locator("[data-reconciliation-state='reconciled']"))
    .toContainText("60% strategic distance");
  await expect(firstEvidence.locator(".strategic-fit-comparison-basis")).toContainText("14");
  await expect(firstEvidence.locator(".strategic-fit-comparison-basis")).toContainText("2,840");
  await expect(firstEvidence.locator(".strategic-fit-comparison-basis")).toContainText("91%");
  await expect(firstEvidence.locator("[data-confidence-label='high']")).toHaveText("High confidence");
  await expect(firstEvidence.locator(".strategic-fit-evidence-paths li")).toHaveCount(3);
  await expect(firstEvidence.locator(".strategic-fit-evidence-sources")).toContainText(
    "Deterministic analysis",
  );
  await expect(firstEvidence.locator(".strategic-fit-evidence-sources")).toContainText("Available");

  const expert = firstEvidence.locator(".strategic-fit-evidence-expert");
  await expect(expert.getByText("White repertoire POV evaluation", { exact: true })).toBeHidden();
  await expert.getByText("Expert evidence values and provenance", { exact: true }).click();
  await expect(expert.getByText("White repertoire POV evaluation", { exact: true })).toBeVisible();
  await expect(expert).toContainText("+20 cp");
  await expect(expert).toContainText("semantic:finding:01");
  await expect(expert).toContainText("core:fixture");
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);

  await first.locator("[data-finding-select]").focus();
  await page.keyboard.press("ArrowDown");
  const secondSelect = queue.locator("[data-finding-id='finding:02'] [data-finding-select]");
  await expect(secondSelect).toBeFocused();
  await expect(secondSelect).toHaveAttribute("aria-pressed", "true");
  await expect(queue.locator("[data-finding-id='finding:02']")).toHaveAttribute(
    "data-finding-selected",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(evidencePane).toBeFocused();
  const secondEvidence = evidencePane.locator("[data-evidence-finding-id='finding:02']");
  await expect(secondEvidence).toBeVisible();
  await expect(secondEvidence.locator("[data-confidence-label='low']")).toHaveText("Low confidence");
  await expect(secondEvidence.locator("[data-confidence-cap='effective-sample-below-four']"))
    .toContainText("Small comparison set");
  await expect(secondEvidence.locator("[data-confidence-cap='effective-sample-below-four']"))
    .toContainText("confidence cannot exceed 39");
  await expect(secondEvidence).toContainText("2 of 7 confidence components are unavailable");
  await expect(secondEvidence.locator("[data-value-state='unavailable']")).toHaveText("Unavailable");
  await expect(secondEvidence.locator("[data-reconciliation-state='partial']"))
    .toContainText("gap is not assigned");
  await expect(secondEvidence.locator(".strategic-fit-data-quality")).toContainText(
    "Opening classification is incomplete for one affected route.",
  );
  await expect(secondEvidence.locator(".strategic-fit-evidence-sources"))
    .toContainText("One affected route has partial structural evidence.");

  await queue.getByRole("button", { name: "Next findings" }).click();
  await expect(queue.locator("[data-finding-id]")).toHaveCount(6);
  await expect(queue.locator("[data-finding-id]").first()).toHaveAttribute("data-finding-id", "finding:07");
  await expect(queue.locator(".strategic-fit-queue-summary p")).toContainText("Showing 7–12 of 12");

  await queue.getByLabel("Sort findings").selectOption({ label: "Opening / system" });
  await expect(queue.locator("[data-finding-id]").first()).toHaveAttribute("data-finding-id", "finding:04");
  await queue.getByLabel("Priority type").selectOption({ label: "Training" });
  await queue.getByLabel("Priority", { exact: true }).selectOption({ label: "Review now" });
  await expect(queue.locator("[data-finding-id]")).toHaveCount(6);
  await queue.getByLabel("Opening / system").selectOption({ label: "Sicilian · Alapin" });
  await expect(queue.locator("[data-finding-id]")).toHaveCount(2);
  expect(await queue.locator("[data-finding-id]").evaluateAll((cards) =>
    cards.map((card) => card.getAttribute("data-finding-id"))
  )).toEqual(["finding:01", "finding:07"]);
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
});

test("Black repertoire evidence labels every engine value from the repertoire point of view", async ({ page }) => {
  const { dialog, before, pathBefore } = await bootstrap(page, "black");
  const queue = dialog.locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();

  const evidencePane = dialog.locator("#strategic-fit-pane-evidence");
  await expect(evidencePane).toBeFocused();
  const evidence = evidencePane.locator("[data-evidence-finding-id='finding:01']");
  await expect(evidence).toContainText("The line is objectively sound for the Black repertoire.");
  await expect(evidence.getByText("White repertoire POV evaluation", { exact: true })).toHaveCount(0);

  const expert = evidence.locator(".strategic-fit-evidence-expert");
  await expect(expert.getByText("Black repertoire POV evaluation", { exact: true })).toBeHidden();
  await expert.getByText("Expert evidence values and provenance", { exact: true }).click();
  await expect(expert.getByText("Black repertoire POV evaluation", { exact: true })).toBeVisible();
  await expect(expert).toContainText("+20 cp");
  await expect(expert).toContainText("Positive values favor the Black repertoire");
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
});

test("overview intents filter only the current report queue and can return to all findings", async ({ page }) => {
  const { dialog, before } = await bootstrap(page);
  await dialog.getByRole("button", { name: "Review opponent-forced findings" }).click();

  const pane = dialog.locator("#strategic-fit-pane-findings");
  await expect(pane).toHaveAttribute("data-queue-filter", "classification:forced-diversity");
  const queue = pane.getByRole("region", { name: "Strategic Fit finding queue" });
  await expect(queue.getByRole("status")).toContainText("Review opponent-forced findings");
  await expect(queue.locator("[data-finding-id]")).toHaveCount(2);
  for (const classification of await queue.locator("[data-finding-id]").all()) {
    await expect(classification).toHaveAttribute("data-finding-classification", "forced-diversity");
  }

  await queue.getByRole("button", { name: "Show all report findings" }).click();
  await expect(pane).toHaveAttribute("data-queue-filter", "none");
  await expect(queue.locator(".strategic-fit-queue-summary p")).toContainText("of 12 matching findings");

  await dialog.getByRole("button", { name: "Return to repertoire" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Open workspace" }).click();
  const reopened = page.getByRole("dialog", { name: "Strategic Fit" });
  const reopenedQueue = reopened.locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await expect(reopenedQueue).toHaveAttribute("data-queue-status", "ready");
  await expect(reopenedQueue.locator("[data-finding-id]")).toHaveCount(6);
  await expect(reopenedQueue.locator(".strategic-fit-queue-summary p"))
    .toContainText("of 12 matching findings");
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
});

test("phone finding queue stays inside the single frozen Findings stage", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { dialog, before, pathBefore } = await bootstrap(page);
  await dialog.getByRole("tab", { name: "Findings" }).click();

  const pane = dialog.locator("#strategic-fit-pane-findings");
  await expect(pane).toBeVisible();
  await expect(dialog.locator(".strategic-fit-workspace-pane:visible")).toHaveCount(1);
  const queue = pane.getByRole("region", { name: "Strategic Fit finding queue" });
  await expect(queue.locator("[data-finding-id]")).toHaveCount(6);
  await expect(queue.getByLabel("Sort findings")).toBeVisible();
  expect(await pane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  const evidenceTab = dialog.getByRole("tab", { name: "Evidence" });
  await expect(evidenceTab).toHaveAttribute("aria-selected", "true");
  const evidencePane = dialog.locator("#strategic-fit-pane-evidence");
  await expect(evidencePane).toBeVisible();
  await expect(evidencePane).toBeFocused();
  await expect(dialog.locator(".strategic-fit-workspace-pane:visible")).toHaveCount(1);
  await expect(evidencePane.locator("[data-evidence-finding-id='finding:01']")).toBeVisible();
  expect(await evidencePane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
});
