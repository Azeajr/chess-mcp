import assert from "node:assert/strict";
import test from "node:test";

import {
  REPLACEMENT_STRATEGIC_SCORE_AXES,
  type ReplacementCandidateScoringResult,
  type ReplacementScoredCandidate,
} from "@chess-mcp/chess-tools";
import {
  buildCandidateComparisonRows,
  buildCandidateSubtreeRoutes,
  formatCanonicalAxisValue,
  resolveCandidateSelection,
} from "../src/components/strategic-fit/CandidateTable.tsx";
import {
  buildReplacementParetoPoints,
  replacementParetoPosition,
} from "../src/components/strategic-fit/ReplacementPareto.tsx";

const version = {
  schema_version: "1.0.0",
  analysis_version: "2.0.0",
  replacement_schema_version: "1.0.0",
} as const;

const source = {
  source_id: "source:comparison:canonical",
  kind: "deterministic-core",
  state: "available",
  version: "2.0.0",
  snapshot: "snapshot:comparison:immutable",
  reason: null,
} as const;

const candidateSource = {
  ...version,
  source_id: "candidate-source:comparison",
  kind: "existing-repertoire-transposition",
  status: "available",
  provider: "repertoire-graph",
  version: "2.0.0",
  snapshot: "snapshot:comparison:immutable",
  reason: null,
  position_ids: ["position:comparison"],
  decision_ids: ["decision:comparison"],
  route_ids: ["route:comparison"],
  details: { retained: true },
  provenance: [source],
} as const;

function contribution(
  axis: (typeof REPLACEMENT_STRATEGIC_SCORE_AXES)[number],
  raw: number | null,
  normalized: number | null,
  state: "available" | "partial" | "unavailable" = "available",
) {
  const lower =
    axis.includes("burden") ||
    axis.includes("cost") ||
    axis === "theory-size" ||
    axis === "new-concepts";
  return {
    analysis_version: "2.0.0",
    axis,
    state,
    normalized_score: normalized,
    raw_value: raw,
    unit: axis === "new-concepts" ? "concepts" : axis === "theory-size" ? "nodes" : "fraction",
    higher_is_better: !lower,
    reason:
      state === "available"
        ? "Canonical available evidence."
        : "Canonical evidence missing or partial.",
    provenance: [source],
  } as const;
}

