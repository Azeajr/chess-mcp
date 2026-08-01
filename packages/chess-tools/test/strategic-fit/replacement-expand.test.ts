import assert from "node:assert/strict";
import test from "node:test";

import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";

import {
  GameTree,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
  buildRepertoireGraph,
  expandReplacementCandidates,
  generateReplacementCandidates,
  generateReplacementEngineCandidates,
  selectReplacementPivot,
  type CausalAttribution,
  type Color,
  type ExpandReplacementCandidatesInput,
  type ReplacementEngineAnalysisEvidence,
  type ReplacementEngineIdentity,
  type ReplacementEngineProvider,
  type ReplacementExplorerExpansionEvidence,
  type ReplacementExplorerExpansionProvider,
  type ReplacementExplorerReplyEvidence,
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
  source_id: "test:replacement-expand",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_FIT_ANALYSIS_VERSION,
  snapshot: "revision:expand",
  reason: null,
};

const engineIdentity: ReplacementEngineIdentity = {
  engine_id: "stockfish:expand-test",
  name: "Stockfish Expand Test",
  version: "18-test",
  configuration_id: "threads=1|hash=16",
  configuration: { Threads: 1, Hash: 16 },
  analysis_schema_version: "uci-multipv:1",
};

const WHITE_GAMES = [
  `[Event "Pivot"]
[Result "*"]

1. e4 e5 2. Bc4 Nf6 3. d3 *`,
  `[Event "Other prep"]
[Result "*"]

1. Nf3 d5 2. d4 Nf6 *`,
] as const;

const BLACK_GAMES = [
  `[Event "Black pivot"]
[Result "*"]

1. e4 c5 2. Nf3 d6 *`,
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
        explanation: "Expansion fixture pivot.",
      },
    ],
    explanation: "Expansion fixture causality.",
  };
}

function engineEvidence(
  request: Parameters<ReplacementEngineProvider["analyse"]>[0],
  ucis: readonly string[],
  id: string,
  state: ReplacementEngineAnalysisEvidence["state"] = "available",
): ReplacementEngineAnalysisEvidence {
  return {
    ...version,
    evidence_id: id,
    state,
    engine: structuredClone(engineIdentity),
    position: structuredClone(request.position),
    requested_depth: request.depth,
    requested_multipv: request.multipv,
    reached_depth: request.depth,
    lines: ucis.map((uci, index) => ({
      line_id: `${id}:line:${index + 1}`,
      multipv_rank: index + 1,
      uci,
      pv: [uci],
      white_pov_evaluation_cp: 24 - index * 8,
      white_pov_mate_in: null,
      depth: request.depth,
      observations: {
        tactical_volatility: 0.2,
        evaluation_sensitivity_cp: 9,
        forcing_move_count: 1,
        observed_move_count: 4,
        king_safety_risk: 0.1,
      },
      provenance: [source],
    })),
    reason: null,
    provenance: [source],
  };
}

