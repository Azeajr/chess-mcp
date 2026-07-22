import { expect, test, type Download, type Page } from "playwright/test";
import {
  contrastViolations,
  expectBasicAccessibility,
  touchTargetViolations,
} from "./helpers/accessibility";

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  toPgn(): string;
  currentPath(): number[];
  version(): number;
  dirty(): boolean;
  preview(): unknown;
  strategicFitMetadata(): any;
  flushStrategicFitMetadata(): Promise<void>;
  setColor(color: "white" | "black"): void;
  strategicFitMetadataStatus(): string;
  selectStrategicFitProfile(mode: "familiar-plans" | "balanced" | "versatile" | "custom"): unknown;
  strategicFitLifecycle(): any;
};

async function downloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

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
              snapshot: "e2e-fixture:strategic-fit-classifier-snapshot-with-a-deliberately-long-unbroken-provenance-identifier-0123456789abcdef",
              reason,
            });
            const boardFens = [
              "rnbqkbnr/pp1ppppp/5n2/2p5/4P3/2P5/PP1P1PPP/RNBQKBNR w KQkq - 1 3",
              "r1bqkb1r/pp1ppppp/2n2n2/2p5/4P3/2P2N2/PP1P1PPP/RNBQKB1R w KQkq - 3 4",
              "r1bqk2r/pp1pbppp/2n1pn2/2p5/3PP3/2P2N2/PP3PPP/RNBQKB1R w KQkq - 1 6",
              "r1bq1rk1/pp1pbppp/2n1pn2/2p5/3PP3/2P1BN2/PP3PPP/RN1QKB1R w KQ - 3 7",
              "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
              "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
            ];
            const snapshot = (
              routeId: string,
              kind: string,
              ply: number,
              fenIndex: number,
              comparability: "comparable" | "incomplete" | "not-comparable" = "comparable",
              positionId?: string,
            ) => ({
              analysis_version: analysisVersion,
              snapshot_id: `snapshot:${routeId}:${kind}:${ply}`,
              route_id: routeId,
              position_id: positionId ?? `position:${routeId}:${ply}`,
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
              trajectory("route:d0915031cdecff76", "complete", [
                snapshot(
                  "route:d0915031cdecff76",
                  "configured-ply",
                  0,
                  4,
                  "comparable",
                  "position:e7550032f70614fc",
                ),
                snapshot(
                  "route:d0915031cdecff76",
                  "configured-ply",
                  2,
                  5,
                  "comparable",
                  "position:5022598b73716fd2",
                ),
                snapshot("route:d0915031cdecff76", "opening-exit", 4, 0),
                snapshot("route:d0915031cdecff76", "central-resolution", 8, 1),
                snapshot("route:d0915031cdecff76", "irreversible-transformation", 10, 2),
                snapshot("route:d0915031cdecff76", "configured-ply", 12, 3),
                snapshot("route:d0915031cdecff76", "final-valid-position", 14, 3, "not-comparable"),
              ]),
              trajectory("route:e93bfad5d54ea7a2", "incomplete", [
                snapshot("route:e93bfad5d54ea7a2", "opening-exit", 4, 0),
                snapshot("route:e93bfad5d54ea7a2", "central-resolution", 8, 1, "incomplete"),
                snapshot("route:e93bfad5d54ea7a2", "configured-ply", 14, 3),
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
                  ? message.payload.options.profile?.mode === "familiar-plans"
                    ? "Fresh evidence shows a familiar closed center against the weighted baseline."
                    : "This branch produces a closed center while the weighted baseline produces an open IQP position."
                  : `Plain-language explanation for fixture finding ${index + 1}.`,
                references: {
                  position_ids: index === 0
                    ? [
                        "position:e7550032f70614fc",
                        "position:2b1fd1b2aadfbfa3",
                        "position:5022598b73716fd2",
                        "position:373d8f8d0de0d9bf",
                        "position:27ed4375501ec11a",
                        "position:38fa52ee143b5f1a",
                      ]
                    : [`position:${id}:a`, `position:${id}:b`],
                  decision_ids: index === 0
                    ? [
                        "decision:e4e5e82a5c33c5ff",
                        "decision:c355600852e94946",
                        "decision:a191661d710d7004",
                        "decision:42f4ab66c74a8a67",
                        "decision:ae1f88a65ccff091",
                      ]
                    : [`decision:${id}:a`, `decision:${id}:b`],
                  route_ids: index === 0
                    ? ["route:d0915031cdecff76", "route:e93bfad5d54ea7a2"]
                    : [`route:${id}:a`, `route:${id}:b`],
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
                          typical_value: {
                            setup: "short-castling",
                            classifier_snapshot_id: "snapshot_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz",
                          },
                          affected_value: {
                            setup: "long-castling",
                            classifier_snapshot_id: "snapshot_abcdefghijklmnopqrstuvwxyz9876543210ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                          },
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
            const routeA = "route:d0915031cdecff76";
            const routeB = "route:e93bfad5d54ea7a2";
            const requestedOverrides = message.payload.options.cohorts?.overrides ?? [];
            const requestedKind = requestedOverrides.at(-1)?.kind ?? "automatic";
            const cohort = (
              cohortId: string,
              routeIds: string[],
              excludedRouteIds: string[] = [],
            ) => ({
              analysis_version: analysisVersion,
              cohort_id: cohortId,
              state: routeIds.length > 1 ? "actionable" : "insufficient-evidence",
              opening_scope_ids: [`opening:${cohortId}`],
              decision_scope_ids: [
                "decision:e4e5e82a5c33c5ff",
                "decision:c355600852e94946",
              ],
              route_ids: routeIds,
              excluded_route_ids: excludedRouteIds,
              route_weights: routeIds.map((routeId) => ({
                route_id: routeId,
                normalized_weight: 1 / routeIds.length,
              })),
              effective_sample_size: routeIds.length,
              modes: routeIds.length === 0 ? [] : [{
                analysis_version: analysisVersion,
                mode_id: `mode:${cohortId}`,
                cohort_id: cohortId,
                representative_route_id: routeIds[0],
                supporting_route_ids: routeIds,
                concept_ids: [],
                normalized_weight: 1,
                effective_sample_size: routeIds.length,
                source: "inferred-medoid",
                provenance: [source("cohort:fixture", "deterministic-core")],
              }],
              override_ids: requestedOverrides.map((entry: any) => entry.override_id),
              provenance: [source("cohort:fixture", "deterministic-core")],
            });
            const cohorts = requestedKind === "merge"
              ? [cohort("cohort:merged", [routeA, routeB])]
              : requestedKind === "split"
                ? [cohort("cohort:split:a", [routeA]), cohort("cohort:split:b", [routeB])]
                : requestedKind === "exclude"
                  ? [cohort("cohort:fixture", [routeA]), cohort("cohort:alternative", [], [routeB])]
                  : [cohort("cohort:fixture", [routeA]), cohort("cohort:alternative", [routeB])];
            const effectiveFindings = findings.map((entry, index) => ({
              ...entry,
              evidence: {
                ...entry.evidence,
                cohort_id: requestedKind === "merge"
                  ? "cohort:merged"
                  : index === 0 ? cohorts[0].cohort_id : cohorts.at(-1).cohort_id,
              },
            }));
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
                  report_id: `report:findings:${message.payload.metadata.repertoire_revision}:${requestedKind}`,
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
                  cohorts,
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
                  findings: effectiveFindings,
                  finding_page: {
                    offset: 0,
                    limit: effectiveFindings.length,
                    total_count: effectiveFindings.length,
                    returned_count: effectiveFindings.length,
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
  await chess(page, (api) => api.loadPgn(
    "1. e4 e5 (1... c5) 2. Nf3 Nc6 *",
    "finding-queue.pgn",
  ));
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

test("finding resolutions are reversible, persistent, count-aware, and automatically reconciled", async ({ page }) => {
  const { dialog, before, pathBefore } = await bootstrap(page);
  const initialVersion = await chess(page, (api) => api.version());
  const initialDirty = await chess(page, (api) => api.dirty());
  const initialPreview = await chess(page, (api) => JSON.stringify(api.preview()));
  const queue = dialog.locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  const first = queue.locator("[data-finding-id='finding:01']");
  await first.locator("[data-finding-select]").click();

  const actions = dialog.locator("[data-resolution-finding-id='finding:01']");
  await expect(actions).toBeVisible();
  await actions.getByRole("radio", { name: /Keep intentionally/ }).check();
  await actions.getByLabel("Optional keep-intentionally reason").selectOption("objectively-strongest");
  await actions.getByLabel("Optional note").fill("Best practical choice for this repertoire.");
  await actions.getByRole("button", { name: "Save resolution" }).click();

  await expect.poll(() => chess(page, (api) =>
    api.strategicFitLifecycle().current_result?.reanalysis?.trigger ?? null
  )).toBe("resolution-change");
  await first.locator("[data-finding-select]").click();
  await expect(actions).toHaveAttribute("data-resolution-state", "keep-intentionally");
  await expect(first.locator(".strategic-fit-finding-resolution")).toHaveText("Kept intentionally");
  await expect(dialog.locator("[data-overview-item='unresolved-findings'] [data-overview-value]"))
    .toHaveText("2");
  await dialog.getByRole("button", { name: "Review unresolved findings" }).click();
  await expect(queue.locator("[data-finding-id='finding:01']")).toHaveCount(0);
  await expect(queue.locator(".strategic-fit-queue-summary p")).toContainText(
    "of 2 matching findings · 12 in this report",
  );
  await queue.getByRole("button", { name: "Show all report findings" }).click();
  await expect(first.locator(".strategic-fit-finding-resolution")).toHaveText("Kept intentionally");
  await first.locator("[data-finding-select]").click();
  const persistedKeep = await chess(page, (api) => api.strategicFitMetadata().resolutions);
  expect(persistedKeep).toMatchObject([{
    state: "keep-intentionally",
    intentional_reason: "objectively-strongest",
    note: "Best practical choice for this repertoire.",
    record_state: "active",
    semantic_finding_id: "semantic:finding:01",
  }]);
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
  expect(await chess(page, (api) => api.version())).toBe(initialVersion);
  expect(await chess(page, (api) => api.dirty())).toBe(initialDirty);
  expect(await chess(page, (api) => JSON.stringify(api.preview()))).toBe(initialPreview);

  const beforeReopenRequest = await chess(page, (api) =>
    api.strategicFitLifecycle().current_result?.request_id ?? null
  );
  await actions.getByRole("button", { name: "Reopen finding" }).click();
  await expect.poll(() => chess(page, (api) =>
    api.strategicFitLifecycle().current_result?.request_id ?? null
  )).not.toBe(beforeReopenRequest);
  await first.locator("[data-finding-select]").click();
  await expect(actions).toHaveAttribute("data-resolution-state", "unresolved");
  await expect(first.locator(".strategic-fit-finding-resolution")).toHaveText("Unresolved");
  await expect(dialog.locator("[data-overview-item='unresolved-findings'] [data-overview-value]"))
    .toHaveText("3");
  expect(await chess(page, (api) => api.strategicFitMetadata().resolutions)).toEqual([]);

  const beforeDeferRequest = await chess(page, (api) =>
    api.strategicFitLifecycle().current_result?.request_id ?? null
  );
  await actions.getByRole("radio", { name: /Defer/ }).check();
  await actions.getByLabel("Optional note").fill("Review after the next event.");
  await actions.getByRole("button", { name: "Save resolution" }).click();
  await expect.poll(() => chess(page, (api) =>
    api.strategicFitLifecycle().current_result?.request_id ?? null
  )).not.toBe(beforeDeferRequest);
  await first.locator("[data-finding-select]").click();
  await expect(actions).toHaveAttribute("data-resolution-state", "defer");
  await expect(first.locator(".strategic-fit-finding-resolution")).toHaveText("Deferred");
  await chess(page, (api) => api.flushStrategicFitMetadata());

  await page.reload();
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await page.getByRole("button", { name: "Open workspace" }).click();
  const restoredDialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await restoredDialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(restoredDialog.locator("[data-analysis-state='completed']")).toBeVisible();
  const restoredQueue = restoredDialog.locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await expect(restoredQueue.locator("[data-finding-id='finding:01'] .strategic-fit-finding-resolution"))
    .toHaveText("Deferred");
  await expect(restoredDialog.locator("[data-overview-item='unresolved-findings'] [data-overview-value]"))
    .toHaveText("2");

  await restoredQueue.locator("[data-finding-id='finding:02'] [data-finding-select]").click();
  const staleSemantic = restoredDialog.locator("[data-resolution-finding-id='finding:02']");
  await expect(staleSemantic.locator("[data-resolution-blocked]")).toContainText(
    "semantic position referenced by this finding no longer belongs",
  );
  await expect(staleSemantic.getByRole("button", { name: "Save resolution" })).toHaveCount(0);
  expect(await chess(page, (api) => api.strategicFitMetadata().resolutions)).toHaveLength(1);

  await chess(page, (api) => api.selectStrategicFitProfile("versatile"));
  await expect.poll(() => chess(page, (api) =>
    api.strategicFitLifecycle().current_result?.reanalysis?.trigger ?? null
  )).toBe("profile-change");
  await expect(restoredDialog.locator("[data-analysis-state='completed']")).toBeVisible();
});

test("training items persist semantic references, keep findings visible, and export legal basic drills", async ({ page }) => {
  const { dialog, before, pathBefore } = await bootstrap(page);
  const initialVersion = await chess(page, (api) => api.version());
  const initialDirty = await chess(page, (api) => api.dirty());
  const queue = dialog.locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  const first = queue.locator("[data-finding-id='finding:01']");
  await first.locator("[data-finding-select]").click();

  const training = dialog.locator("[data-training-finding-id='finding:01']");
  await expect(training).toBeVisible();
  await training.getByLabel("Optional training notes").fill("Practice Nf3 from the matched checkpoints.");
  await training.getByRole("button", { name: "Create training item" }).click();
  await expect.poll(() => chess(page, (api) =>
    api.strategicFitLifecycle().current_result?.reanalysis?.trigger ?? null
  )).toBe("resolution-change");
  await first.locator("[data-finding-select]").click();
  await expect(dialog.locator("[data-training-finding-id='finding:01']")).toContainText("Semantic positions2");
  await expect(first.locator(".strategic-fit-finding-resolution")).toHaveText("Train as an exception");
  await expect(first).toBeVisible();
  await expect(dialog.locator("[data-overview-item='unresolved-findings'] [data-overview-value]"))
    .toHaveText("2");

  const persisted = await chess(page, (api) => api.strategicFitMetadata());
  expect(persisted.training_references).toHaveLength(1);
  expect(persisted.training_references[0].references.position_ids).toEqual([
    "position:5022598b73716fd2",
    "position:e7550032f70614fc",
  ]);
  expect(persisted.resolutions).toMatchObject([{
    state: "train-as-exception",
    semantic_finding_id: "semantic:finding:01",
    note: "Practice Nf3 from the matched checkpoints.",
    linked_training_ids: [persisted.training_references[0].training_id],
  }]);
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
  expect(await chess(page, (api) => api.version())).toBe(initialVersion);
  expect(await chess(page, (api) => api.dirty())).toBe(initialDirty);

  const downloadEvent = page.waitForEvent("download");
  await training.getByRole("button", { name: "Save basic drill JSON" }).click();
  const download = await downloadEvent;
  const artifact = JSON.parse(await downloadText(download));
  expect(artifact.artifact_kind).toBe("chess-mcp/strategic-fit-basic-drill");
  expect(artifact.drills).toEqual(expect.arrayContaining([
    expect.objectContaining({
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      expected_san: "e4",
      source_san_path: [],
    }),
    expect.objectContaining({
      fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
      expected_san: "Nf3",
      source_san_path: ["e4", "e5"],
    }),
  ]));

  await chess(page, (api) => api.flushStrategicFitMetadata());
  await page.reload();
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await page.getByRole("button", { name: "Open workspace" }).click();
  const restored = page.getByRole("dialog", { name: "Strategic Fit" });
  await restored.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(restored.locator("[data-analysis-state='completed']")).toBeVisible();
  const restoredQueue = restored.locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await restoredQueue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await expect(restored.locator("[data-training-finding-id='finding:01']"))
    .toContainText("Training item saved");
  await expect(restored.locator("[data-training-record-id]")).toHaveAttribute(
    "data-training-record-id",
    persisted.training_references[0].training_id,
  );
});

test("cohort adjustments preview exact impact, persist metadata-only, reanalyze, reset, and block stale confirmation", async ({ page }) => {
  const { dialog, before, pathBefore } = await bootstrap(page);
  const initialVersion = await chess(page, (api) => api.version());
  const initialDirty = await chess(page, (api) => api.dirty());
  const initialPreview = await chess(page, (api) => JSON.stringify(api.preview()));
  const queue = dialog.locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  const selectFirst = async () => {
    await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
    await expect(dialog.locator("[data-cohort-editor]")).toBeVisible();
    return dialog.locator("[data-cohort-editor]");
  };

  let editor = await selectFirst();
  await editor.getByRole("button", { name: "Preview adjustment" }).click();
  await expect(editor.getByRole("alert")).toContainText("Choose routes from the cohorts to merge");
  expect(await chess(page, (api) => api.strategicFitMetadata().cohort_overrides)).toEqual([]);

  await editor.locator("input[value='route:d0915031cdecff76']").check();
  await editor.locator("input[value='route:e93bfad5d54ea7a2']").check();
  await editor.getByLabel("Optional reason").fill("These routes share one practical repertoire plan.");
  await editor.getByRole("button", { name: "Preview adjustment" }).click();
  const mergePreview = editor.locator(".strategic-fit-cohort-preview");
  await expect(mergePreview).toContainText("Exact impact before confirmation");
  await expect(mergePreview.locator("dl > div", { hasText: "Current cohorts" })).toContainText("2");
  await expect(mergePreview.locator("dl > div", { hasText: "Proposed cohorts" })).toContainText("1");
  await expect(mergePreview.locator("dl > div", { hasText: "Affected routes" })).toContainText("2");
  await expect(mergePreview).toContainText("route:d0915031cdecff76");
  await expect(mergePreview).toContainText("route:e93bfad5d54ea7a2");
  await expect(mergePreview.locator("dl > div", { hasText: "Current baselines" })).toContainText("2");
  await expect(mergePreview.locator("dl > div", { hasText: "Proposed baselines" })).toContainText("1");
  await expect(mergePreview.locator("dl > div", { hasText: "Current findings" })).toContainText("12");
  await expect(mergePreview.locator("dl > div", { hasText: "Proposed findings" })).toContainText("12");
  expect(await chess(page, (api) => api.strategicFitMetadata().cohort_overrides)).toEqual([]);

  await mergePreview.getByRole("button", { name: "Confirm and analyze again" }).click();
  await expect.poll(() => chess(page, (api) =>
    api.strategicFitLifecycle().current_result?.report_id ?? null
  )).toContain(":merge");
  expect(await chess(page, (api) => api.strategicFitMetadata().cohort_overrides)).toMatchObject([{
    kind: "merge",
    route_ids: ["route:d0915031cdecff76", "route:e93bfad5d54ea7a2"],
    record_state: "active",
  }]);
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
  expect(await chess(page, (api) => api.version())).toBe(initialVersion);
  expect(await chess(page, (api) => api.dirty())).toBe(initialDirty);
  expect(await chess(page, (api) => JSON.stringify(api.preview()))).toBe(initialPreview);

  editor = await selectFirst();
  await editor.getByRole("radio", { name: /Restore automatic cohorts/ }).check();
  await editor.getByLabel("Saved adjustment to remove").selectOption({ index: 1 });
  await editor.getByRole("button", { name: "Preview adjustment" }).click();
  await expect(editor.locator(".strategic-fit-cohort-preview")).toContainText("cohort:fixture");
  await editor.getByRole("button", { name: "Confirm and analyze again" }).click();
  await expect.poll(() => chess(page, (api) =>
    api.strategicFitLifecycle().current_result?.report_id ?? null
  )).toContain(":automatic");
  expect(await chess(page, (api) => api.strategicFitMetadata().cohort_overrides)).toEqual([]);

  editor = await selectFirst();
  await editor.getByRole("radio", { name: /Rename cohort/ }).check();
  await editor.getByRole("textbox", { name: "User-facing name", exact: true })
    .fill("Unified e4 repertoire");
  await editor.getByRole("button", { name: "Preview adjustment" }).click();
  const renamePreview = editor.locator(".strategic-fit-cohort-preview");
  await expect(renamePreview.locator("dl > div", { hasText: "Current cohorts" })).toContainText("cohort:fixture");
  await expect(renamePreview.locator("dl > div", { hasText: "Proposed cohorts" })).toContainText("cohort:fixture");
  await renamePreview.getByRole("button", { name: "Confirm and analyze again" }).click();
  await expect.poll(() => chess(page, (api) =>
    api.strategicFitMetadata().cohort_labels[0]?.display_name ?? null
  )).toBe("Unified e4 repertoire");
  await expect(queue.locator("[data-finding-id='finding:01']")).toContainText("Unified e4 repertoire");
  await chess(page, (api) => api.flushStrategicFitMetadata());

  await page.reload();
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await page.getByRole("button", { name: "Open workspace" }).click();
  const restored = page.getByRole("dialog", { name: "Strategic Fit" });
  await restored.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(restored.locator("[data-analysis-state='completed']")).toBeVisible();
  const restoredQueue = restored.locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await expect(restoredQueue.locator("[data-finding-id='finding:01']"))
    .toContainText("Unified e4 repertoire");
  await restoredQueue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  const restoredEditor = restored.locator("[data-cohort-editor]");
  await restoredEditor.getByRole("radio", { name: /Restore automatic cohorts/ }).check();
  await restoredEditor.getByLabel("Saved adjustment to remove").selectOption({ index: 1 });
  await restoredEditor.getByRole("button", { name: "Preview adjustment" }).click();
  await restoredEditor.getByRole("button", { name: "Confirm and analyze again" }).click();
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadata().cohort_labels.length)).toBe(0);

  await restoredQueue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  const staleEditor = restored.locator("[data-cohort-editor]");
  await staleEditor.locator("input[value='route:d0915031cdecff76']").check();
  await staleEditor.locator("input[value='route:e93bfad5d54ea7a2']").check();
  await staleEditor.getByRole("button", { name: "Preview adjustment" }).click();
  await expect(staleEditor.locator(".strategic-fit-cohort-preview")).toBeVisible();
  await chess(page, (api) => api.selectStrategicFitProfile("versatile"));
  await expect.poll(() => chess(page, (api) =>
    api.strategicFitLifecycle().current_result?.reanalysis?.trigger ?? null
  )).toBe("profile-change");
  await expect(staleEditor.locator(".strategic-fit-cohort-preview")).toHaveCount(0);
  expect(await chess(page, (api) => api.strategicFitMetadata().cohort_overrides)).toEqual([]);
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

  await comparison.getByLabel("Affected branch route").selectOption("route:e93bfad5d54ea7a2");
  await comparison.getByLabel("Strategic milestone").selectOption("central-resolution");
  await expect(sync).toHaveAttribute("data-milestone-state", "incomplete");
  await expect(sync).toContainText("Incomplete checkpoint evidence");
  await comparison.getByLabel("Strategic milestone").selectOption("irreversible-transformation");
  await expect(sync).toHaveAttribute("data-milestone-state", "incomplete");
  await expect(sync).toContainText("affected branch is missing");
  await expect(comparison.locator("[data-board-role='affected'] .strategic-fit-comparison-board-missing"))
    .toContainText("Board unavailable at this milestone");

  await comparison.getByLabel("Affected branch route").selectOption("route:d0915031cdecff76");
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

test("automatic replacement reports clear comparison selection and local route state", async ({ page }) => {
  const { dialog, before, pathBefore } = await bootstrap(page);
  const queue = dialog.locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  const evidencePane = dialog.locator("#strategic-fit-pane-evidence");
  await expect(evidencePane.locator("[data-board-read-only='true']")).toHaveCount(2);
  await evidencePane.getByLabel("Affected branch route").selectOption("route:e93bfad5d54ea7a2");
  await evidencePane.getByLabel("Strategic milestone").selectOption("central-resolution");
  await expect(evidencePane.locator(".strategic-fit-comparison-sync-status"))
    .toHaveAttribute("data-milestone-state", "incomplete");

  await chess(page, (api) => api.selectStrategicFitProfile("familiar-plans"));
  await expect.poll(() => chess(page, (api) =>
    api.strategicFitLifecycle().current_result?.reanalysis?.trigger ?? null
  )).toBe("profile-change");
  await expect(evidencePane.locator("[data-evidence-finding-id]")).toHaveCount(0);

  const refreshedQueue = dialog.locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await refreshedQueue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await expect(refreshedQueue.locator("[data-finding-id='finding:01'] [data-finding-changed-evidence='true']"))
    .toContainText("Review this finding again");
  await expect(evidencePane.locator(".strategic-fit-comparison-sync-status"))
    .toHaveAttribute("data-milestone-key", "opening-exit");
  await expect(evidencePane.getByLabel("Affected branch route"))
    .toHaveValue("route:d0915031cdecff76");
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

test("phone resolution controls are keyboard-operable, accessible, and touch-sized", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { dialog, before, pathBefore } = await bootstrap(page);
  await dialog.getByRole("tab", { name: "Findings" }).click();
  const queue = dialog.locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  const resolutionTab = dialog.getByRole("tab", { name: "Resolution" });
  await resolutionTab.focus();
  await page.keyboard.press("Enter");
  await expect(resolutionTab).toHaveAttribute("aria-selected", "true");
  const pane = dialog.locator("#strategic-fit-pane-resolution");
  const actions = pane.locator("[data-resolution-finding-id='finding:01']");
  await expect(actions).toBeVisible();

  const keep = actions.getByRole("radio", { name: /Keep intentionally/ });
  await keep.focus();
  await page.keyboard.press("ArrowDown");
  const defer = actions.getByRole("radio", { name: /Defer/ });
  await expect(defer).toBeChecked();
  await actions.getByLabel("Optional note").focus();
  await page.keyboard.type("Keyboard and phone review note.");
  const save = actions.getByRole("button", { name: "Save resolution" });
  await save.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => chess(page, (api) =>
    api.strategicFitLifecycle().current_result?.reanalysis?.trigger ?? null
  )).toBe("resolution-change");
  await dialog.getByRole("tab", { name: "Findings" }).click();
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await dialog.getByRole("tab", { name: "Resolution" }).click();
  await expect(actions).toHaveAttribute("data-resolution-state", "defer");
  await expect(actions.getByRole("button", { name: "Reopen finding" })).toBeVisible();

  await expectBasicAccessibility(dialog);
  expect(await touchTargetViolations(pane)).toEqual([]);
  expect(await pane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
});

test("phone can complete the full review journey with the keyboard only and return safely", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFindingWorkerFixture(page);
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await chess(page, (api) => api.loadPgn("1. e4 e5 2. Nf3 Nc6 *", "keyboard-review.pgn"));
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");

  const opener = page.getByRole("button", { name: "Open workspace" });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await expect(dialog.getByRole("button", { name: "Return to repertoire" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("radio", { name: /Balanced/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByText("Advanced preferences", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Skip for now" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Use Balanced profile" })).toBeFocused();
  await page.keyboard.press("Enter");

  const analyze = dialog.getByRole("button", { name: "Analyze strategic fit" });
  await expect(analyze).toBeFocused();
  const settledBefore = await chess(page, (api) => ({
    pgn: api.toPgn(),
    version: api.version(),
    dirty: api.dirty(),
    preview: JSON.stringify(api.preview()),
    metadata: JSON.stringify(api.strategicFitMetadata()),
  }));
  await page.keyboard.press("Enter");
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible();

  const overviewTab = dialog.getByRole("tab", { name: "Overview" });
  for (let index = 0; index < 6 && !(await overviewTab.evaluate((element) => element === document.activeElement)); index++) {
    await page.keyboard.press("Tab");
  }
  await expect(overviewTab).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const findingsTab = dialog.getByRole("tab", { name: "Findings" });
  await expect(findingsTab).toBeFocused();
  await expect(dialog.locator("#strategic-fit-pane-findings")).toBeVisible();

  const firstFinding = dialog.locator("[data-finding-id='finding:01'] [data-finding-select]");
  for (let index = 0; index < 12 && !(await firstFinding.evaluate((element) => element === document.activeElement)); index++) {
    await page.keyboard.press("Tab");
  }
  await expect(firstFinding).toBeFocused();
  await page.keyboard.press("Enter");
  const evidencePane = dialog.locator("#strategic-fit-pane-evidence");
  await expect(evidencePane).toBeVisible();
  await expect(evidencePane).toBeFocused();
  await expect(dialog.locator("[data-board-read-only='true']")).toHaveCount(2);

  const sourceLine = evidencePane.getByRole("combobox", {
    name: "Affected source line",
    exact: true,
  });
  for (let index = 0; index < 8 && !(await sourceLine.evaluate((element) => element === document.activeElement)); index++) {
    await page.keyboard.press("Tab");
  }
  await expect(sourceLine).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowUp");
  await expect(sourceLine).toHaveValue("3");
  await page.keyboard.press("Tab");
  const goToLine = evidencePane.getByRole("button", { name: "Go to line" });
  await expect(goToLine).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await chess(page, (api) => api.currentPath())).toEqual([0, 0, 0, 0]);
  expect(await chess(page, (api) => ({
    pgn: api.toPgn(),
    version: api.version(),
    dirty: api.dirty(),
    preview: JSON.stringify(api.preview()),
    metadata: JSON.stringify(api.strategicFitMetadata()),
  }))).toEqual(settledBefore);

  const evidenceTab = dialog.getByRole("tab", { name: "Evidence" });
  for (let index = 0; index < 8 && !(await evidenceTab.evaluate((element) => element === document.activeElement)); index++) {
    await page.keyboard.press("Shift+Tab");
  }
  await expect(evidenceTab).toBeFocused();
  await page.keyboard.press("Home");
  await expect(overviewTab).toBeFocused();
  const close = dialog.getByRole("button", { name: "Return to repertoire" });
  for (let index = 0; index < 6 && !(await close.evaluate((element) => element === document.activeElement)); index++) {
    await page.keyboard.press("Shift+Tab");
  }
  await expect(close).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("completed desktop and phone review pass accessibility, overflow, and visual baselines", async ({ page }) => {
  const { dialog } = await bootstrap(page);
  const firstFinding = dialog.locator("[data-finding-id='finding:01'] [data-finding-select]");
  await firstFinding.click();
  const evidencePane = dialog.locator("#strategic-fit-pane-evidence");
  const expert = evidencePane.locator(".strategic-fit-evidence-expert");

  const close = dialog.getByRole("button", { name: "Return to repertoire" });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  const previewAdjustment = dialog.getByRole("button", { name: "Preview adjustment" });
  await expect(previewAdjustment).toBeFocused();
  expect(await previewAdjustment.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 2;
  })).toBe(true);
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();

  await expert.locator("summary").click();
  await evidencePane.getByRole("combobox", {
    name: "Affected source line",
    exact: true,
  }).selectOption("4");
  await expectBasicAccessibility(dialog);
  expect(await contrastViolations(dialog)).toEqual([]);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await evidencePane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(dialog).toHaveScreenshot("strategic-fit-review-desktop.png", {
    animations: "disabled",
    caret: "hide",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.locator(".strategic-fit-workspace-pane:visible")).toHaveCount(1);
  await expectBasicAccessibility(dialog);
  expect(await touchTargetViolations(dialog)).toEqual([]);
  expect(await contrastViolations(dialog)).toEqual([]);
  expect(await evidencePane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(dialog).toHaveScreenshot("strategic-fit-review-phone.png", {
    animations: "disabled",
    caret: "hide",
  });
});