function scoredCandidate(options: {
  readonly id: string;
  readonly san: string;
  readonly pareto: "pareto-optimal" | "dominated" | "unscored";
  readonly dominatedBy?: readonly string[];
  readonly color?: "white" | "black";
  readonly expansionStatus?: "complete" | "truncated" | "unavailable";
  readonly missingPopularity?: boolean;
  readonly longRouteLength?: number;
}): ReplacementScoredCandidate {
  const color = options.color ?? "white";
  const edgeCount = options.longRouteLength ?? 2;
  const edges = Array.from({ length: edgeCount }, (_, index) => ({
    analysis_version: "2.0.0",
    edge_id: `edge:${options.id}:${index}`,
    from_node_id: `node:${options.id}:${index}`,
    to_node_id: `node:${options.id}:${index + 1}`,
    decision_id: `decision:${options.id}:${index}`,
    san: index === 0 ? options.san : index % 2 === 0 ? `Move${index}` : `Reply${index}`,
    uci: "a2a3",
    mover_color: index % 2 === 0 ? color : color === "white" ? "black" : "white",
    owner: index % 2 === 0 ? "repertoire" : "opponent",
    forcing: index % 7 === 0,
    expected_opponent_frequency: index % 5 === 0 ? null : 0.5,
    source_san_paths: [[options.san]],
    annotation_text: [],
  }));
  const nodes = Array.from({ length: edgeCount + 1 }, (_, index) => ({
    analysis_version: "2.0.0",
    node_id: `node:${options.id}:${index}`,
    kind:
      index === 0
        ? "root"
        : index === edgeCount
          ? "terminal"
          : index % 2 === 0
            ? "repertoire-decision"
            : "opponent-reply",
    position_id: `position:${options.id}:${index}`,
    fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
    ply: index,
    outgoing_edge_ids: index < edgeCount ? [`edge:${options.id}:${index}`] : [],
    source_san_paths: [[options.san]],
    transposition_target_position_id: index === edgeCount ? "position:prepared" : null,
  }));
  const expansionStatus = options.expansionStatus ?? "complete";
  const subtree = {
    ...version,
    subtree_id: `subtree:${options.id}`,
    root_position_id: `position:${options.id}:0`,
    root_node_id: `node:${options.id}:0`,
    nodes,
    edges,
    routes: [
      {
        analysis_version: "2.0.0",
        route_id: `route:${options.id}:complete`,
        node_ids: nodes.map((node) => node.node_id),
        edge_ids: edges.map((edge) => edge.edge_id),
        terminal_node_id: nodes.at(-1)!.node_id,
        termination: expansionStatus === "complete" ? "existing-preparation" : "budget-exhausted",
        expected_opponent_frequency: expansionStatus === "complete" ? 1 : null,
      },
    ],
    strategic_horizon_ply: 48,
    important_reply_count: 4,
    covered_important_reply_count: expansionStatus === "complete" ? 4 : 2,
    forcing_reply_count: 2,
    covered_forcing_reply_count: expansionStatus === "complete" ? 2 : 1,
    unresolved_risk_ids: expansionStatus === "complete" ? [] : [`risk:${options.id}`],
    provenance: [candidateSource],
    status: expansionStatus === "complete" ? "complete" : "truncated",
    completion:
      expansionStatus === "complete"
        ? { kind: "immediate-transposition", target_position_id: "position:prepared" }
        : null,
    truncation_reasons: expansionStatus === "complete" ? [] : ["subtree-node-budget-exhausted"],
  };
  const axes = REPLACEMENT_STRATEGIC_SCORE_AXES.map((axis, index) => {
    if (axis === "popularity" && options.missingPopularity)
      return contribution(axis, null, null, "unavailable");
    if (expansionStatus !== "complete") return contribution(axis, null, null, "partial");
    return contribution(axis, 0.9 - index * 0.05, 0.9 - index * 0.05);
  });
  return {
    ...version,
    candidate_id: options.id,
    request_id: "request:comparison",
    report_id: "report:comparison",
    finding_id: "finding:comparison",
    semantic_finding_id: "semantic-finding:comparison",
    cohort_id: "cohort:comparison",
    repertoire_revision: "browser:42",
    repertoire_color: color,
    state: expansionStatus === "complete" && !options.missingPopularity ? "available" : "partial",
    reason: expansionStatus === "complete" ? null : "Candidate expansion is not complete.",
    expansion: {
      ...version,
      candidate_id: options.id,
      rank: 1,
      seed: {
        ...version,
        candidate_id: options.id,
        rank: 1,
        status: "ready-for-expansion",
        request_id: "request:comparison",
        report_id: "report:comparison",
        finding_id: "finding:comparison",
        semantic_finding_id: "semantic-finding:comparison",
        cohort_id: "cohort:comparison",
        repertoire_revision: "browser:42",
        repertoire_color: color,
        pivot: { owner: "repertoire" },
        san: options.san,
        uci: "a2a3",
        mover_color: color,
        outcome_position_id: `position:${options.id}:1`,
        outcome_position_key: `key:${options.id}`,
        outcome_fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
        existing_preparation: true,
        memory_class: "existing-preparation",
        rank_hint: "low-memory-existing-preparation",
        maximum_database_popularity: options.missingPopularity ? null : 0.75,
        source_kinds: ["existing-repertoire-transposition"],
        source_san_paths: [[options.san]],
        database_evidence_ids: [],
        provenance: [candidateSource],
        expansion: {
          ...version,
          status: "full-subtree-required",
          full_subtree_required: true,
          required_contract: "ReplacementCandidateSubtree",
          reason: "Full subtree required.",
        },
        objective_quality: {},
        engine_evidence_ids: [],
      },
      evidence_item_results:
        expansionStatus === "complete"
          ? []
          : [
              {
                error_code: "subtree-node-budget-exhausted",
                status: "budget-exhausted",
                explanation: "Long subtree hit bounded node budget.",
              },
            ],
      source_results: [],
      omissions:
        expansionStatus === "complete"
          ? []
          : [
              {
                omission_id: `omission:${options.id}`,
                reason: "subtree-node-budget-exhausted",
                explanation: "Remaining continuation is unavailable.",
              },
            ],
      unresolved_risks:
        expansionStatus === "complete"
          ? []
          : [
              {
                analysis_version: "2.0.0",
                risk_id: `risk:${options.id}`,
                kind: "incomplete-expansion",
                status: "open",
                explanation: "Candidate subtree is partial.",
                affected_position_ids: [`position:${options.id}:1`],
                affected_route_ids: [`route:${options.id}:complete`],
                provenance: [source],
              },
            ],
      status: expansionStatus,
      subtree,
    },
    objective_quality: {
      ...version,
      state: "available",
      white_pov_evaluation_cp: 37,
      white_pov_mate_in: null,
      white_pov_best_evaluation_cp: 50,
      white_pov_best_mate_in: null,
      repertoire_pov_evaluation_cp: color === "black" ? -37 : 37,
      repertoire_pov_mate_in: null,
      repertoire_pov_loss_from_best_cp: 13,
      repertoire_pov_verdict: "within-tolerance",
      engine_depth: 24,
      engine_multipv: 3,
      evaluation_uncertainty_cp: 5,
      tactical_volatility: 0.2,
      evaluation_sensitivity_cp: 8,
      forcing_density: 0.1,
      king_safety_risk: 0.1,
      viable_move_width: 3,
      database_performance: null,
      theoretical_status: null,
      reason: null,
      provenance: [source],
    },
    strategic_score: {
      ...version,
      state: expansionStatus === "complete" ? "available" : "partial",
      cohort_id: "cohort:comparison",
      trajectory_ids: [],
      strategic_fit_score: null,
      strategic_fit_delta: null,
      strategic_familiarity: expansionStatus === "complete" ? 0.85 : null,
      memorization_burden: expansionStatus === "complete" ? 0.2 : null,
      expected_opponent_coverage: expansionStatus === "complete" ? 0.9 : null,
      new_concept_ids: ["concept:iqp"],
      theory_nodes_before: 20,
      theory_nodes_after: expansionStatus === "complete" ? 24 : null,
      theory_nodes_added: expansionStatus === "complete" ? 4 : null,
      theory_nodes_removed: 0,
      popularity: options.missingPopularity ? null : 0.75,
      homogenization_cost: 0.1,
      training_cost: 0.2,
      transposition_position_ids: ["position:prepared"],
      contributions: axes,
      provenance: [source],
    },
    pareto: {
      ...version,
      status: options.pareto,
      axis_ids:
        options.pareto === "unscored"
          ? []
          : ["objective-quality", ...REPLACEMENT_STRATEGIC_SCORE_AXES],
      dominated_by_candidate_ids: options.dominatedBy ?? [],
      reason:
        options.pareto === "pareto-optimal"
          ? "Canonical tradeoff; no single best candidate is inferred."
          : options.pareto === "dominated"
            ? "Canonical dominator IDs retained."
            : "Missing or incomplete evidence cannot enter frontier.",
    },
    trajectory_report: null,
    concept_dictionary: null,
    route_weighting: null,
  } as unknown as ReplacementScoredCandidate;
}