async function setup(
  options: {
    readonly color?: Color;
    readonly games?: readonly string[];
    readonly budget?: Partial<ReplacementRequest["budget"]>;
  } = {},
): Promise<ExpandReplacementCandidatesInput> {
  const color = options.color ?? "white";
  const games = options.games ?? (color === "white" ? WHITE_GAMES : BLACK_GAMES);
  const graph = buildRepertoireGraph(GameTree.fromPgn(games.join("\n\n")), color);
  const route = routeBeginning(graph, color === "white" ? "e4 e5 Bc4" : "e4 c5");
  const decision = decisionAt(graph, route, color === "white" ? "Bc4" : "c5");
  const references = {
    position_ids: [...route.position_ids],
    decision_ids: [...route.decision_ids],
    route_ids: [route.route_id],
    source_san_paths: route.source_san_paths.map((path) => [...path]),
  };
  const finding: ReplacementPivotFindingEvidence = {
    finding_id: "finding:expand",
    semantic_finding_id: "semantic-finding:expand",
    repertoire_revision: "revision:expand",
    references,
    evidence: {
      cohort_id: "cohort:expand",
      dimensions: [{ dimension_id: "dynamic.tactical-volatility" }],
      causality: attribution(route, decision),
      provenance: [source],
    },
    provenance: { repertoire_revision: "revision:expand", sources: [source] },
  };
  const cohort: ReplacementPivotCohortEvidence = {
    cohort_id: "cohort:expand",
    route_ids: [route.route_id],
    route_weights: [{ route_id: route.route_id, normalized_weight: 1 }],
    transposition_position_ids: graph.transposition_links.map((link) => link.position_id),
    provenance: [source],
  };
  const request: ReplacementRequest = {
    ...BLACK_REPLACEMENT_REQUEST,
    request_id: "request:expand",
    report_id: "report:expand",
    finding_id: finding.finding_id,
    semantic_finding_id: finding.semantic_finding_id,
    cohort_id: cohort.cohort_id,
    repertoire_revision: "revision:expand",
    repertoire_color: color,
    candidate_sources: ["engine-multipv"],
    budget: {
      ...BLACK_REPLACEMENT_REQUEST.budget,
      maximum_candidates: 1,
      maximum_subtree_nodes_per_candidate: 20,
      maximum_engine_positions: 8,
      maximum_explorer_queries: 4,
      engine_depth: 18,
      engine_multipv: 1,
      strategic_horizon_ply: color === "white" ? 5 : 4,
      minimum_reply_popularity: 0.05,
      include_all_forcing_replies: true,
      ...options.budget,
    },
    provenance: [source],
  };
  const pivotResult = selectReplacementPivot({ request, finding, cohort, graph });
  assert.equal(pivotResult.status, "selected");
  const candidateGeneration = generateReplacementCandidates({
    request,
    graph,
    pivot_result: pivotResult,
  });
  const rootUci = color === "white" ? "d2d4" : "e7e5";
  const rootProvider: ReplacementEngineProvider = {
    identity: engineIdentity,
    async analyse(engineRequest) {
      return engineEvidence(engineRequest, [rootUci], "engine-evidence:task-8-4");
    },
  };
  const engineGeneration = await generateReplacementEngineCandidates({
    request,
    graph,
    pivot_result: pivotResult,
    candidate_generation: candidateGeneration,
    provider: rootProvider,
  });
  assert.equal(engineGeneration.candidates.length, 1);
  return {
    request,
    graph,
    pivot_result: pivotResult,
    candidate_generation: candidateGeneration,
    engine_generation: engineGeneration,
  };
}

function reply(
  id: string,
  san: string,
  uci: string,
  probability: number,
): ReplacementExplorerReplyEvidence {
  return {
    move_id: id,
    san,
    uci,
    played_probability: probability,
    games: Math.round(probability * 1000),
    pv: [uci],
    provenance: [source],
  };
}

function explorerProvider(
  replies: readonly ReplacementExplorerReplyEvidence[],
  alter?: (evidence: ReplacementExplorerExpansionEvidence) => ReplacementExplorerExpansionEvidence,
): ReplacementExplorerExpansionProvider {
  return {
    provider: "explorer:test",
    version: "2026-07",
    snapshot: "population:test",
    async query(request) {
      const evidence: ReplacementExplorerExpansionEvidence = {
        ...version,
        evidence_id: `explorer:${request.position.position_id}`,
        state: "available",
        provider: "explorer:test",
        provider_version: "2026-07",
        snapshot: "population:test",
        position: structuredClone(request.position),
        replies: structuredClone(replies),
        reason: null,
        provenance: [source],
      };
      return alter?.(evidence) ?? evidence;
    },
  };
}

function firstLegalUci(fen: string, preferred: readonly string[]): string {
  const position = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  for (const uci of preferred) {
    const move = parseUci(uci);
    if (move && position.isLegal(move)) return uci;
  }
  throw new Error(`No preferred legal continuation at ${fen}`);
}

function continuationProvider(
  options: { readonly malformedPv?: boolean; readonly reverseLines?: boolean } = {},
): ReplacementEngineProvider {
  return {
    identity: engineIdentity,
    async analyse(request) {
      const uci = firstLegalUci(request.position.fen, [
        "g1f3",
        "d1d4",
        "c2c3",
        "b8c6",
        "g8f6",
        "f1b5",
      ]);
      const evidence = engineEvidence(
        request,
        [uci],
        `engine-expand:${request.position.position_id}`,
      );
      if (options.malformedPv) {
        return { ...evidence, lines: evidence.lines.map((line) => ({ ...line, pv: ["a1a8"] })) };
      }
      return options.reverseLines
        ? { ...evidence, lines: [...evidence.lines].reverse() }
        : evidence;
    },
  };
}

