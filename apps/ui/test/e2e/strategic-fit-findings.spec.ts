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

async function installFindingWorkerFixture(page: Page, replacementLabFixture = false) {
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

async function bootstrap(
  page: Page,
  repertoireColor: "white" | "black" = "white",
  replacementLabFixture = false,
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
  return { dialog, before, pathBefore };
}

test("finding queue renders frozen card fields, stable pages, composed filters, and keyboard selection", async ({
  page,
}) => {
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

  await queue.getByRole("button", { name: "Next findings" }).click();
  await expect(queue.locator("[data-finding-id]")).toHaveCount(6);
  await expect(queue.locator("[data-finding-id]").first()).toHaveAttribute(
    "data-finding-id",
    "finding:07",
  );
  await expect(queue.locator(".strategic-fit-queue-summary p")).toContainText("Showing 7–12 of 12");

  await queue.getByLabel("Sort findings").selectOption({ label: "Opening / system" });
  await expect(queue.locator("[data-finding-id]").first()).toHaveAttribute(
    "data-finding-id",
    "finding:04",
  );
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
  const first = queue.locator("[data-finding-id='finding:01']");
  await first.locator("[data-finding-select]").click();

  const actions = dialog.locator("[data-resolution-finding-id='finding:01']");
  await expect(actions).toBeVisible();
  await actions.getByRole("radio", { name: /Keep intentionally/ }).check();
  await actions
    .getByLabel("Optional keep-intentionally reason")
    .selectOption("objectively-strongest");
  await actions.getByLabel("Optional note").fill("Best practical choice for this repertoire.");
  await actions.getByRole("button", { name: "Save resolution" }).click();

  await expect
    .poll(() =>
      chess(page, (api) => api.strategicFitLifecycle().current_result?.reanalysis?.trigger ?? null),
    )
    .toBe("resolution-change");
  await first.locator("[data-finding-select]").click();
  await expect(actions).toHaveAttribute("data-resolution-state", "keep-intentionally");
  await expect(first.locator(".strategic-fit-finding-resolution")).toHaveText("Kept intentionally");
  await expect(
    dialog.locator("[data-overview-item='unresolved-findings'] [data-overview-value]"),
  ).toHaveText("2");
  await dialog.getByRole("button", { name: "Review unresolved findings" }).click();
  await expect(queue.locator("[data-finding-id='finding:01']")).toHaveCount(0);
  await expect(queue.locator(".strategic-fit-queue-summary p")).toContainText(
    "of 2 matching findings · 12 in this report",
  );
  await queue.getByRole("button", { name: "Show all report findings" }).click();
  await expect(first.locator(".strategic-fit-finding-resolution")).toHaveText("Kept intentionally");
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
  await actions.getByRole("button", { name: "Reopen finding" }).click();
  await expect
    .poll(() =>
      chess(page, (api) => api.strategicFitLifecycle().current_result?.request_id ?? null),
    )
    .not.toBe(beforeReopenRequest);
  await first.locator("[data-finding-select]").click();
  await expect(actions).toHaveAttribute("data-resolution-state", "unresolved");
  await expect(first.locator(".strategic-fit-finding-resolution")).toHaveText("Unresolved");
  await expect(
    dialog.locator("[data-overview-item='unresolved-findings'] [data-overview-value]"),
  ).toHaveText("3");
  expect(await chess(page, (api) => api.strategicFitMetadata().resolutions)).toEqual([]);

  const beforeDeferRequest = await chess(
    page,
    (api) => api.strategicFitLifecycle().current_result?.request_id ?? null,
  );
  await actions.getByRole("radio", { name: /Defer/ }).check();
  await actions.getByLabel("Optional note").fill("Review after the next event.");
  await actions.getByRole("button", { name: "Save resolution" }).click();
  await expect
    .poll(() =>
      chess(page, (api) => api.strategicFitLifecycle().current_result?.request_id ?? null),
    )
    .not.toBe(beforeDeferRequest);
  await first.locator("[data-finding-select]").click();
  await expect(actions).toHaveAttribute("data-resolution-state", "defer");
  await expect(first.locator(".strategic-fit-finding-resolution")).toHaveText("Deferred");
  await chess(page, (api) => api.flushStrategicFitMetadata());

  await page.reload();
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await page.getByRole("button", { name: "Open Strategic Fit" }).click();
  const restoredDialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await restoredDialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(restoredDialog.locator("[data-analysis-state='completed']")).toBeVisible();
  const restoredQueue = restoredDialog
    .locator("#strategic-fit-pane-findings")
    .getByRole("region", { name: "Strategic Fit finding queue" });
  await expect(
    restoredQueue.locator("[data-finding-id='finding:01'] .strategic-fit-finding-resolution"),
  ).toHaveText("Deferred");
  await expect(
    restoredDialog.locator("[data-overview-item='unresolved-findings'] [data-overview-value]"),
  ).toHaveText("2");

  await restoredQueue.locator("[data-finding-id='finding:02'] [data-finding-select]").click();
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
    await queue.locator(`[data-finding-id='${findingId}'] [data-finding-select]`).click();
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
  const first = queue.locator("[data-finding-id='finding:01']");
  await first.locator("[data-finding-select]").click();

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
  await first.locator("[data-finding-select]").click();
  await expect(dialog.locator("[data-training-finding-id='finding:01']")).toContainText(
    "Semantic positions2",
  );
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
  await restoredQueue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
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
  await expect(restoredQueue.locator("[data-finding-id='finding:01']")).toContainText(
    "Unified e4 repertoire",
  );
  await restoredQueue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  const restoredEditor = restored.locator("[data-cohort-editor]");
  await restoredEditor.getByRole("radio", { name: /Restore automatic cohorts/ }).check();
  await restoredEditor.getByLabel("Saved adjustment to remove").selectOption({ index: 1 });
  await restoredEditor.getByRole("button", { name: "Preview adjustment" }).click();
  await restoredEditor.getByRole("button", { name: "Confirm and analyze again" }).click();
  await expect
    .poll(() => chess(page, (api) => api.strategicFitMetadata().cohort_labels.length))
    .toBe(0);

  await restoredQueue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
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
  await refreshedQueue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
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
  await expect
    .poll(() =>
      chess(page, (api) => api.strategicFitLifecycle().current_result?.reanalysis?.trigger ?? null),
    )
    .toBe("resolution-change");
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

    const close = dialog.getByRole("button", { name: "Return to repertoire" });
    await close.focus();
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
    await expect(close).toBeFocused();

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
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
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

  await queue.getByRole("button", { name: "Next findings" }).click();
  await queue.locator("[data-finding-id='finding:10'] [data-finding-select]").click();
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
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
  await dialog.getByRole("tab", { name: "Resolution" }).click();
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
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
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
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
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
  await queue.locator("[data-finding-id='finding:01'] [data-finding-select]").click();
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
