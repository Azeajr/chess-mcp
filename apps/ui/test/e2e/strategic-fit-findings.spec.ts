import { expect, test, type Download, type Page } from "playwright/test";
import { installFindingWorkerFixture } from "./helpers/strategic-fit-worker-fixture";
import { destinationSquares, dragMove, premoveSquares, selectSquare } from "./helpers/board";
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
  strategicFitMetadata(): unknown;
  flushStrategicFitMetadata(): Promise<void>;
  setColor(color: "white" | "black"): void;
  setReplacementLabResultForTesting(result: unknown): void;
  setReplacementLabReviewForTesting(review: unknown): void;
  setResolutionProofForTesting(snapshot: unknown): void;
  documentId(): string;
  strategicFitMetadataStatus(): string;
  selectStrategicFitProfile(mode: "familiar-plans" | "balanced" | "versatile" | "custom"): unknown;
  upsertStrategicFitResolution(input: unknown): unknown;
  strategicFitLifecycle(): unknown;
  strategicFitTrainingPerformance(): {
    targets: unknown[];
    attempts: { recalled: boolean; response_time_ms: number }[];
  };
};

function replacementComparisonFixture(color: "white" | "black" = "white") {
  const version = {
    schema_version: "1.0.0",
    analysis_version: "2.0.0",
    replacement_schema_version: "1.0.0",
  };
  const source = {
    source_id: "source:e2e:comparison",
    kind: "deterministic-core",
    state: "available",
    version: "2.0.0",
    snapshot: "snapshot:e2e:comparison",
    reason: null,
  };
  const sourceRecord = {
    ...version,
    source_id: "candidate-source:e2e:comparison",
    kind: "existing-repertoire-transposition",
    status: "available",
    provider: "repertoire-graph",
    version: "2.0.0",
    snapshot: "snapshot:e2e:comparison",
    reason: null,
    position_ids: ["position:prepared"],
    decision_ids: ["decision:prepared"],
    route_ids: ["route:prepared"],
    details: { fixture: true },
    provenance: [source],
  };
  const axisIds = [
    "strategic-fit",
    "strategic-familiarity",
    "memorization-burden",
    "expected-coverage",
    "new-concepts",
    "theory-size",
    "popularity",
    "homogenization-cost",
    "training-cost",
  ];
  const makeCandidate = (
    id: string,
    san: string,
    paretoStatus: "pareto-optimal" | "dominated" | "unscored",
    edgeCount: number,
  ) => {
    const unavailable = paretoStatus === "unscored";
    const edges = Array.from({ length: edgeCount }, (_, index) => ({
      analysis_version: "2.0.0",
      edge_id: `edge:${id}:${index}`,
      from_node_id: `node:${id}:${index}`,
      to_node_id: `node:${id}:${index + 1}`,
      decision_id: `decision:${id}:${index}`,
      san: index === 0 ? san : index % 2 === 0 ? `Move${index}` : `Reply${index}`,
      uci: "a2a3",
      mover_color: index % 2 === 0 ? color : color === "white" ? "black" : "white",
      owner: index % 2 === 0 ? "repertoire" : "opponent",
      forcing: index % 8 === 0,
      expected_opponent_frequency: index % 6 === 0 ? null : 0.5,
      source_san_paths: [[san]],
      annotation_text: [],
    }));
    const nodes = Array.from({ length: edgeCount + 1 }, (_, index) => ({
      analysis_version: "2.0.0",
      node_id: `node:${id}:${index}`,
      kind: index === 0 ? "root" : index === edgeCount ? "terminal" : "opponent-reply",
      position_id: `position:${id}:${index}`,
      fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
      ply: index,
      outgoing_edge_ids: index < edgeCount ? [`edge:${id}:${index}`] : [],
      source_san_paths: [[san]],
      transposition_target_position_id: index === edgeCount ? "position:prepared" : null,
    }));
    const subtree = unavailable
      ? null
      : {
          ...version,
          subtree_id: `subtree:${id}`,
          root_position_id: nodes[0]!.position_id,
          root_node_id: nodes[0]!.node_id,
          nodes,
          edges,
          routes: [
            {
              analysis_version: "2.0.0",
              route_id: `route:${id}:long`,
              node_ids: nodes.map((node) => node.node_id),
              edge_ids: edges.map((edge) => edge.edge_id),
              terminal_node_id: nodes.at(-1)!.node_id,
              termination: "existing-preparation",
              expected_opponent_frequency: 1,
            },
          ],
          strategic_horizon_ply: 48,
          important_reply_count: 4,
          covered_important_reply_count: 4,
          forcing_reply_count: 2,
          covered_forcing_reply_count: 2,
          unresolved_risk_ids: [],
          provenance: [sourceRecord],
          status: "complete",
          completion: { kind: "immediate-transposition", target_position_id: "position:prepared" },
          truncation_reasons: [],
        };
    return {
      ...version,
      candidate_id: id,
      request_id: "request:e2e:comparison",
      report_id: "report:e2e:comparison",
      finding_id: "finding:01",
      semantic_finding_id: "semantic:finding:01",
      cohort_id: "cohort:fixture",
      repertoire_revision: "browser:fixture",
      repertoire_color: color,
      state: unavailable ? "unavailable" : "available",
      reason: unavailable ? "Candidate provider unavailable; retained for inspection." : null,
      expansion: {
        ...version,
        candidate_id: id,
        rank: 1,
        seed: {
          ...version,
          candidate_id: id,
          san,
          provenance: [sourceRecord],
        },
        evidence_item_results: unavailable
          ? [
              {
                error_code: "provider-unavailable",
                status: "unavailable",
                explanation: "Provider unavailable; candidate evidence retained.",
              },
            ]
          : [],
        omissions: [],
        unresolved_risks: unavailable
          ? [
              {
                analysis_version: "2.0.0",
                risk_id: `risk:${id}`,
                kind: "incomplete-expansion",
                status: "open",
                explanation: "Expansion unavailable.",
                affected_position_ids: [],
                affected_route_ids: [],
                provenance: [source],
              },
            ]
          : [],
        status: unavailable ? "unavailable" : "complete",
        subtree,
      },
      objective_quality: {
        ...version,
        state: unavailable ? "unavailable" : "available",
        white_pov_evaluation_cp: unavailable ? null : 35,
        white_pov_mate_in: null,
        repertoire_pov_evaluation_cp: unavailable ? null : color === "black" ? -35 : 35,
        repertoire_pov_mate_in: null,
        repertoire_pov_loss_from_best_cp: unavailable ? null : 15,
        repertoire_pov_verdict: unavailable ? "unverified" : "within-tolerance",
        engine_depth: unavailable ? null : 24,
        engine_multipv: unavailable ? null : 3,
      },
      strategic_score: {
        ...version,
        new_concept_ids: unavailable ? [] : ["concept:e2e:iqp"],
        transposition_position_ids: unavailable ? [] : ["position:prepared"],
        contributions: axisIds.map((axis, index) => ({
          analysis_version: "2.0.0",
          axis,
          state: unavailable ? "unavailable" : "available",
          normalized_score: unavailable ? null : 0.9 - index * 0.05,
          raw_value: unavailable ? null : 0.9 - index * 0.05,
          unit:
            axis === "new-concepts" ? "concepts" : axis === "theory-size" ? "nodes" : "fraction",
          higher_is_better: !axis.includes("burden") && !axis.includes("cost"),
          reason: unavailable ? "Canonical axis unavailable." : "Canonical Phase 8 axis.",
          provenance: [source],
        })),
        provenance: [source],
      },
      pareto: {
        ...version,
        status: paretoStatus,
        axis_ids: unavailable ? [] : ["objective-quality", ...axisIds],
        dominated_by_candidate_ids: paretoStatus === "dominated" ? ["candidate:e2e:tradeoff"] : [],
        reason:
          paretoStatus === "pareto-optimal"
            ? "No candidate dominates this tradeoff; no single best is inferred."
            : paretoStatus === "dominated"
              ? "Exact canonical dominator retained."
              : "Unavailable evidence cannot enter frontier.",
      },
    };
  };
  const candidates = [
    makeCandidate("candidate:e2e:tradeoff", "Bc4", "pareto-optimal", 30),
    makeCandidate("candidate:e2e:dominated", "d4", "dominated", 3),
    makeCandidate("candidate:e2e:unavailable", "Nc3", "unscored", 1),
  ];
  return {
    request: {},
    pivot_result: {},
    candidate_generation: { source_results: [], database_item_results: [] },
    engine_generation: { source_results: [], engine_item_results: [] },
    expansion: { status: "partial", source_results: [], evidence_item_results: [], candidates: [] },
    scoring: {
      ...version,
      status: "partial",
      error_code: null,
      explanation: "Canonical comparison fixture.",
      repertoire_color: color,
      candidates,
      pareto_candidate_ids: ["candidate:e2e:tradeoff"],
      dominated_candidate_ids: ["candidate:e2e:dominated"],
      unscored_candidate_ids: ["candidate:e2e:unavailable"],
    },
    safety: { status: "partial", candidates: [] },
    preview: { status: "partial", items: [] },
  };
}

