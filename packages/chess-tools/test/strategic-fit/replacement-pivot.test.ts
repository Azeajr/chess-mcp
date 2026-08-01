import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  REPLACEMENT_PIVOT_NON_ACTIONABLE_REASONS,
  REPLACEMENT_PIVOT_RESULT_STATUSES,
  REPLACEMENT_USER_CANDIDATE_LINE_ERROR_CODES,
  REPLACEMENT_USER_CANDIDATE_LINE_STATUSES,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
  buildRepertoireGraph,
  selectReplacementPivot,
  type CausalAttribution,
  type CausalControlLabel,
  type Color,
  type ReplacementPivotCohortEvidence,
  type ReplacementPivotFindingEvidence,
  type ReplacementRequest,
  type RepertoireGraph,
  type RepertoireGraphDecision,
  type RepertoireGraphRoute,
  type SelectReplacementPivotInput,
  type StrategicFitSourceProvenance,
} from "../../src/index.ts";
import { BLACK_REPLACEMENT_REQUEST } from "./replacement-types.compile.ts";

const source: StrategicFitSourceProvenance = {
  source_id: "test:replacement-pivot",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_FIT_ANALYSIS_VERSION,
  snapshot: "revision:test",
  reason: null,
};

const WHITE_PGN = `[Event "Pivot route A"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 *

[Event "Pivot route B"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 *`;

function routeBeginning(graph: RepertoireGraph, prefix: string): RepertoireGraphRoute {
  const route = graph.routes.find((candidate) => candidate.san_moves.join(" ").startsWith(prefix));
  assert.ok(route, `route beginning ${prefix}`);
  return route;
}

function decisionAt(
  graph: RepertoireGraph,
  route: RepertoireGraphRoute,
  san: string,
): RepertoireGraphDecision {
  const index = route.san_moves.indexOf(san);
  assert.notEqual(index, -1, `${san} exists on route`);
  const decision = graph.decisions.find(
    (candidate) => candidate.decision_id === route.decision_ids[index],
  );
  assert.ok(decision, `decision for ${san}`);
  return decision;
}

function causalEvent(
  route: RepertoireGraphRoute,
  decision: RepertoireGraphDecision,
  kind: "player-decision" | "opponent-divergence" = "player-decision",
) {
  const ply = route.decision_ids.indexOf(decision.decision_id) + 1;
  return {
    event_id: `event:${kind}:${decision.decision_id}`,
    kind,
    ply,
    position_id: route.position_ids[ply]!,
    decision_id: decision.decision_id,
    san: decision.san,
    explanation: `${kind} test evidence`,
  } as const;
}

function attribution(
  label: CausalControlLabel,
  likelyDecisionIds: readonly string[],
  events: CausalAttribution["timeline"],
): CausalAttribution {
  const controllability =
    label === "mostly-player-controlled"
      ? 0.85
      : label === "shared-or-uncertain"
        ? 0.5
        : label === "mostly-opponent-forced"
          ? 0.15
          : null;
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    controllability,
    label,
    player_contribution: controllability,
    opponent_contribution: controllability === null ? null : 1 - controllability,
    likely_causal_decision_ids: [...likelyDecisionIds],
    timeline: [...events],
    explanation: `${label} finding-specific evidence`,
  };
}

interface InputOptions {
  readonly graph: RepertoireGraph;
  readonly routes: readonly RepertoireGraphRoute[];
  readonly causality: CausalAttribution;
  readonly pivotSelection?: ReplacementRequest["pivot_selection"];
  readonly candidateLines?: readonly (readonly string[])[];
  readonly revision?: string;
}

function input(options: InputOptions): SelectReplacementPivotInput {
  const revision = options.revision ?? "revision:test";
  const routeIds = options.routes.map((route) => route.route_id).sort();
  const positionIds = [...new Set(options.routes.flatMap((route) => route.position_ids))].sort();
  const decisionIds = [...new Set(options.routes.flatMap((route) => route.decision_ids))].sort();
  const sourcePaths = options.routes.flatMap((route) =>
    route.source_san_paths.map((path) => [...path]),
  );
  const finding: ReplacementPivotFindingEvidence = {
    finding_id: "finding:test",
    semantic_finding_id: "semantic-finding:test",
    repertoire_revision: revision,
    references: {
      position_ids: positionIds,
      decision_ids: decisionIds,
      route_ids: routeIds,
      source_san_paths: sourcePaths,
    },
    evidence: {
      cohort_id: "cohort:test",
      dimensions: [{ dimension_id: "center.state" }],
      causality: options.causality,
      provenance: [source],
    },
    provenance: { repertoire_revision: revision, sources: [source] },
  };
  const cohort: ReplacementPivotCohortEvidence = {
    cohort_id: "cohort:test",
    route_ids: routeIds,
    route_weights: routeIds.map((routeId) => ({
      route_id: routeId,
      normalized_weight: 1 / routeIds.length,
    })),
    transposition_position_ids: options.graph.transposition_links
      .filter((link) => link.route_ids.some((routeId) => routeIds.includes(routeId)))
      .map((link) => link.position_id),
    provenance: [source],
  };
  const request: ReplacementRequest = {
    ...BLACK_REPLACEMENT_REQUEST,
    request_id: "request:test",
    report_id: "report:test",
    finding_id: finding.finding_id,
    semantic_finding_id: finding.semantic_finding_id,
    cohort_id: cohort.cohort_id,
    repertoire_revision: revision,
    repertoire_color: options.graph.repertoire_color,
    pivot_selection: options.pivotSelection ?? { kind: "automatic", decision_id: null },
    user_candidate_san_lines: options.candidateLines ?? [],
    provenance: [source],
  };
  return { request, graph: options.graph, finding, cohort };
}