const WHITE_REPLIES = [
  reply("popular-nc6", "Nc6", "b8c6", 0.7),
  reply("rare-forcing-exd4", "exd4", "e5d4", 0.01),
  reply("rare-quiet-a6", "a6", "a7a6", 0.01),
] as const;

test("popular replies and rare forcing replies form a bounded legal subtree at comparable horizons", async () => {
  const input = await setup();
  const result = await expandReplacementCandidates({
    ...input,
    explorer_provider: explorerProvider(WHITE_REPLIES),
    engine_provider: continuationProvider(),
  });

  assert.equal(result.status, "complete");
  assert.equal(result.candidates.length, 1);
  const expansion = result.candidates[0]!;
  assert.equal(expansion.status, "complete");
  assert.equal(expansion.subtree.status, "complete");
  assert.equal(expansion.subtree.important_reply_count, 1);
  assert.equal(expansion.subtree.covered_important_reply_count, 1);
  assert.equal(expansion.subtree.forcing_reply_count, 2);
  assert.equal(expansion.subtree.covered_forcing_reply_count, 2);
  const opponentEdges = expansion.subtree.edges.filter((edge) => edge.owner === "opponent");
  assert.deepEqual(opponentEdges.map((edge) => edge.san).sort(), ["Bb4+", "Nc6", "exd4"]);
  assert.equal(opponentEdges.find((edge) => edge.san === "exd4")?.forcing, true);
  assert.equal(opponentEdges.find((edge) => edge.san === "Nc6")?.forcing, false);
  assert.ok(
    expansion.omissions.some((item) => item.san === "a6" && item.reason === "popularity-filtered"),
  );
  assert.ok(
    expansion.subtree.nodes.length <= input.request.budget.maximum_subtree_nodes_per_candidate,
  );
  assert.ok(
    expansion.subtree.routes.every((route) => {
      const node = expansion.subtree.nodes.find(
        (candidate) => candidate.node_id === route.terminal_node_id,
      )!;
      return (
        route.termination === "existing-preparation" ||
        route.termination === "terminal-position" ||
        node.ply === input.request.budget.strategic_horizon_ply
      );
    }),
  );
});

test("forcing classification is deterministic and independent of explorer claims", async () => {
  const input = await setup();
  const falseClaims = WHITE_REPLIES.map((item) => ({
    ...item,
    forcing: false,
  })) as unknown as readonly ReplacementExplorerReplyEvidence[];
  const first = await expandReplacementCandidates({
    ...input,
    explorer_provider: explorerProvider(falseClaims),
    engine_provider: continuationProvider(),
  });
  const second = await expandReplacementCandidates({
    ...input,
    explorer_provider: explorerProvider([...falseClaims].reverse()),
    engine_provider: continuationProvider(),
  });
  assert.equal(
    first.candidates[0]!.subtree?.edges.find((edge) => edge.san === "exd4")?.forcing,
    true,
  );
  assert.deepEqual(first, second);
});

test("subtree-node budget exhaustion records every omitted required reply and truncation", async () => {
  const input = await setup({ budget: { maximum_subtree_nodes_per_candidate: 3 } });
  const result = await expandReplacementCandidates({
    ...input,
    explorer_provider: explorerProvider(WHITE_REPLIES),
    engine_provider: continuationProvider(),
  });
  const candidate = result.candidates[0]!;
  assert.equal(result.status, "partial");
  assert.equal(candidate.status, "budget-exhausted");
  assert.equal(candidate.subtree?.status, "truncated");
  assert.ok(candidate.subtree!.truncation_reasons.includes("subtree-node-budget-exhausted"));
  assert.ok(
    candidate.omissions.some(
      (item) => item.reason === "subtree-node-budget-exhausted" && (item.important || item.forcing),
    ),
  );
  assert.ok(
    candidate.unresolved_risks.some(
      (item) => item.kind === "unresolved-forcing-reply" || item.kind === "incomplete-expansion",
    ),
  );
});