function replacementChangeReviewFixture(color: "white" | "black" = "white") {
  const version = {
    schema_version: "1.0.0",
    analysis_version: "2.0.0",
    replacement_schema_version: "1.0.0",
  };
  const provenance = [
    {
      source_id: "source:e2e:change-review",
      kind: "deterministic-core",
      state: "available",
      version: "2.0.0",
      snapshot: "snapshot:e2e:change-review",
      reason: null,
    },
  ];
  const objective = (cp: number) => ({
    ...version,
    state: "available",
    white_pov_evaluation_cp: cp,
    white_pov_mate_in: null,
    white_pov_best_evaluation_cp: 45,
    white_pov_best_mate_in: null,
    repertoire_pov_evaluation_cp: color === "black" ? -cp : cp,
    repertoire_pov_mate_in: null,
    repertoire_pov_loss_from_best_cp: 10,
    repertoire_pov_verdict: "within-tolerance",
    engine_depth: 24,
    engine_multipv: 3,
    evaluation_uncertainty_cp: 4,
    tactical_volatility: 0.1,
    evaluation_sensitivity_cp: 5,
    forcing_density: 0.2,
    king_safety_risk: 0.1,
    viable_move_width: 3,
    database_performance: null,
    theoretical_status: null,
    reason: null,
    provenance,
  });
  const score = (after: boolean) => ({
    ...version,
    state: "available",
    cohort_id: "cohort:fixture",
    trajectory_ids: [after ? "trajectory:after" : "trajectory:before"],
    strategic_fit_score: after ? 0.82 : 0.54,
    strategic_fit_delta: after ? 0.28 : 0,
    strategic_familiarity: after ? 0.86 : 0.5,
    memorization_burden: after ? 0.25 : 0.4,
    expected_opponent_coverage: after ? 0.96 : 0.91,
    new_concept_ids: ["concept:e2e:iqp"],
    theory_nodes_before: 24,
    theory_nodes_after: after ? 31 : 24,
    theory_nodes_added: after ? 7 : 0,
    theory_nodes_removed: after ? 3 : 0,
    popularity: 0.72,
    homogenization_cost: after ? 0.1 : 0.3,
    training_cost: after ? 0.24 : 0.42,
    transposition_position_ids: ["position:prepared"],
    contributions: [],
    provenance,
  });
  const coverage = {
    ...version,
    state: "partial",
    popularity_weighted_before: 0.91,
    popularity_weighted_after: 0.96,
    popularity_weighted_delta: 0.05,
    required_reply_count_before: 8,
    required_reply_count_after: 9,
    newly_uncovered_replies: [],
    newly_covered_replies: [
      {
        analysis_version: "2.0.0",
        state: "available",
        position_id: "position:new-reply",
        decision_id: "decision:new-reply",
        san: "Nf6",
        expected_frequency: 0.18,
        forcing: true,
        source_san_paths: [["e4", "e5", "Nf3", "Nf6"]],
        reason: "Canonical newly covered forcing reply.",
        provenance,
      },
    ],
    duplicate_branch_ids: [],
    new_transposition_position_ids: ["position:prepared"],
    affected_metrics: [
      {
        analysis_version: "2.0.0",
        metric_id: "training-adjusted-workload",
        state: "partial",
        before: 0.42,
        after: 0.24,
        delta: -0.18,
        unit: "fraction",
        reason: "Partial personal training evidence retained.",
        provenance,
      },
    ],
    reason: "One metric remains partial.",
    provenance,
  };
  const target = {
    position_id: "position:old",
    decision_id: "decision:old",
    source_san_path: ["e4", "e5", "Nf3", "Nc6", "Bb5"],
  };
  const operations = [
    {
      analysis_version: "2.0.0",
      operation_id: "operation:add",
      sequence: 0,
      kind: "add-subtree",
      parent: {
        position_id: "position:pivot",
        decision_id: "decision:pivot",
        source_san_path: ["e4", "e5", "Nf3"],
      },
      subtree: { subtree_id: "subtree:e2e:long" },
      provenance,
    },
    {
      analysis_version: "2.0.0",
      operation_id: "operation:link",
      sequence: 1,
      kind: "link-transposition",
      source: {
        position_id: "position:new",
        decision_id: "decision:new",
        source_san_path: ["e4", "e5", "Nf3", "Nf6"],
      },
      target_position_id: "position:prepared",
      provenance,
    },
    {
      analysis_version: "2.0.0",
      operation_id: "operation:annotation",
      sequence: 2,
      kind: "preserve-annotation",
      source: target,
      target: { ...target, source_san_path: ["e4", "e5", "Nf3", "Nf6"] },
      comments: ["Long exact annotation retained"],
      nags: [1],
      semantic_equivalence_verified: true,
      provenance,
    },
    {
      analysis_version: "2.0.0",
      operation_id: "operation:archive",
      sequence: 3,
      kind: "archive-subtree",
      archive_id: "archive:e2e:old-line",
      target,
      archive_pgn: "1. e4 e5 2. Nf3 Nc6 3. Bb5 {old line archived exactly} *",
      references: {
        position_ids: ["position:old"],
        decision_ids: ["decision:old"],
        route_ids: ["route:old"],
        source_san_paths: [target.source_san_path],
      },
      provenance,
    },
    {
      analysis_version: "2.0.0",
      operation_id: "operation:prune",
      sequence: 4,
      kind: "prune-subtree",
      target,
      archive_operation_id: "operation:archive",
      explicitly_confirmed: true,
      provenance,
    },
  ];
  const diffs = operations.map((operation, index) => ({
    analysis_version: "2.0.0",
    operation_id: operation.operation_id,
    sequence: index,
    kind: operation.kind,
    added_paths:
      index === 0
        ? [["e4", "e5", "Nf3", "Nf6", ...Array.from({ length: 36 }, (_, i) => `Move${i}`)]]
        : [],
    removed_paths: index === 4 ? [target.source_san_path] : [],
    annotated_paths: index === 2 ? [["e4", "e5", "Nf3", "Nf6"]] : [],
    linked_paths: index === 1 ? [["e4", "e5", "Nf3", "Nf6"]] : [],
    archived_paths: index === 3 ? [target.source_san_path] : [],
    reordered_parent_paths: [],
    linked_position_ids: index === 1 ? ["position:prepared"] : [],
    archive_ids: index === 3 ? ["archive:e2e:old-line"] : [],
  }));
  const safetyChecks = [
    "legality",
    "engine-sanity",
    "coverage",
    "gap-scan",
    "transpositions",
    "duplicates",
    "stale-revision",
    "affected-cohort-preview",
  ].map((kind) => ({
    analysis_version: "2.0.0",
    kind,
    status: kind === "affected-cohort-preview" ? "warning" : "passed",
    explanation:
      kind === "affected-cohort-preview"
        ? "Partial training evidence remains visible."
        : `${kind} passed canonical Phase 8 evidence.`,
    risk_ids: kind === "affected-cohort-preview" ? ["risk:e2e:partial"] : [],
    provenance,
  }));
  const preview = {
    ...version,
    before: {
      analysis_version: "2.0.0",
      position_count: 20,
      decision_count: 19,
      route_count: 8,
      source_route_count: 8,
      transposition_count: 1,
    },
    after: {
      analysis_version: "2.0.0",
      position_count: 27,
      decision_count: 25,
      route_count: 9,
      source_route_count: 9,
      transposition_count: 2,
    },
    objective_quality_before: objective(20),
    objective_quality_after: objective(35),
    strategic_score_before: score(false),
    strategic_score_after: score(true),
    coverage_effects: coverage,
    affected_paths: diffs.flatMap((diff) => [
      ...diff.added_paths,
      ...diff.removed_paths,
      ...diff.annotated_paths,
      ...diff.linked_paths,
      ...diff.archived_paths,
    ]),
    preserved_annotation_count: 1,
    archive_ids: ["archive:e2e:old-line"],
    operation_diffs: diffs,
    archive_payloads: [
      {
        analysis_version: "2.0.0",
        archive_id: "archive:e2e:old-line",
        operation_id: "operation:archive",
        target,
        pgn: "1. e4 e5 2. Nf3 Nc6 3. Bb5 {old line archived exactly} *",
        references: {
          position_ids: ["position:old"],
          decision_ids: ["decision:old"],
          route_ids: ["route:old"],
          source_san_paths: [target.source_san_path],
        },
        provenance,
      },
    ],
    finding_changes_state: "not-reanalyzed",
    changed_finding_ids: [],
    new_finding_ids: [],
    resolved_finding_ids: [],
  };
  const safetyCandidate = {
    ...version,
    candidate_id: "candidate:e2e:tradeoff",
    request_id: "request:e2e:comparison",
    report_id: "report:fixture",
    finding_id: "finding:01",
    semantic_finding_id: "semantic:finding:01",
    cohort_id: "cohort:fixture",
    repertoire_revision: "browser:fixture",
    repertoire_color: color,
    pivot_id: "pivot:e2e",
    action: "replace",
    action_label: "Replace line",
    status: "safe",
    error_code: null,
    explanation: "Safe replacement retained.",
    source_graph_identity: "graph:e2e",
    simulated_graph_identity: "graph:e2e:after",
    coverage_effects: coverage,
    safety_checks: safetyChecks,
    scored_candidate: {
      expansion: {
        unresolved_risks: [
          {
            analysis_version: "2.0.0",
            risk_id: "risk:e2e:partial",
            kind: "engine-unverified",
            status: "open",
            explanation: "Deeper verification remains optional.",
            affected_position_ids: ["position:new"],
            affected_route_ids: ["route:new"],
            provenance,
          },
        ],
      },
    },
    provenance,
    source_tree_unchanged: true,
    source_scoring_unchanged: true,
    inputs_unchanged: true,
  };
  const stage = {
    stage_id: "stage:e2e:change-review",
    status: "staged",
    result_status: "previewed",
    document_id: "document:e2e",
    base_revision: 7,
    base_repertoire_revision: "browser:7",
    tree_identity: "tree:e2e",
    metadata_identity: "metadata:e2e",
    safety_identity: "safety:e2e",
    change_set_identity: "change-set:e2e",
    preview_identity: "preview:e2e",
    archive_identity: "archive:e2e",
    provenance_identity: "provenance:e2e",
    safety: {
      ...version,
      request_id: "request:e2e:comparison",
      report_id: "report:fixture",
      finding_id: "finding:01",
      semantic_finding_id: "semantic:finding:01",
      cohort_id: "cohort:fixture",
      repertoire_revision: "browser:7",
      repertoire_color: color,
      pivot_id: "pivot:e2e",
      candidates: [safetyCandidate],
      provenance,
    },
    change_set: {
      ...version,
      change_set_id: "change-set:e2e",
      request_id: "request:e2e:comparison",
      candidate_id: "candidate:e2e:tradeoff",
      base_repertoire_revision: "browser:7",
      status: "validated",
      atomic: true,
      staged: true,
      retention: {
        archive: "archive",
        prune: "prune",
        prune_explicitly_confirmed: true,
        archive_before_prune: true,
      },
      operations,
      safety_checks: safetyChecks,
      unresolved_risk_ids: ["risk:e2e:partial"],
      provenance,
    },
    preview: {
      ...version,
      change_set_id: "change-set:e2e",
      base_repertoire_revision: "browser:7",
      atomic: true,
      source_tree_unchanged: true,
      operation_results: operations.map((operation) => ({
        analysis_version: "2.0.0",
        operation_id: operation.operation_id,
        status: "applied",
        error_code: null,
        explanation: "Previewed on clone.",
      })),
      provenance,
      status: "previewed",
      result: { repertoire_revision: null, pgn: "fixture", preview },
      failure: null,
    },
    navigation_san_path: ["e4", "e5", "Nf3"],
    created_at: "2026-07-29T12:00:00.000Z",
    accepted_revision: null,
    error_code: null,
  };
  return {
    candidate_id: "candidate:e2e:tradeoff",
    action: "replace",
    status: "ready",
    evidence: {
      action: "replace",
      safety: stage.safety,
      item: {
        candidate_id: "candidate:e2e:tradeoff",
        status: "previewed",
        stage: { ok: true, stage },
      },
    },
    stage,
    error: null,
  };
}

function resolutionProofFixture(
  documentId: string,
  acceptedRevision: number,
  color: "white" | "black" = "white",
) {
  return {
    status: "awaiting-rescan",
    phase: "acceptance",
    tracked: {
      stage_id: "stage:e2e:change-review",
      document_id: documentId,
      base_revision: acceptedRevision - 1,
      accepted_revision: acceptedRevision,
      action_summary: { archive: "archive", prune: "prune" },
      candidate_id: "candidate:e2e:tradeoff",
      finding_id: "finding:01",
      semantic_finding_id: "semantic:finding:01",
      report_id: "report:fixture",
      repertoire_color: color,
      accepted_at: "2026-07-30T12:00:00.000Z",
    },
    outcome: null,
    new_findings: [],
    reanalysis: null,
    claims: null,
    undo_record: {
      undo_id: "undo:e2e:proof",
      stage_id: "stage:e2e:change-review",
      document_id: documentId,
      status: "available",
      base_revision: acceptedRevision - 1,
      accepted_revision: acceptedRevision,
    },
    superseded_reason: null,
    error: null,
  };
}

async function downloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

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
 * The workspace shows one stage at a time at every width, so a spec has to be on the stage whose
 * pane it inspects — the same click a reader makes. It lands on Overview after an analysis; this
 * file is almost entirely about the finding queue, so `stage` defaults to "findings".
 */
async function showStage(
  dialog: ReturnType<Page["getByRole"]>,
  stage: "overview" | "findings" | "evidence" | "resolution",
) {
  await dialog.locator(`#strategic-fit-stage-${stage}`).click();
  await expect(dialog.locator(".strategic-fit-workspace-body")).toHaveAttribute(
    "data-stage",
    stage,
  );
}

async function bootstrap(
  page: Page,
  repertoireColor: "white" | "black" = "white",
  replacementLabFixture = false,
  stage: "overview" | "findings" | "evidence" | "resolution" = "findings",
) {
  await installFindingWorkerFixture(page, replacementLabFixture);
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await chess(page, (api) => api.loadPgn("1. e4 e5 (1... c5) 2. Nf3 Nc6 *", "finding-queue.pgn"));
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await chess(page, (api, color) => api.setColor(color), repertoireColor);
  await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
  const before = await chess(page, (api) => api.toPgn());
  const pathBefore = await chess(page, (api) => [...api.currentPath()]);
  await page.getByRole("button", { name: "Open Strategic Fit" }).click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await dialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible();
  if (stage !== "overview") await showStage(page, stage);
  return { dialog, before, pathBefore };
}