test("automatic selection chooses one repertoire-player-controlled causal decision", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(WHITE_PGN), "white");
  const route = routeBeginning(graph, "e4 e5");
  const decision = decisionAt(graph, route, "Nf3");
  const result = selectReplacementPivot(
    input({
      graph,
      routes: [route],
      causality: attribution(
        "mostly-player-controlled",
        [decision.decision_id],
        [causalEvent(route, decision)],
      ),
    }),
  );

  assert.equal(result.status, "selected");
  assert.equal(result.pivot.status, "actionable");
  assert.equal(result.pivot.owner, "repertoire");
  assert.equal(result.pivot.decision_id, decision.decision_id);
  assert.equal(result.pivot.position_id, decision.from_position_id);
});

test("opponent-forced finding stays non-actionable instead of blaming next player move", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(WHITE_PGN), "white");
  const route = routeBeginning(graph, "e4 e5");
  const opponent = decisionAt(graph, route, "e5");
  const result = selectReplacementPivot(
    input({
      graph,
      routes: [route],
      causality: attribution(
        "mostly-opponent-forced",
        [],
        [causalEvent(route, opponent, "opponent-divergence")],
      ),
    }),
  );

  assert.equal(result.status, "non-actionable");
  assert.equal(result.non_actionable_reason, "opponent-controlled");
  assert.equal(result.pivot.decision_id, null);
  assert.deepEqual(result.alternative_pivots, []);
});

test("shared and interacting causal decisions return explicit alternatives", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(WHITE_PGN), "white");
  const route = routeBeginning(graph, "e4 e5");
  const first = decisionAt(graph, route, "Nf3");
  const second = decisionAt(graph, route, "Bb5");
  const result = selectReplacementPivot(
    input({
      graph,
      routes: [route],
      causality: attribution(
        "shared-or-uncertain",
        [first.decision_id, second.decision_id],
        [causalEvent(route, first), causalEvent(route, second)],
      ),
    }),
  );

  assert.equal(result.status, "alternatives-required");
  assert.equal(result.pivot.status, "shared");
  assert.deepEqual(
    new Set(result.alternative_pivots.map((pivot) => pivot.decision_id)),
    new Set([first.decision_id, second.decision_id]),
  );
});

test("center finding spanning several paths never silently selects first navigation path", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(WHITE_PGN), "white");
  const kingPawn = routeBeginning(graph, "e4 e5");
  const queenPawn = routeBeginning(graph, "d4 d5");
  const onlyFirstPath = decisionAt(graph, kingPawn, "Nf3");
  const result = selectReplacementPivot(
    input({
      graph,
      routes: [kingPawn, queenPawn],
      causality: attribution(
        "mostly-player-controlled",
        [onlyFirstPath.decision_id],
        [causalEvent(kingPawn, onlyFirstPath)],
      ),
    }),
  );

  assert.equal(result.status, "alternatives-required");
  assert.equal(result.pivot.decision_id, null);
  assert.equal(result.alternative_pivots.length, 1);
  assert.match(result.pivot.explanation, /several semantic routes/);
  assert.deepEqual(
    new Set(result.pivot.source_san_paths.map((path) => path.join(" "))),
    new Set(
      [kingPawn, queenPawn].flatMap((route) =>
        route.source_san_paths.map((path) => path.join(" ")),
      ),
    ),
  );
});

