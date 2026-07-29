import assert from "node:assert/strict";

import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { makeUci } from "chessops/util";

import {
  GameTree,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  normalizeExplorerFilters,
  positionKey,
  scoreReplacementCandidates,
  simulateReplacementSafety,
  type ReplacementCandidateExpansion,
  type ReplacementCompleteCandidateExpansion,
  type StrategicFitMetric,
  type StrategicFitMetricId,
  type StrategicFitMetrics,
  type StrategicFitSourceProvenance,
  type StrategicPopularityCollection,
} from "../../src/index.ts";
import {
  PGN,
  allCandidateConceptMastery,
  completeCandidate,
  completeFixture,
  contextFixture,
  input,
} from "./replacement-score.fixtures.ts";

const source: StrategicFitSourceProvenance = {
  source_id: "test:replacement-change-set",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_FIT_ANALYSIS_VERSION,
  snapshot: "revision:score",
  reason: null,
};

function metric(metricId: StrategicFitMetricId, value: number): StrategicFitMetric<number> {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    metric_id: metricId,
    state: "available",
    value,
    unit: "fraction",
    reason: null,
    provenance: [source],
  };
}

function comparableMetrics(base: StrategicFitMetrics): StrategicFitMetrics {
  return {
    ...base,
    familiarity_adjusted_coverage: metric("familiarity-adjusted-coverage", 0.4),
    training_adjusted_workload: metric("training-adjusted-workload", 0.7),
  };
}