test("finding queue renders frozen card fields, stable pages, composed filters, and keyboard selection", async ({
  page,
}) => {
  const { dialog, before, pathBefore } = await bootstrap(page);
  const pane = dialog.locator("#strategic-fit-pane-findings");
  const queue = pane.getByRole("region", { name: "Strategic Fit finding queue" });
  await expect(queue).toHaveAttribute("data-queue-status", "ready");
  await showStage(page, "findings");
  await expect(queue.locator("[data-finding-id]")).toHaveCount(6);
  await expect(queue.locator(".strategic-fit-queue-summary p")).toContainText(
    "Showing 1–6 of 12 matching findings · 12 in this report",
  );

  await showStage(page, "findings");
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

  await showStage(page, "findings");
  const unavailable = queue.locator("[data-finding-id='finding:02']");
  await expect(unavailable).toContainText("Expected frequency unavailable");
  await expect(unavailable).toContainText("Objective soundness unavailable");
  await expect(unavailable).toContainText("No engine verification was requested");

  await showStage(page, "findings");
  await first.locator("[data-finding-select]").click();
  const evidencePane = dialog.locator("#strategic-fit-pane-evidence");
  await expect(evidencePane).toBeFocused();
  const firstEvidence = evidencePane.locator("[data-evidence-finding-id='finding:01']");
  await expect(firstEvidence).toBeVisible();
  await expect(firstEvidence.locator("[data-dimension-id]")).toHaveCount(3);
  await expect(
    firstEvidence.locator("[data-dimension-id='center-dynamics.center-state']"),
  ).toContainText("Open iqp");
  await expect(
    firstEvidence.locator("[data-dimension-id='center-dynamics.center-state']"),
  ).toContainText("Closed");
  await expect(firstEvidence.locator("[data-reconciliation-state='reconciled']")).toContainText(
    "60% strategic distance",
  );
  await expect(firstEvidence.locator(".strategic-fit-comparison-basis")).toContainText("14");
  await expect(firstEvidence.locator(".strategic-fit-comparison-basis")).toContainText("2,840");
  await expect(firstEvidence.locator(".strategic-fit-comparison-basis")).toContainText("91%");
  await expect(firstEvidence.locator("[data-confidence-label='high']")).toHaveText(
    "High confidence",
  );
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

  // Selecting a finding advances to the Evidence stage, so come back to the queue before driving
  // it from the keyboard — arrow keys move the selection without leaving the queue, which is the
  // contract the next few assertions cover.
  await showStage(page, "findings");
  await first.locator("[data-finding-select]").focus();
  await page.keyboard.press("ArrowDown");
  const secondSelect = queue.locator("[data-finding-id='finding:02'] [data-finding-select]");
  await expect(secondSelect).toBeFocused();
  await expect(secondSelect).toHaveAttribute("aria-pressed", "true");
  // No stage switch here: clicking the stage strip would move focus off the queue, and the Enter
  // below has to land on the finding that ArrowDown selected.
  await expect(queue.locator("[data-finding-id='finding:02']")).toHaveAttribute(
    "data-finding-selected",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(evidencePane).toBeFocused();
  const secondEvidence = evidencePane.locator("[data-evidence-finding-id='finding:02']");
  await expect(secondEvidence).toBeVisible();
  await expect(secondEvidence.locator("[data-confidence-label='low']")).toHaveText(
    "Low confidence",
  );
  await expect(
    secondEvidence.locator("[data-confidence-cap='effective-sample-below-four']"),
  ).toContainText("Small comparison set");
  await expect(
    secondEvidence.locator("[data-confidence-cap='effective-sample-below-four']"),
  ).toContainText("confidence cannot exceed 39");
  await expect(secondEvidence).toContainText("2 of 7 confidence components are unavailable");
  await expect(secondEvidence.locator("[data-value-state='unavailable']")).toHaveText(
    "Unavailable",
  );
  await expect(secondEvidence.locator("[data-reconciliation-state='partial']")).toContainText(
    "gap is not assigned",
  );
  await expect(secondEvidence.locator(".strategic-fit-data-quality")).toContainText(
    "Opening classification is incomplete for one affected route.",
  );
  await expect(secondEvidence.locator(".strategic-fit-evidence-sources")).toContainText(
    "One affected route has partial structural evidence.",
  );

  await showStage(page, "findings");
  await queue.getByRole("button", { name: "Next findings" }).click();
  await expect(queue.locator("[data-finding-id]")).toHaveCount(6);
  await expect(queue.locator("[data-finding-id]").first()).toHaveAttribute(
    "data-finding-id",
    "finding:07",
  );
  await showStage(page, "findings");
  await expect(queue.locator(".strategic-fit-queue-summary p")).toContainText("Showing 7–12 of 12");

  await queue.getByLabel("Sort findings").selectOption({ label: "Opening / system" });
  await expect(queue.locator("[data-finding-id]").first()).toHaveAttribute(
    "data-finding-id",
    "finding:04",
  );
  await showStage(page, "findings");
  await queue.getByLabel("Priority type").selectOption({ label: "Training" });
  await queue.getByLabel("Priority", { exact: true }).selectOption({ label: "Review now" });
  await expect(queue.locator("[data-finding-id]")).toHaveCount(6);
  await queue.getByLabel("Opening / system").selectOption({ label: "Sicilian · Alapin" });
  await expect(queue.locator("[data-finding-id]")).toHaveCount(2);
  expect(
    await queue
      .locator("[data-finding-id]")
      .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-finding-id"))),
  ).toEqual(["finding:01", "finding:07"]);
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
});

test("finding resolutions are reversible, persistent, count-aware, and automatically reconciled", async ({
  page,
}) => {
  const { dialog, before, pathBefore } = await bootstrap(page);
  const initialVersion = await chess(page, (api) => api.version());
  const initialDirty = await chess(page, (api) => api.dirty());
  const initialPreview = await chess(page, (api) => JSON.stringify(api.preview()));
  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  const first = queue.locator("[data-finding-id='finding:01']");
  await showStage(page, "findings");
  await first.locator("[data-finding-select]").click();

  // Selecting a finding lands on Evidence; recording a decision is the stage after it.
  await showStage(page, "resolution");
  const actions = dialog.locator("[data-resolution-finding-id='finding:01']");
  await expect(actions).toBeVisible();
  await actions.getByRole("radio", { name: /Keep intentionally/ }).check();
  await actions.getByLabel("Why keep it (optional)").selectOption("objectively-strongest");
  await actions.getByLabel("Optional note").fill("Best practical choice for this repertoire.");
  await actions.getByRole("button", { name: "Save resolution" }).click();

  await expect
    .poll(() =>
      chess(page, (api) => api.strategicFitLifecycle().current_result?.reanalysis?.trigger ?? null),
    )
    .toBe("resolution-change");
  await showStage(page, "findings");
  await first.locator("[data-finding-select]").click();
  await expect(actions).toHaveAttribute("data-resolution-state", "keep-intentionally");
  await showStage(page, "findings");
  await expect(first.locator(".strategic-fit-finding-resolution")).toHaveText("Kept intentionally");
  await expect(
    dialog.locator("[data-overview-item='unresolved-findings'] [data-overview-value]"),
  ).toHaveText("2");
  // The overview's drill-in lives on the Overview stage, and taking it moves to the queue.
  await showStage(page, "overview");
  await dialog.getByRole("button", { name: "Review unresolved findings" }).click();
  await showStage(page, "findings");
  await expect(queue.locator("[data-finding-id='finding:01']")).toHaveCount(0);
  await expect(queue.locator(".strategic-fit-queue-summary p")).toContainText(
    "of 2 matching findings · 12 in this report",
  );
  await showStage(page, "findings");
  await queue.getByRole("button", { name: "Show all report findings" }).click();
  await expect(first.locator(".strategic-fit-finding-resolution")).toHaveText("Kept intentionally");
  await showStage(page, "findings");
  await first.locator("[data-finding-select]").click();
  const persistedKeep = await chess(page, (api) => api.strategicFitMetadata().resolutions);
  expect(persistedKeep).toMatchObject([
    {
      state: "keep-intentionally",
      intentional_reason: "objectively-strongest",
      note: "Best practical choice for this repertoire.",
      record_state: "active",
      semantic_finding_id: "semantic:finding:01",
    },
  ]);
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
  expect(await chess(page, (api) => api.version())).toBe(initialVersion);
  expect(await chess(page, (api) => api.dirty())).toBe(initialDirty);
  expect(await chess(page, (api) => JSON.stringify(api.preview()))).toBe(initialPreview);

  const beforeReopenRequest = await chess(
    page,
    (api) => api.strategicFitLifecycle().current_result?.request_id ?? null,
  );
  await showStage(page, "resolution");
  await actions.getByRole("button", { name: "Reopen finding" }).click();
  await expect
    .poll(() =>
      chess(page, (api) => api.strategicFitLifecycle().current_result?.request_id ?? null),
    )
    .not.toBe(beforeReopenRequest);
  await showStage(page, "findings");
  await first.locator("[data-finding-select]").click();
  await expect(actions).toHaveAttribute("data-resolution-state", "unresolved");
  await showStage(page, "findings");
  await expect(first.locator(".strategic-fit-finding-resolution")).toHaveText("Unresolved");
  await expect(
    dialog.locator("[data-overview-item='unresolved-findings'] [data-overview-value]"),
  ).toHaveText("3");
  expect(await chess(page, (api) => api.strategicFitMetadata().resolutions)).toEqual([]);

  const beforeDeferRequest = await chess(
    page,
    (api) => api.strategicFitLifecycle().current_result?.request_id ?? null,
  );
  await showStage(page, "resolution");
  await actions.getByRole("radio", { name: /Defer/ }).check();
  await actions.getByLabel("Optional note").fill("Review after the next event.");
  await actions.getByRole("button", { name: "Save resolution" }).click();
  await expect
    .poll(() =>
      chess(page, (api) => api.strategicFitLifecycle().current_result?.request_id ?? null),
    )
    .not.toBe(beforeDeferRequest);
  await showStage(page, "findings");
  await first.locator("[data-finding-select]").click();
  await expect(actions).toHaveAttribute("data-resolution-state", "defer");
  await showStage(page, "findings");
  await expect(first.locator(".strategic-fit-finding-resolution")).toHaveText("Deferred");
  await chess(page, (api) => api.flushStrategicFitMetadata());

  await page.reload();
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await page.getByRole("button", { name: "Open Strategic Fit" }).click();
  const restoredDialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await restoredDialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(restoredDialog.locator("[data-analysis-state='completed']")).toBeVisible();
  await showStage(page, "findings");
  const restoredQueue = restoredDialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await expect(
    restoredQueue.locator("[data-finding-id='finding:01'] .strategic-fit-finding-resolution"),
  ).toHaveText("Deferred");
  await expect(
    restoredDialog.locator("[data-overview-item='unresolved-findings'] [data-overview-value]"),
  ).toHaveText("2");

  await showStage(page, "findings");
  await restoredQueue.locator("[data-finding-id='finding:02'] [data-finding-select]").click();
  await showStage(page, "resolution");
  const staleSemantic = restoredDialog.locator("[data-resolution-finding-id='finding:02']");
  await expect(staleSemantic.locator("[data-resolution-blocked]")).toContainText(
    "semantic position referenced by this finding no longer belongs",
  );
  await expect(staleSemantic.getByRole("button", { name: "Save resolution" })).toHaveCount(0);
  expect(await chess(page, (api) => api.strategicFitMetadata().resolutions)).toHaveLength(1);

  await chess(page, (api) => api.selectStrategicFitProfile("versatile"));
  await expect
    .poll(() =>
      chess(page, (api) => api.strategicFitLifecycle().current_result?.reanalysis?.trigger ?? null),
    )
    .toBe("profile-change");
  await expect(restoredDialog.locator("[data-analysis-state='completed']")).toBeVisible();
});

test("review completion blocks unreviewed findings, exports provenance, and records reopen history", async ({
  page,
}) => {
  const { dialog, before, pathBefore } = await bootstrap(page);
  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "overview");
  const review = dialog.locator("[data-review-state]");
  await expect(review).toHaveAttribute("data-review-state", "incomplete");
  await expect(review.getByRole("button", { name: "Complete review" })).toHaveCount(0);
  await expect(review.locator("[data-unreviewed-count]")).toHaveAttribute(
    "data-unreviewed-count",
    "3",
  );

  await chess(page, (api) => {
    for (const suffix of ["10", "12"]) {
      api.upsertStrategicFitResolution({
        resolution_id: `resolution:review:${suffix}`,
        finding_id: `finding:${suffix}`,
        semantic_finding_id: `semantic:finding:${suffix}`,
        state: "defer",
        note: `Deferred review finding ${suffix}.`,
        references: {
          position_ids: ["position:e7550032f70614fc"],
          decision_ids: ["decision:e4e5e82a5c33c5ff"],
          route_ids: ["route:d0915031cdecff76"],
          source_san_paths: [["e4", "c5", "c3", "Nf6"]],
        },
      });
    }
  });
  await expect(dialog.locator("[data-analysis-state='stale']")).toBeVisible();
  await dialog.getByRole("button", { name: "Retry analysis" }).click();
  await expect(review.locator("[data-unreviewed-count]")).toHaveAttribute(
    "data-unreviewed-count",
    "1",
  );

  const deferFinding = async (findingId: string) => {
    const beforeRequest = await chess(
      page,
      (api) => api.strategicFitLifecycle().current_result?.request_id ?? null,
    );
    await showStage(page, "findings");
    await queue.locator(`[data-finding-id='${findingId}'] [data-finding-select]`).click();
    await showStage(page, "resolution");
    const actions = dialog.locator(`[data-resolution-finding-id='${findingId}']`);
    await actions.getByRole("radio", { name: /Defer/ }).check();
    await actions.getByRole("button", { name: "Save resolution" }).click();
    await expect
      .poll(() =>
        chess(page, (api) => api.strategicFitLifecycle().current_result?.request_id ?? null),
      )
      .not.toBe(beforeRequest);
  };
  await deferFinding("finding:01");

  await expect(review).toHaveAttribute("data-review-state", "ready");
  await showStage(page, "overview");
  await review.getByRole("button", { name: "Complete review" }).click();
  await expect(review).toHaveAttribute("data-review-state", "completed");
  await expect(review.locator("[data-review-summary-id]")).toContainText("revision browser:1");
  await expect(review.locator("[data-review-metric='coverage']")).toContainText("70% → 70%");

  const downloadEvent = page.waitForEvent("download");
  await review.getByRole("button", { name: "Save review summary JSON" }).click();
  const artifact = JSON.parse(await downloadText(await downloadEvent));
  expect(artifact.artifact_kind).toBe("chess-mcp/strategic-fit-review-summary");
  expect(artifact.summary.repertoire_revision).toBe("browser:1");
  expect(artifact.summary.source_report_provenance.generated_at).toBe("2026-07-18T00:00:00.000Z");
  expect(artifact.summary.deferred_semantic_finding_ids).toEqual([
    "semantic:finding:01",
    "semantic:finding:05",
    "semantic:finding:10",
    "semantic:finding:12",
  ]);

  await review.getByRole("button", { name: "Reopen semantic:finding:01" }).click();
  await expect
    .poll(() =>
      chess(page, (api) => api.strategicFitLifecycle().current_result?.reanalysis?.trigger ?? null),
    )
    .toBe("resolution-change");
  await expect(review).toHaveAttribute("data-review-state", "incomplete");
  await review.getByText(/Review history/).click();
  await expect(review.locator("[data-history-state='reopened']")).toBeVisible();
  await showStage(page, "overview");
  await expect(review.getByRole("button", { name: "Complete review" })).toHaveCount(0);
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
});