test("engine, explorer, popularity, and reply-policy budgets stop scheduling deterministically", async () => {
  const input = await setup({
    budget: {
      maximum_explorer_queries: 0,
      include_all_forcing_replies: false,
    },
  });
  let explorerCalls = 0;
  let engineCalls = 0;
  const explorer = explorerProvider(WHITE_REPLIES);
  const engine = continuationProvider();
  const result = await expandReplacementCandidates({
    ...input,
    explorer_provider: {
      ...explorer,
      async query(request, signal) {
        explorerCalls++;
        return explorer.query(request, signal);
      },
    },
    engine_provider: {
      ...engine,
      async analyse(request, signal) {
        engineCalls++;
        return engine.analyse(request, signal);
      },
    },
  });
  const candidate = result.candidates[0]!;
  assert.equal(result.status, "partial");
  assert.equal(explorerCalls, 0);
  assert.equal(engineCalls, 0);
  assert.equal(result.explorer_queries_scheduled, 0);
  assert.equal(result.engine_positions_scheduled, 1);
  assert.ok(candidate.omissions.some((item) => item.reason === "explorer-query-budget-exhausted"));
  assert.ok(
    candidate.omissions.some((item) => item.reason === "reply-policy-excluded" && item.forcing),
  );
  assert.ok(candidate.subtree?.truncation_reasons.includes("explorer-query-budget-exhausted"));
  assert.ok(candidate.subtree?.truncation_reasons.includes("forcing-reply-policy"));

  const engineLimitedInput = await setup({ budget: { maximum_engine_positions: 1 } });
  engineCalls = 0;
  const engineLimited = await expandReplacementCandidates({
    ...engineLimitedInput,
    explorer_provider: explorerProvider(WHITE_REPLIES),
    engine_provider: {
      ...engine,
      async analyse(request, signal) {
        engineCalls++;
        return engine.analyse(request, signal);
      },
    },
  });
  assert.equal(engineCalls, 0);
  assert.equal(engineLimited.engine_positions_scheduled, 1);
  assert.ok(
    engineLimited.omissions.some((item) => item.reason === "engine-position-budget-exhausted"),
  );
});

test("canonical positions join existing preparation by transposition", async () => {
  const games = [
    ...WHITE_GAMES,
    `[Event "Prepared move order"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. d4 *`,
  ];
  const input = await setup({ games });
  const result = await expandReplacementCandidates({
    ...input,
    explorer_provider: explorerProvider([reply("popular-nc6", "Nc6", "b8c6", 0.7)]),
    engine_provider: continuationProvider(),
  });
  const candidate = result.candidates[0]!;
  const joined = candidate.subtree?.nodes.find(
    (node) => node.kind === "transposition" && node.transposition_target_position_id !== null,
  );
  assert.ok(joined);
  assert.ok(
    candidate.subtree?.routes.some((route) => route.termination === "existing-preparation"),
  );
});

test("illegal and malformed explorer/engine PV evidence remains per-item and never throws", async () => {
  const input = await setup();
  const badReplies = [
    reply("illegal", "Qa9", "a1a8", 0.8),
    { ...reply("malformed-pv", "Nc6", "b8c6", 0.7), pv: ["a1a8"] },
    reply("rare-forcing-exd4", "exd4", "e5d4", 0.01),
  ];
  const result = await expandReplacementCandidates({
    ...input,
    explorer_provider: explorerProvider(badReplies),
    engine_provider: continuationProvider({ malformedPv: true }),
  });
  assert.equal(result.status, "partial");
  assert.ok(
    result.evidence_item_results.some(
      (item) => item.provider_kind === "explorer" && item.status === "illegal",
    ),
  );
  assert.ok(
    result.evidence_item_results.some(
      (item) => item.provider_kind === "explorer" && item.error_code === "malformed-pv",
    ),
  );
  assert.ok(
    result.evidence_item_results.some(
      (item) => item.provider_kind === "engine" && item.error_code === "malformed-pv",
    ),
  );
  assert.ok(result.candidates[0]!.seed.engine_evidence_ids.includes("engine-evidence:task-8-4"));
});