function popularityFor(
  graph: ReturnType<typeof contextFixture>["graph"],
): StrategicPopularityCollection {
  const decisionWeights = graph.decisions.filter((decision) => decision.owner === "opponent")
    .map((decision, index) => ({
      decision_id: decision.decision_id,
      weight: index + 1,
      provenance: [source],
    }));
  return {
    state: "complete",
    filters: normalizeExplorerFilters({ movesLimit: 30 }),
    relevant_positions: new Set(graph.decisions.filter((decision) => decision.owner === "opponent")
      .map((decision) => decision.from_position_id)).size,
    positions_queried: decisionWeights.length,
    positions_weighted: decisionWeights.length,
    positions_skipped: 0,
    budget_exhausted: false,
    decision_weights: decisionWeights,
    weighting: { mode: "external", decision_weights: decisionWeights, provenance: [source] },
    provenance: [source],
  };
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function semanticPositionId(fen: string): string {
  return `position:${stableHash(positionKey(fen))}`;
}

export function expandedNovelLine(
  complete: ReplacementCompleteCandidateExpansion,
): ReplacementCompleteCandidateExpansion {
  const subtree = complete.subtree;
  const root = subtree.nodes[0]!;
  const outcome = subtree.nodes[1]!;
  const sans = ["Be7", "O-O", "Nf6", "d3", "O-O", "Nc3", "d6", "Re1", "a6"];
  let chess = Chess.fromSetup(parseFen(outcome.fen).unwrap()).unwrap();
  let fromNodeId = outcome.node_id;
  const nodes: Array<typeof subtree.nodes[number]> = [];
  const edges: Array<typeof subtree.edges[number]> = [];
  const nodeIds = [root.node_id, outcome.node_id];
  const edgeIds = [subtree.edges[0]!.edge_id];
  const opponentEdgeIds: string[] = [];
  for (const [index, san] of sans.entries()) {
    const move = parseSan(chess, san);
    assert.ok(move, `${san} at ${makeFen(chess.toSetup())}`);
    const canonicalSan = makeSan(chess, move);
    const uci = makeUci(move);
    const fromPositionId = semanticPositionId(makeFen(chess.toSetup()));
    const mover = chess.turn;
    chess.play(move);
    const fen = makeFen(chess.toSetup());
    const positionId = semanticPositionId(fen);
    const nodeId = `node:${complete.candidate_id}:novel:${index}`;
    const edgeId = `edge:${complete.candidate_id}:novel:${index}`;
    const owner = mover === complete.seed.repertoire_color ? "repertoire" as const : "opponent" as const;
    const decisionId = `decision:${stableHash([fromPositionId, uci, positionId].join("\u001f"))}`;
    edges.push({
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      edge_id: edgeId,
      from_node_id: fromNodeId,
      to_node_id: nodeId,
      decision_id: decisionId,
      san: canonicalSan,
      uci,
      mover_color: mover,
      owner,
      forcing: owner === "opponent" && opponentEdgeIds.length === 0,
      expected_opponent_frequency: owner === "opponent" ? 1 : null,
      source_san_paths: [],
      annotation_text: [],
    });
    if (owner === "opponent") opponentEdgeIds.push(edgeId);
    nodes.push({
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      node_id: nodeId,
      kind: index === sans.length - 1 ? "terminal" : owner === "opponent"
        ? "opponent-reply" : "repertoire-decision",
      position_id: positionId,
      fen,
      ply: outcome.ply + index + 1,
      outgoing_edge_ids: [],
      source_san_paths: [],
      transposition_target_position_id: null,
    });
    const previous = nodes.at(-2);
    if (previous) nodes[nodes.length - 2] = { ...previous, outgoing_edge_ids: [edgeId] };
    fromNodeId = nodeId;
    nodeIds.push(nodeId);
    edgeIds.push(edgeId);
  }
  return {
    ...complete,
    subtree: {
      ...subtree,
      subtree_id: `${subtree.subtree_id}:novel`,
      nodes: [root, {
        ...outcome,
        kind: "repertoire-decision",
        outgoing_edge_ids: [edges[0]!.edge_id],
        transposition_target_position_id: null,
      }, ...nodes] as typeof subtree.nodes,
      edges: [subtree.edges[0]!, ...edges] as typeof subtree.edges,
      routes: [{
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        route_id: `route:${complete.candidate_id}:novel`,
        node_ids: nodeIds,
        edge_ids: edgeIds,
        terminal_node_id: nodeIds.at(-1)!,
        termination: "strategic-horizon",
        expected_opponent_frequency: 1,
      }],
      important_reply_count: opponentEdgeIds.length,
      covered_important_reply_count: opponentEdgeIds.length,
      forcing_reply_count: 1,
      covered_forcing_reply_count: 1,
      completion: {
        kind: "expanded-opponent-replies",
        opponent_reply_edge_ids: opponentEdgeIds as [string, ...string[]],
        comparable_strategic_horizon_reached: true,
      },
    },
  };
}

export function scoredFixture(
  fixture: ReturnType<typeof contextFixture>,
  candidates: readonly ReplacementCandidateExpansion[],
) {
  const first = scoreReplacementCandidates(input(fixture, candidates));
  const scoringInput = input(fixture, candidates, allCandidateConceptMastery(first));
  return scoreReplacementCandidates({
    ...scoringInput,
    metrics: comparableMetrics(scoringInput.metrics),
    popularity: popularityFor(fixture.graph),
  });
}

export function addOnlyFixture(candidateKind: "novel" | "transposition" = "novel", pgn = PGN) {
  const values = completeFixture();
  const candidate = candidateKind === "novel" ? expandedNovelLine(values.candidates[0]!) : values.candidates[0]!;
  const scoring = scoredFixture(values.fixture, [candidate]);
  const tree = GameTree.fromPgn(pgn);
  const safety = simulateReplacementSafety({
    source_tree: tree,
    request: values.fixture.request,
    scoring,
  });
  return { tree, request: values.fixture.request, scoring, safety, candidate };
}

export function replacementFixture(pgnComment = "", repertoireRevision = "revision:score") {
  const shortRuy = PGN.replace(
    "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 *",
    `1. e4 e5 2. Nf3 Nc6 3. Bb5${pgnComment ? ` {${pgnComment}}` : ""} *`,
  );
  const fixture = contextFixture(undefined, "white", "e4 e5 Nf3 Nc6 Bc4", shortRuy, repertoireRevision);
  const base = completeCandidate(fixture, "Bc4", "candidate:safe-replacement", 20, 0.8);
  const candidate = expandedNovelLine(base);
  const scoring = scoredFixture(fixture, [candidate]);
  const tree = GameTree.fromPgn(shortRuy);
  const safety = simulateReplacementSafety({
    source_tree: tree,
    request: fixture.request,
    scoring,
    candidate_actions: [{ candidate_id: candidate.candidate_id, action: "replace", prune_explicitly_confirmed: true }],
  });
  return { tree, request: fixture.request, scoring, safety, candidate, shortRuy };
}
