import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
  buildRepertoireGraph,
  generateReplacementCandidates,
  positionKey,
  selectReplacementPivot,
  type CausalAttribution,
  type Color,
  type GenerateReplacementCandidatesInput,
  type ReplacementCandidateSourceKind,
  type ReplacementOpeningDatabaseEvidence,
  type ReplacementOpeningDatabaseMoveEvidence,
  type ReplacementPivotCohortEvidence,
  type ReplacementPivotFindingEvidence,
  type ReplacementPivotSelectionResult,
  type ReplacementRequest,
  type RepertoireGraph,
  type RepertoireGraphDecision,
  type RepertoireGraphRoute,
  type StrategicFitSourceProvenance,
} from "../../src/index.ts";
import { BLACK_REPLACEMENT_REQUEST } from "./replacement-types.compile.ts";

const source: StrategicFitSourceProvenance = {
  source_id: "test:replacement-candidates",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_FIT_ANALYSIS_VERSION,
  snapshot: "revision:candidates",
  reason: null,
};

const WHITE_GAMES = [
  `[Event "Candidate pivot"]
[Result "*"]

1. e4 e5 2. Bc4 Nf6 3. d3 *`,
  `[Event "Prepared alternative"]
[Result "*"]

1. e4 e5 2. Nc3 Nc6 3. Nf3 *`,
  `[Event "Shortcut order"]
[Result "*"]

1. Nf3 e5 2. e4 Nc6 3. Bb5 *`,
] as const;

const BLACK_GAMES = [
  `[Event "Black pivot"]
[Result "*"]

1. e4 c5 2. Nf3 d6 *`,
  `[Event "Black prepared alternative"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 *`,
] as const;

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
  const decision = graph.decisions.find((candidate) => candidate.decision_id === route.decision_ids[index]);
  assert.ok(decision, `decision for ${san}`);
  return decision;
}

function attribution(route: RepertoireGraphRoute, decision: RepertoireGraphDecision): CausalAttribution {
  const ply = route.decision_ids.indexOf(decision.decision_id) + 1;
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    controllability: 0.9,
    label: "mostly-player-controlled",
    player_contribution: 0.9,
    opponent_contribution: 0.1,
    likely_causal_decision_ids: [decision.decision_id],
    timeline: [{
      event_id: `event:${decision.decision_id}`,
      kind: "player-decision",
      ply,
      position_id: route.position_ids[ply - 1]!,
      decision_id: decision.decision_id,
      san: decision.san,
      explanation: "Candidate-generation fixture pivot.",
    }],
    explanation: "Fixture causality.",
  };
}

interface CandidateSetup {
  readonly tree: GameTree;
  readonly graph: RepertoireGraph;
  readonly input: GenerateReplacementCandidatesInput;
}

function setup(
  games: readonly string[] = WHITE_GAMES,
  color: Color = "white",
  routePrefix = "e4 e5 Bc4",
  pivotSan = "Bc4",
  candidateSources: readonly ReplacementCandidateSourceKind[] = [
    "existing-repertoire-transposition",
    "move-order-shortcut",
    "opening-database",
  ],
  maximumCandidates = 12,
): CandidateSetup {
  const tree = GameTree.fromPgn(games.join("\n\n"));
  const graph = buildRepertoireGraph(tree, color);
  const route = routeBeginning(graph, routePrefix);
  const pivotDecision = decisionAt(graph, route, pivotSan);
  const references = {
    position_ids: [...route.position_ids],
    decision_ids: [...route.decision_ids],
    route_ids: [route.route_id],
    source_san_paths: route.source_san_paths.map((path) => [...path]),
  };
  const finding: ReplacementPivotFindingEvidence = {
    finding_id: "finding:candidates",
    semantic_finding_id: "semantic-finding:candidates",
    repertoire_revision: "revision:candidates",
    references,
    evidence: {
      cohort_id: "cohort:candidates",
      dimensions: [{ dimension_id: "center.state" }],
      causality: attribution(route, pivotDecision),
      provenance: [source],
    },
    provenance: { repertoire_revision: "revision:candidates", sources: [source] },
  };
  const cohort: ReplacementPivotCohortEvidence = {
    cohort_id: "cohort:candidates",
    route_ids: [route.route_id],
    route_weights: [{ route_id: route.route_id, normalized_weight: 1 }],
    transposition_position_ids: graph.transposition_links.map((link) => link.position_id),
    provenance: [source],
  };
  const request: ReplacementRequest = {
    ...BLACK_REPLACEMENT_REQUEST,
    request_id: "request:candidates",
    report_id: "report:candidates",
    finding_id: finding.finding_id,
    semantic_finding_id: finding.semantic_finding_id,
    cohort_id: cohort.cohort_id,
    repertoire_revision: "revision:candidates",
    repertoire_color: color,
    candidate_sources: [...candidateSources],
    budget: { ...BLACK_REPLACEMENT_REQUEST.budget, maximum_candidates: maximumCandidates },
    provenance: [source],
  };
  const pivotResult = selectReplacementPivot({ request, graph, finding, cohort });
  assert.equal(pivotResult.status, "selected");
  return { tree, graph, input: { request, graph, pivot_result: pivotResult } };
}

