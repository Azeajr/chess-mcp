import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
  buildRepertoireGraph,
  generateReplacementCandidates,
  generateReplacementEngineCandidates,
  selectReplacementPivot,
  type CausalAttribution,
  type Color,
  type GenerateReplacementEngineCandidatesInput,
  type ReplacementCandidateSourceKind,
  type ReplacementEngineAnalysisEvidence,
  type ReplacementEngineDynamicObservations,
  type ReplacementEngineIdentity,
  type ReplacementEngineLineEvidence,
  type ReplacementEngineProvider,
  type ReplacementEngineProviderRequest,
  type ReplacementOpeningDatabaseEvidence,
  type ReplacementPivotCohortEvidence,
  type ReplacementPivotFindingEvidence,
  type ReplacementRequest,
  type RepertoireGraph,
  type RepertoireGraphDecision,
  type RepertoireGraphRoute,
  type StrategicFitSourceProvenance,
} from "../../src/index.ts";
import { BLACK_REPLACEMENT_REQUEST } from "./replacement-types.compile.ts";

const version = {
  schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  replacement_schema_version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
} as const;

const source: StrategicFitSourceProvenance = {
  source_id: "test:replacement-engine",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_FIT_ANALYSIS_VERSION,
  snapshot: "revision:engine",
  reason: null,
};

const identity: ReplacementEngineIdentity = {
  engine_id: "stockfish:test",
  name: "Stockfish Test",
  version: "18-test",
  configuration_id: "threads=1|hash=16",
  configuration: { Threads: 1, Hash: 16 },
  analysis_schema_version: "uci-multipv:1",
};

const observations: ReplacementEngineDynamicObservations = {
  tactical_volatility: 0.3,
  evaluation_sensitivity_cp: 12,
  forcing_move_count: 2,
  observed_move_count: 4,
  king_safety_risk: 0.2,
};

const WHITE_GAMES = [
  `[Event "Engine pivot"]
[Result "*"]

1. e4 e5 2. Bc4 Nf6 3. d3 *`,
  `[Event "Prepared Nc3"]
[Result "*"]

1. e4 e5 2. Nc3 Nc6 3. Nf3 *`,
  `[Event "Prepared Nf3"]
[Result "*"]

1. Nf3 e5 2. e4 Nc6 3. Bb5 *`,
] as const;

const BLACK_GAMES = [
  `[Event "Black pivot"]
[Result "*"]

1. e4 c5 2. Nf3 d6 *`,
  `[Event "Black prepared"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 *`,
] as const;

function routeBeginning(graph: RepertoireGraph, prefix: string): RepertoireGraphRoute {
  const route = graph.routes.find((candidate) => candidate.san_moves.join(" ").startsWith(prefix));
  assert.ok(route);
  return route;
}

function decisionAt(
  graph: RepertoireGraph,
  route: RepertoireGraphRoute,
  san: string,
): RepertoireGraphDecision {
  const index = route.san_moves.indexOf(san);
  assert.notEqual(index, -1);
  const decision = graph.decisions.find(
    (candidate) => candidate.decision_id === route.decision_ids[index],
  );
  assert.ok(decision);
  return decision;
}

function attribution(
  route: RepertoireGraphRoute,
  decision: RepertoireGraphDecision,
): CausalAttribution {
  const ply = route.decision_ids.indexOf(decision.decision_id) + 1;
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    controllability: 0.9,
    label: "mostly-player-controlled",
    player_contribution: 0.9,
    opponent_contribution: 0.1,
    likely_causal_decision_ids: [decision.decision_id],
    timeline: [
      {
        event_id: `event:${decision.decision_id}`,
        kind: "player-decision",
        ply,
        position_id: route.position_ids[ply - 1]!,
        decision_id: decision.decision_id,
        san: decision.san,
        explanation: "Engine fixture pivot.",
      },
    ],
    explanation: "Engine fixture causality.",
  };
}