test("optional explorer PV, duplicate replies, and malformed raw items remain structured", async () => {
  const input = await setup();
  const provider = explorerProvider([], (evidence) => ({
    ...evidence,
    replies: [
      { ...reply("a-nc6", "Nc6", "b8c6", 0.7), pv: [] },
      reply("z-duplicate-nc6", "Nc6", "b8c6", 0.7),
      null,
    ] as unknown as readonly ReplacementExplorerReplyEvidence[],
  }));
  const result = await expandReplacementCandidates({
    ...input,
    explorer_provider: provider,
    engine_provider: continuationProvider(),
  });

  assert.equal(result.status, "partial");
  const candidate = result.candidates[0]!;
  assert.equal(candidate.subtree?.important_reply_count, 1);
  assert.equal(candidate.subtree?.covered_important_reply_count, 1);
  const explorerItems = result.evidence_item_results.filter(
    (item) => item.provider_kind === "explorer",
  );
  const optionalPv = explorerItems.find((item) => item.item_id === "a-nc6");
  assert.equal(optionalPv?.status, "complete");
  assert.deepEqual(optionalPv?.canonical_pv_san, []);
  assert.equal(
    explorerItems.find((item) => item.item_id === "z-duplicate-nc6")?.error_code,
    "malformed-evidence",
  );
  assert.ok(explorerItems.some((item) => item.item_id === null && item.status === "malformed"));
});

test("malformed explorer and engine provenance is structural rather than exceptional", async () => {
  const input = await setup();
  const malformedExplorer = await expandReplacementCandidates({
    ...input,
    explorer_provider: explorerProvider(WHITE_REPLIES, (evidence) => ({
      ...evidence,
      provenance: [null] as unknown as readonly StrategicFitSourceProvenance[],
    })),
    engine_provider: continuationProvider(),
  });
  assert.equal(malformedExplorer.status, "unavailable");
  assert.ok(
    malformedExplorer.evidence_item_results.some(
      (item) => item.provider_kind === "explorer" && item.error_code === "malformed-evidence",
    ),
  );

  const engine = continuationProvider();
  const malformedEngine = await expandReplacementCandidates({
    ...input,
    explorer_provider: explorerProvider([reply("popular-nc6", "Nc6", "b8c6", 0.7)]),
    engine_provider: {
      ...engine,
      async analyse(request, signal) {
        const evidence = await engine.analyse(request, signal);
        assert.ok(evidence);
        return {
          ...evidence,
          provenance: [null] as unknown as readonly StrategicFitSourceProvenance[],
        };
      },
    },
  });
  assert.equal(malformedEngine.status, "partial");
  assert.ok(
    malformedEngine.evidence_item_results.some(
      (item) => item.provider_kind === "engine" && item.error_code === "malformed-evidence",
    ),
  );
});

test("wider compatible engine cache is reused even after the provider budget is exhausted", async () => {
  const sourceInput = await setup();
  const generated = await expandReplacementCandidates({
    ...sourceInput,
    explorer_provider: explorerProvider([reply("popular-nc6", "Nc6", "b8c6", 0.7)]),
    engine_provider: continuationProvider(),
  });
  assert.ok(generated.engine_cache_writes.length > 0);
  const widerCache = generated.engine_cache_writes.map((entry) => ({
    ...structuredClone(entry),
    requested_multipv: 2,
    lines: [
      ...structuredClone(entry.lines),
      {
        ...structuredClone(entry.lines[0]!),
        line_id: `${entry.evidence_id}:surplus`,
        multipv_rank: 2,
      },
    ],
  }));
  const budgetLimitedInput = await setup({ budget: { maximum_engine_positions: 1 } });
  let engineCalls = 0;
  const engine = continuationProvider();
  const result = await expandReplacementCandidates({
    ...budgetLimitedInput,
    explorer_provider: explorerProvider([reply("popular-nc6", "Nc6", "b8c6", 0.7)]),
    engine_provider: {
      ...engine,
      async analyse(request, signal) {
        engineCalls++;
        return engine.analyse(request, signal);
      },
    },
    engine_cache_evidence: widerCache,
  });

  assert.equal(result.status, "complete");
  assert.equal(engineCalls, 0);
  assert.equal(result.engine_positions_scheduled, 1);
  assert.ok(
    result.source_results
      .filter((item) => item.provider_kind === "engine")
      .every((item) => item.cache?.status === "hit"),
  );
});