test("training items persist semantic references, keep findings visible, and export legal basic drills", async ({
  page,
}) => {
  const { dialog, before, pathBefore } = await bootstrap(page);
  const initialVersion = await chess(page, (api) => api.version());
  const initialDirty = await chess(page, (api) => api.dirty());
  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  const first = queue.locator("[data-finding-id='finding:01']");
  await showStage(page, "findings");
  await first.locator("[data-finding-select]").click();

  await showStage(page, "resolution");
  const training = dialog.locator("[data-training-finding-id='finding:01']");
  await expect(training).toBeVisible();
  await training
    .getByLabel("Optional training notes")
    .fill("Practice Nf3 from the matched checkpoints.");
  await training.getByRole("button", { name: "Create training item" }).click();
  await expect
    .poll(() =>
      chess(page, (api) => api.strategicFitLifecycle().current_result?.reanalysis?.trigger ?? null),
    )
    .toBe("resolution-change");
  await showStage(page, "findings");
  await first.locator("[data-finding-select]").click();
  await showStage(page, "resolution");
  await expect(dialog.locator("[data-training-finding-id='finding:01']")).toContainText(
    "Semantic positions2",
  );
  await showStage(page, "findings");
  await expect(first.locator(".strategic-fit-finding-resolution")).toHaveText(
    "Train as an exception",
  );
  await expect(first).toBeVisible();
  await expect(
    dialog.locator("[data-overview-item='unresolved-findings'] [data-overview-value]"),
  ).toHaveText("2");

  const persisted = await chess(page, (api) => api.strategicFitMetadata());
  expect(persisted.training_references).toHaveLength(1);
  expect(persisted.training_references[0].references.position_ids).toEqual([
    "position:5022598b73716fd2",
    "position:e7550032f70614fc",
  ]);
  expect(persisted.resolutions).toMatchObject([
    {
      state: "train-as-exception",
      semantic_finding_id: "semantic:finding:01",
      note: "Practice Nf3 from the matched checkpoints.",
      linked_training_ids: [persisted.training_references[0].training_id],
    },
  ]);
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
  expect(await chess(page, (api) => api.version())).toBe(initialVersion);
  expect(await chess(page, (api) => api.dirty())).toBe(initialDirty);

  await showStage(page, "resolution");
  const downloadEvent = page.waitForEvent("download");
  await training.getByRole("button", { name: "Save basic drill JSON" }).click();
  const download = await downloadEvent;
  const artifact = JSON.parse(await downloadText(download));
  expect(artifact.artifact_kind).toBe("chess-mcp/strategic-fit-basic-drill");
  expect(artifact.drills).toEqual(
    expect.arrayContaining([
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
    ]),
  );

  await chess(page, (api) => api.flushStrategicFitMetadata());
  await page.reload();
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await page.getByRole("button", { name: "Open Strategic Fit" }).click();
  const restored = page.getByRole("dialog", { name: "Strategic Fit" });
  await restored.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(restored.locator("[data-analysis-state='completed']")).toBeVisible();
  const restoredQueue = restored
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await restoredQueue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await showStage(page, "resolution");
  await expect(restored.locator("[data-training-finding-id='finding:01']")).toContainText(
    "Training item saved",
  );
  await expect(restored.locator("[data-training-record-id]")).toHaveAttribute(
    "data-training-record-id",
    persisted.training_references[0].training_id,
  );
});

test("cohort adjustments preview exact impact, persist metadata-only, reanalyze, reset, and block stale confirmation", async ({
  page,
}) => {
  const { dialog, before, pathBefore } = await bootstrap(page);
  const initialVersion = await chess(page, (api) => api.version());
  const initialDirty = await chess(page, (api) => api.dirty());
  const initialPreview = await chess(page, (api) => JSON.stringify(api.preview()));
  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  const selectFirst = async () => {
    await showStage(page, "findings");
    await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
    await showStage(page, "resolution");
    await expect(dialog.locator("[data-cohort-editor]")).toBeVisible();
    return dialog.locator("[data-cohort-editor]");
  };

  let editor = await selectFirst();
  await editor.getByRole("button", { name: "Preview adjustment" }).click();
  await expect(editor.getByRole("alert")).toContainText("Choose routes from the cohorts to merge");
  expect(await chess(page, (api) => api.strategicFitMetadata().cohort_overrides)).toEqual([]);

  await editor.locator("input[value='route:d0915031cdecff76']").check();
  await editor.locator("input[value='route:e93bfad5d54ea7a2']").check();
  await editor
    .getByLabel("Optional reason")
    .fill("These routes share one practical repertoire plan.");
  await editor.getByRole("button", { name: "Preview adjustment" }).click();
  const mergePreview = editor.locator(".strategic-fit-cohort-preview");
  await expect(mergePreview).toContainText("Exact impact before confirmation");
  await expect(mergePreview.locator("dl > div", { hasText: "Current cohorts" })).toContainText("2");
  await expect(mergePreview.locator("dl > div", { hasText: "Proposed cohorts" })).toContainText(
    "1",
  );
  await expect(mergePreview.locator("dl > div", { hasText: "Affected routes" })).toContainText("2");
  await expect(mergePreview).toContainText("route:d0915031cdecff76");
  await expect(mergePreview).toContainText("route:e93bfad5d54ea7a2");
  await expect(mergePreview.locator("dl > div", { hasText: "Current baselines" })).toContainText(
    "2",
  );
  await expect(mergePreview.locator("dl > div", { hasText: "Proposed baselines" })).toContainText(
    "1",
  );
  await expect(mergePreview.locator("dl > div", { hasText: "Current findings" })).toContainText(
    "12",
  );
  await expect(mergePreview.locator("dl > div", { hasText: "Proposed findings" })).toContainText(
    "12",
  );
  expect(await chess(page, (api) => api.strategicFitMetadata().cohort_overrides)).toEqual([]);

  await mergePreview.getByRole("button", { name: "Confirm and analyze again" }).click();
  await expect
    .poll(() => chess(page, (api) => api.strategicFitLifecycle().current_result?.report_id ?? null))
    .toContain(":merge");
  expect(await chess(page, (api) => api.strategicFitMetadata().cohort_overrides)).toMatchObject([
    {
      kind: "merge",
      route_ids: ["route:d0915031cdecff76", "route:e93bfad5d54ea7a2"],
      record_state: "active",
    },
  ]);
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
  await expect
    .poll(() => chess(page, (api) => api.strategicFitLifecycle().current_result?.report_id ?? null))
    .toContain(":automatic");
  expect(await chess(page, (api) => api.strategicFitMetadata().cohort_overrides)).toEqual([]);

  editor = await selectFirst();
  await editor.getByRole("radio", { name: /Rename cohort/ }).check();
  await editor
    .getByRole("textbox", { name: "User-facing name", exact: true })
    .fill("Unified e4 repertoire");
  await editor.getByRole("button", { name: "Preview adjustment" }).click();
  const renamePreview = editor.locator(".strategic-fit-cohort-preview");
  await expect(renamePreview.locator("dl > div", { hasText: "Current cohorts" })).toContainText(
    "cohort:fixture",
  );
  await expect(renamePreview.locator("dl > div", { hasText: "Proposed cohorts" })).toContainText(
    "cohort:fixture",
  );
  await renamePreview.getByRole("button", { name: "Confirm and analyze again" }).click();
  await expect
    .poll(() =>
      chess(page, (api) => api.strategicFitMetadata().cohort_labels[0]?.display_name ?? null),
    )
    .toBe("Unified e4 repertoire");
  await showStage(page, "findings");
  await expect(queue.locator("[data-finding-id='finding:01']")).toContainText(
    "Unified e4 repertoire",
  );
  await chess(page, (api) => api.flushStrategicFitMetadata());

  await page.reload();
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await page.getByRole("button", { name: "Open Strategic Fit" }).click();
  const restored = page.getByRole("dialog", { name: "Strategic Fit" });
  await restored.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(restored.locator("[data-analysis-state='completed']")).toBeVisible();
  const restoredQueue = restored
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await expect(restoredQueue.locator("[data-finding-id='finding:01']")).toContainText(
    "Unified e4 repertoire",
  );
  await showStage(page, "findings");
  await restoredQueue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await showStage(page, "resolution");
  const restoredEditor = restored.locator("[data-cohort-editor]");
  await restoredEditor.getByRole("radio", { name: /Restore automatic cohorts/ }).check();
  await restoredEditor.getByLabel("Saved adjustment to remove").selectOption({ index: 1 });
  await restoredEditor.getByRole("button", { name: "Preview adjustment" }).click();
  await restoredEditor.getByRole("button", { name: "Confirm and analyze again" }).click();
  await expect
    .poll(() => chess(page, (api) => api.strategicFitMetadata().cohort_labels.length))
    .toBe(0);

  await showStage(page, "findings");
  await restoredQueue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await showStage(page, "resolution");
  const staleEditor = restored.locator("[data-cohort-editor]");
  await staleEditor.locator("input[value='route:d0915031cdecff76']").check();
  await staleEditor.locator("input[value='route:e93bfad5d54ea7a2']").check();
  await staleEditor.getByRole("button", { name: "Preview adjustment" }).click();
  await expect(staleEditor.locator(".strategic-fit-cohort-preview")).toBeVisible();
  await chess(page, (api) => api.selectStrategicFitProfile("versatile"));
  await expect
    .poll(() =>
      chess(page, (api) => api.strategicFitLifecycle().current_result?.reanalysis?.trigger ?? null),
    )
    .toBe("profile-change");
  await expect(staleEditor.locator(".strategic-fit-cohort-preview")).toHaveCount(0);
  expect(await chess(page, (api) => api.strategicFitMetadata().cohort_overrides)).toEqual([]);
});