function scoring(
  candidates: readonly ReplacementScoredCandidate[],
): ReplacementCandidateScoringResult {
  return {
    ...version,
    status: candidates.some((candidate) => candidate.state !== "available")
      ? "partial"
      : "complete",
    error_code: null,
    explanation: "Canonical fixture result.",
    request_id: "request:comparison",
    report_id: "report:comparison",
    finding_id: "finding:comparison",
    semantic_finding_id: "semantic-finding:comparison",
    cohort_id: "cohort:comparison",
    repertoire_revision: "browser:42",
    repertoire_color: candidates[0]?.repertoire_color ?? "white",
    pivot_id: "pivot:comparison",
    candidates,
    pareto_candidate_ids: candidates
      .filter((candidate) => candidate.pareto.status === "pareto-optimal")
      .map((candidate) => candidate.candidate_id),
    dominated_candidate_ids: candidates
      .filter((candidate) => candidate.pareto.status === "dominated")
      .map((candidate) => candidate.candidate_id),
    unscored_candidate_ids: candidates
      .filter((candidate) => candidate.pareto.status === "unscored")
      .map((candidate) => candidate.candidate_id),
    context: {},
    expansion: {},
    provenance: [source],
    source_graph_unchanged: true,
    source_context_unchanged: true,
    expansion_unchanged: true,
    inputs_unchanged: true,
  } as unknown as ReplacementCandidateScoringResult;
}