function databaseMove(
  moveId: string,
  san: string,
  uci: string,
  playedPct: number,
  sourceId = `opening-explorer:${moveId}`,
): ReplacementOpeningDatabaseMoveEvidence {
  return {
    move_id: moveId,
    san,
    uci,
    popularity: {
      games: Math.round(playedPct * 10),
      played_pct: playedPct,
      white_pct: 40,
      draw_pct: 30,
      black_pct: 30,
      average_rating: 1900,
    },
    provenance: [{
      source_id: sourceId,
      kind: "opening-explorer",
      state: "available",
      version: "database-v1",
      snapshot: "snapshot:2026-07",
      reason: null,
    }],
  };
}

function databaseEvidence(
  candidateSetup: CandidateSetup,
  state: ReplacementOpeningDatabaseEvidence["state"],
  moves: readonly ReplacementOpeningDatabaseMoveEvidence[],
  evidenceId = `evidence:${state}`,
): ReplacementOpeningDatabaseEvidence {
  assert.equal(candidateSetup.input.pivot_result.status, "selected");
  const pivotPosition = candidateSetup.graph.positions.find((position) =>
    position.position_id === candidateSetup.input.pivot_result.pivot.position_id
  );
  assert.ok(pivotPosition);
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    replacement_schema_version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
    evidence_id: evidenceId,
    state,
    database: "lichess",
    provider: "fixture-opening-explorer",
    version: "database-v1",
    snapshot: "snapshot:2026-07",
    filter_key: "db=lichess|speeds=rapid|ratings=1800|since=2026-01|until=2026-07|moves=12",
    filters: {
      db: "lichess",
      speeds: ["rapid"],
      ratings: [1800],
      since: "2026-01",
      until: "2026-07",
      movesLimit: 12,
    },
    position: {
      position_id: pivotPosition.position_id,
      position_key: pivotPosition.position_key,
      fen: pivotPosition.fen,
    },
    moves: moves.map((move) => ({
      ...move,
      popularity: { ...move.popularity },
      provenance: move.provenance.map((item) => ({ ...item })),
    })),
    reason: state === "available" ? null : `Fixture ${state} evidence.`,
    provenance: [{
      source_id: `opening-explorer:${evidenceId}`,
      kind: "opening-explorer",
      state: state === "available" ? "available" : state === "partial" ? "partial" : state === "stale" ? "stale" : "unavailable",
      version: "database-v1",
      snapshot: "snapshot:2026-07",
      reason: state === "available" ? null : `Fixture ${state} evidence.`,
    }],
  };
}

function candidateProjection(result: ReturnType<typeof generateReplacementCandidates>) {
  return result.candidates.map((candidate) => ({
    id: candidate.candidate_id,
    rank: candidate.rank,
    san: candidate.san,
    uci: candidate.uci,
    outcome: candidate.outcome_position_key,
    sources: candidate.source_kinds,
    popularity: candidate.maximum_database_popularity,
  }));
}

test("existing prepared alternatives and semantic move-order shortcuts become low-memory seeds", () => {
  const candidateSetup = setup();
  const result = generateReplacementCandidates(candidateSetup.input);
  const prepared = result.candidates.find((candidate) => candidate.san === "Nc3");
  const shortcut = result.candidates.find((candidate) => candidate.san === "Nf3");

  assert.equal(result.status, "partial");
  assert.ok(prepared);
  assert.ok(shortcut);
  assert.equal(prepared.memory_class, "low");
  assert.equal(shortcut.memory_class, "low");
  assert.equal(prepared.rank_hint, "low-memory-existing-preparation");
  assert.ok(prepared.source_kinds.includes("existing-repertoire-transposition"));
  assert.ok(shortcut.source_kinds.includes("move-order-shortcut"));
  const shortcutSource = shortcut.provenance.find((item) => item.kind === "move-order-shortcut");
  assert.ok(shortcutSource);
  assert.ok(shortcutSource.decision_ids.length > 0);
  assert.equal(shortcut.expansion.status, "full-subtree-required");
  assert.equal(shortcut.expansion.required_contract, "ReplacementCandidateSubtree");
});