test("shallow, incomplete, and malformed engine lines cannot masquerade as complete", async () => {
  const input = await setup({ budget: { engine_multipv: 2 } });
  const provider: ReplacementEngineProvider = {
    identity: engineIdentity,
    async analyse(request) {
      const uci = firstLegalUci(request.position.fen, [
        "g1f3",
        "d1d4",
        "c2c3",
        "b8c6",
        "g8f6",
        "f1b5",
      ]);
      const evidence = engineEvidence(request, [uci], `shallow:${request.position.position_id}`);
      return {
        ...evidence,
        reached_depth: request.depth - 1,
        lines: [
          { ...evidence.lines[0]!, depth: request.depth - 1 },
          null,
        ] as unknown as ReplacementEngineAnalysisEvidence["lines"],
      };
    },
  };
  const result = await expandReplacementCandidates({
    ...input,
    explorer_provider: explorerProvider([reply("popular-nc6", "Nc6", "b8c6", 0.7)]),
    engine_provider: provider,
  });

  assert.equal(result.status, "partial");
  assert.ok(
    result.source_results
      .filter((item) => item.provider_kind === "engine")
      .every((item) => item.state === "partial"),
  );
  assert.ok(
    result.evidence_item_results.some(
      (item) => item.provider_kind === "engine" && item.error_code === "stale-request",
    ),
  );
  assert.ok(
    result.evidence_item_results.some(
      (item) => item.provider_kind === "engine" && item.status === "malformed",
    ),
  );
  assert.notEqual(result.candidates[0]!.status, "complete");
});

test("stale semantic pivot or Task 8.4 identity returns structured stale result", async () => {
  const input = await setup();
  const stale = await expandReplacementCandidates({
    ...input,
    request: { ...input.request, repertoire_revision: "revision:stale" },
  });
  assert.equal(stale.status, "stale");
  assert.equal(stale.error_code, "request-pivot-mismatch");
  assert.deepEqual(stale.candidates, []);
});

test("unavailable explorer and engine retain usable seed, source evidence, and explicit partial subtree", async () => {
  const input = await setup();
  const result = await expandReplacementCandidates(input);
  assert.equal(result.status, "unavailable");
  const candidate = result.candidates[0]!;
  assert.equal(candidate.seed.candidate_id, input.engine_generation.candidates[0]!.candidate_id);
  assert.equal(candidate.subtree?.status, "truncated");
  assert.ok(
    candidate.source_results.some(
      (item) => item.provider_kind === "explorer" && item.state === "unavailable",
    ),
  );
  assert.ok(
    candidate.source_results.some(
      (item) => item.provider_kind === "engine" && item.state === "unavailable",
    ),
  );
  assert.ok(result.task_8_4_engine_item_results.length > 0);
  assert.ok(result.unresolved_risks.some((item) => item.kind === "engine-unverified"));
});

test("cancellation reaches provider signal and stops all new scheduling", async () => {
  const input = await setup();
  const controller = new AbortController();
  let explorerCalls = 0;
  let engineCalls = 0;
  let receivedSignal: AbortSignal | undefined;
  const provider = explorerProvider(WHITE_REPLIES);
  const cancellingExplorer: ReplacementExplorerExpansionProvider = {
    ...provider,
    async query(request, signal) {
      explorerCalls++;
      receivedSignal = signal;
      controller.abort();
      return provider.query(request, signal);
    },
  };
  const engine = continuationProvider();
  const countingEngine: ReplacementEngineProvider = {
    ...engine,
    async analyse(request, signal) {
      engineCalls++;
      return engine.analyse(request, signal);
    },
  };
  const result = await expandReplacementCandidates({
    ...input,
    explorer_provider: cancellingExplorer,
    engine_provider: countingEngine,
    signal: controller.signal,
  });
  assert.equal(result.status, "cancelled");
  assert.equal(explorerCalls, 1);
  assert.equal(engineCalls, 0);
  assert.equal(receivedSignal, controller.signal);
  assert.equal(result.explorer_queries_scheduled, 1);
});