function setup(
  color: Color = "white",
  games: readonly string[] = WHITE_GAMES,
  routePrefix = "e4 e5 Bc4",
  pivotSan = "Bc4",
  overrides: Partial<ReplacementRequest["budget"]> = {},
  tolerance: number | null = 35,
  sources: readonly ReplacementCandidateSourceKind[] = [
    "existing-repertoire-transposition",
    "move-order-shortcut",
    "engine-multipv",
  ],
  databaseMoves: readonly {
    readonly id: string;
    readonly san: string;
    readonly uci: string;
  }[] = [],
): GenerateReplacementEngineCandidatesInput {
  const graph = buildRepertoireGraph(GameTree.fromPgn(games.join("\n\n")), color);
  const route = routeBeginning(graph, routePrefix);
  const decision = decisionAt(graph, route, pivotSan);
  const references = {
    position_ids: [...route.position_ids],
    decision_ids: [...route.decision_ids],
    route_ids: [route.route_id],
    source_san_paths: route.source_san_paths.map((path) => [...path]),
  };
  const finding: ReplacementPivotFindingEvidence = {
    finding_id: "finding:engine",
    semantic_finding_id: "semantic-finding:engine",
    repertoire_revision: "revision:engine",
    references,
    evidence: {
      cohort_id: "cohort:engine",
      dimensions: [{ dimension_id: "dynamic.tactical-volatility" }],
      causality: attribution(route, decision),
      provenance: [source],
    },
    provenance: { repertoire_revision: "revision:engine", sources: [source] },
  };
  const cohort: ReplacementPivotCohortEvidence = {
    cohort_id: "cohort:engine",
    route_ids: [route.route_id],
    route_weights: [{ route_id: route.route_id, normalized_weight: 1 }],
    transposition_position_ids: graph.transposition_links.map((link) => link.position_id),
    provenance: [source],
  };
  const request: ReplacementRequest = {
    ...BLACK_REPLACEMENT_REQUEST,
    request_id: "request:engine",
    report_id: "report:engine",
    finding_id: finding.finding_id,
    semantic_finding_id: finding.semantic_finding_id,
    cohort_id: cohort.cohort_id,
    repertoire_revision: "revision:engine",
    repertoire_color: color,
    candidate_sources: [...sources],
    maximum_repertoire_pov_loss_from_best_cp: tolerance,
    budget: {
      ...BLACK_REPLACEMENT_REQUEST.budget,
      maximum_candidates: 12,
      maximum_engine_positions: 1,
      engine_depth: 20,
      engine_multipv: 4,
      ...overrides,
    },
    provenance: [source],
  };
  const pivotResult = selectReplacementPivot({ request, graph, finding, cohort });
  assert.equal(pivotResult.status, "selected");
  const pivotPosition = graph.positions.find(
    (position) => position.position_id === pivotResult.pivot.position_id,
  );
  assert.ok(pivotPosition);
  const databaseEvidence: ReplacementOpeningDatabaseEvidence[] =
    databaseMoves.length === 0
      ? []
      : [
          {
            ...version,
            evidence_id: "database-evidence:engine-test",
            state: "available",
            database: "lichess",
            provider: "fixture-opening-explorer",
            version: "database-v1",
            snapshot: "snapshot:engine-test",
            filter_key: "db=lichess|speeds=rapid|ratings=1800|since=|until=|moves=12",
            filters: {
              db: "lichess",
              speeds: ["rapid"],
              ratings: [1800],
              since: null,
              until: null,
              movesLimit: 12,
            },
            position: {
              position_id: pivotPosition.position_id,
              position_key: pivotPosition.position_key,
              fen: pivotPosition.fen,
            },
            moves: databaseMoves.map((move) => ({
              move_id: move.id,
              san: move.san,
              uci: move.uci,
              popularity: {
                games: 100,
                played_pct: 50,
                white_pct: 40,
                draw_pct: 30,
                black_pct: 30,
                average_rating: 1900,
              },
              provenance: [
                {
                  source_id: `opening-explorer:${move.id}`,
                  kind: "opening-explorer",
                  state: "available",
                  version: "database-v1",
                  snapshot: "snapshot:engine-test",
                  reason: null,
                },
              ],
            })),
            reason: null,
            provenance: [
              {
                source_id: "opening-explorer:engine-test",
                kind: "opening-explorer",
                state: "available",
                version: "database-v1",
                snapshot: "snapshot:engine-test",
                reason: null,
              },
            ],
          },
        ];
  const candidateGeneration = generateReplacementCandidates({
    request,
    graph,
    pivot_result: pivotResult,
    database_evidence: databaseEvidence,
  });
  assert.ok(candidateGeneration.status === "complete" || candidateGeneration.status === "partial");
  return { request, graph, pivot_result: pivotResult, candidate_generation: candidateGeneration };
}

function line(
  id: string,
  rank: number,
  uci: string,
  pv: readonly string[],
  cp: number | null,
  mate: number | null = null,
  depth = 20,
  dynamic: ReplacementEngineDynamicObservations = observations,
  provenanceId = `engine-line:${id}`,
): ReplacementEngineLineEvidence {
  return {
    line_id: id,
    multipv_rank: rank,
    uci,
    pv: [...pv],
    white_pov_evaluation_cp: cp,
    white_pov_mate_in: mate,
    depth,
    observations: { ...dynamic },
    provenance: [
      {
        source_id: provenanceId,
        kind: "engine",
        state: "available",
        version: identity.version,
        snapshot: "engine-search:test",
        reason: null,
      },
    ],
  };
}

function evidence(
  input: GenerateReplacementEngineCandidatesInput,
  lines: readonly ReplacementEngineLineEvidence[],
  state: ReplacementEngineAnalysisEvidence["state"] = "available",
  overrides: Partial<ReplacementEngineAnalysisEvidence> = {},
): ReplacementEngineAnalysisEvidence {
  assert.equal(input.pivot_result.status, "selected");
  const graphPosition = input.graph.positions.find(
    (position) => position.position_id === input.pivot_result.pivot.position_id,
  );
  assert.ok(graphPosition);
  return {
    ...version,
    evidence_id: "engine-evidence:test",
    state,
    engine: { ...identity, configuration: { ...identity.configuration } },
    position: {
      position_id: graphPosition.position_id,
      position_key: graphPosition.position_key,
      fen: graphPosition.fen,
    },
    requested_depth: input.request.budget.engine_depth,
    requested_multipv: input.request.budget.engine_multipv,
    reached_depth: lines.length > 0 ? Math.max(...lines.map((item) => item.depth)) : null,
    lines: lines.map((item) => ({
      ...item,
      pv: [...item.pv],
      observations: { ...item.observations },
      provenance: item.provenance.map((itemSource) => ({ ...itemSource })),
    })),
    reason: state === "available" ? null : `Fixture ${state} evidence.`,
    provenance: [
      {
        source_id: "engine-search:test",
        kind: "engine",
        state:
          state === "available"
            ? "available"
            : state === "partial"
              ? "partial"
              : state === "stale"
                ? "stale"
                : "unavailable",
        version: identity.version,
        snapshot: "engine-search:test",
        reason: null,
      },
    ],
    ...overrides,
  };
}