test("canonical outcome deduplicates local and database sources while preserving every source kind", () => {
  const candidateSetup = setup();
  const evidence = databaseEvidence(candidateSetup, "available", [
    databaseMove("db-nf3", "Nf3", "g1f3", 64),
  ]);
  const result = generateReplacementCandidates({ ...candidateSetup.input, database_evidence: [evidence] });
  const nf3 = result.candidates.filter((candidate) => candidate.san === "Nf3");

  assert.equal(nf3.length, 1);
  assert.deepEqual(nf3[0]?.source_kinds, ["move-order-shortcut", "opening-database"]);
  assert.equal(nf3[0]?.database_evidence_ids[0], evidence.evidence_id);
  assert.equal(result.database_item_results[0]?.candidate_id, nf3[0]?.candidate_id);
});

test("duplicate database source merges complete evidence and distinct nested provenance", () => {
  const candidateSetup = setup();
  const evidence = databaseEvidence(candidateSetup, "available", [
    databaseMove("db-d3-a", "d3", "d2d3", 20, "opening-explorer:sample-a"),
    databaseMove("db-d3-b", "d3", "d2d3", 25, "opening-explorer:sample-b"),
  ], "evidence:duplicate-source");
  const result = generateReplacementCandidates({ ...candidateSetup.input, database_evidence: [evidence] });
  const d3 = result.candidates.find((candidate) => candidate.san === "d3");
  assert.ok(d3);
  const databaseSource = d3.provenance.find((item) => item.kind === "opening-database");
  assert.ok(databaseSource);
  assert.equal((databaseSource.details.merged_evidence as readonly unknown[]).length, 2);
  assert.deepEqual(
    databaseSource.provenance.map((item) => item.source_id).filter((id) => id.includes("sample")),
    ["opening-explorer:sample-a", "opening-explorer:sample-b"],
  );
  assert.equal(d3.maximum_database_popularity, 25);
  assert.equal(result.database_item_results.filter((item) => item.status === "accepted").length, 2);
});

test("ordering and identities are independent of repertoire, evidence, and move input order", () => {
  const forward = setup();
  const reverse = setup([...WHITE_GAMES].reverse());
  const forwardEvidence = [
    databaseEvidence(forward, "available", [databaseMove("d3", "d3", "d2d3", 20)], "evidence:a"),
    databaseEvidence(forward, "available", [databaseMove("h3", "h3", "h2h3", 5)], "evidence:b"),
  ];
  const reverseEvidence = [
    databaseEvidence(reverse, "available", [databaseMove("h3", "h3", "h2h3", 5)], "evidence:b"),
    databaseEvidence(reverse, "available", [databaseMove("d3", "d3", "d2d3", 20)], "evidence:a"),
  ].reverse();

  const first = generateReplacementCandidates({ ...forward.input, database_evidence: forwardEvidence });
  const second = generateReplacementCandidates({ ...reverse.input, database_evidence: reverseEvidence });
  assert.deepEqual(candidateProjection(first), candidateProjection(second));
});

test("maximum-candidate budget applies after canonical deduplication", () => {
  const candidateSetup = setup(WHITE_GAMES, "white", "e4 e5 Bc4", "Bc4", [
    "existing-repertoire-transposition",
    "move-order-shortcut",
    "opening-database",
  ], 1);
  const evidence = databaseEvidence(candidateSetup, "available", [
    databaseMove("d3", "d3", "d2d3", 50),
    databaseMove("h3", "h3", "h2h3", 40),
  ]);
  const result = generateReplacementCandidates({ ...candidateSetup.input, database_evidence: [evidence] });

  assert.equal(result.candidates.length, 1);
  assert.ok(result.discovered_candidate_count > result.candidates.length);
  assert.ok(result.database_item_results.every((item) => item.status === "budget-excluded"));
  assert.ok(result.source_results
    .filter((item) => item.kind !== "opening-database")
    .every((item) => item.accepted_item_count <= result.candidates.length));
  const excludedShortcut = result.source_results.find((item) => item.kind === "move-order-shortcut");
  assert.equal(excludedShortcut?.accepted_item_count, 0);
  assert.equal(excludedShortcut?.rejected_item_count, 1);
  assert.match(excludedShortcut?.reason ?? "", /maximum-candidate budget/);
  assert.equal(result.status, "partial");
});