test("no supported causal pivot returns versioned structured non-actionable result", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(WHITE_PGN), "white");
  const route = routeBeginning(graph, "e4 e5");
  const result = selectReplacementPivot(
    input({
      graph,
      routes: [route],
      causality: attribution("mostly-player-controlled", ["decision:removed"], []),
    }),
  );

  assert.equal(result.status, "non-actionable");
  assert.equal(result.non_actionable_reason, "no-supported-causal-pivot");
  assert.deepEqual(result.pivot.source_san_paths, route.source_san_paths);
  assert.equal(result.schema_version, STRATEGIC_FIT_SCHEMA_VERSION);
  assert.equal(result.analysis_version, STRATEGIC_FIT_ANALYSIS_VERSION);
  assert.equal(result.replacement_schema_version, STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION);
});

test("validated user-selected pivot accepts legal SAN line from pivot position", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(WHITE_PGN), "white");
  const route = routeBeginning(graph, "e4 e5");
  const first = decisionAt(graph, route, "Nf3");
  const selected = decisionAt(graph, route, "Bb5");
  const result = selectReplacementPivot(
    input({
      graph,
      routes: [route],
      causality: attribution(
        "shared-or-uncertain",
        [first.decision_id, selected.decision_id],
        [causalEvent(route, first), causalEvent(route, selected)],
      ),
      pivotSelection: { kind: "user-selected", decision_id: selected.decision_id },
      candidateLines: [["Bc4", "Nf6"]],
    }),
  );

  assert.equal(result.status, "selected");
  assert.equal(result.pivot.decision_id, selected.decision_id);
  assert.equal(result.candidate_line_results[0]?.status, "valid");
  assert.deepEqual(result.candidate_line_results[0]?.canonical_san_line, ["Bc4", "Nf6"]);
  assert.equal(result.candidate_line_results[0]?.first_move_uci, "f1c4");
});

test("illegal user candidate is rejected per item without throwing", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(WHITE_PGN), "white");
  const route = routeBeginning(graph, "e4 e5");
  const selected = decisionAt(graph, route, "Nf3");
  const result = selectReplacementPivot(
    input({
      graph,
      routes: [route],
      causality: attribution(
        "mostly-player-controlled",
        [selected.decision_id],
        [causalEvent(route, selected)],
      ),
      pivotSelection: { kind: "user-selected", decision_id: selected.decision_id },
      candidateLines: [["Qa9"], []],
    }),
  );

  assert.equal(result.status, "selected");
  assert.deepEqual(
    result.candidate_line_results.map((candidate) => candidate.status),
    ["illegal", "illegal"],
  );
  assert.deepEqual(
    result.candidate_line_results.map((candidate) => candidate.error_code),
    ["illegal-san", "empty-line"],
  );
});

test("unknown and stale user-selected decisions return structured stale candidate items", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(WHITE_PGN), "white");
  const route = routeBeginning(graph, "e4 e5");
  const causal = decisionAt(graph, route, "Nf3");
  const unrelated = decisionAt(graph, route, "Bb5");
  const base = {
    graph,
    routes: [route],
    causality: attribution(
      "mostly-player-controlled",
      [causal.decision_id],
      [causalEvent(route, causal)],
    ),
    candidateLines: [["Bc4"]],
  } as const;
  const unknown = selectReplacementPivot(
    input({
      ...base,
      pivotSelection: { kind: "user-selected", decision_id: "decision:unknown" },
    }),
  );
  const stale = selectReplacementPivot(
    input({
      ...base,
      pivotSelection: { kind: "user-selected", decision_id: unrelated.decision_id },
    }),
  );

  assert.equal(unknown.status, "non-actionable");
  assert.equal(unknown.non_actionable_reason, "unknown-user-selected-decision");
  assert.equal(unknown.candidate_line_results[0]?.status, "stale");
  assert.equal(stale.status, "non-actionable");
  assert.equal(stale.non_actionable_reason, "stale-user-selected-decision");
  assert.equal(stale.candidate_line_results[0]?.status, "stale");
});

test("semantic pivot selection and validation stay stable across transposition paths", () => {
  const tree = GameTree.fromPgn(`[Event "Move order A"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Nf3 Be7 5. e3 O-O *

[Event "Move order B"]
[Result "*"]

1. Nf3 d5 2. d4 Nf6 3. c4 e6 4. Nc3 Be7 5. e3 O-O *`);
  const graph = buildRepertoireGraph(tree, "white");
  const routes = graph.routes;
  assert.equal(routes.length, 2);
  const firstDecision = decisionAt(graph, routes[0]!, "e3");
  const secondDecision = decisionAt(graph, routes[1]!, "e3");
  assert.equal(firstDecision.decision_id, secondDecision.decision_id);
  assert.equal(firstDecision.source_san_paths.length, 2);
  const result = selectReplacementPivot(
    input({
      graph,
      routes,
      causality: attribution(
        "mostly-player-controlled",
        [firstDecision.decision_id],
        [causalEvent(routes[0]!, firstDecision)],
      ),
      candidateLines: [["b3"]],
    }),
  );

  assert.equal(result.status, "selected");
  assert.equal(result.pivot.decision_id, firstDecision.decision_id);
  assert.equal(result.pivot.source_san_paths.length, 2);
  assert.deepEqual(
    new Set(result.pivot.source_san_paths.map((path) => path.join(" "))),
    new Set(firstDecision.source_san_paths.map((path) => path.join(" "))),
  );
  assert.equal(result.candidate_line_results[0]?.status, "valid");
});