test("comparison consumes canonical Pareto frontier, ties, and dominated candidates without aggregate best", () => {
  const result = scoring([
    scoredCandidate({ id: "candidate:tradeoff-a", san: "Bc4", pareto: "pareto-optimal" }),
    scoredCandidate({ id: "candidate:tradeoff-tie", san: "d4", pareto: "pareto-optimal" }),
    scoredCandidate({
      id: "candidate:dominated",
      san: "Nc3",
      pareto: "dominated",
      dominatedBy: ["candidate:tradeoff-a", "candidate:tradeoff-tie"],
    }),
  ]);
  const before = JSON.stringify(result);
  const rows = buildCandidateComparisonRows(result);
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((row) => row.pareto_status === "pareto-optimal").length, 2);
  assert.equal(
    rows.find((row) => row.candidate_id === "candidate:dominated")?.pareto_status,
    "dominated",
  );
  assert.equal(
    rows.find((row) => row.candidate_id === "candidate:dominated")?.dominated_by_candidate_ids
      .length,
    2,
  );
  assert.equal(
    rows.some((row) => Object.hasOwn(row, "best")),
    false,
  );
  assert.equal(Object.hasOwn(result, "best_candidate_id"), false);
  assert.equal(JSON.stringify(result), before);
});

test("chart and table resolve one stable candidate identity and retain every Pareto state", () => {
  const rows = buildCandidateComparisonRows(
    scoring([
      scoredCandidate({ id: "candidate:a", san: "Bc4", pareto: "pareto-optimal" }),
      scoredCandidate({
        id: "candidate:b",
        san: "d4",
        pareto: "dominated",
        dominatedBy: ["candidate:a"],
      }),
      scoredCandidate({
        id: "candidate:c",
        san: "Nc3",
        pareto: "unscored",
        expansionStatus: "unavailable",
      }),
    ]),
  );
  const points = buildReplacementParetoPoints(rows);
  const selectedFromChart = resolveCandidateSelection(rows, points[1]!.candidate_id);
  const selectedFromTable = resolveCandidateSelection(rows, rows[1]!.candidate_id);
  assert.equal(selectedFromChart, "candidate:b");
  assert.equal(selectedFromTable, selectedFromChart);
  assert.equal(resolveCandidateSelection(rows, "candidate:stale"), null);
  assert.equal(points.find((point) => point.candidate_id === "candidate:c")?.available, false);
  assert.equal(points.map((point) => point.status).join(","), "pareto-optimal,dominated,unscored");
  assert.equal(points[0]!.coincident_count, 2);
  assert.equal(points[1]!.coincident_count, 2);
  const firstPosition = replacementParetoPosition(points[0]!, 0);
  const secondPosition = replacementParetoPosition(points[1]!, 1);
  assert.equal(firstPosition.anchor_x, secondPosition.anchor_x);
  assert.equal(firstPosition.anchor_y, secondPosition.anchor_y);
  assert.notDeepEqual(
    [firstPosition.display_x, firstPosition.display_y],
    [secondPosition.display_x, secondPosition.display_y],
  );
});