test("offline and unavailable database states retain usable local candidates", () => {
  const candidateSetup = setup();
  for (const state of ["offline", "unavailable"] as const) {
    const evidence = databaseEvidence(candidateSetup, state, []);
    const result = generateReplacementCandidates({ ...candidateSetup.input, database_evidence: [evidence] });
    assert.equal(result.status, "partial");
    assert.ok(result.candidates.some((candidate) => candidate.san === "Nc3"));
    const sourceResult = result.source_results.find((item) => item.source_id.endsWith(evidence.evidence_id));
    assert.equal(sourceResult?.evidence_state, state);
    assert.equal(sourceResult?.status, "unavailable");
  }
});

test("partial and stale evidence remain explicit while legal partial items stay usable", () => {
  const candidateSetup = setup();
  const partial = databaseEvidence(candidateSetup, "partial", [databaseMove("d3", "d3", "d2d3", 21)]);
  const stale = databaseEvidence(candidateSetup, "stale", [databaseMove("h3", "h3", "h2h3", 8)]);
  const result = generateReplacementCandidates({ ...candidateSetup.input, database_evidence: [stale, partial] });

  assert.equal(result.status, "partial");
  assert.ok(result.candidates.some((candidate) => candidate.san === "d3"));
  assert.deepEqual(result.database_item_results.map((item) => item.status), ["accepted", "stale"]);
  assert.deepEqual(result.source_results.filter((item) => item.kind === "opening-database").map((item) => item.evidence_state), ["partial", "stale"]);
});

test("illegal SAN, malformed UCI, and SAN/UCI mismatch return independent item errors", () => {
  const candidateSetup = setup();
  const evidence = databaseEvidence(candidateSetup, "available", [
    databaseMove("bad-san", "Qa9", "d2d3", 10),
    databaseMove("bad-uci", "d3", "not-uci", 9),
    databaseMove("mismatch", "d3", "h2h3", 8),
  ]);
  const result = generateReplacementCandidates({ ...candidateSetup.input, database_evidence: [evidence] });

  assert.deepEqual(result.database_item_results.map((item) => item.status), ["illegal", "illegal", "illegal"]);
  assert.deepEqual(result.database_item_results.map((item) => item.error_code), ["illegal-san", "illegal-uci", "san-uci-mismatch"]);
  assert.ok(result.candidates.some((candidate) => candidate.memory_class === "low"));
});

test("stale pivot identity and stale evidence position return structured results", () => {
  const candidateSetup = setup();
  const stalePivot = generateReplacementCandidates({
    ...candidateSetup.input,
    pivot_result: { ...candidateSetup.input.pivot_result, request_id: "request:old" },
  });
  assert.equal(stalePivot.status, "stale");
  assert.equal(stalePivot.error_code, "request-pivot-mismatch");

  assert.equal(candidateSetup.input.pivot_result.status, "selected");
  const forgedPivot = {
    ...candidateSetup.input.pivot_result,
    pivot: {
      ...candidateSetup.input.pivot_result.pivot,
      replacement_schema_version: "0.0.0",
    },
  } as unknown as ReplacementPivotSelectionResult;
  const forged = generateReplacementCandidates({
    ...candidateSetup.input,
    pivot_result: forgedPivot,
  });
  assert.equal(forged.status, "stale");
  assert.equal(forged.error_code, "request-pivot-mismatch");

  const pivotPositionId = candidateSetup.input.pivot_result.pivot.position_id;
  const malformedGraph = {
    ...candidateSetup.graph,
    positions: candidateSetup.graph.positions.map((position) =>
      position.position_id === pivotPositionId
        ? { ...position, fen: `${position.fen.split(" ").slice(0, 4).join(" ")} invalid clocks` }
        : position
    ),
  };
  const malformed = generateReplacementCandidates({
    ...candidateSetup.input,
    graph: malformedGraph,
  });
  assert.equal(malformed.status, "stale");
  assert.equal(malformed.error_code, "pivot-position-stale");

  const evidence = databaseEvidence(candidateSetup, "available", [databaseMove("d3", "d3", "d2d3", 20)]);
  const stalePosition = { ...evidence, position: { ...evidence.position, position_key: "stale-position-key" } };
  const result = generateReplacementCandidates({ ...candidateSetup.input, database_evidence: [stalePosition] });
  assert.equal(result.database_item_results[0]?.status, "stale");
  assert.equal(result.database_item_results[0]?.error_code, "stale-pivot-position");
  assert.ok(result.candidates.some((candidate) => candidate.san === "Nc3"));
});

