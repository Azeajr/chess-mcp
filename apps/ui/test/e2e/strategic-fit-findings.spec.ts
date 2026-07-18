import { expect, test, type Page } from "playwright/test";

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  toPgn(): string;
  currentPath(): number[];
  version(): number;
  dirty(): boolean;
  preview(): unknown;
  strategicFitMetadata(): unknown;
  setColor(color: "white" | "black"): void;
  strategicFitMetadataStatus(): string;
  selectStrategicFitProfile(mode: "familiar-plans" | "balanced" | "versatile" | "custom"): unknown;
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
            const boardFens = [
              "rnbqkbnr/pp1ppppp/5n2/2p5/4P3/2P5/PP1P1PPP/RNBQKBNR w KQkq - 1 3",
              "r1bqkb1r/pp1ppppp/2n2n2/2p5/4P3/2P2N2/PP1P1PPP/RNBQKB1R w KQkq - 3 4",
              "r1bqk2r/pp1pbppp/2n1pn2/2p5/3PP3/2P2N2/PP3PPP/RNBQKB1R w KQkq - 1 6",
              "r1bq1rk1/pp1pbppp/2n1pn2/2p5/3PP3/2P1BN2/PP3PPP/RN1QKB1R w KQ - 3 7",
            ];
            const snapshot = (
              routeId: string,
              kind: string,
              ply: number,
              fenIndex: number,
              comparability: "comparable" | "incomplete" | "not-comparable" = "comparable",
            ) => ({
              analysis_version: analysisVersion,
              snapshot_id: `snapshot:${routeId}:${kind}:${ply}`,
              route_id: routeId,
              position_id: `position:${routeId}:${ply}`,
              fen: boardFens[fenIndex % boardFens.length],
              checkpoint: {
                analysis_version: analysisVersion,
                checkpoint_id: `checkpoint:${routeId}:${kind}:${ply}`,
                kind,
                ply,
                reason: `${kind} fixture evidence for ${routeId}.`,
                comparability,
              },
              signals: [],
              classifier_confidence: 0.9,
              provenance: [source("trajectory:fixture", "deterministic-core")],
            });
            const trajectory = (
              routeId: string,
              state: "complete" | "incomplete",
              snapshots: any[],
              missingCheckpoints: any[] = [],
            ) => ({
              analysis_version: analysisVersion,
              trajectory_id: `trajectory:${routeId}`,
              route_id: routeId,
              state,
              snapshots,
              missing_checkpoints: missingCheckpoints,
              evidence_coverage: state === "complete" ? 1 : 0.5,
              stable_signal_ids: [],
              transient_signal_ids: [],
              provenance: [source("trajectory:fixture", "deterministic-core")],
            });
            const comparisonTrajectories = [
              trajectory("route:finding:01:a", "complete", [
                snapshot("route:finding:01:a", "opening-exit", 4, 0),
                snapshot("route:finding:01:a", "central-resolution", 8, 1),
                snapshot("route:finding:01:a", "irreversible-transformation", 10, 2),
                snapshot("route:finding:01:a", "configured-ply", 12, 3),
                snapshot("route:finding:01:a", "final-valid-position", 14, 3, "not-comparable"),
              ]),
              trajectory("route:finding:01:b", "incomplete", [
                snapshot("route:finding:01:b", "opening-exit", 4, 0),
                snapshot("route:finding:01:b", "central-resolution", 8, 1, "incomplete"),
                snapshot("route:finding:01:b", "configured-ply", 14, 3),
              ], [{
                kind: "irreversible-transformation",
                reason: "This affected route ends before an irreversible checkpoint is available.",
              }]),
              trajectory("route:baseline:01:a", "complete", [
                snapshot("route:baseline:01:a", "opening-exit", 6, 0),
                snapshot("route:baseline:01:a", "central-resolution", 10, 1),
                snapshot("route:baseline:01:a", "irreversible-transformation", 10, 2),
                snapshot("route:baseline:01:a", "configured-ply", 12, 3),
                snapshot("route:baseline:01:a", "final-valid-position", 16, 3, "not-comparable"),
              ]),
              trajectory("route:baseline:01:b", "complete", [
                snapshot("route:baseline:01:b", "opening-exit", 6, 0),
                snapshot("route:baseline:01:b", "central-resolution", 10, 2),
                snapshot("route:baseline:01:b", "configured-ply", 12, 3),
              ]),
            ];
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
                        ["e4", "e5", "Nf3", "Nc6"],
                        [
                          "e4", "c5", "c3", "Nf6", "e5", "Nd5", "d4", "cxd4",
                          "Nf3", "Nc6", "cxd4", "d6", "Bc4", "Nb6", "Bb5", "dxe5",
                        ],
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
                  representative_route_ids: index === 0
                    ? ["route:baseline:01:a", "route:baseline:01:b"]
                    : [`route:${id}:a`],
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
                    timeline: index === 0
                      ? [
                          {
                            event_id: "event:opponent-divergence",
                            kind: "opponent-divergence",
                            ply: 2,
                            position_id: "position:finding:01:opponent",
                            decision_id: "decision:finding:01:opponent",
                            san: "c5",
                            explanation: "The opponent chooses the Sicilian structure.",
                          },
                          {
                            event_id: "event:player-decision",
                            kind: "player-decision",
                            ply: 3,
                            position_id: "position:finding:01:player",
                            decision_id: "decision:finding:01:a",
                            san: "c3",
                            explanation: "The repertoire chooses the Alapin setup.",
                          },
                          {
                            event_id: "event:irreversible",
                            kind: "irreversible-event",
                            ply: 7,
                            position_id: "position:finding:01:irreversible",
                            decision_id: "decision:finding:01:b",
                            san: "d4",
                            explanation: "The central pawn commitment cannot be reversed.",
                          },
                          {
                            event_id: "event:first-difference",
                            kind: "first-strategic-difference",
                            ply: 8,
                            position_id: "position:finding:01:difference",
                            decision_id: null,
                            san: "cxd4",
                            explanation: "The first persistent center-state difference appears.",
                          },
                          {
                            event_id: "event:stable",
                            kind: "difference-stable",
                            ply: 12,
                            position_id: "position:finding:01:stable",
                            decision_id: null,
                            san: "d6",
                            explanation: "The difference remains stable at the matched checkpoint.",
                          },
                          {
                            event_id: "event:transposition",
                            kind: "transposition",
                            ply: 14,
                            position_id: "position:finding:01:transposition",
                            decision_id: null,
                            san: null,
                            explanation: "Another move order reaches this canonical position.",
                          },
                        ]
                      : [],
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
                  trajectories: comparisonTrajectories,
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
  await first.getByText("5 source lines").click();
  await expect(first.locator(".strategic-fit-finding-paths li")).toHaveText([
    "e4 c5 c3 Nf6",
    "e4 c5 Nf3 e6 c3",
    "e4 c5 c3 d5",
    "e4 e5 Nf3 Nc6",
    "e4 c5 c3 Nf6 e5 Nd5 d4 cxd4 Nf3 Nc6 cxd4 d6 Bc4 Nb6 Bb5 dxe5",
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
  await expect(firstEvidence.locator(".strategic-fit-evidence-paths li")).toHaveCount(5);
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

test("comparison boards synchronize canonical milestones and only Go to line navigates", async ({ page }) => {
  const { dialog, before, pathBefore } = await bootstrap(page);
  const initialVersion = await chess(page, (api) => api.version());
  const initialDirty = await chess(page, (api) => api.dirty());
  const initialPreview = await chess(page, (api) => JSON.stringify(api.preview()));
  const initialMetadata = await chess(page, (api) => JSON.stringify(api.strategicFitMetadata()));
  const queue = dialog.locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();

  const evidence = dialog.locator("[data-evidence-finding-id='finding:01']");
  const comparison = evidence.locator(".strategic-fit-comparison-boards");
  await expect(comparison.locator("[data-board-read-only='true']")).toHaveCount(2);
  await expect(comparison.locator("[data-board-orientation='white']")).toHaveCount(2);
  await expect(comparison.getByLabel("Affected branch route").locator("option")).toHaveCount(2);
  await expect(comparison.getByLabel("Typical cohort route").locator("option")).toHaveCount(2);
  await expect(comparison.getByLabel("Affected source line").locator("option")).toHaveCount(5);
  const sync = comparison.locator(".strategic-fit-comparison-sync-status");
  await expect(sync).toHaveAttribute("data-milestone-key", "opening-exit");
  await expect(sync).toHaveAttribute("data-milestone-state", "matched");
  await expect(sync).toContainText("Matched strategic milestone");
  await expect(sync).toContainText("Affected route 1 with Typical route 1 at Opening exit");

  await comparison.getByLabel("Affected branch route").selectOption("route:finding:01:b");
  await comparison.getByLabel("Strategic milestone").selectOption("central-resolution");
  await expect(sync).toHaveAttribute("data-milestone-state", "incomplete");
  await expect(sync).toContainText("Incomplete checkpoint evidence");
  await comparison.getByLabel("Strategic milestone").selectOption("irreversible-transformation");
  await expect(sync).toHaveAttribute("data-milestone-state", "incomplete");
  await expect(sync).toContainText("affected branch is missing");
  await expect(comparison.locator("[data-board-role='affected'] .strategic-fit-comparison-board-missing"))
    .toContainText("Board unavailable at this milestone");

  await comparison.getByLabel("Affected branch route").selectOption("route:finding:01:a");
  await comparison.getByLabel("Typical cohort route").selectOption("route:baseline:01:b");
  await expect(sync).toHaveAttribute("data-milestone-state", "mismatched");
  await expect(sync).toContainText("typical cohort is missing");
  await comparison.getByLabel("Typical cohort route").selectOption("route:baseline:01:a");
  await comparison.getByLabel("Strategic milestone").selectOption("configured-ply:12");
  await expect(sync).toHaveAttribute("data-milestone-state", "matched");
  await expect(sync).toContainText("Configured checkpoint at ply 12");

  const timeline = evidence.locator(".strategic-fit-causal-timeline");
  await expect(timeline.locator("[data-causal-event]")).toHaveCount(6);
  await expect(timeline.locator("[data-causal-event='opponent-divergence']"))
    .toContainText("Opponent divergence");
  await expect(timeline.locator("[data-causal-event='player-decision']")).toContainText("Player decision");
  await expect(timeline.locator("[data-causal-event='irreversible-event']"))
    .toContainText("Irreversible event");
  await expect(timeline.locator("[data-causal-event='first-strategic-difference']"))
    .toContainText("First strategic difference");
  await expect(timeline.locator("[data-causal-event='difference-stable']"))
    .toContainText("Difference becomes stable");
  await expect(timeline.locator("[data-causal-event='transposition']")).toContainText("Transposition");
  await expect(timeline).toContainText("Dotted marker");
  await expect(timeline).toContainText("Striped marker");

  const sourceLine = comparison.getByLabel("Affected source line");
  await sourceLine.selectOption("4");
  const goToLine = comparison.getByRole("button", { name: "Go to line" });
  await expect(goToLine).toBeDisabled();
  await expect(comparison.locator(".strategic-fit-line-navigation code"))
    .toContainText("Bb5 dxe5");
  expect(await comparison.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.version())).toBe(initialVersion);
  expect(await chess(page, (api) => api.dirty())).toBe(initialDirty);
  expect(await chess(page, (api) => JSON.stringify(api.preview()))).toBe(initialPreview);
  expect(await chess(page, (api) => JSON.stringify(api.strategicFitMetadata()))).toBe(initialMetadata);

  await sourceLine.selectOption("3");
  await expect(goToLine).toBeEnabled();
  await goToLine.click();
  expect(await chess(page, (api) => api.currentPath())).toEqual([0, 0, 0, 0]);
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.version())).toBe(initialVersion);
  expect(await chess(page, (api) => api.dirty())).toBe(initialDirty);
  expect(await chess(page, (api) => JSON.stringify(api.preview()))).toBe(initialPreview);
  expect(await chess(page, (api) => JSON.stringify(api.strategicFitMetadata()))).toBe(initialMetadata);
});