test("comparison boards synchronize canonical milestones and only Go to line navigates", async ({
  page,
}) => {
  const { dialog, before, pathBefore } = await bootstrap(page);
  const initialVersion = await chess(page, (api) => api.version());
  const initialDirty = await chess(page, (api) => api.dirty());
  const initialPreview = await chess(page, (api) => JSON.stringify(api.preview()));
  const initialMetadata = await chess(page, (api) => JSON.stringify(api.strategicFitMetadata()));
  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
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
  await expect(
    comparison.locator("[data-board-role='affected'] .strategic-fit-comparison-board-missing"),
  ).toContainText("Board unavailable at this milestone");

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
  await expect(timeline.locator("[data-causal-event='opponent-divergence']")).toContainText(
    "Opponent divergence",
  );
  await expect(timeline.locator("[data-causal-event='player-decision']")).toContainText(
    "Player decision",
  );
  await expect(timeline.locator("[data-causal-event='irreversible-event']")).toContainText(
    "Irreversible event",
  );
  await expect(timeline.locator("[data-causal-event='first-strategic-difference']")).toContainText(
    "First strategic difference",
  );
  await expect(timeline.locator("[data-causal-event='difference-stable']")).toContainText(
    "Difference becomes stable",
  );
  await expect(timeline.locator("[data-causal-event='transposition']")).toContainText(
    "Transposition",
  );
  await expect(timeline).toContainText("Dotted marker");
  await expect(timeline).toContainText("Striped marker");

  const sourceLine = comparison.getByLabel("Affected source line");
  await sourceLine.selectOption("4");
  const goToLine = comparison.getByRole("button", { name: "Go to line" });
  await expect(goToLine).toBeDisabled();
  await expect(comparison.locator(".strategic-fit-line-navigation code")).toContainText("Bb5 dxe5");
  expect(await comparison.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );

  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.version())).toBe(initialVersion);
  expect(await chess(page, (api) => api.dirty())).toBe(initialDirty);
  expect(await chess(page, (api) => JSON.stringify(api.preview()))).toBe(initialPreview);
  expect(await chess(page, (api) => JSON.stringify(api.strategicFitMetadata()))).toBe(
    initialMetadata,
  );

  await sourceLine.selectOption("3");
  await expect(goToLine).toBeEnabled();
  await goToLine.click();
  expect(await chess(page, (api) => api.currentPath())).toEqual([0, 0, 0, 0]);
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.version())).toBe(initialVersion);
  expect(await chess(page, (api) => api.dirty())).toBe(initialDirty);
  expect(await chess(page, (api) => JSON.stringify(api.preview()))).toBe(initialPreview);
  expect(await chess(page, (api) => JSON.stringify(api.strategicFitMetadata()))).toBe(
    initialMetadata,
  );
});

test("automatic replacement reports clear comparison selection and local route state", async ({
  page,
}) => {
  const { dialog, before, pathBefore } = await bootstrap(page);
  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  const evidencePane = dialog.locator("#strategic-fit-pane-evidence");
  await expect(evidencePane.locator("[data-board-read-only='true']")).toHaveCount(2);
  await evidencePane.getByLabel("Affected branch route").selectOption("route:e93bfad5d54ea7a2");
  await evidencePane.getByLabel("Strategic milestone").selectOption("central-resolution");
  await expect(evidencePane.locator(".strategic-fit-comparison-sync-status")).toHaveAttribute(
    "data-milestone-state",
    "incomplete",
  );

  await chess(page, (api) => api.selectStrategicFitProfile("familiar-plans"));
  await expect
    .poll(() =>
      chess(page, (api) => api.strategicFitLifecycle().current_result?.reanalysis?.trigger ?? null),
    )
    .toBe("profile-change");
  await expect(evidencePane.locator("[data-evidence-finding-id]")).toHaveCount(0);

  const refreshedQueue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await refreshedQueue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await showStage(page, "findings");
  await expect(
    refreshedQueue.locator("[data-finding-id='finding:01'] [data-finding-changed-evidence='true']"),
  ).toContainText("Review this finding again");
  await expect(evidencePane.locator(".strategic-fit-comparison-sync-status")).toHaveAttribute(
    "data-milestone-key",
    "opening-exit",
  );
  await expect(evidencePane.getByLabel("Affected branch route")).toHaveValue(
    "route:d0915031cdecff76",
  );
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
});

