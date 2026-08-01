import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";

import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { makeUci } from "chessops/util";

import {
  GameTree,
  REPLACEMENT_SAFETY_ACTIONS,
  REPLACEMENT_SAFETY_ACTION_LABELS,
  REPLACEMENT_SAFETY_CANDIDATE_STATUSES,
  REPLACEMENT_SAFETY_ERROR_CODES,
  REPLACEMENT_SAFETY_RESULT_STATUSES,
  REPLACEMENT_SAFETY_CHECK_KINDS,
  REPLACEMENT_SAFETY_CHECK_STATUSES,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
  normalizeExplorerFilters,
  positionKey,
  scoreReplacementCandidates,
  simulateReplacementSafety,
  type ReplacementCandidateExpansion,
  type ReplacementCompleteCandidateExpansion,
  type ReplacementExpansionOmission,
  type ReplacementRequest,
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
  incompleteCandidate,
  input,
} from "./replacement-score.fixtures.ts";

const version = {
  schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  replacement_schema_version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
} as const;

const safetySource: StrategicFitSourceProvenance = {
  source_id: "test:replacement-safety",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
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
    provenance: [safetySource],
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
  state: StrategicPopularityCollection["state"] = "complete",
): StrategicPopularityCollection {
  const decisionWeights = graph.decisions
    .filter((decision) => decision.owner === "opponent")
    .map((decision, index) => ({
      decision_id: decision.decision_id,
      weight: index + 1,
      provenance: [safetySource],
    }));
  return {
    state,
    filters: normalizeExplorerFilters({ movesLimit: 30 }),
    relevant_positions: new Set(
      graph.decisions
        .filter((decision) => decision.owner === "opponent")
        .map((decision) => decision.from_position_id),
    ).size,
    positions_queried: state === "complete" ? decisionWeights.length : 1,
    positions_weighted: state === "complete" ? decisionWeights.length : 1,
    positions_skipped: state === "complete" ? 0 : Math.max(0, decisionWeights.length - 1),
    budget_exhausted: state === "partial",
    decision_weights: decisionWeights,
    weighting: {
      mode: "external",
      decision_weights: decisionWeights,
      provenance: [safetySource],
    },
    provenance: [
      {
        ...safetySource,
        kind: "opening-explorer",
        state:
          state === "complete" ? "available" : state === "unavailable" ? "unavailable" : "partial",
        reason: state === "complete" ? null : "Fixture popularity evidence is partial.",
      },
    ],
  };
}