function provider(
  result: ReplacementEngineAnalysisEvidence | null,
  calls: ReplacementEngineProviderRequest[] = [],
): ReplacementEngineProvider {
  return {
    identity,
    async analyse(request) {
      calls.push(request);
      return result;
    },
  };
}

function projection(result: Awaited<ReturnType<typeof generateReplacementEngineCandidates>>) {
  return {
    candidates: result.candidates.map((candidate) => ({
      id: candidate.candidate_id,
      rank: candidate.rank,
      san: candidate.san,
      uci: candidate.uci,
      outcome: candidate.outcome_position_key,
      sources: candidate.source_kinds,
      verdict: candidate.objective_quality.repertoire_pov_verdict,
    })),
    items: result.engine_item_results.map((item) => ({
      line: item.line_id,
      status: item.status,
      outcome: item.outcome_position_key,
      uci: item.canonical_uci,
    })),
  };
}

test("stubbed MultiPV validates legal UCI/PVs, merges canonical local/database outcomes, and retains complete provenance", async () => {
  const input = setup(
    "white",
    WHITE_GAMES,
    "e4 e5 Bc4",
    "Bc4",
    {},
    35,
    [
      "existing-repertoire-transposition",
      "move-order-shortcut",
      "opening-database",
      "engine-multipv",
    ],
    [{ id: "database-nf3", san: "Nf3", uci: "g1f3" }],
  );
  const engineEvidence = evidence(input, [
    line("nf3-a", 2, "g1f3", ["g1f3", "b8c6"], 15, null, 20, observations, "engine-line:nf3-a"),
    line("d3", 3, "d2d3", ["d2d3", "b8c6"], -5),
    line("nf3-b", 1, "g1f3", ["g1f3", "b8c6"], 15, null, 20, observations, "engine-line:nf3-b"),
  ]);
  const calls: ReplacementEngineProviderRequest[] = [];
  const result = await generateReplacementEngineCandidates({
    ...input,
    provider: provider(engineEvidence, calls),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.depth, 20);
  assert.equal(calls[0]?.multipv, 4);
  assert.equal(
    calls[0]?.position.position_id,
    input.pivot_result.status === "selected" ? input.pivot_result.pivot.position_id : "",
  );
  const nf3 = result.candidates.find((candidate) => candidate.san === "Nf3");
  assert.ok(nf3);
  assert.equal(result.candidates.filter((candidate) => candidate.san === "Nf3").length, 1);
  assert.ok(nf3.source_kinds.includes("move-order-shortcut"));
  assert.ok(nf3.source_kinds.includes("opening-database"));
  assert.ok(nf3.source_kinds.includes("engine-multipv"));
  const engineSource = nf3.provenance.find((item) => item.kind === "engine-multipv");
  assert.ok(engineSource);
  assert.equal((engineSource.details.merged_evidence as readonly unknown[]).length, 2);
  assert.deepEqual(
    engineSource.provenance
      .map((item) => item.source_id)
      .filter((id) => id.startsWith("engine-line")),
    ["engine-line:nf3-a", "engine-line:nf3-b"],
  );
  assert.equal(
    result.engine_item_results.find((item) => item.line_id === "d3")?.canonical_pv_san[0],
    "d3",
  );
  assert.equal(nf3.expansion.status, "full-subtree-required");
});

test("ordering and identities ignore engine line order", async () => {
  const input = setup();
  const lines = [
    line("d3", 2, "d2d3", ["d2d3", "b8c6"], 5),
    line("h3-good", 3, "h2h3", ["h2h3", "b8c6"], 100),
    line("h3-conflict", 4, "h2h3", ["h2h3", "b8c6"], -100),
    line("nf3", 1, "g1f3", ["g1f3", "b8c6"], 20),
  ];
  const first = await generateReplacementEngineCandidates({
    ...input,
    provider: provider(evidence(input, lines)),
  });
  const second = await generateReplacementEngineCandidates({
    ...input,
    provider: provider(evidence(input, [...lines].reverse())),
  });
  assert.deepEqual(projection(first), projection(second));
  assert.equal(
    first.candidates.some((candidate) => candidate.san === "h3"),
    false,
  );
  const conflicting = first.engine_item_results.filter((item) => item.canonical_san === "h3");
  assert.deepEqual(
    conflicting.map((item) => [
      item.objective_quality?.repertoire_pov_verdict,
      item.status,
      item.error_code,
    ]),
    [
      ["outside-tolerance", "rejected", "outside-evaluation-tolerance"],
      ["within-tolerance", "budget-excluded", "canonical-outcome-rejected"],
    ],
  );
  assert.equal(
    first.engine_item_results.find((item) => item.line_id === "nf3")?.objective_quality
      ?.repertoire_pov_verdict,
    "within-tolerance",
  );
});

test("illegal UCI and malformed or illegal PVs return independent per-item results", async () => {
  const input = setup("white", WHITE_GAMES, "e4 e5 Bc4", "Bc4", { engine_multipv: 5 });
  const malformedEvidence = evidence(input, [
    line("bad-uci", 1, "not-uci", ["not-uci"], 20),
    line("empty-pv", 2, "g1f3", [], 10),
    line("mismatch", 3, "g1f3", ["d2d3"], 5),
    line("illegal-pv", 4, "d2d3", ["d2d3", "a1a8"], 0),
  ]);
  const cyclicProvenance: Record<string, unknown> = { ...source };
  cyclicProvenance.reason = cyclicProvenance;
  const result = await generateReplacementEngineCandidates({
    ...input,
    provider: provider({
      ...malformedEvidence,
      lines: [
        ...malformedEvidence.lines,
        null,
        {
          ...line("malformed-nested", 5, "g1f3", ["g1f3", "b8c6"], 15),
          observations: "not-observations",
          provenance: [cyclicProvenance],
        },
        { line_id: 7, multipv_rank: "one", uci: 1n, pv: [] },
      ] as unknown as readonly ReplacementEngineLineEvidence[],
    }),
  });
  assert.deepEqual(
    Object.fromEntries(
      result.engine_item_results
        .filter((item) => item.line_id !== null)
        .filter((item) => item.line_id !== "malformed-nested")
        .map((item) => [item.line_id, [item.status, item.error_code]]),
    ),
    {
      "bad-uci": ["illegal", "illegal-uci"],
      "empty-pv": ["malformed-pv", "malformed-pv"],
      mismatch: ["malformed-pv", "malformed-pv"],
      "illegal-pv": ["malformed-pv", "malformed-pv"],
    },
  );
  const anonymous = result.engine_item_results.filter((item) => item.line_id === null);
  assert.ok(anonymous.length >= 2);
  assert.ok(
    anonymous.every(
      (item) =>
        item.input_uci === null &&
        (item.multipv_rank === null || typeof item.multipv_rank === "number"),
    ),
  );
  const nested = result.engine_item_results.find((item) => item.line_id === "malformed-nested");
  assert.ok(nested);
  assert.equal(nested.observations?.tactical_volatility, null);
  assert.deepEqual(nested.provenance, malformedEvidence.provenance);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.ok(result.candidates.some((candidate) => candidate.existing_preparation));
});

test("stale pivot and stale engine position return structurally without engine exceptions", async () => {
  const input = setup();
  const stalePivot = await generateReplacementEngineCandidates({
    ...input,
    pivot_result: { ...input.pivot_result, request_id: "request:old" },
    provider: provider(null),
  });
  assert.equal(stalePivot.status, "stale");
  assert.equal(stalePivot.error_code, "request-pivot-mismatch");

  const staleEvidence = evidence(input, [line("nf3", 1, "g1f3", ["g1f3", "b8c6"], 10)]);
  const result = await generateReplacementEngineCandidates({
    ...input,
    provider: provider({
      ...staleEvidence,
      position: { ...staleEvidence.position, position_key: "stale" },
    }),
  });
  assert.equal(result.status, "stale");
  assert.equal(result.engine_item_results[0]?.status, "stale");
  assert.equal(result.engine_item_results[0]?.error_code, "stale-engine-position");
  assert.ok(result.candidates.length > 0);

  const versionMismatch = await generateReplacementEngineCandidates({
    ...input,
    provider: provider({
      ...staleEvidence,
      replacement_schema_version: "strategic-fit-replacement:old",
    }),
  });
  assert.equal(versionMismatch.status, "rejected");
  assert.equal(versionMismatch.engine_item_results[0]?.error_code, "engine-version-mismatch");

  const cyclicConfiguration: Record<string, unknown> = {};
  cyclicConfiguration.self = cyclicConfiguration;
  for (const malformedHeader of [
    { ...staleEvidence, state: "unknown" },
    { ...staleEvidence, reason: 1n },
    { ...staleEvidence, engine: { ...staleEvidence.engine, configuration: cyclicConfiguration } },
    {
      ...staleEvidence,
      engine: { ...staleEvidence.engine, configuration: { Threads: undefined } },
    },
    {
      ...staleEvidence,
      engine: { ...staleEvidence.engine, configuration: { Contempt: Number.NaN } },
    },
    {
      ...staleEvidence,
      engine: { ...staleEvidence.engine, configuration: { [Symbol("hidden")]: 1 } },
    },
  ] as unknown as ReplacementEngineAnalysisEvidence[]) {
    const malformed = await generateReplacementEngineCandidates({
      ...input,
      provider: provider(malformedHeader),
    });
    assert.equal(malformed.status, "rejected");
    assert.equal(malformed.engine_item_results[0]?.error_code, "malformed-evaluation");
    assert.doesNotThrow(() => JSON.stringify(malformed));
  }

  assert.equal(input.pivot_result.status, "selected");
  const pivotPositionId = input.pivot_result.pivot.position_id;
  const highClockGraph = {
    ...input.graph,
    positions: input.graph.positions.map((position) =>
      position.position_id === pivotPositionId
        ? { ...position, fen: `${position.fen.split(" ").slice(0, 4).join(" ")} 60 40` }
        : position,
    ),
  };
  const highClockInput = { ...input, graph: highClockGraph };
  const highClockEvidence = evidence(highClockInput, [
    line("clock", 1, "g1f3", ["g1f3", "b8c6"], 10),
  ]);
  const staleClock = await generateReplacementEngineCandidates({
    ...highClockInput,
    provider: provider({
      ...highClockEvidence,
      position: {
        ...highClockEvidence.position,
        fen: `${highClockEvidence.position.fen.split(" ").slice(0, 4).join(" ")} 61 40`,
      },
    }),
  });
  assert.equal(staleClock.status, "stale");
  assert.equal(staleClock.engine_item_results[0]?.error_code, "stale-engine-position");
});

test("unavailable, rejected, unverified, and partial engine states preserve Task 8.3 candidates", async () => {
  const databaseInput = setup(
    "white",
    WHITE_GAMES,
    "e4 e5 Bc4",
    "Bc4",
    {},
    35,
    ["existing-repertoire-transposition", "opening-database", "engine-multipv"],
    [{ id: "database-d3", san: "d3", uci: "d2d3" }],
  );
  const noProvider = await generateReplacementEngineCandidates({
    ...databaseInput,
    provider: null,
  });
  assert.equal(noProvider.status, "unavailable");
  assert.ok(
    noProvider.candidates.some((candidate) => candidate.source_kinds.includes("opening-database")),
  );

  for (const state of ["unavailable", "rejected", "unverified"] as const) {
    const input = setup();
    const result = await generateReplacementEngineCandidates({
      ...input,
      provider: provider(evidence(input, [], state)),
    });
    assert.equal(result.status, state);
    assert.ok(result.candidates.length > 0);
    assert.ok(
      result.candidates.every((candidate) => candidate.objective_quality.state === "unavailable"),
    );
    assert.equal(result.source_results[0]?.evidence_state, state);
  }

  const input = setup();
  const partialEvidence = evidence(
    input,
    [line("nf3", 1, "g1f3", ["g1f3", "b8c6"], 10, null, 12)],
    "partial",
    { reached_depth: 12 },
  );
  const partial = await generateReplacementEngineCandidates({
    ...input,
    provider: provider(partialEvidence),
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.engine_item_results[0]?.status, "partial");
  assert.equal(
    partial.candidates.find((candidate) => candidate.san === "Nf3")?.objective_quality.state,
    "partial",
  );
});

test("cancellation signal reaches provider and no extra engine position is scheduled", async () => {
  const input = setup(undefined, undefined, undefined, undefined, { maximum_engine_positions: 24 });
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  let calls = 0;
  const cancellingProvider: ReplacementEngineProvider = {
    identity,
    async analyse(_request, signal) {
      calls++;
      received = signal;
      controller.abort();
      throw new DOMException("cancelled", "AbortError");
    },
  };
  const result = await generateReplacementEngineCandidates({
    ...input,
    provider: cancellingProvider,
    signal: controller.signal,
  });
  assert.equal(received, controller.signal);
  assert.equal(calls, 1);
  assert.equal(result.engine_positions_scheduled, 1);
  assert.equal(result.status, "cancelled");
  assert.equal(result.engine_item_results[0]?.error_code, "engine-cancelled");
});

test("depth 30, requested MultiPV, engine-position budget, and maximum-candidate budget are exact", async () => {
  const depthInput = setup("white", WHITE_GAMES, "e4 e5 Bc4", "Bc4", {
    engine_depth: 30,
    engine_multipv: 2,
  });
  const calls: ReplacementEngineProviderRequest[] = [];
  const depthResult = await generateReplacementEngineCandidates({
    ...depthInput,
    provider: provider(
      evidence(depthInput, [
        line("nf3", 1, "g1f3", ["g1f3", "b8c6"], 10, null, 30),
        line("d3", 2, "d2d3", ["d2d3", "b8c6"], 0, null, 30),
        line("h3-extra", 3, "h2h3", ["h2h3", "b8c6"], -10, null, 30),
      ]),
      calls,
    ),
  });
  assert.equal(calls[0]?.depth, 30);
  assert.equal(calls[0]?.multipv, 2);
  assert.equal(
    depthResult.engine_item_results.find((item) => item.line_id === "h3-extra")?.error_code,
    "multipv-budget-exceeded",
  );

  const noBudgetInput = setup("white", WHITE_GAMES, "e4 e5 Bc4", "Bc4", {
    maximum_engine_positions: 0,
  });
  let noBudgetCalls = 0;
  const noBudget = await generateReplacementEngineCandidates({
    ...noBudgetInput,
    provider: {
      identity,
      async analyse() {
        noBudgetCalls++;
        return null;
      },
    },
  });
  assert.equal(noBudgetCalls, 0);
  assert.equal(noBudget.engine_item_results[0]?.error_code, "maximum-engine-positions-exceeded");

  const limitedInput = setup("white", WHITE_GAMES, "e4 e5 Bc4", "Bc4", { maximum_candidates: 1 });
  const limited = await generateReplacementEngineCandidates({
    ...limitedInput,
    provider: provider(
      evidence(limitedInput, [
        line("d3", 1, "d2d3", ["d2d3", "b8c6"], 20),
        line("h3", 2, "h2h3", ["h2h3", "b8c6"], 10),
      ]),
    ),
  });
  assert.equal(limited.candidates.length, 1);
  assert.ok(limited.discovered_candidate_count > limited.candidates.length);
  assert.ok(limited.engine_item_results.every((item) => item.status === "budget-excluded"));

  let invalidCalls = 0;
  const invalidMultipvInput = setup("white", WHITE_GAMES, "e4 e5 Bc4", "Bc4", {
    engine_multipv: 11,
  });
  const invalidMultipv = await generateReplacementEngineCandidates({
    ...invalidMultipvInput,
    provider: {
      identity,
      async analyse() {
        invalidCalls++;
        return null;
      },
    },
  });
  assert.equal(invalidMultipv.status, "invalid-request");
  assert.equal(invalidMultipv.error_code, "invalid-engine-multipv");

  const invalidToleranceInput = setup("white", WHITE_GAMES, "e4 e5 Bc4", "Bc4", {}, Number.NaN);
  const invalidTolerance = await generateReplacementEngineCandidates({
    ...invalidToleranceInput,
    provider: {
      identity,
      async analyse() {
        invalidCalls++;
        return null;
      },
    },
  });
  assert.equal(invalidTolerance.status, "invalid-request");
  assert.equal(invalidTolerance.error_code, "invalid-evaluation-tolerance");
  assert.equal(invalidCalls, 0);

  const duplicateRankInput = setup("white", WHITE_GAMES, "e4 e5 Bc4", "Bc4", { engine_multipv: 2 });
  const duplicateRank = await generateReplacementEngineCandidates({
    ...duplicateRankInput,
    provider: provider(
      evidence(duplicateRankInput, [
        line("duplicate-a", 1, "g1f3", ["g1f3", "b8c6"], 20),
        line("duplicate-b", 1, "d2d3", ["d2d3", "b8c6"], 10),
      ]),
    ),
  });
  assert.ok(
    duplicateRank.engine_item_results.every(
      (item) => item.status === "rejected" && item.error_code === "duplicate-multipv-rank",
    ),
  );

  const malformedConfiguration: Record<string, unknown> = {};
  malformedConfiguration.self = malformedConfiguration;
  let malformedProviderCalls = 0;
  const malformedProvider = await generateReplacementEngineCandidates({
    ...depthInput,
    provider: {
      identity: {
        ...identity,
        configuration: malformedConfiguration,
      } as unknown as ReplacementEngineIdentity,
      async analyse() {
        malformedProviderCalls++;
        return null;
      },
    },
  });
  assert.equal(malformedProvider.status, "rejected");
  assert.equal(malformedProvider.engine_item_results[0]?.error_code, "engine-identity-mismatch");
  assert.equal(malformedProviderCalls, 0);
  assert.doesNotThrow(() => JSON.stringify(malformedProvider));
});

test("cache reuses only compatible semantic position, engine identity, depth, and MultiPV evidence", async () => {
  const deepInput = setup("white", WHITE_GAMES, "e4 e5 Bc4", "Bc4", {
    engine_depth: 30,
    engine_multipv: 4,
  });
  const deepEvidence = evidence(deepInput, [
    line("nf3", 1, "g1f3", ["g1f3", "b8c6"], 20, null, 30),
    line("d3", 2, "d2d3", ["d2d3", "b8c6"], 10, null, 30),
    line("h3", 3, "h2h3", ["h2h3", "b8c6"], 0, null, 30),
    line("a3", 4, "a2a3", ["a2a3", "b8c6"], -10, null, 30),
  ]);
  let calls = 0;
  const first = await generateReplacementEngineCandidates({
    ...deepInput,
    provider: {
      identity,
      async analyse() {
        calls++;
        return deepEvidence;
      },
    },
  });
  assert.ok(first.cache_write);

  const shallowInput = {
    ...deepInput,
    request: {
      ...deepInput.request,
      budget: { ...deepInput.request.budget, engine_depth: 20, engine_multipv: 2 },
    },
  };
  const hit = await generateReplacementEngineCandidates({
    ...shallowInput,
    provider: {
      identity,
      async analyse() {
        calls++;
        return null;
      },
    },
    cache_evidence: [first.cache_write!],
  });
  assert.equal(calls, 1);
  assert.equal(hit.source_results[0]?.cache.status, "hit");
  assert.equal(hit.engine_item_results.length, 2);

  const freshShallowEvidence = evidence(shallowInput, [
    line("fresh-nf3", 1, "g1f3", ["g1f3", "b8c6"], 20, null, 20),
    line("fresh-d3", 2, "d2d3", ["d2d3", "b8c6"], 10, null, 20),
  ]);
  const cyclicConfiguration: Record<string, unknown> = { Threads: 1 };
  cyclicConfiguration.self = cyclicConfiguration;
  const incompleteCaches: ReplacementEngineAnalysisEvidence[] = [
    { ...first.cache_write!, evidence_id: "cache:partial", state: "partial" },
    {
      ...first.cache_write!,
      evidence_id: "cache:missing-rank",
      lines: first.cache_write!.lines.slice(0, 1),
    },
    {
      ...first.cache_write!,
      evidence_id: "cache:shallow-line",
      lines: first.cache_write!.lines.map((item, index) =>
        index === 0 ? { ...item, depth: 12 } : item,
      ),
    },
    { ...first.cache_write!, evidence_id: "cache:malformed-position", position: null },
    {
      ...first.cache_write!,
      evidence_id: "cache:malformed-engine",
      engine: { ...first.cache_write!.engine, configuration: cyclicConfiguration },
    },
  ] as unknown as ReplacementEngineAnalysisEvidence[];
  let unsafeCalls = 0;
  for (const cacheEntry of incompleteCaches) {
    const miss = await generateReplacementEngineCandidates({
      ...shallowInput,
      provider: {
        identity,
        async analyse() {
          unsafeCalls++;
          return freshShallowEvidence;
        },
      },
      cache_evidence: [cacheEntry],
    });
    assert.equal(miss.source_results[0]?.cache.status, "miss");
  }
  assert.equal(
    unsafeCalls,
    incompleteCaches.length,
    "partial, incomplete, or shallow line evidence cannot satisfy cache reuse",
  );

  const deeperInput = {
    ...deepInput,
    request: {
      ...deepInput.request,
      budget: { ...deepInput.request.budget, engine_depth: 30, engine_multipv: 5 },
    },
  };
  await generateReplacementEngineCandidates({
    ...deeperInput,
    provider: {
      identity,
      async analyse() {
        calls++;
        return evidence(deeperInput, [], "unavailable");
      },
    },
    cache_evidence: [first.cache_write!],
  });
  assert.equal(calls, 2, "narrower cache cannot serve a wider request");

  assert.equal(deepInput.pivot_result.status, "selected");
  const pivotPositionId = deepInput.pivot_result.pivot.position_id;
  const highClockGraph = {
    ...deepInput.graph,
    positions: deepInput.graph.positions.map((position) =>
      position.position_id === pivotPositionId
        ? { ...position, fen: `${position.fen.split(" ").slice(0, 4).join(" ")} 60 40` }
        : position,
    ),
  };
  const highClockInput = { ...deepInput, graph: highClockGraph };
  const highClockEvidence = evidence(highClockInput, [
    line("high-clock", 1, "g1f3", ["g1f3", "b8c6"], 20, null, 30),
  ]);
  const differentClockCache = {
    ...highClockEvidence,
    evidence_id: "cache:different-high-clock",
    position: {
      ...highClockEvidence.position,
      fen: `${highClockEvidence.position.fen.split(" ").slice(0, 4).join(" ")} 61 40`,
    },
  };
  let highClockCalls = 0;
  const highClock = await generateReplacementEngineCandidates({
    ...highClockInput,
    provider: {
      identity,
      async analyse() {
        highClockCalls++;
        return highClockEvidence;
      },
    },
    cache_evidence: [differentClockCache],
  });
  assert.equal(
    highClockCalls,
    1,
    "different FEN clocks at the 50-move boundary cannot reuse cache evidence",
  );
  assert.equal(highClock.source_results[0]?.cache.status, "miss");
});

test("centipawn loss and tolerance use repertoire POV without reversing Black comparisons", async () => {
  const whiteInput = setup();
  const white = await generateReplacementEngineCandidates({
    ...whiteInput,
    provider: provider(
      evidence(whiteInput, [
        line("best", 1, "d2d3", ["d2d3", "b8c6"], 40),
        line("within", 2, "h2h3", ["h2h3", "b8c6"], 10),
        line("outside", 3, "g1f3", ["g1f3", "b8c6"], 0),
      ]),
    ),
  });
  const within = white.engine_item_results.find((item) => item.line_id === "within")!;
  const outside = white.engine_item_results.find((item) => item.line_id === "outside")!;
  assert.equal(within.objective_quality?.repertoire_pov_loss_from_best_cp, 30);
  assert.equal(within.objective_quality?.repertoire_pov_verdict, "within-tolerance");
  assert.equal(outside.objective_quality?.repertoire_pov_loss_from_best_cp, 40);
  assert.equal(outside.error_code, "outside-evaluation-tolerance");
  const retainedOutside = white.candidates.find((candidate) => candidate.san === "Nf3");
  assert.ok(retainedOutside);
  assert.ok(
    retainedOutside.provenance.some(
      (item) => item.kind === "engine-multipv" && item.status === "rejected",
    ),
  );
  assert.ok(
    retainedOutside.provenance.some(
      (item) => item.kind !== "engine-multipv" && item.status === "available",
    ),
  );

  const blackInput = setup("black", BLACK_GAMES, "e4 c5", "c5");
  const black = await generateReplacementEngineCandidates({
    ...blackInput,
    provider: provider(
      evidence(blackInput, [
        line("black-best", 1, "e7e5", ["e7e5", "g1f3"], -50),
        line("black-second", 2, "d7d5", ["d7d5", "e4d5"], -20),
      ]),
    ),
  });
  const second = black.engine_item_results.find((item) => item.line_id === "black-second")!;
  assert.equal(second.objective_quality?.white_pov_evaluation_cp, -20);
  assert.equal(second.objective_quality?.repertoire_pov_evaluation_cp, 20);
  assert.equal(second.objective_quality?.repertoire_pov_loss_from_best_cp, 30);
  assert.equal(black.candidates.find((candidate) => candidate.san === "e5")?.mover_color, "black");
  assert.equal(black.repertoire_color, "black");
});

test("mate ordering preserves forced-mate verdicts without centipawn sentinels", async () => {
  const input = setup("black", BLACK_GAMES, "e4 c5", "c5");
  const result = await generateReplacementEngineCandidates({
    ...input,
    provider: provider(
      evidence(input, [
        line("mate-for-fast", 2, "e7e5", ["e7e5", "g1f3"], null, -3),
        line("mate-for-slow", 1, "d7d5", ["d7d5", "e4d5"], null, -7),
        line("mate-against", 3, "g7g6", ["g7g6", "d2d4"], null, 4),
      ]),
    ),
  });
  const fast = result.engine_item_results.find((item) => item.line_id === "mate-for-fast")!;
  const slow = result.engine_item_results.find((item) => item.line_id === "mate-for-slow")!;
  const against = result.engine_item_results.find((item) => item.line_id === "mate-against")!;
  assert.equal(fast.objective_quality?.repertoire_pov_verdict, "forced-mate-for-repertoire");
  assert.equal(fast.objective_quality?.white_pov_best_mate_in, -3);
  assert.equal(fast.objective_quality?.repertoire_pov_loss_from_best_cp, null);
  assert.equal(slow.objective_quality?.repertoire_pov_verdict, "forced-mate-for-repertoire");
  assert.equal(against.objective_quality?.repertoire_pov_verdict, "forced-mate-against-repertoire");
  assert.equal(against.error_code, "forced-mate-against-repertoire");
});

test("dynamic quality uses inspectable observations and leaves missing values unavailable rather than zero", async () => {
  const input = setup();
  const missing: ReplacementEngineDynamicObservations = {
    tactical_volatility: null,
    evaluation_sensitivity_cp: null,
    forcing_move_count: null,
    observed_move_count: null,
    king_safety_risk: null,
  };
  const result = await generateReplacementEngineCandidates({
    ...input,
    provider: provider(
      evidence(input, [
        line("observed", 1, "g1f3", ["g1f3", "b8c6"], 30),
        line("missing", 2, "d2d3", ["d2d3", "b8c6"], 10, null, 20, missing),
      ]),
    ),
  });
  const observed = result.engine_item_results.find(
    (item) => item.line_id === "observed",
  )!.objective_quality!;
  assert.equal(observed.tactical_volatility, 0.3);
  assert.equal(observed.evaluation_sensitivity_cp, 12);
  assert.equal(observed.forcing_density, 0.5);
  assert.equal(observed.king_safety_risk, 0.2);
  assert.equal(observed.viable_move_width, 2);
  assert.equal(observed.evaluation_uncertainty_cp, 20);
  const unavailable = result.engine_item_results.find(
    (item) => item.line_id === "missing",
  )!.objective_quality!;
  assert.equal(unavailable.tactical_volatility, null);
  assert.equal(unavailable.evaluation_sensitivity_cp, null);
  assert.equal(unavailable.forcing_density, null);
  assert.equal(unavailable.king_safety_risk, null);
  assert.equal(unavailable.state, "partial");
});

test("engine configuration, cache, versions, source states, evidence, and every input remain immutable and serializable", async () => {
  const input = setup();
  const engineEvidence = evidence(input, [
    line("nf3", 1, "g1f3", ["g1f3", "b8c6"], 20),
    line("d3", 2, "d2d3", ["d2d3", "b8c6"], 0),
  ]);
  const cacheInput = evidence(
    input,
    [line("shallow", 1, "g1f3", ["g1f3", "b8c6"], 10, null, 12)],
    "partial",
    { evidence_id: "cache:shallow", reached_depth: 12 },
  );
  const before = {
    graph: JSON.stringify(input.graph),
    pivot: JSON.stringify(input.pivot_result),
    candidates: JSON.stringify(input.candidate_generation),
    evidence: JSON.stringify(engineEvidence),
    cache: JSON.stringify(cacheInput),
  };
  const result = await generateReplacementEngineCandidates({
    ...input,
    provider: provider(engineEvidence),
    cache_evidence: [cacheInput],
  });
  assert.equal(JSON.stringify(input.graph), before.graph);
  assert.equal(JSON.stringify(input.pivot_result), before.pivot);
  assert.equal(JSON.stringify(input.candidate_generation), before.candidates);
  assert.equal(JSON.stringify(engineEvidence), before.evidence);
  assert.equal(JSON.stringify(cacheInput), before.cache);
  assert.equal(result.source_repertoire_unchanged, true);
  assert.equal(result.source_graph_unchanged, true);
  assert.equal(result.pivot_result_unchanged, true);
  assert.equal(result.candidate_generation_unchanged, true);
  assert.equal(result.engine_evidence_unchanged, true);
  assert.equal(result.cache_inputs_unchanged, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.equal(result.schema_version, STRATEGIC_FIT_SCHEMA_VERSION);
  assert.equal(result.analysis_version, STRATEGIC_FIT_ANALYSIS_VERSION);
  assert.equal(result.replacement_schema_version, STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION);
  const item = result.engine_item_results[0]!;
  assert.deepEqual(item.engine.configuration, identity.configuration);
  assert.equal(item.engine.version, identity.version);
  assert.equal(item.requested_depth, input.request.budget.engine_depth);
  assert.equal(item.requested_multipv, input.request.budget.engine_multipv);
  assert.equal(item.cache.status, "miss");
  assert.ok(
    result.candidates.some(
      (candidate) =>
        candidate.provenance.some((candidateSource) => candidateSource.kind !== "engine-multipv") &&
        candidate.provenance.some((candidateSource) => candidateSource.kind === "engine-multipv"),
    ),
  );
});