test("accepted and rejected items retain database filters, snapshots, popularity, position, move, and provenance", () => {
  const candidateSetup = setup();
  const evidence = databaseEvidence(candidateSetup, "available", [
    databaseMove("legal", "d3", "d2d3", 37),
    databaseMove("illegal", "Qa9", "d2d3", 2),
  ]);
  const result = generateReplacementCandidates({ ...candidateSetup.input, database_evidence: [evidence] });

  for (const item of result.database_item_results) {
    assert.equal(item.database, evidence.database);
    assert.equal(item.filter_key, evidence.filter_key);
    assert.deepEqual(item.filters, evidence.filters);
    assert.equal(item.snapshot, evidence.snapshot);
    assert.deepEqual(item.position, evidence.position);
    assert.ok(item.input_san.length > 0);
    assert.ok(item.input_uci.length > 0);
    assert.ok(item.popularity.games >= 0);
    assert.ok(item.provenance.some((provenance) => provenance.kind === "opening-explorer"));
  }
  assert.equal(
    result.database_item_results.find((item) => item.move_id === "legal")?.popularity.played_pct,
    37,
  );
});

test("Black repertoire uses Black-owned pivot legality without reversing White-POV database evidence", () => {
  const candidateSetup = setup(BLACK_GAMES, "black", "e4 c5", "c5");
  const evidence = databaseEvidence(candidateSetup, "available", [databaseMove("black-d5", "d5", "d7d5", 12)]);
  const result = generateReplacementCandidates({ ...candidateSetup.input, database_evidence: [evidence] });
  const e5 = result.candidates.find((candidate) => candidate.san === "e5");
  const d5 = result.candidates.find((candidate) => candidate.san === "d5");

  assert.ok(e5);
  assert.ok(d5);
  assert.equal(e5.mover_color, "black");
  assert.equal(d5.repertoire_color, "black");
  assert.equal(result.database_item_results[0]?.popularity.white_pct, 40);
});

test("generation preserves repertoire, graph, pivot result, and injected evidence byte-for-byte", () => {
  const candidateSetup = setup();
  const evidence = databaseEvidence(candidateSetup, "available", [databaseMove("d3", "d3", "d2d3", 20)]);
  const beforeTree = candidateSetup.tree.toPgn();
  const beforeGraph = JSON.stringify(candidateSetup.graph);
  const beforePivot = JSON.stringify(candidateSetup.input.pivot_result);
  const beforeEvidence = JSON.stringify(evidence);
  const result = generateReplacementCandidates({ ...candidateSetup.input, database_evidence: [evidence] });

  assert.equal(candidateSetup.tree.toPgn(), beforeTree);
  assert.equal(JSON.stringify(candidateSetup.graph), beforeGraph);
  assert.equal(JSON.stringify(candidateSetup.input.pivot_result), beforePivot);
  assert.equal(JSON.stringify(evidence), beforeEvidence);
  assert.equal(result.source_repertoire_unchanged, true);
  assert.equal(result.source_graph_unchanged, true);
  assert.equal(result.pivot_result_unchanged, true);
  assert.equal(result.database_evidence_unchanged, true);
});

test("result serialization preserves versions, identity chain, provenance, and semantic deduplication", () => {
  const candidateSetup = setup();
  const evidence = databaseEvidence(candidateSetup, "available", [
    databaseMove("nf3-a", "Nf3", "g1f3", 50),
    databaseMove("nf3-b", "Nf3", "g1f3", 45),
  ]);
  const result = generateReplacementCandidates({ ...candidateSetup.input, database_evidence: [evidence] });
  const roundTrip = JSON.parse(JSON.stringify(result));

  assert.deepEqual(roundTrip, result);
  assert.equal(result.schema_version, STRATEGIC_FIT_SCHEMA_VERSION);
  assert.equal(result.analysis_version, STRATEGIC_FIT_ANALYSIS_VERSION);
  assert.equal(result.replacement_schema_version, STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION);
  assert.equal(result.request_id, candidateSetup.input.request.request_id);
  assert.equal(result.report_id, candidateSetup.input.request.report_id);
  assert.equal(result.finding_id, candidateSetup.input.request.finding_id);
  assert.equal(result.semantic_finding_id, candidateSetup.input.request.semantic_finding_id);
  assert.equal(result.cohort_id, candidateSetup.input.request.cohort_id);
  assert.equal(result.repertoire_revision, candidateSetup.input.request.repertoire_revision);
  assert.equal(result.candidates.filter((candidate) => candidate.san === "Nf3").length, 1);
  assert.ok(result.provenance.some((item) => item.source_id === "strategic-fit:replacement-candidates"));
  assert.equal(positionKey(result.candidates.find((candidate) => candidate.san === "Nf3")!.outcome_fen), result.candidates.find((candidate) => candidate.san === "Nf3")!.outcome_position_key);
});