test("Black repertoire evidence labels every engine value from the repertoire point of view", async ({
  page,
}) => {
  const { dialog, before, pathBefore } = await bootstrap(page, "black");
  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();

  const evidencePane = dialog.locator("#strategic-fit-pane-evidence");
  await expect(evidencePane).toBeFocused();
  const evidence = evidencePane.locator("[data-evidence-finding-id='finding:01']");
  await expect(evidence).toContainText("The line is objectively sound for the Black repertoire.");
  await expect(evidence.getByText("White repertoire POV evaluation", { exact: true })).toHaveCount(
    0,
  );
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

test("overview intents filter only the current report queue and can return to all findings", async ({
  page,
}) => {
  // The overview's drill-in lives on the Overview stage, and taking it moves to the queue.
  const { dialog, before } = await bootstrap(page, "white", false, "overview");
  await dialog.getByRole("button", { name: "Review opponent-forced findings" }).click();

  const pane = dialog.locator("#strategic-fit-pane-findings");
  await expect(pane).toHaveAttribute("data-queue-filter", "classification:forced-diversity");
  const queue = pane.getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await expect(queue.getByRole("status")).toContainText("Review opponent-forced findings");
  await expect(queue.locator("[data-finding-id]")).toHaveCount(2);
  for (const classification of await queue.locator("[data-finding-id]").all()) {
    await expect(classification).toHaveAttribute("data-finding-classification", "forced-diversity");
  }

  await showStage(page, "findings");
  await queue.getByRole("button", { name: "Show all report findings" }).click();
  await expect(pane).toHaveAttribute("data-queue-filter", "none");
  await expect(queue.locator(".strategic-fit-queue-summary p")).toContainText(
    "of 12 matching findings",
  );

  await dialog.getByRole("button", { name: "Return to repertoire" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Open Strategic Fit" }).click();
  const reopened = page.getByRole("dialog", { name: "Strategic Fit" });
  const reopenedQueue = reopened
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await expect(reopenedQueue).toHaveAttribute("data-queue-status", "ready");
  await expect(reopenedQueue.locator("[data-finding-id]")).toHaveCount(6);
  await expect(reopenedQueue.locator(".strategic-fit-queue-summary p")).toContainText(
    "of 12 matching findings",
  );
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
  await showStage(page, "findings");
  await expect(queue.locator("[data-finding-id]")).toHaveCount(6);
  await expect(queue.getByLabel("Sort findings")).toBeVisible();
  expect(await pane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await showStage(page, "findings");
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
  expect(await evidencePane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
});

test("phone resolution controls are keyboard-operable, accessible, and touch-sized", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { dialog, before, pathBefore } = await bootstrap(page);
  await dialog.getByRole("tab", { name: "Findings" }).click();
  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  const resolutionTab = dialog.getByRole("tab", { name: "Resolution" });
  await resolutionTab.focus();
  await page.keyboard.press("Enter");
  await expect(resolutionTab).toHaveAttribute("aria-selected", "true");
  const pane = dialog.locator("#strategic-fit-pane-resolution");
  await showStage(page, "resolution");
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
  await expect
    .poll(() =>
      chess(page, (api) => api.strategicFitLifecycle().current_result?.reanalysis?.trigger ?? null),
    )
    .toBe("resolution-change");
  await dialog.getByRole("tab", { name: "Findings" }).click();
  await showStage(page, "findings");
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

test("phone can complete the full review journey with the keyboard only and return safely", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFindingWorkerFixture(page);
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await chess(page, (api) => api.loadPgn("1. e4 e5 2. Nf3 Nc6 *", "keyboard-review.pgn"));
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");

  const opener = page.getByRole("button", { name: "Open Strategic Fit" });
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
  for (
    let index = 0;
    index < 6 && !(await overviewTab.evaluate((element) => element === document.activeElement));
    index++
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(overviewTab).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const findingsTab = dialog.getByRole("tab", { name: "Findings" });
  await expect(findingsTab).toBeFocused();
  await expect(dialog.locator("#strategic-fit-pane-findings")).toBeVisible();

  const firstFinding = dialog.locator("[data-finding-id='finding:01'] [data-finding-select]");
  for (
    let index = 0;
    index < 12 && !(await firstFinding.evaluate((element) => element === document.activeElement));
    index++
  ) {
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
  for (
    let index = 0;
    index < 8 && !(await sourceLine.evaluate((element) => element === document.activeElement));
    index++
  ) {
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
  expect(
    await chess(page, (api) => ({
      pgn: api.toPgn(),
      version: api.version(),
      dirty: api.dirty(),
      preview: JSON.stringify(api.preview()),
      metadata: JSON.stringify(api.strategicFitMetadata()),
    })),
  ).toEqual(settledBefore);

  const evidenceTab = dialog.getByRole("tab", { name: "Evidence" });
  for (
    let index = 0;
    index < 8 && !(await evidenceTab.evaluate((element) => element === document.activeElement));
    index++
  ) {
    await page.keyboard.press("Shift+Tab");
  }
  await expect(evidenceTab).toBeFocused();
  await page.keyboard.press("Home");
  await expect(overviewTab).toBeFocused();
  const close = dialog.getByRole("button", { name: "Return to repertoire" });
  for (
    let index = 0;
    index < 6 && !(await close.evaluate((element) => element === document.activeElement));
    index++
  ) {
    await page.keyboard.press("Shift+Tab");
  }
  await expect(close).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test(
  "completed desktop and phone review pass accessibility, overflow, and visual baselines",
  { tag: "@visual" },
  async ({ page }) => {
    const { dialog } = await bootstrap(page);
    const firstFinding = dialog.locator("[data-finding-id='finding:01'] [data-finding-select]");
    await firstFinding.click();
    const evidencePane = dialog.locator("#strategic-fit-pane-evidence");
    const expert = evidencePane.locator(".strategic-fit-evidence-expert");

    // The cohort editor's focus ring is the control under test here, and it lives on the
    // resolution stage; the screenshots below are taken back on the evidence stage.
    await showStage(page, "resolution");
    const close = dialog.getByRole("button", { name: "Return to repertoire" });
    await close.focus();
    // The stage's last control is the review loop's forward step, which sits after the resolution
    // blocks because that is where the reader finishes deciding; the cohort editor is the one
    // before it.
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.locator("[data-resolution-next-finding]")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    const previewAdjustment = dialog.getByRole("button", { name: "Preview adjustment" });
    await expect(previewAdjustment).toBeFocused();
    expect(
      await previewAdjustment.evaluate((element) => {
        const style = getComputedStyle(element);
        return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 2;
      }),
    ).toBe(true);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();

    await showStage(page, "evidence");
    await expert.locator("summary").click();
    await evidencePane
      .getByRole("combobox", {
        name: "Affected source line",
        exact: true,
      })
      .selectOption("4");
    await expectBasicAccessibility(dialog);
    expect(await contrastViolations(dialog)).toEqual([]);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    expect(
      await evidencePane.evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await expect(dialog).toHaveScreenshot("strategic-fit-review-desktop.png", {
      animations: "disabled",
      caret: "hide",
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog.getByRole("tab", { name: "Evidence" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(dialog.locator(".strategic-fit-workspace-pane:visible")).toHaveCount(1);
    await expectBasicAccessibility(dialog);
    expect(await touchTargetViolations(dialog)).toEqual([]);
    expect(await contrastViolations(dialog)).toEqual([]);
    expect(
      await evidencePane.evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await expect(dialog).toHaveScreenshot("strategic-fit-review-phone.png", {
      animations: "disabled",
      caret: "hide",
    });
  },
);

test("Replacement Lab opens only from an actionable current finding and closes without mutation", async ({
  page,
}) => {
  const { dialog, before, pathBefore } = await bootstrap(page, "white", true);
  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await showStage(page, "resolution");
  const action = dialog
    .locator("[data-resolution-finding-id='finding:01']")
    .getByRole("button", { name: "Open Replacement Lab" });
  await expect(action).toBeEnabled();
  await action.click();

  const lab = page.getByRole("dialog", { name: "Replacement Lab" });
  await expect(lab).toBeVisible();
  // WP-007 AC-7 (UX-045): the workspace behind the Lab was aria-hidden but still interactive.
  const workspace = page.locator(".strategic-fit-workspace");
  await expect(workspace).toHaveAttribute("aria-hidden", "true");
  await expect(workspace).toHaveJSProperty("inert", true);
  await expect(lab).toContainText("Different center plan");
  await expect(lab).toContainText("Findingfinding:01");
  await expect(lab).toContainText("Semantic findingsemantic:finding:01");
  await expect(lab).toContainText("User verdicts use White repertoire POV");
  const pivot = lab.getByRole("radio", { name: /Nf3 · ply 3/ });
  await expect(pivot).not.toBeChecked();
  await pivot.check();
  await expect(lab.getByRole("button", { name: "Confirm semantic pivot" })).toBeEnabled();
  await expect(lab.getByRole("checkbox", { name: /Existing preparation/ })).toBeChecked();
  await expect(
    lab.getByRole("checkbox", { name: /Structurally similar preparation/ }),
  ).toBeDisabled();
  const depth = lab.getByRole("spinbutton", { name: "Engine depth" });
  await depth.fill("12");
  await expect(depth).toHaveValue("12");
  await lab.getByRole("button", { name: "Confirm semantic pivot" }).click();
  await lab.getByRole("button", { name: "Generate and stage previews" }).click();
  const cancel = lab.getByRole("button", { name: "Cancel generation" });
  await expect(cancel).toBeVisible();
  await expect(lab.getByRole("heading", { name: "Generating candidates" })).toBeVisible();
  await cancel.click();
  await expect(lab).toContainText("Generation cancelled");
  await expect(lab.getByRole("button", { name: "Retry generation" })).toBeVisible();
  await lab.getByRole("button", { name: "Close lab" }).click();
  await expect(lab).toHaveCount(0);
  await expect(action).toBeFocused();
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);

  await showStage(page, "findings");
  await queue.getByRole("button", { name: "Next findings" }).click();
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:10'] [data-finding-select]").click();
  await showStage(page, "resolution");
  const forced = dialog.locator("[data-resolution-finding-id='finding:10']");
  await expect(forced.getByRole("button", { name: "Open Replacement Lab" })).toBeDisabled();
  await expect(forced).toContainText("This difference is forced");
});

test("Black Replacement Lab is keyboard-contained, touch-sized, and transient across reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { dialog, before } = await bootstrap(page, "black", true);
  await dialog.getByRole("tab", { name: "Findings" }).click();
  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await dialog.getByRole("tab", { name: "Resolution" }).click();
  await showStage(page, "resolution");
  const action = dialog
    .locator("[data-resolution-finding-id='finding:01']")
    .getByRole("button", { name: "Open Replacement Lab" });
  await action.click();

  const lab = page.getByRole("dialog", { name: "Replacement Lab" });
  await expect(lab.locator("[data-repertoire-color='black']")).toContainText(
    "Black repertoire POV",
  );
  await expect(lab).toContainText("White POV");
  const pivot = lab.getByRole("radio", { name: /e5 · ply 2/ });
  await expect(pivot).not.toBeChecked();
  await pivot.check();
  expect(await lab.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await touchTargetViolations(lab)).toEqual([]);

  const close = lab.getByRole("button", { name: "Close lab" });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  expect(await lab.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(lab).toHaveCount(0);
  await expect(action).toBeFocused();
  expect(await chess(page, (api) => api.toPgn())).toBe(before);

  await page.reload();
  await expect(page.getByRole("dialog", { name: "Replacement Lab" })).toHaveCount(0);
});

/**
 * WP-033 AC-5: the workspace and the lab are both on the Dialog primitive, so Escape must close the
 * lab first and leave the workspace open. This is the ordering that breaks if only one of the two
 * surfaces is migrated: every dialog listens on document in the capture phase, and the outer one
 * registered first, so without the primitive's nesting stack the workspace would answer instead.
 */
test("Escape closes the nested Replacement Lab before the workspace behind it", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { dialog } = await bootstrap(page, "white", true);
  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await showStage(page, "resolution");
  await dialog
    .locator("[data-resolution-finding-id='finding:01']")
    .getByRole("button", { name: "Open Replacement Lab" })
    .click();

  const lab = page.getByRole("dialog", { name: "Replacement Lab" });
  await expect(lab).toBeVisible();

  // First Escape: the lab closes, the workspace survives.
  await page.keyboard.press("Escape");
  await expect(lab).toHaveCount(0);
  await expect(dialog).toBeVisible();

  // Second Escape: now the workspace itself closes, proving the stack popped correctly.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("Replacement comparison synchronizes accessible table and Pareto selection without mutation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { dialog, before, pathBefore } = await bootstrap(page, "white", true);
  const stateBefore = await chess(page, (api) => ({
    version: api.version(),
    dirty: api.dirty(),
    preview: JSON.stringify(api.preview()),
  }));
  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await showStage(page, "resolution");
  await dialog
    .locator("[data-resolution-finding-id='finding:01']")
    .getByRole("button", { name: "Open Replacement Lab" })
    .click();

  const lab = page.getByRole("dialog", { name: "Replacement Lab" });
  await chess(
    page,
    (api, result) => api.setReplacementLabResultForTesting(result),
    replacementComparisonFixture(),
  );
  await expect(
    page.locator(
      "[data-replacement-lab-status='complete'], [data-replacement-lab-status='partial']",
    ),
  ).toBeVisible();

  const table = lab.getByRole("table", { name: /Candidate comparison/ });
  await expect(table).toBeVisible();
  await expect(table).toContainText("never means one aggregate best candidate");
  await expect(table.locator("[data-best], [aria-label*='best candidate' i]")).toHaveCount(0);
  const candidateButton = table.locator("tbody th button").first();
  const candidateId = await candidateButton.locator("code").textContent();
  expect(candidateId).toBeTruthy();
  await candidateButton.focus();
  await page.keyboard.press("Enter");
  await expect(candidateButton).toHaveAttribute("aria-pressed", "true");
  const chartPoint = lab.locator(`.replacement-pareto-point[data-candidate-id='${candidateId}']`);
  await expect(chartPoint).toHaveAttribute("aria-pressed", "true");
  await chartPoint.focus();
  await page.keyboard.press("Space");
  await expect(candidateButton).toHaveAttribute("aria-pressed", "true");
  await expect(lab.getByText("Selected by stable candidate identity")).toBeVisible();
  await expect(lab.getByRole("heading", { name: "Canonical strategic axes" })).toBeVisible();
  await expect(lab.getByRole("heading", { name: "Complete proposed subtree" })).toBeVisible();
  await expect(lab).toContainText("White-POV engine transport");
  expect(
    await lab.evaluate((element) =>
      [...element.querySelectorAll("*")].every((child) => {
        const style = getComputedStyle(child);
        return style.animationDuration === "0s" && style.transitionDuration === "0s";
      }),
    ),
  ).toBe(true);
  await expect(table.locator("caption")).toContainText("Candidate comparison");
  await expect(table.locator("thead th[scope='col']")).toHaveCount(8);
  await expect(table.locator("tbody th[scope='row']")).toHaveCount(3);
  await expect(table.locator("tbody th button").nth(1)).not.toHaveAttribute("aria-controls");
  await expect(table.locator("tbody th button").nth(2)).not.toHaveAttribute("aria-controls");
  expect(await contrastViolations(lab)).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(lab.locator(".replacement-pareto-plot")).toBeHidden();
  await expect(lab.getByRole("list", { name: "Pareto chart mobile fallback" })).toBeVisible();
  expect(await lab.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await touchTargetViolations(lab)).toEqual([]);

  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
  expect(
    await chess(page, (api) => ({
      version: api.version(),
      dirty: api.dirty(),
      preview: JSON.stringify(api.preview()),
    })),
  ).toEqual(stateBefore);
});

test("staged change review is revision-bound, accessible, responsive, and non-mutating before confirmation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  const { dialog, before, pathBefore } = await bootstrap(page, "black", true);
  const stateBefore = await chess(page, (api) => ({
    version: api.version(),
    dirty: api.dirty(),
    preview: JSON.stringify(api.preview()),
  }));
  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await showStage(page, "resolution");
  await dialog
    .locator("[data-resolution-finding-id='finding:01']")
    .getByRole("button", { name: "Open Replacement Lab" })
    .click();
  const lab = page.getByRole("dialog", { name: "Replacement Lab" });
  await chess(
    page,
    (api, result) => api.setReplacementLabResultForTesting(result),
    replacementComparisonFixture("black"),
  );
  const candidate = lab
    .getByRole("table", { name: /Candidate comparison/ })
    .locator("tbody th button")
    .first();
  await candidate.click();
  await chess(
    page,
    (api, review) => api.setReplacementLabReviewForTesting(review),
    replacementChangeReviewFixture("black"),
  );

  const review = lab.locator(".replacement-change-review");
  await expect(review).toBeVisible();
  await expect(review.getByRole("heading", { name: "Review exact atomic change" })).toBeVisible();
  await expect(review.getByRole("radio", { name: /Archive then prune old line/ })).toBeChecked();
  await expect(review).toContainText("archive:e2e:old-line");
  await expect(review).toContainText("Long exact annotation retained");
  await expect(review).toContainText("Exact additions");
  await expect(review).toContainText("Exact links");
  await expect(review.getByRole("list", { name: "Affected descendant paths" })).toBeVisible();
  await expect(review).toContainText("Training burden");
  await expect(review).toContainText("Partial personal training evidence retained");
  await expect(review).toContainText("Black repertoire POV before");
  await expect(review).toContainText("White-POV engine transport before");
  await expect(
    review.getByRole("table", { name: "Exact canonical tree statistics" }),
  ).toBeVisible();
  await expect(review.getByRole("table", { name: /Exact metric deltas/ })).toBeVisible();
  await expect(review.locator("[data-operation-kind='archive-subtree']")).toBeVisible();
  await expect(review.locator("[data-operation-kind='prune-subtree']")).toBeVisible();
  await expect(review.locator("[data-check-status='warning']")).toBeVisible();
  await expect(review.locator("[data-risk-status='open']")).toBeVisible();
  const confirmation = review.getByRole("checkbox", { name: /I confirm document revision 7/ });
  const accept = review.getByRole("button", { name: "Accept one atomic change at revision 7" });
  await expect(accept).toBeDisabled();
  await confirmation.focus();
  await page.keyboard.press("Space");
  await expect(accept).toBeEnabled();
  expect(
    await review.evaluate((element) =>
      [...element.querySelectorAll("*")].every((child) => {
        const style = getComputedStyle(child);
        return style.animationDuration === "0s" && style.transitionDuration === "0s";
      }),
    ),
  ).toBe(true);
  expect(await contrastViolations(review)).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await review.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await touchTargetViolations(review)).toEqual([]);
  await review.getByRole("button", { name: "Reject preview" }).click();
  await expect(review).toContainText("Preview rejected without mutation");
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
  expect(
    await chess(page, (api) => ({
      version: api.version(),
      dirty: api.dirty(),
      preview: JSON.stringify(api.preview()),
    })),
  ).toEqual(stateBefore);
});

test("resolution proof stays claimless before rescan, binds post-commit report evidence, and blocks stale undo without mutation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  const { dialog, before, pathBefore } = await bootstrap(page, "black", true);
  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await showStage(page, "resolution");
  await dialog
    .locator("[data-resolution-finding-id='finding:01']")
    .getByRole("button", { name: "Open Replacement Lab" })
    .click();
  const lab = page.getByRole("dialog", { name: "Replacement Lab" });
  await chess(
    page,
    (api, result) => api.setReplacementLabResultForTesting(result),
    replacementComparisonFixture("black"),
  );
  await lab
    .getByRole("table", { name: /Candidate comparison/ })
    .locator("tbody th button")
    .first()
    .click();
  const acceptedReview = replacementChangeReviewFixture("black");
  await chess(
    page,
    (api, review) =>
      api.setReplacementLabReviewForTesting({
        ...review,
        status: "accepted",
        stage: {
          ...review.stage,
          status: "accepted",
          result_status: "accepted",
          accepted_revision: api.version(),
        },
      }),
    acceptedReview,
  );
  const documentId = (await chess(page, (api) => api.documentId())) as string;
  const version = (await chess(page, (api) => api.version())) as number;

  const proof = lab.locator(".replacement-resolution-proof");
  await chess(
    page,
    (api, fixture) => api.setResolutionProofForTesting(fixture),
    resolutionProofFixture(documentId, version + 1, "black"),
  );
  await expect(proof).toBeVisible();
  await expect(proof.getByRole("heading", { name: "Check what changed" })).toBeVisible();
  await expect(proof).toHaveAttribute("data-proof-status", "superseded");
  await expect(proof).toContainText(
    "No success or resolution claim is made before a completed rescan",
  );
  await expect(proof).toContainText(`Another edit moved the document to revision ${version}`);

  await chess(
    page,
    (api, fixture) => api.setResolutionProofForTesting(fixture),
    resolutionProofFixture(documentId, version, "black"),
  );
  await expect(proof).toHaveAttribute("data-proof-status", "proven");
  await expect(proof.locator(".replacement-proof-outcome")).toHaveAttribute(
    "data-proof-outcome",
    "still-open",
  );
  await expect(proof).toContainText("Still open.");
  await expect(proof).toContainText("it remains unresolved");
  const claims = proof.getByRole("table", { name: "Post-commit report metric claims" });
  await expect(claims).toBeVisible();
  await expect(proof).toContainText(
    "Every value comes from complete reports, not from staged predictions",
  );
  await expect(proof).toContainText(`report:findings:browser:${version}`);
  await expect(claims).toContainText("unavailable: no pre-change report was retained");
  await expect(claims).toContainText("70.0%");
  await expect(proof).toContainText("Black repertoire POV");
  await expect(proof).toContainText("White POV");

  expect(
    await proof.evaluate((element) =>
      [...element.querySelectorAll("*")].every((child) => {
        const style = getComputedStyle(child);
        return style.animationDuration === "0s" && style.transitionDuration === "0s";
      }),
    ),
  ).toBe(true);
  expect(await contrastViolations(proof)).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await proof.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await touchTargetViolations(proof)).toEqual([]);

  const undoButton = proof.getByRole("button", { name: "Undo this accepted change" });
  await expect(undoButton).toBeEnabled();
  await undoButton.click();
  await expect(proof).toHaveAttribute("data-proof-status", "undo-blocked");
  await expect(proof).toContainText("undo-unavailable");
  await expect(proof).toContainText("Undo was rejected without mutation");
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);
  expect(await chess(page, (api) => api.version())).toBe(version);
});

/**
 * WP-035 — the Review/Redesign split validation checkpoint.
 *
 * PD-5 fixes the product decision to *no split*: one workspace, not two focused modes. These two
 * tests are that decision's automated evidence rather than a research study. They drive both
 * journeys through the single workspace and record a machine-readable trace of every transition.
 *
 * Every transition asserts stage-state equality (the visible indicator equals the application's own
 * stage), that exactly one stage is marked current, and that no resolution control renders twice —
 * the duplicate-render regression WP-033 removed, and the strongest single piece of evidence that
 * one workspace is not overloaded.
 *
 * Scope note on the redesign journey. It ends at a revision-bound, confirmable atomic acceptance,
 * not at a mutated repertoire. Acceptance validates a nine-link identity chain
 * (`strategic-fit-changes.ts:410`) whose tree and metadata identities are hashes of the live
 * document, and whose change set must apply to the live tree. Only `stageChangeSet` can produce
 * those, from a change set constructed by `packages/chess-tools` against that exact tree — neither
 * is reachable from a browser test without adding a production seam, which is outside this
 * package's `docs/`-only scope. The applied outcome is therefore proven where the machinery
 * actually lives: `apps/ui/test/strategic-fit-changes.test.ts` stages through the real controller
 * and asserts the revision increments by exactly one. These tests prove the reachability and
 * safety of the redesign path; that test proves the apply. Neither claims the other's evidence.
 */
const WP035_CONTROL_SELECTORS = [
  "[data-resolution-finding-id]",
  ".strategic-fit-train-exception",
  ".strategic-fit-cohort-editor",
] as const;

interface Wp035Lifecycle {
  current_result?: { request_id?: string } | null;
}

interface Wp035Transition {
  sequence: number;
  event: string;
  applicationState: string;
  projectedStage: string;
  observed: {
    storeStage: string;
    currentIndicatorId: string | null;
    currentIndicatorCount: number;
  };
  stageStateEqual: boolean;
  explicitRedesignAction: boolean;
  redesignOpen: boolean;
  resolutionControlCounts: Record<string, number>;
  duplicateControlCount: number;
  horizontalOverflowPixels: number;
}

interface Wp035Journey {
  id: string;
  transitions: Wp035Transition[];
}

const wp035Journeys: Wp035Journey[] = [];
const wp035Metrics: Record<string, Record<string, number>> = {};

/**
 * Records one transition and asserts its invariants immediately, so a failure names the transition
 * that broke instead of surfacing as a mismatched total at the end of the journey.
 */
async function wp035Record(
  page: Page,
  journey: Wp035Journey,
  event: string,
  applicationState: string,
  projectedStage: string,
  options: { explicitRedesignAction?: boolean } = {},
): Promise<void> {
  const dom = await page.evaluate(
    (selectors) => {
      const workspace = document.querySelector(".strategic-fit-workspace");
      const body = workspace?.querySelector(".strategic-fit-workspace-body");
      const current = workspace?.querySelectorAll("[data-stage-state='current']") ?? [];
      const counts: Record<string, number> = {};
      for (const selector of selectors)
        counts[selector] = document.querySelectorAll(selector).length;
      return {
        storeStage: body?.getAttribute("data-stage") ?? "",
        currentIndicatorId: current.length === 1 ? (current[0]?.id ?? null) : null,
        currentIndicatorCount: current.length,
        counts,
        overflow: workspace
          ? Math.max(0, Math.round(workspace.scrollWidth - workspace.clientWidth))
          : 0,
        redesignOpen: document.querySelectorAll(".replacement-lab").length > 0,
      };
    },
    WP035_CONTROL_SELECTORS as unknown as string[],
  );

  // Every selector may render at most once; anything above one is a duplicate.
  const duplicateControlCount = Object.values(dom.counts).reduce(
    (total, count) => total + Math.max(0, count - 1),
    0,
  );
  const stageStateEqual =
    dom.storeStage === projectedStage &&
    dom.currentIndicatorCount === 1 &&
    dom.currentIndicatorId === `strategic-fit-stage-${projectedStage}`;

  journey.transitions.push({
    sequence: journey.transitions.length,
    event,
    applicationState,
    projectedStage,
    observed: {
      storeStage: dom.storeStage,
      currentIndicatorId: dom.currentIndicatorId,
      currentIndicatorCount: dom.currentIndicatorCount,
    },
    stageStateEqual,
    explicitRedesignAction: options.explicitRedesignAction ?? false,
    redesignOpen: dom.redesignOpen,
    resolutionControlCounts: dom.counts,
    duplicateControlCount,
    horizontalOverflowPixels: dom.overflow,
  });

  expect(dom.storeStage, `${journey.id}/${event}: stage`).toBe(projectedStage);
  expect(dom.currentIndicatorCount, `${journey.id}/${event}: current stage markers`).toBe(1);
  expect(dom.currentIndicatorId, `${journey.id}/${event}: current stage id`).toBe(
    `strategic-fit-stage-${projectedStage}`,
  );
  expect(duplicateControlCount, `${journey.id}/${event}: duplicate controls`).toBe(0);
  expect(dom.overflow, `${journey.id}/${event}: horizontal overflow`).toBe(0);
}

function wp035Summarize(
  journey: Wp035Journey,
  decisionCount: number,
  confirmableAcceptanceCount: number,
) {
  const metrics = {
    decisionCount,
    confirmableAcceptanceCount,
    transitionCount: journey.transitions.length,
    explicitRedesignEntryCount: journey.transitions.filter((t) => t.explicitRedesignAction).length,
    // A redesign surface that *became* open on a transition nobody asked for. This is the number
    // PD-5 actually rests on: review must never slide into redesign on its own. It counts entries,
    // not presence — the lab legitimately stays open across the transitions that follow.
    implicitRedesignEntryCount: journey.transitions.filter(
      (t, index) =>
        t.redesignOpen &&
        !t.explicitRedesignAction &&
        !(journey.transitions[index - 1]?.redesignOpen ?? false),
    ).length,
    stageStateMismatchCount: journey.transitions.filter((t) => !t.stageStateEqual).length,
    duplicateControlCount: journey.transitions.reduce(
      (total, t) => Math.max(total, t.duplicateControlCount),
      0,
    ),
    maximumHorizontalOverflowPixels: journey.transitions.reduce(
      (total, t) => Math.max(total, t.horizontalOverflowPixels),
      0,
    ),
  };
  wp035Metrics[journey.id] = metrics;
  return metrics;
}

test("WP-035 review journey reaches a decision and never enters redesign", async ({ page }) => {
  const journey: Wp035Journey = { id: "review", transitions: [] };
  wp035Journeys.push(journey);

  const { dialog, before, pathBefore } = await bootstrap(page, "white", false, "overview");
  await wp035Record(page, journey, "analysis-completed", "review-overview", "overview");

  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await wp035Record(page, journey, "finding-selected", "review-evidence", "evidence");

  await showStage(page, "resolution");
  const actions = dialog.locator("[data-resolution-finding-id='finding:01']");
  await actions.getByRole("radio", { name: /Defer/ }).check();
  await wp035Record(page, journey, "decision-chosen", "review-decision", "resolution");

  // Saving a resolution re-runs the analysis, so wait for the new report the way the existing
  // review tests do rather than racing the pane's re-render.
  const requestId = () =>
    chess(
      page,
      (api) => (api.strategicFitLifecycle() as Wp035Lifecycle).current_result?.request_id ?? null,
    );
  const beforeRequest = await requestId();
  await actions.getByRole("button", { name: "Save resolution" }).click();
  await expect.poll(requestId).not.toBe(beforeRequest);
  // Re-selecting the finding after the re-analysis: saving a resolution produces a new report, and
  // the resolution pane renders against the current report's selection.
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await showStage(page, "resolution");
  await expect(dialog.locator("[data-resolution-finding-id='finding:01']")).toHaveAttribute(
    "data-resolution-state",
    "defer",
  );
  await wp035Record(page, journey, "decision-saved", "review-decided", "resolution");

  // Reviewing reaches a decision without mutating the repertoire.
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);

  const metrics = wp035Summarize(journey, 1, 0);
  expect(metrics.explicitRedesignEntryCount).toBe(0);
  expect(metrics.implicitRedesignEntryCount).toBe(0);
  expect(metrics.stageStateMismatchCount).toBe(0);
});

test("WP-035 redesign journey reaches a revision-bound acceptance through one explicit action", async ({
  page,
}) => {
  const journey: Wp035Journey = { id: "redesign", transitions: [] };
  wp035Journeys.push(journey);

  const { dialog, before, pathBefore } = await bootstrap(page, "white", true, "overview");
  await wp035Record(page, journey, "analysis-completed", "review-overview", "overview");

  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await wp035Record(page, journey, "finding-selected", "review-evidence", "evidence");

  // The redesign surface does not exist until the explicit action below opens it.
  const lab = page.getByRole("dialog", { name: "Replacement Lab" });
  await expect(lab).toHaveCount(0);
  await showStage(page, "resolution");
  await dialog
    .locator("[data-resolution-finding-id='finding:01']")
    .getByRole("button", { name: "Open Replacement Lab" })
    .click();
  await expect(lab).toBeVisible();
  await wp035Record(page, journey, "redesign-opened", "redesign-lab-open", "resolution", {
    explicitRedesignAction: true,
  });

  await chess(
    page,
    (api, result) => api.setReplacementLabResultForTesting(result),
    replacementComparisonFixture("white"),
  );
  await lab
    .getByRole("table", { name: /Candidate comparison/ })
    .locator("tbody th button")
    .first()
    .click();
  await wp035Record(page, journey, "candidate-selected", "redesign-candidate", "resolution");

  await chess(
    page,
    (api, review) => api.setReplacementLabReviewForTesting(review),
    replacementChangeReviewFixture("white"),
  );
  const review = lab.locator(".replacement-change-review");
  await expect(review).toBeVisible();
  await wp035Record(page, journey, "change-review-ready", "redesign-review", "resolution");

  // The acceptance is revision-bound and gated: the control names the exact revision it would
  // apply at and stays disabled until that revision is explicitly confirmed.
  const accept = review.getByRole("button", { name: /Accept one atomic change at revision/ });
  await expect(accept).toBeDisabled();
  await review.getByRole("checkbox", { name: /I confirm document revision/ }).check();
  await expect(accept).toBeEnabled();
  await wp035Record(page, journey, "acceptance-confirmable", "redesign-confirmable", "resolution");

  // Reaching the acceptance control mutates nothing; only accepting can, and that path's applied
  // outcome is proven against the real controller in apps/ui/test/strategic-fit-changes.test.ts.
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  expect(await chess(page, (api) => api.currentPath())).toEqual(pathBefore);

  const metrics = wp035Summarize(journey, 0, 1);
  expect(metrics.explicitRedesignEntryCount).toBe(1);
  expect(metrics.implicitRedesignEntryCount).toBe(0);
  expect(metrics.stageStateMismatchCount).toBe(0);
});

test.afterAll(async () => {
  const reportPath = process.env.WP035_REPORT_PATH;
  if (!reportPath || wp035Journeys.length !== 2) return;
  const { writeFile, mkdir } = await import("node:fs/promises");
  const nodePath = await import("node:path");
  const report = {
    schemaVersion: 1,
    workPackage: "WP-035",
    decision: "no-split",
    journeys: wp035Journeys.map((journey) => ({
      id: journey.id,
      metrics: wp035Metrics[journey.id],
      transitions: journey.transitions,
    })),
    recommendation: {
      decision: "retain-one-workspace",
      reason:
        "Both journeys complete in one workspace: review reaches a decision without ever entering redesign, and redesign reaches a revision-bound confirmable acceptance through a single explicit action. The stage indicator equalled the application's own stage at every transition and no resolution control rendered twice.",
      subjectiveClarityClaimed: false,
      appliedOutcomeCoverage:
        "apps/ui/test/strategic-fit-changes.test.ts stages through the real change controller and asserts the document revision increments by exactly one.",
      followUpPackageProposal: null,
    },
  };
  await mkdir(nodePath.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
});

test("a created training item records an attempt only once a move is played on its drill board", async ({
  page,
}) => {
  const { dialog } = await bootstrap(page);
  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();

  await showStage(page, "resolution");
  const training = dialog.locator("[data-training-finding-id='finding:01']");
  await training.getByRole("button", { name: "Create training item" }).click();

  // Creating the item registers targets. It must not invent an attempt: recall evidence may only
  // come from a move the user actually played.
  const afterCreate = await chess(page, (api) => api.strategicFitTrainingPerformance());
  expect(afterCreate.targets.length).toBeGreaterThan(0);
  expect(afterCreate.attempts).toEqual([]);

  // Creating an item triggers reanalysis, which remounts the panel; the finding has to be
  // re-selected before it is on screen again. The training test above relies on the same sequence.
  await expect
    .poll(() =>
      chess(page, (api) => api.strategicFitLifecycle().current_result?.reanalysis?.trigger ?? null),
    )
    .toBe("resolution-change");
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();

  await showStage(page, "resolution");
  const reopened = dialog.locator("[data-training-finding-id='finding:01']");
  await reopened.getByRole("button", { name: /^Drill \d+ position/u }).click();
  const active = reopened.locator(".strategic-fit-drill-active").first();
  await expect(active).toBeVisible();

  // The fixture's first drill is the position after 1. e4 e5 with a prepared Nf3 — one of the two
  // drills the exported artifact asserts above, which pins their content but not their order.
  await expect(active).toHaveAttribute("data-drill-expected", "Nf3");
  await expect(active).toHaveAttribute(
    "data-drill-fen",
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  );
  const board = active.locator(".cg-wrap");
  await expect(board).toBeVisible();
  await expect(board).toHaveClass(/manipulable/u);
  await expect(reopened.locator("[data-drill-locked='false']")).toBeVisible();

  // Still no attempt: rendering a drill is not attempting one.
  const afterOpening = await chess(page, (api) => api.strategicFitTrainingPerformance());
  expect(afterOpening.attempts).toEqual([]);

  // Now play it. This is the whole move → SAN → recall-comparison → recorded-attempt path running
  // in a real browser for the first time; before `helpers/board.ts` existed it was reachable only
  // from the unit tests in test/strategic-fit-drill.test.ts and test/strategic-fit-training.test.ts.
  await dragMove(board, "g1", "f3");

  // Asserted against the store rather than the drill's own result banner, because recording an
  // attempt schedules a reanalysis that unmounts the whole resolution column — the banner is on
  // its way out by the time this runs, and the recorded attempt is the durable evidence anyway.
  await expect
    .poll(() => chess(page, (api) => api.strategicFitTrainingPerformance().attempts.length))
    .toBe(1);
  const [attempt] = (await chess(page, (api) => api.strategicFitTrainingPerformance())).attempts;
  expect(attempt.recalled).toBe(true); // g1f3 is the prepared Nf3
  expect(attempt.response_time_ms).toBeGreaterThan(0);
});

test("a black-to-move drill is playable, and a legal wrong move is recorded as not recalled", async ({
  page,
}) => {
  // A Black repertoire so the drill is Black to move — the case a White fixture cannot reach.
  // `DrillBoard` used to leave chessground's `turnColor` at its "white" default while setting
  // `movable.color` to the side to move, and chessground's `isMovable` demands the two agree: a
  // black piece failed that check, fell through to the premove branch instead, and the drag set a
  // premove that never fires `movable.events.after`. The board looked live and recorded nothing.
  const { dialog } = await bootstrap(page, "black");
  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();

  await showStage(page, "resolution");
  const training = dialog.locator("[data-training-finding-id='finding:01']");
  await training.getByRole("button", { name: "Create training item" }).click();
  await expect
    .poll(() =>
      chess(page, (api) => api.strategicFitLifecycle().current_result?.reanalysis?.trigger ?? null),
    )
    .toBe("resolution-change");
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();

  await showStage(page, "resolution");
  const reopened = dialog.locator("[data-training-finding-id='finding:01']");
  await reopened.getByRole("button", { name: /^Drill \d+ position/u }).click();
  const active = reopened.locator(".strategic-fit-drill-active").first();
  await expect(active).toHaveAttribute("data-drill-expected", "e5");

  const board = active.locator(".cg-wrap");
  await expect(board).toHaveClass(/orientation-black/u);
  await selectSquare(board, "d7");
  // The regression guard: with `turnColor` wrong these are the markers the board offers instead of
  // real destinations, and the piece can only be premoved.
  expect(await premoveSquares(board)).toEqual([]);
  expect((await destinationSquares(board)).sort()).toEqual(["d5", "d6"]);

  // d5 is legal here and is not the prepared e5, which is what separates "recorded a miss" from
  // "recorded nothing": an illegal move would also leave the attempt list empty.
  await dragMove(board, "d7", "d5");
  await expect
    .poll(() => chess(page, (api) => api.strategicFitTrainingPerformance().attempts.length))
    .toBe(1);
  const [attempt] = (await chess(page, (api) => api.strategicFitTrainingPerformance())).attempts;
  expect(attempt.recalled).toBe(false);
});

test("the resolution stage offers the next unresolved finding, closing the review loop", async ({
  page,
}) => {
  const { dialog } = await bootstrap(page);
  const queue = dialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await showStage(page, "findings");
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();

  // Evidence already offers "Record a decision"; before this, Resolution offered nothing, so
  // getting to the next finding meant going back to the stage strip and re-finding your place in
  // a queue the saved finding had just dropped out of.
  await showStage(page, "resolution");
  const next = dialog.locator("[data-resolution-next-finding]");
  await expect(next).toBeVisible();

  // Three findings are unresolved in the fixture report. The one under review is not offered as
  // its own successor, so two remain — the count states the scope the button walks.
  await expect(dialog.locator(".strategic-fit-resolution-next span")).toHaveText("2 remaining");

  await next.click();
  await expect(dialog.locator(".strategic-fit-workspace-body")).toHaveAttribute(
    "data-stage",
    "evidence",
  );

  // Asserted through the resolution pane rather than the queue: the successor may sit on a page the
  // queue has not mounted, and the point is which finding is under review, not which row is drawn.
  await showStage(page, "resolution");
  const actions = dialog.locator("[data-resolution-finding-id]");
  await expect(actions).toHaveCount(1);
  await expect(actions).not.toHaveAttribute("data-resolution-finding-id", "finding:01");
});