test("progress is monotonic, deterministic, and terminal", async () => {
  const input = await setup();
  const progress: { completed: number; visited: number; candidates: number; state: string }[] = [];
  const result = await expandReplacementCandidates({
    ...input,
    explorer_provider: explorerProvider(WHITE_REPLIES),
    engine_provider: continuationProvider(),
    onProgress(value) {
      progress.push({
        completed: value.completed_units,
        visited: value.visited_positions,
        candidates: value.completed_candidates,
        state: value.state,
      });
    },
  });
  assert.equal(result.status, "complete");
  assert.ok(progress.length > 3);
  for (let index = 1; index < progress.length; index++) {
    assert.ok(progress[index]!.completed >= progress[index - 1]!.completed);
    assert.ok(progress[index]!.visited >= progress[index - 1]!.visited);
    assert.ok(progress[index]!.candidates >= progress[index - 1]!.candidates);
  }
  assert.equal(progress.at(-1)!.state, "completed");
});

test("Black repertoire ownership and White/repertoire POV labels remain distinct", async () => {
  const input = await setup({ color: "black" });
  const result = await expandReplacementCandidates({
    ...input,
    explorer_provider: explorerProvider([reply("popular-nf3", "Nf3", "g1f3", 0.8)]),
    engine_provider: continuationProvider(),
  });
  assert.equal(result.status, "complete");
  const candidate = result.candidates[0]!;
  assert.equal(candidate.seed.repertoire_color, "black");
  assert.equal(candidate.seed.objective_quality.white_pov_evaluation_cp, 24);
  assert.equal(candidate.seed.objective_quality.repertoire_pov_evaluation_cp, -24);
  assert.ok(
    candidate.subtree?.edges.some(
      (edge) => edge.san === "Nf3" && edge.owner === "opponent" && edge.mover_color === "white",
    ),
  );
  assert.ok(
    candidate.subtree?.edges.some(
      (edge) => edge.san === "Nc6" && edge.owner === "repertoire" && edge.mover_color === "black",
    ),
  );
  const continuation = result.evidence_item_results.find(
    (item) => item.provider_kind === "engine" && item.included,
  );
  assert.equal(continuation?.white_pov_evaluation_cp, 24);
  assert.equal(continuation?.repertoire_pov_evaluation_cp, -24);
});

test("versions, provenance, source states, provider evidence, cache, and inputs serialize immutably", async () => {
  const input = await setup();
  const cacheRequest = {
    request_id: input.request.request_id,
    repertoire_revision: input.request.repertoire_revision,
    repertoire_color: input.request.repertoire_color,
    position: {
      position_id: "position:unrelated",
      position_key: "8/8/8/8/8/8/8/K6k w - -",
      fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
    },
    depth: input.request.budget.engine_depth,
    multipv: input.request.budget.engine_multipv,
  } as const;
  const cache = [engineEvidence(cacheRequest, ["a1a2"], "cache:unrelated", "partial")];
  const before = JSON.stringify({
    request: input.request,
    graph: input.graph,
    pivot: input.pivot_result,
    candidates: input.candidate_generation,
    engine: input.engine_generation,
    cache,
  });
  const explorer = explorerProvider(WHITE_REPLIES);
  const engine = continuationProvider();
  const result = await expandReplacementCandidates({
    ...input,
    explorer_provider: explorer,
    engine_provider: engine,
    engine_cache_evidence: cache,
  });
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(result)));
  assert.equal(
    JSON.stringify({
      request: input.request,
      graph: input.graph,
      pivot: input.pivot_result,
      candidates: input.candidate_generation,
      engine: input.engine_generation,
      cache,
    }),
    before,
  );
  assert.equal(result.schema_version, STRATEGIC_FIT_SCHEMA_VERSION);
  assert.equal(result.analysis_version, STRATEGIC_FIT_ANALYSIS_VERSION);
  assert.equal(result.replacement_schema_version, STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION);
  assert.ok(
    result.provenance.some((item) => item.source_id === "strategic-fit:replacement-expand"),
  );
  assert.ok(result.source_results.every((item) => item.evidence !== null));
  assert.equal(result.source_graph_unchanged, true);
  assert.equal(result.engine_generation_unchanged, true);
  assert.equal(result.providers_unchanged, true);
  assert.equal(result.cache_inputs_unchanged, true);
  assert.equal(result.evidence_unchanged, true);
});