function scoringFixture(
  candidates?: readonly ReplacementCandidateExpansion[],
  options: {
    expansionStatus?: "complete" | "partial";
    popularity?: StrategicPopularityCollection | null;
    metrics?: StrategicFitMetrics;
  } = {},
) {
  const values = completeFixture();
  const expansions = candidates ?? values.candidates;
  const first = scoreReplacementCandidates(
    input(values.fixture, expansions, null, options.expansionStatus ?? "complete"),
  );
  const training = allCandidateConceptMastery(first);
  const baseInput = input(
    values.fixture,
    expansions,
    training,
    options.expansionStatus ?? "complete",
  );
  const scoringInput = {
    ...baseInput,
    metrics: options.metrics ?? comparableMetrics(baseInput.metrics),
    popularity: options.popularity ?? null,
  };
  return {
    ...values,
    tree: GameTree.fromPgn(PGN),
    scoringInput,
    scoring: scoreReplacementCandidates(scoringInput),
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

function expandedNovelLine(
  complete: ReplacementCompleteCandidateExpansion,
): ReplacementCompleteCandidateExpansion {
  const subtree = complete.subtree;
  const root = subtree.nodes[0]!;
  const outcome = subtree.nodes[1]!;
  const sans = ["Be7", "O-O", "Nf6", "d3", "O-O", "Nc3", "d6", "Re1", "a6"];
  let chess = Chess.fromSetup(parseFen(outcome.fen).unwrap()).unwrap();
  let fromNodeId = outcome.node_id;
  const nodes: Array<(typeof subtree.nodes)[number]> = [];
  const edges: Array<(typeof subtree.edges)[number]> = [];
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
    const owner =
      mover === complete.seed.repertoire_color ? ("repertoire" as const) : ("opponent" as const);
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
      kind:
        index === sans.length - 1
          ? "terminal"
          : owner === "opponent"
            ? "opponent-reply"
            : "repertoire-decision",
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
      nodes: [
        root,
        {
          ...outcome,
          kind: "repertoire-decision",
          outgoing_edge_ids: [edges[0]!.edge_id],
          transposition_target_position_id: null,
        },
        ...nodes,
      ] as typeof subtree.nodes,
      edges: [subtree.edges[0]!, ...edges] as typeof subtree.edges,
      routes: [
        {
          analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
          route_id: `route:${complete.candidate_id}:novel`,
          node_ids: nodeIds,
          edge_ids: edgeIds,
          terminal_node_id: nodeIds.at(-1)!,
          termination: "strategic-horizon",
          expected_opponent_frequency: 1,
        },
      ],
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

function safetyInput(
  values: ReturnType<typeof scoringFixture>,
  actions?: Parameters<typeof simulateReplacementSafety>[0]["candidate_actions"],
) {
  return {
    source_tree: values.tree,
    request: values.fixture.request,
    scoring: values.scoring,
    candidate_actions: actions,
  };
}

test("safe add-only alternative uses exact label and clone-only simulation", () => {
  const base = completeFixture();
  const values = scoringFixture([expandedNovelLine(base.candidates[0]!)], {
    popularity: popularityFor(base.fixture.graph),
  });
  const treeBefore = values.tree.toPgn();
  const result = simulateReplacementSafety(safetyInput(values));
  assert.ok(result.candidates.length > 0);
  assert.ok(result.candidates.every((candidate) => candidate.action === "add-alternative"));
  assert.ok(result.candidates.every((candidate) => candidate.action_label === "Add alternative"));
  assert.ok(
    result.candidates.every(
      (candidate) => candidate.status !== "blocked" && candidate.status !== "unavailable",
    ),
  );
  assert.ok(
    result.candidates.every(
      (candidate) =>
        candidate.safety_checks.find((check) => check.kind === "coverage")?.status === "passed",
    ),
  );
  assert.equal(values.tree.toPgn(), treeBefore);
  assert.equal(result.source_tree_unchanged, true);
});

test("safe replacement simulates explicit pruning without exposing an applied tree", () => {
  const shortRuy = PGN.replace(
    "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 *",
    "1. e4 e5 2. Nf3 Nc6 3. Bb5 *",
  );
  const fixture = contextFixture(undefined, "white", "e4 e5 Nf3 Nc6 Bc4", shortRuy);
  const base = completeCandidate(fixture, "Bc4", "candidate:safe-replacement", 20, 0.8);
  const candidate = expandedNovelLine(base);
  const first = scoreReplacementCandidates(input(fixture, [candidate]));
  const scoringInput = input(fixture, [candidate], allCandidateConceptMastery(first));
  const scoring = scoreReplacementCandidates({
    ...scoringInput,
    metrics: comparableMetrics(scoringInput.metrics),
    popularity: popularityFor(fixture.graph),
  });
  const candidateId = candidate.candidate_id;
  const result = simulateReplacementSafety({
    source_tree: GameTree.fromPgn(shortRuy),
    request: fixture.request,
    scoring,
    candidate_actions: [
      {
        candidate_id: candidateId,
        action: "replace",
        prune_explicitly_confirmed: true,
      },
    ],
  });
  const simulated = result.candidates.find((item) => item.candidate_id === candidateId)!;
  assert.notEqual(
    simulated.status,
    "blocked",
    `${simulated.error_code}:${simulated.coverage_effects.newly_uncovered_replies
      .map(
        (reply) => `${reply.san}@${reply.source_san_paths.map((path) => path.join(" ")).join("|")}`,
      )
      .slice(0, 5)
      .join(",")}`,
  );
  assert.notEqual(simulated.status, "unavailable");
  assert.equal(
    simulated.safety_checks.find((check) => check.kind === "coverage")!.status,
    "passed",
  );
  assert.equal(simulated.coverage_effects.newly_uncovered_replies.length, 0);
  assert.equal(Object.hasOwn(simulated, "operations"), false);
  assert.equal(Object.hasOwn(simulated, "result"), false);
});

test("pruning coverage regression is blocked with exact newly uncovered replies", () => {
  const initial = completeFixture();
  const popularity = popularityFor(initial.fixture.graph);
  const values = scoringFixture(undefined, { popularity });
  const candidateId = "candidate:familiar";
  const result = simulateReplacementSafety(
    safetyInput(values, [
      {
        candidate_id: candidateId,
        action: "replace",
        prune_explicitly_confirmed: true,
      },
    ]),
  );
  const candidate = result.candidates.find((item) => item.candidate_id === candidateId)!;
  assert.equal(candidate.status, "blocked");
  assert.equal(candidate.error_code, "required-reply-uncovered");
  assert.ok(candidate.coverage_effects.newly_uncovered_replies.length > 0);
  assert.ok(
    candidate.coverage_effects.newly_uncovered_replies.every(
      (reply) =>
        reply.state === "available" && reply.provenance.length > 0 && reply.reason.length > 0,
    ),
  );
  assert.equal(
    candidate.safety_checks.find((check) => check.kind === "gap-scan")!.status,
    "blocked",
  );
  assert.equal(
    candidate.coverage_effects.required_reply_count_after,
    candidate.coverage_effects.required_reply_count_before -
      candidate.coverage_effects.newly_uncovered_replies.length,
  );
});

test("opponent replies without popularity rows remain required and cannot be pruned silently", () => {
  const values = scoringFixture();
  const candidateId = "candidate:familiar";
  const result = simulateReplacementSafety(
    safetyInput(values, [
      {
        candidate_id: candidateId,
        action: "replace",
        prune_explicitly_confirmed: true,
      },
    ]),
  );
  const candidate = result.candidates.find((item) => item.candidate_id === candidateId)!;
  assert.equal(candidate.status, "blocked");
  assert.equal(candidate.error_code, "required-reply-uncovered");
  assert.ok(candidate.coverage_effects.newly_uncovered_replies.length > 0);
});

test("novel complete subtree reports exact newly covered replies and weighted delta", () => {
  const base = completeFixture();
  const novel = expandedNovelLine(base.candidates[0]!);
  const values = scoringFixture([novel], { popularity: popularityFor(base.fixture.graph) });
  const result = simulateReplacementSafety(safetyInput(values));
  const candidate = result.candidates[0]!;
  assert.equal(candidate.coverage_effects.newly_uncovered_replies.length, 0);
  assert.equal(candidate.coverage_effects.newly_covered_replies.length, 5);
  assert.equal(
    candidate.coverage_effects.required_reply_count_after,
    candidate.coverage_effects.required_reply_count_before + 5,
  );
  assert.ok(candidate.coverage_effects.required_reply_count_before > 0);
  assert.ok(candidate.coverage_effects.popularity_weighted_before! > 0);
  assert.ok(candidate.coverage_effects.popularity_weighted_before! < 1);
  assert.equal(candidate.coverage_effects.popularity_weighted_after, 1);
  assert.equal(
    candidate.coverage_effects.popularity_weighted_delta,
    Math.round((1 - candidate.coverage_effects.popularity_weighted_before!) * 1_000_000) /
      1_000_000,
  );
  assert.equal(
    candidate.coverage_effects.newly_covered_replies.some((reply) => reply.forcing),
    true,
  );
});

test("forcing reply evidence cannot disappear silently", () => {
  const base = completeFixture();
  const oldReply = base.fixture.graph.decisions.find(
    (decision) =>
      decision.owner === "opponent" &&
      decision.route_ids.includes(base.fixture.pivotRoute.route_id) &&
      decision.plies.some((ply) => ply > base.fixture.pivot.ply),
  )!;
  const omission: ReplacementExpansionOmission = {
    ...version,
    omission_id: "omission:forcing-regression",
    position_id: oldReply.from_position_id,
    decision_id: oldReply.decision_id,
    san: oldReply.san,
    uci: oldReply.uci,
    important: true,
    forcing: true,
    played_probability: 0.4,
    reason: "provider-unavailable",
    explanation: "Required forcing reply evidence fixture.",
    provenance: [safetySource],
  };
  const candidate = { ...base.candidates[0]!, omissions: [omission] };
  const values = scoringFixture([candidate]);
  const result = simulateReplacementSafety(
    safetyInput(values, [
      {
        candidate_id: candidate.candidate_id,
        action: "replace",
        prune_explicitly_confirmed: true,
      },
    ]),
  );
  const uncovered = result.candidates[0]!.coverage_effects.newly_uncovered_replies;
  assert.equal(result.candidates[0]!.status, "blocked");
  assert.ok(uncovered.some((reply) => reply.decision_id === oldReply.decision_id && reply.forcing));
});

test("duplicates, canonical transpositions, and false gaps remain separate", () => {
  const values = scoringFixture();
  const result = simulateReplacementSafety(safetyInput(values));
  const familiar = result.candidates.find(
    (candidate) => candidate.candidate_id === "candidate:familiar",
  )!;
  assert.ok(familiar.coverage_effects.duplicate_branch_ids.length > 0);
  assert.equal(familiar.coverage_effects.newly_uncovered_replies.length, 0);
  assert.equal(
    new Set(familiar.coverage_effects.new_transposition_position_ids).size,
    familiar.coverage_effects.new_transposition_position_ids.length,
  );
  assert.equal(
    familiar.safety_checks.find((check) => check.kind === "duplicates")!.status,
    "warning",
  );
});

test("navigation paths and transposition aliases do not multiply coverage", () => {
  const base = completeFixture();
  const duplicated = {
    ...base.candidates[0]!,
    subtree: {
      ...base.candidates[0]!.subtree,
      nodes: base.candidates[0]!.subtree.nodes.map((node) => ({
        ...node,
        source_san_paths: [...node.source_san_paths, ...node.source_san_paths].reverse(),
      })) as (typeof base.candidates)[0]["subtree"]["nodes"],
      edges: base.candidates[0]!.subtree.edges.map((edge) => ({
        ...edge,
        source_san_paths: [...edge.source_san_paths, ...edge.source_san_paths].reverse(),
      })) as (typeof base.candidates)[0]["subtree"]["edges"],
    },
  };
  const values = scoringFixture([duplicated]);
  const candidate = simulateReplacementSafety(safetyInput(values)).candidates[0]!;
  const baseline = simulateReplacementSafety(safetyInput(scoringFixture([base.candidates[0]!])))
    .candidates[0]!;
  assert.equal(
    candidate.coverage_effects.required_reply_count_before,
    baseline.coverage_effects.required_reply_count_before,
  );
  assert.equal(
    candidate.coverage_effects.required_reply_count_after,
    baseline.coverage_effects.required_reply_count_after,
  );
  assert.equal(
    candidate.coverage_effects.popularity_weighted_after,
    baseline.coverage_effects.popularity_weighted_after,
  );
});

test("affected Strategic Fit metric emits exact before, after, delta, state, and provenance", () => {
  const base = completeFixture();
  const values = scoringFixture([expandedNovelLine(base.candidates[0]!)]);
  const candidate = simulateReplacementSafety(safetyInput(values)).candidates[0]!;
  const effect = candidate.coverage_effects.affected_metrics.find(
    (item) => item.metric_id === "familiarity-adjusted-coverage",
  )!;
  assert.equal(effect.state, "partial");
  assert.equal(effect.before, 0.4);
  assert.equal(effect.after, 0);
  assert.equal(effect.delta, -0.4);
  assert.match(effect.reason!, /expected route weight/);
  assert.ok(effect.provenance.length > 0);
});

test("missing and partial popularity, coverage, and metric evidence stays explicit", () => {
  const base = completeFixture();
  const novel = expandedNovelLine(base.candidates[0]!);
  const lastOpponentEdge = [...novel.subtree.edges]
    .reverse()
    .find((edge) => edge.owner === "opponent")!;
  const partialCandidate = {
    ...novel,
    subtree: {
      ...novel.subtree,
      edges: novel.subtree.edges.map((edge) =>
        edge.edge_id === lastOpponentEdge.edge_id
          ? { ...edge, expected_opponent_frequency: null }
          : edge,
      ) as typeof novel.subtree.edges,
      routes: novel.subtree.routes.map((route) => ({
        ...route,
        expected_opponent_frequency: null,
      })) as typeof novel.subtree.routes,
    },
  };
  const unavailableMetrics = input(base.fixture, [partialCandidate]).metrics;
  const values = scoringFixture([partialCandidate], {
    metrics: unavailableMetrics,
    popularity: popularityFor(base.fixture.graph, "partial"),
  });
  const candidate = simulateReplacementSafety(safetyInput(values)).candidates[0]!;
  assert.equal(candidate.status, "partial");
  assert.equal(candidate.coverage_effects.state, "partial");
  assert.equal(candidate.coverage_effects.popularity_weighted_before, null);
  assert.equal(candidate.coverage_effects.popularity_weighted_after, null);
  assert.ok(candidate.coverage_effects.reason!.includes("not counted as zero"));
  assert.ok(
    candidate.coverage_effects.affected_metrics.every((effect) => effect.state !== "available"),
  );
  assert.notEqual(
    candidate.safety_checks.find((check) => check.kind === "affected-cohort-preview")!.status,
    "passed",
  );
});

test("partial, truncated, blocked, stale, and unscored Task 8.5-8.6 boundaries cannot masquerade", () => {
  const base = completeFixture();
  const truncated = incompleteCandidate(base.candidates[0]!);
  const blocked = {
    ...incompleteCandidate(base.candidates[1]!),
    status: "unavailable" as const,
    subtree: {
      ...incompleteCandidate(base.candidates[1]!).subtree!,
      status: "blocked" as const,
      truncation_reasons: ["provider-unavailable"] as [string, ...string[]],
    },
  };
  const values = scoringFixture([base.candidates[2]!, truncated, blocked], {
    expansionStatus: "partial",
  });
  const result = simulateReplacementSafety(safetyInput(values));
  for (const id of [truncated.candidate_id, blocked.candidate_id]) {
    const candidate = result.candidates.find((item) => item.candidate_id === id)!;
    assert.equal(candidate.status, "unavailable");
    assert.equal(candidate.error_code, "candidate-unscored");
    assert.equal(candidate.coverage_effects.state, "unavailable");
  }
  const stale = simulateReplacementSafety({
    ...safetyInput(values),
    scoring: { ...values.scoring, status: "stale" },
  });
  assert.equal(stale.status, "stale");
  assert.equal(stale.error_code, "scoring-not-current");
  assert.deepEqual(stale.candidates, []);
});

test("dominated candidates remain inspectable through safety simulation", () => {
  const values = scoringFixture();
  const dominated = values.scoring.candidates.find(
    (candidate) => candidate.pareto.status === "dominated",
  )!;
  const result = simulateReplacementSafety(safetyInput(values));
  const retained = result.candidates.find(
    (candidate) => candidate.candidate_id === dominated.candidate_id,
  )!;
  assert.equal(retained.scored_candidate.pareto.status, "dominated");
  assert.deepEqual(
    retained.scored_candidate.pareto.dominated_by_candidate_ids,
    dominated.pareto.dominated_by_candidate_ids,
  );
});

test("ordering is deterministic across candidate, source, evidence, path, reply, metric, duplicate, and transposition order", () => {
  const values = scoringFixture();
  const first = simulateReplacementSafety(safetyInput(values));
  const reversedExpansion = {
    ...values.scoringInput.expansion,
    candidates: [...values.scoringInput.expansion.candidates].reverse().map((candidate) => ({
      ...candidate,
      source_results: [...candidate.source_results].reverse(),
      evidence_item_results: [...candidate.evidence_item_results].reverse(),
      omissions: [...candidate.omissions].reverse(),
      unresolved_risks: [...candidate.unresolved_risks].reverse(),
      seed: {
        ...candidate.seed,
        source_san_paths: [...candidate.seed.source_san_paths].reverse(),
        provenance: [...candidate.seed.provenance].reverse(),
      },
      subtree:
        candidate.subtree === null
          ? null
          : {
              ...candidate.subtree,
              nodes: [...candidate.subtree.nodes].reverse().map((node) => ({
                ...node,
                source_san_paths: [...node.source_san_paths].reverse(),
              })),
              edges: [...candidate.subtree.edges].reverse().map((edge) => ({
                ...edge,
                source_san_paths: [...edge.source_san_paths].reverse(),
              })),
              routes: [...candidate.subtree.routes].reverse(),
              provenance: [...candidate.subtree.provenance].reverse(),
            },
    })),
    source_results: [...values.scoringInput.expansion.source_results].reverse(),
    evidence_item_results: [...values.scoringInput.expansion.evidence_item_results].reverse(),
    omissions: [...values.scoringInput.expansion.omissions].reverse(),
    unresolved_risks: [...values.scoringInput.expansion.unresolved_risks].reverse(),
    provenance: [...values.scoringInput.expansion.provenance].reverse(),
  };
  const reversedScoring = scoreReplacementCandidates({
    ...values.scoringInput,
    expansion: reversedExpansion,
  });
  const second = simulateReplacementSafety({
    ...safetyInput(values),
    scoring: reversedScoring,
    candidate_actions: [...values.scoring.candidates].reverse().map((candidate) => ({
      candidate_id: candidate.candidate_id,
      action: "add-alternative" as const,
    })),
  });
  assert.equal(second.status === "stale", false, "reordered set-like evidence must remain current");
  assert.equal(isDeepStrictEqual(second, first), true, "deterministic safety result mismatch");
});

test("runtime pruning requires a known action and literal confirmation", () => {
  const values = scoringFixture();
  const candidateId = values.scoring.candidates[0]!.candidate_id;
  const unconfirmed = simulateReplacementSafety({
    ...safetyInput(values),
    candidate_actions: [
      {
        candidate_id: candidateId,
        action: "replace",
        prune_explicitly_confirmed: false,
      } as unknown as { candidate_id: string; action: "replace"; prune_explicitly_confirmed: true },
    ],
  });
  assert.equal(unconfirmed.status, "invalid-request");
  assert.equal(unconfirmed.error_code, "prune-not-confirmed");

  const unknown = simulateReplacementSafety({
    ...safetyInput(values),
    candidate_actions: [{ candidate_id: candidateId, action: "remove" } as never],
  });
  assert.equal(unknown.status, "invalid-request");
  assert.equal(unknown.error_code, "invalid-candidate-action");
});

test("blocked objective evidence propagates to candidate and result status", () => {
  const base = completeFixture();
  const candidate = base.candidates[0]!;
  const unsafe = {
    ...candidate,
    seed: {
      ...candidate.seed,
      objective_quality: {
        ...candidate.seed.objective_quality,
        repertoire_pov_loss_from_best_cp: 300,
        repertoire_pov_verdict: "outside-tolerance" as const,
      },
    },
  };
  const values = scoringFixture([unsafe]);
  const result = simulateReplacementSafety(safetyInput(values));
  assert.equal(result.status, "blocked");
  assert.equal(result.candidates[0]!.status, "blocked");
  assert.equal(result.candidates[0]!.error_code, "objective-safety-blocked");
  assert.equal(
    result.candidates[0]!.safety_checks.find((check) => check.kind === "engine-sanity")!.status,
    "blocked",
  );
});

test("Black repertoire ownership stays distinct from White-POV engine transport", () => {
  const fixture = contextFixture(undefined, "black");
  const candidate = completeCandidate(fixture, "Nf6", "candidate:black-safety", 20, 0.8);
  const first = scoreReplacementCandidates(input(fixture, [candidate]));
  const baseInput = input(fixture, [candidate], allCandidateConceptMastery(first));
  const scoring = scoreReplacementCandidates({
    ...baseInput,
    metrics: comparableMetrics(baseInput.metrics),
  });
  const tree = GameTree.fromPgn(PGN);
  const result = simulateReplacementSafety({
    source_tree: tree,
    request: fixture.request,
    scoring,
  });
  const simulated = result.candidates[0]!;
  assert.equal(simulated.repertoire_color, "black");
  assert.equal(simulated.scored_candidate.expansion.seed.pivot.owner, "repertoire");
  assert.equal(simulated.scored_candidate.expansion.seed.mover_color, "black");
  assert.equal(
    typeof simulated.scored_candidate.objective_quality.white_pov_evaluation_cp,
    "number",
  );
  assert.equal(
    typeof simulated.scored_candidate.objective_quality.repertoire_pov_evaluation_cp,
    "number",
  );
});

test("identity, provenance, versions, source evidence, and full inputs serialize unchanged", () => {
  const values = scoringFixture();
  const requestBefore = JSON.stringify(values.fixture.request);
  const scoringBefore = JSON.stringify(values.scoring);
  const treeBefore = values.tree.toPgn();
  const inputValue = safetyInput(values);
  const result = simulateReplacementSafety(inputValue);
  assert.equal(
    isDeepStrictEqual(JSON.parse(JSON.stringify(result)), result),
    true,
    "safety result must remain JSON-serializable",
  );
  for (const key of [
    "request_id",
    "report_id",
    "finding_id",
    "semantic_finding_id",
    "cohort_id",
    "repertoire_revision",
    "repertoire_color",
  ] as const) {
    assert.equal(result[key], values.fixture.request[key]);
  }
  assert.equal(result.schema_version, STRATEGIC_FIT_SCHEMA_VERSION);
  assert.equal(result.analysis_version, STRATEGIC_FIT_ANALYSIS_VERSION);
  assert.equal(result.replacement_schema_version, STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION);
  assert.equal(
    isDeepStrictEqual(result.scoring.expansion, values.scoring.expansion),
    true,
    "Task 8.5 expansion changed",
  );
  assert.equal(
    isDeepStrictEqual(result.scoring.context.graph, values.scoring.context.graph),
    true,
    "source graph changed",
  );
  assert.equal(
    isDeepStrictEqual(result.scoring.context.profile, values.scoring.context.profile),
    true,
    "profile changed",
  );
  assert.equal(JSON.stringify(values.fixture.request), requestBefore);
  assert.equal(JSON.stringify(values.scoring), scoringBefore);
  assert.equal(values.tree.toPgn(), treeBefore);
  assert.equal(result.request_unchanged, true);
  assert.equal(result.scoring_unchanged, true);
  assert.equal(result.expansion_unchanged, true);
  assert.equal(result.evidence_unchanged, true);
  assert.equal(result.inputs_unchanged, true);
});

test("invalid action sets and source graph mismatch fail before simulation", () => {
  const values = scoringFixture();
  const id = values.scoring.candidates[0]!.candidate_id;
  const duplicate = simulateReplacementSafety(
    safetyInput(values, [
      { candidate_id: id, action: "add-alternative" },
      { candidate_id: id, action: "replace", prune_explicitly_confirmed: true },
    ]),
  );
  assert.equal(duplicate.status, "invalid-request");
  assert.equal(duplicate.error_code, "duplicate-candidate-action");
  const mismatched = simulateReplacementSafety({
    ...safetyInput(values),
    source_tree: GameTree.fromPgn("1. d4 d5 2. c4 e6 *"),
  });
  assert.equal(mismatched.status, "stale");
  assert.equal(mismatched.error_code, "source-graph-mismatch");
});

test("coverage/safety actions, states, errors, checks, and statuses are exhaustive and duplicate-free", () => {
  assert.deepEqual(REPLACEMENT_SAFETY_ACTIONS, ["add-alternative", "replace"]);
  assert.equal(REPLACEMENT_SAFETY_ACTION_LABELS["add-alternative"], "Add alternative");
  assert.deepEqual(REPLACEMENT_SAFETY_CANDIDATE_STATUSES, [
    "safe",
    "partial",
    "blocked",
    "unavailable",
  ]);
  assert.deepEqual(REPLACEMENT_SAFETY_RESULT_STATUSES, [
    "complete",
    "partial",
    "blocked",
    "unavailable",
    "stale",
    "invalid-request",
  ]);
  assert.deepEqual(REPLACEMENT_SAFETY_ERROR_CODES, [
    "request-scoring-mismatch",
    "scoring-not-current",
    "source-graph-mismatch",
    "duplicate-candidate-action",
    "unknown-candidate",
    "invalid-candidate-action",
    "prune-not-confirmed",
    "candidate-unscored",
    "candidate-expansion-incomplete",
    "candidate-identity-mismatch",
    "simulation-failed",
    "required-reply-uncovered",
    "objective-safety-blocked",
  ]);
  assert.deepEqual(REPLACEMENT_SAFETY_CHECK_KINDS, [
    "legality",
    "engine-sanity",
    "coverage",
    "gap-scan",
    "transpositions",
    "duplicates",
    "stale-revision",
    "affected-cohort-preview",
  ]);
  assert.deepEqual(REPLACEMENT_SAFETY_CHECK_STATUSES, [
    "passed",
    "warning",
    "blocked",
    "unavailable",
  ]);
  for (const values of [
    REPLACEMENT_SAFETY_ACTIONS,
    REPLACEMENT_SAFETY_CANDIDATE_STATUSES,
    REPLACEMENT_SAFETY_RESULT_STATUSES,
    REPLACEMENT_SAFETY_ERROR_CODES,
    REPLACEMENT_SAFETY_CHECK_KINDS,
    REPLACEMENT_SAFETY_CHECK_STATUSES,
  ]) {
    assert.equal(new Set(values).size, values.length);
  }
});