test("selection leaves source repertoire and graph byte-identical", () => {
  const tree = GameTree.fromPgn(WHITE_PGN);
  const beforeTree = tree.toPgn();
  const graph = buildRepertoireGraph(tree, "white");
  const beforeGraph = JSON.stringify(graph);
  const route = routeBeginning(graph, "e4 e5");
  const decision = decisionAt(graph, route, "Nf3");
  const result = selectReplacementPivot(
    input({
      graph,
      routes: [route],
      causality: attribution(
        "mostly-player-controlled",
        [decision.decision_id],
        [causalEvent(route, decision)],
      ),
      candidateLines: [["Bc4"]],
    }),
  );

  assert.equal(result.source_repertoire_unchanged, true);
  assert.equal(tree.toPgn(), beforeTree);
  assert.equal(JSON.stringify(graph), beforeGraph);
});

test("result serialization preserves versions, identities, revision, color, and provenance", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(WHITE_PGN), "white");
  const route = routeBeginning(graph, "e4 e5");
  const decision = decisionAt(graph, route, "Nf3");
  const selectedInput = input({
    graph,
    routes: [route],
    causality: attribution(
      "mostly-player-controlled",
      [decision.decision_id],
      [causalEvent(route, decision)],
    ),
  });
  const result = selectReplacementPivot(selectedInput);
  const roundTrip = JSON.parse(JSON.stringify(result));

  assert.deepEqual(roundTrip, result);
  assert.equal(result.request_id, selectedInput.request.request_id);
  assert.equal(result.finding_id, selectedInput.finding.finding_id);
  assert.equal(result.semantic_finding_id, selectedInput.finding.semantic_finding_id);
  assert.equal(result.cohort_id, selectedInput.cohort.cohort_id);
  assert.equal(result.repertoire_revision, selectedInput.request.repertoire_revision);
  assert.equal(result.repertoire_color, "white");
  assert.ok(result.provenance.some((item) => item.source_id === source.source_id));
  assert.ok(result.provenance.some((item) => item.source_id === "strategic-fit:replacement-pivot"));
});

test("Black repertoire ownership uses graph color and validates from Black pivot position", () => {
  const graph = buildRepertoireGraph(
    GameTree.fromPgn(`[Event "Black pivot"]
[Result "*"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 *`),
    "black",
  );
  const route = graph.routes[0]!;
  const decision = decisionAt(graph, route, "c5");
  const result = selectReplacementPivot(
    input({
      graph,
      routes: [route],
      causality: attribution(
        "mostly-player-controlled",
        [decision.decision_id],
        [causalEvent(route, decision)],
      ),
      candidateLines: [["e5"]],
    }),
  );

  assert.equal(result.status, "selected");
  assert.equal(result.repertoire_color, "black");
  assert.equal(result.pivot.owner, "repertoire");
  assert.equal(result.pivot.san, "c5");
  assert.equal(result.candidate_line_results[0]?.status, "valid");
  assert.equal(result.candidate_line_results[0]?.first_move_uci, "e7e5");
});

test("pivot and user-candidate enum values are exhaustive, unique package-root exports", () => {
  assert.deepEqual(REPLACEMENT_PIVOT_RESULT_STATUSES, [
    "selected",
    "alternatives-required",
    "non-actionable",
  ]);
  assert.deepEqual(REPLACEMENT_USER_CANDIDATE_LINE_STATUSES, ["valid", "illegal", "stale"]);
  assert.deepEqual(REPLACEMENT_USER_CANDIDATE_LINE_ERROR_CODES, [
    "empty-line",
    "illegal-san",
    "pivot-selection-required",
    "pivot-unavailable",
  ]);
  for (const values of [
    REPLACEMENT_PIVOT_RESULT_STATUSES,
    REPLACEMENT_PIVOT_NON_ACTIONABLE_REASONS,
    REPLACEMENT_USER_CANDIDATE_LINE_STATUSES,
    REPLACEMENT_USER_CANDIDATE_LINE_ERROR_CODES,
  ]) {
    assert.equal(new Set(values).size, values.length);
  }
});

void ("white" satisfies Color);