test("stale and replacement reports clear comparison selection and local route state", async ({ page }) => {
  const { dialog, before, pathBefore } = await bootstrap(page);
  const queue = dialog.locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  const evidencePane = dialog.locator("#strategic-fit-pane-evidence");
  await expect(evidencePane.locator("[data-board-read-only='true']")).toHaveCount(2);
  await evidencePane.getByLabel("Affected branch route").selectOption("route:finding:01:b");
  await evidencePane.getByLabel("Strategic milestone").selectOption("central-resolution");
  await expect(evidencePane.locator(".strategic-fit-comparison-sync-status"))
    .toHaveAttribute("data-milestone-state", "incomplete");

  await chess(page, (api) => api.selectStrategicFitProfile("familiar-plans"));
  await expect(dialog.locator("[data-analysis-state='stale']")).toBeVisible();
  await expect(evidencePane.locator("[data-evidence-finding-id]")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Retry analysis" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible();
  await expect(evidencePane.locator("[data-evidence-finding-id]")).toHaveCount(0);

  const refreshedQueue = dialog.locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await refreshedQueue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await expect(evidencePane.locator(".strategic-fit-comparison-sync-status"))
    .toHaveAttribute("data-milestone-key", "opening-exit");
  await expect(evidencePane.getByLabel("Affected branch route"))
    .toHaveValue("route:finding:01:a");
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
  await expect(evidence.locator("[data-board-orientation='black']")).toHaveCount(2);
  await expect(evidence.locator("[data-board-read-only='true']")).toHaveCount(2);

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
  const boardCards = evidencePane.locator(".strategic-fit-comparison-board-card");
  await expect(boardCards).toHaveCount(2);
  const firstBoard = await boardCards.nth(0).boundingBox();
  const secondBoard = await boardCards.nth(1).boundingBox();
  expect(firstBoard).not.toBeNull();
  expect(secondBoard).not.toBeNull();
  expect(secondBoard!.y).toBeGreaterThan(firstBoard!.y + firstBoard!.height - 1);
  expect(await evidencePane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
});
