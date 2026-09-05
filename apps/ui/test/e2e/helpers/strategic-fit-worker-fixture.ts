import type { Page } from "playwright/test";

export async function installFindingWorkerFixture(page: Page, replacementLabFixture = false) {
  await page.addInitScript((replacementLabFixture) => {
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args, newTarget) {
        if (!String(args[0]).includes("strategic-fit.worker")) {
          return Reflect.construct(target, args, newTarget);
        }
        const controlled = {
          onmessage: null as ((event: MessageEvent) => void) | null,
          onerror: null as ((event: ErrorEvent) => void) | null,
          postMessage(message: { type?: unknown }) {
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
              "review-now",
              "review-now",
              "review-later",
              "informational",
              "review-now",
              "insufficient-evidence",
              "insufficient-evidence",
              "informational",
              "review-later",
              "review-now",
              "review-later",
              "informational",
            ];
            const openings = [
              "Sicilian · Alapin",
              "French · Advance",
              "Queen's Gambit · Exchange",
              "Caro-Kann · Classical",
              "English · Four Knights",
              "French · Advance",
              "Sicilian · Alapin",
              "Ruy Lopez · Berlin",
              "Queen's Gambit · Exchange",
              "French · Advance",
              "Caro-Kann · Classical",
              "English · Four Knights",
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
              snapshot:
                "e2e-fixture:strategic-fit-classifier-snapshot-with-a-deliberately-long-unbroken-provenance-identifier-0123456789abcdef",
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
              snapshots: unknown[],
              missingCheckpoints: unknown[] = [],
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
              trajectory(
                "route:e93bfad5d54ea7a2",
                "incomplete",
                [
                  snapshot("route:e93bfad5d54ea7a2", "opening-exit", 4, 0),
                  snapshot("route:e93bfad5d54ea7a2", "central-resolution", 8, 1, "incomplete"),
                  snapshot("route:e93bfad5d54ea7a2", "configured-ply", 14, 3),
                ],
                [
                  {
                    kind: "irreversible-transformation",
                    reason:
                      "This affected route ends before an irreversible checkpoint is available.",
                  },
                ],
              ),
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
                affected_line_summary:
                  index === 0 ? "Alapin, 6...Nf6 branch" : `Fixture line ${index + 1}`,
                explanation:
                  index === 0
                    ? message.payload.options.profile?.mode === "familiar-plans"
                      ? "Fresh evidence shows a familiar closed center against the weighted baseline."
                      : "This branch produces a closed center while the weighted baseline produces an open IQP position."
                    : `Plain-language explanation for fixture finding ${index + 1}.`,
                references: {
                  position_ids:
                    index === 0
                      ? [
                          "position:e7550032f70614fc",
                          "position:2b1fd1b2aadfbfa3",
                          "position:5022598b73716fd2",
                          "position:373d8f8d0de0d9bf",
                          "position:27ed4375501ec11a",
                          "position:38fa52ee143b5f1a",
                        ]
                      : [`position:${id}:a`, `position:${id}:b`],
                  decision_ids:
                    index === 0
                      ? [
                          "decision:e4e5e82a5c33c5ff",
                          "decision:c355600852e94946",
                          "decision:a191661d710d7004",
                          "decision:42f4ab66c74a8a67",
                          "decision:ae1f88a65ccff091",
                        ]
                      : [`decision:${id}:a`, `decision:${id}:b`],
                  route_ids:
                    index === 0
                      ? ["route:d0915031cdecff76", "route:e93bfad5d54ea7a2"]
                      : [`route:${id}:a`, `route:${id}:b`],
                  source_san_paths:
                    index === 0
                      ? [
                          ["e4", "c5", "c3", "Nf6"],
                          ["e4", "c5", "Nf3", "e6", "c3"],
                          ["e4", "c5", "c3", "d5"],
                          ["e4", "e5", "Nf3", "Nc6"],
                          [
                            "e4",
                            "c5",
                            "c3",
                            "Nf6",
                            "e5",
                            "Nd5",
                            "d4",
                            "cxd4",
                            "Nf3",
                            "Nc6",
                            "cxd4",
                            "d6",
                            "Bc4",
                            "Nb6",
                            "Bb5",
                            "dxe5",
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
                  applied_caps:
                    index === 1
                      ? [
                          {
                            reason: "effective-sample-below-four",
                            maximum_score: 39,
                            explanation:
                              "Effective sample size is below four, so confidence cannot exceed 39.",
                          },
                        ]
                      : [],
                  explanation:
                    index === 1
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
                      provenance: [
                        source(
                          "engine:fixture",
                          "engine",
                          "unavailable",
                          "No engine verification was requested for this base scan.",
                        ),
                      ],
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
                  representative_route_ids:
                    index === 0
                      ? ["route:baseline:01:a", "route:baseline:01:b"]
                      : [`route:${id}:a`],
                  dimensions:
                    index === 0
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
                              classifier_snapshot_id:
                                "snapshot_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz",
                            },
                            affected_value: {
                              setup: "long-castling",
                              classifier_snapshot_id:
                                "snapshot_abcdefghijklmnopqrstuvwxyz9876543210ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                            },
                            contribution: 0.1,
                            explanation: "King setup contributes 10% of normalized distance.",
                          },
                        ]
                      : index === 1
                        ? [
                            {
                              dimension_id: "learning-concepts.unique-concepts",
                              typical_value: null,
                              affected_value: ["new-plan"],
                              contribution: 0.2,
                              explanation: "Available concept evidence contributes 20%.",
                            },
                          ]
                        : [
                            {
                              dimension_id: "dynamic-character.tactical-level",
                              typical_value: "moderate",
                              affected_value: "high",
                              contribution: 0.8 - index * 0.02,
                              explanation: "Tactical character accounts for the reported distance.",
                            },
                          ],
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
                    likely_causal_decision_ids:
                      index === 0
                        ? [
                            message.payload.repertoire_color === "black"
                              ? "decision:c355600852e94946"
                              : "decision:a191661d710d7004",
                          ]
                        : [`decision:${id}:a`],
                    timeline:
                      index === 0
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
                              decision_id:
                                message.payload.repertoire_color === "black"
                                  ? "decision:c355600852e94946"
                                  : "decision:a191661d710d7004",
                              san: message.payload.repertoire_color === "black" ? "e5" : "Nf3",
                              explanation: "The repertoire chooses the causal fixture move.",
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
                              explanation:
                                "The difference remains stable at the matched checkpoint.",
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
                  provenance:
                    index === 1
                      ? [
                          source(
                            "structure:fixture",
                            "structure-classifier",
                            "partial",
                            "One affected route has partial structural evidence.",
                          ),
                        ]
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
                "decision:a191661d710d7004",
              ],
              route_ids: routeIds,
              excluded_route_ids: excludedRouteIds,
              route_weights: routeIds.map((routeId) => ({
                route_id: routeId,
                normalized_weight: 1 / routeIds.length,
              })),
              effective_sample_size: routeIds.length,
              transposition_position_ids: [],
              modes:
                routeIds.length === 0
                  ? []
                  : [
                      {
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
                      },
                    ],
              override_ids: requestedOverrides.map(
                (entry: { override_id: string }) => entry.override_id,
              ),
              provenance: [source("cohort:fixture", "deterministic-core")],
            });
            const cohorts =
              requestedKind === "merge"
                ? [cohort("cohort:merged", [routeA, routeB])]
                : requestedKind === "split"
                  ? [cohort("cohort:split:a", [routeA]), cohort("cohort:split:b", [routeB])]
                  : requestedKind === "exclude"
                    ? [
                        cohort("cohort:fixture", [routeA]),
                        cohort("cohort:alternative", [], [routeB]),
                      ]
                    : replacementLabFixture
                      ? [
                          { ...cohort("cohort:fixture", [routeA, routeB]), state: "actionable" },
                          { ...cohort("cohort:alternative", [routeB]), state: "actionable" },
                        ]
                      : [
                          cohort("cohort:fixture", [routeA]),
                          cohort("cohort:alternative", [routeB]),
                        ];
            const effectiveFindings = findings.map((entry, index) => ({
              ...entry,
              evidence: {
                ...entry.evidence,
                cohort_id:
                  requestedKind === "merge"
                    ? "cohort:merged"
                    : index === 0
                      ? cohorts[0].cohort_id
                      : cohorts.at(-1).cohort_id,
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
                    issues: [
                      {
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
                      },
                    ],
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
                      familiarity_adjusted_coverage: metric(
                        "familiarity-adjusted-coverage",
                        "fraction",
                        0.7,
                      ),
                      training_adjusted_workload: metric(
                        "training-adjusted-workload",
                        "score",
                        0.5,
                      ),
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
  }, replacementLabFixture);
}