test("Pareto memory ring uses canonical normalized orientation for unbounded burden points", () => {
  const candidate = scoredCandidate({
    id: "candidate:burden",
    san: "Bc4",
    pareto: "pareto-optimal",
  });
  const changed = {
    ...candidate,
    strategic_score: {
      ...candidate.strategic_score,
      contributions: candidate.strategic_score.contributions.map((item) =>
        item.axis === "memorization-burden"
          ? { ...item, raw_value: 42, normalized_score: 0.25, unit: "burden-points" }
          : item,
      ),
    },
  } as ReplacementScoredCandidate;
  const point = buildReplacementParetoPoints(buildCandidateComparisonRows(scoring([changed])))[0]!;
  assert.equal(point.memory_burden, 0.75);
  assert.equal(point.available, true);
});

test("Black repertoire POV, White-POV transport, identities, versions, and provenance stay distinct", () => {
  const candidate = scoredCandidate({
    id: "candidate:black",
    san: "Nf6",
    pareto: "pareto-optimal",
    color: "black",
  });
  const rows = buildCandidateComparisonRows(scoring([candidate]));
  const row = rows[0]!;
  assert.equal(row.repertoire_pov_evaluation, "-37 cp");
  assert.equal(row.white_pov_transport, "+37 cp");
  assert.equal(row.request_id, "request:comparison");
  assert.equal(row.report_id, "report:comparison");
  assert.equal(row.finding_id, "finding:comparison");
  assert.equal(row.semantic_finding_id, "semantic-finding:comparison");
  assert.equal(row.cohort_id, "cohort:comparison");
  assert.equal(row.repertoire_revision, "browser:42");
  assert.equal(row.analysis_version, "2.0.0");
  assert.equal(row.axes[0]!.provenance_source_ids[0], source.source_id);
  assert.equal(
    row.candidate.expansion.seed.provenance[0]?.snapshot,
    "snapshot:comparison:immutable",
  );
});

test("missing axes remain unavailable and partial candidates retain errors, risks, and long complete route evidence", () => {
  const missing = scoredCandidate({
    id: "candidate:partial-long",
    san: "Bc4",
    pareto: "unscored",
    expansionStatus: "truncated",
    missingPopularity: true,
    longRouteLength: 40,
  });
  const result = scoring([missing]);
  const before = JSON.stringify(result);
  const row = buildCandidateComparisonRows(result)[0]!;
  const popularity = row.axes.find((axis) => axis.axis === "popularity")!;
  assert.equal(popularity.value, "Unavailable");
  assert.equal(popularity.raw_value, null);
  assert.equal(row.status, "truncated");
  assert.equal(row.pareto_status, "unscored");
  assert.equal(
    row.candidate.expansion.evidence_item_results[0]?.error_code,
    "subtree-node-budget-exhausted",
  );
  assert.equal(row.candidate.expansion.omissions.length, 1);
  assert.equal(row.candidate.expansion.unresolved_risks.length, 1);
  const routes = buildCandidateSubtreeRoutes(row);
  assert.equal(routes.length, 1);
  assert.equal(routes[0]!.edge_ids.length, 40);
  assert.equal(routes[0]!.san.split(" ").length, 40);
  assert.equal(routes[0]!.expected_frequency, "Unavailable");
  assert.equal(JSON.stringify(result), before);
});

test("canonical value formatting never converts missing or partial evidence to zero", () => {
  assert.equal(
    formatCanonicalAxisValue({ state: "unavailable", raw_value: null, unit: "fraction" }),
    "Unavailable",
  );
  assert.equal(
    formatCanonicalAxisValue({ state: "partial", raw_value: null, unit: "fraction" }),
    "Unavailable (partial evidence)",
  );
  assert.equal(
    formatCanonicalAxisValue({ state: "available", raw_value: 0, unit: "fraction" }),
    "0%",
  );
  assert.equal(
    formatCanonicalAxisValue({ state: "partial", raw_value: 0.5, unit: "fraction" }),
    "50% (partial)",
  );
});
