import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  analyzeStrategicFit,
  buildRepertoireGraph,
  calculateStrategicRouteWeights,
  collectStrategicPopularityWeights,
  explorerRequest,
  strategicFitReportCacheKey,
  type ExplorerPosition,
} from "../../src/index.ts";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const ROOT_BRANCHES = `
[Event "King pawn"]
[Result "*"]

1. e4 e5 2. Nf3 *

[Event "Sicilian"]
[Result "*"]

1. e4 c5 2. Nf3 *`;

const MULTI_DECISION = `
[Event "Open game"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 (2... Nf6) *

[Event "Sicilian"]
[Result "*"]

1. e4 c5 2. Nf3 d6 (2... Nc6) *`;

const TRANSPOSED_DECISION = `
[Event "Knight first"]
[Result "*"]

1. Nf3 d5 2. d4 Nf6 (2... e6) *

[Event "Pawn first"]
[Result "*"]

1. d4 d5 2. Nf3 Nf6 (2... e6) *`;

const position = (moves: Array<{ uci: string; games: number }>): ExplorerPosition => ({
  total_games: moves.reduce((sum, move) => sum + move.games, 0),
  white_pct: 50,
  draw_pct: 30,
  black_pct: 20,
  opening: null,
  moves: moves.map((move) => ({
    san: move.uci,
    uci: move.uci,
    games: move.games,
    played_pct: 0,
    white_pct: 50,
    draw_pct: 30,
    black_pct: 20,
    average_rating: null,
  })),
});

test("explorer URLs and cache keys include every supported population filter", () => {
  const configured = explorerRequest(START, {
    db: "lichess",
    speeds: ["rapid", "blitz"],
    ratings: [2000, 1600],
    since: "2024-01",
    until: "2026-06",
    movesLimit: 30,
  });
  assert.match(configured.url, /\/lichess\?/);
  assert.match(configured.url, /speeds=blitz,rapid/);
  assert.match(configured.url, /ratings=1600,2000/);
  assert.match(configured.url, /since=2024-01/);
  assert.match(configured.url, /until=2026-06/);
  assert.match(configured.url, /moves=30/);

  const reordered = explorerRequest(START, {
    db: "lichess",
    speeds: ["blitz", "rapid", "blitz"],
    ratings: [1600, 2000, 1600],
    since: "2024-01",
    until: "2026-06",
    movesLimit: 30,
  });
  assert.equal(reordered.cache_key, configured.cache_key, "set-like filters canonicalize before caching");

  const variations = [
    { db: "lichess" as const, speeds: ["blitz"] as const, ratings: [1600, 2000] as const, since: "2024-01", until: "2026-06", movesLimit: 30 },
    { db: "lichess" as const, speeds: ["blitz", "rapid"] as const, ratings: [1800] as const, since: "2024-01", until: "2026-06", movesLimit: 30 },
    { db: "lichess" as const, speeds: ["blitz", "rapid"] as const, ratings: [1600, 2000] as const, since: "2025-01", until: "2026-06", movesLimit: 30 },
    { db: "lichess" as const, speeds: ["blitz", "rapid"] as const, ratings: [1600, 2000] as const, since: "2024-01", until: "2025-06", movesLimit: 30 },
    { db: "lichess" as const, speeds: ["blitz", "rapid"] as const, ratings: [1600, 2000] as const, since: "2024-01", until: "2026-06", movesLimit: 12 },
  ];
  for (const filters of variations) {
    assert.notEqual(explorerRequest(START, filters).cache_key, configured.cache_key);
  }

  const masters = explorerRequest(START, { db: "masters", since: "2018", until: "2025", movesLimit: 8 });
  assert.match(masters.url, /\/masters\?/);
  assert.match(masters.url, /since=2018/);
  assert.match(masters.url, /until=2025/);
  assert.notEqual(masters.cache_key, configured.cache_key);
  assert.throws(
    () => explorerRequest(START, { db: "masters", speeds: ["rapid"] }),
    /explorer_unsupported_masters_population_filter/,
  );
  assert.throws(
    () => explorerRequest(START, { db: "lichess", since: "2025" }),
    /explorer_invalid_since/,
  );
});

test("canonical transpositions query one opponent-decision position once", async () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(TRANSPOSED_DECISION), "white");
  let calls = 0;
  const collection = await collectStrategicPopularityWeights(
    graph,
    {},
    async () => {
      calls++;
      return position([{ uci: "g8f6", games: 80 }, { uci: "e7e6", games: 20 }]);
    },
  );

  assert.equal(collection.state, "complete");
  assert.equal(collection.relevant_positions, 1);
  assert.equal(collection.positions_queried, 1);
  assert.equal(collection.decision_weights.length, 2);
  assert.equal(calls, 1);
});

test("query budgets are hard bounds with monotonic progress and explicit partial coverage", async () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(MULTI_DECISION), "white");
  let calls = 0;
  const progress: Array<[number, number]> = [];
  const collection = await collectStrategicPopularityWeights(
    graph,
    { maxPositions: 1, onProgress: (done, total) => progress.push([done, total]) },
    async () => {
      calls++;
      return position([
        { uci: "e7e5", games: 70 },
        { uci: "c7c5", games: 30 },
        { uci: "b8c6", games: 60 },
        { uci: "g8f6", games: 40 },
        { uci: "d7d6", games: 55 },
        { uci: "b8c6", games: 45 },
      ]);
    },
  );

  assert.equal(collection.state, "partial");
  assert.equal(collection.budget_exhausted, true);
  assert.equal(collection.positions_queried, 1);
  assert.ok(collection.positions_skipped > 0);
  assert.equal(calls, 1);
  assert.deepEqual(progress, [[0, 1], [1, 1]]);
  assert.equal(collection.provenance[0]?.state, "partial");
  assert.match(collection.provenance[0]?.reason ?? "", /bounded query budget was exhausted/);

  const weights = calculateStrategicRouteWeights(graph, collection.weighting);
  assert.equal(weights.state, "partial");
  assert.ok(weights.fallbacks.some((fallback) => fallback.reason === "missing-decision-weight"));
});

test("cancellation stops scheduling after the in-flight canonical query", async () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(MULTI_DECISION), "white");
  let cancelled = false;
  let calls = 0;
  let release: ((value: ExplorerPosition) => void) | undefined;
  const pending = collectStrategicPopularityWeights(
    graph,
    { shouldCancel: () => cancelled },
    async () => new Promise<ExplorerPosition>((resolve) => {
      calls++;
      release = resolve;
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  cancelled = true;
  release?.(position([{ uci: "e7e5", games: 1 }]));

  const collection = await pending;
  assert.equal(collection.state, "cancelled");
  assert.equal(calls, 1);
  assert.equal(collection.provenance[0]?.state, "partial");
});

test("authentication and offline failures remain unavailable evidence with usable equal fallback", async () => {
  const tree = GameTree.fromPgn(ROOT_BRANCHES);
  const graph = buildRepertoireGraph(tree, "white");
  let calls = 0;
  const unauthenticated = await collectStrategicPopularityWeights(
    graph,
    { availability: "authentication-required" },
    async () => {
      calls++;
      return position([]);
    },
  );
  assert.equal(unauthenticated.state, "unavailable");
  assert.equal(unauthenticated.positions_queried, 0);
  assert.equal(unauthenticated.provenance[0]?.state, "unavailable");
  assert.match(unauthenticated.provenance[0]?.reason ?? "", /requires authentication/);
  assert.equal(calls, 0);

  const offline = await collectStrategicPopularityWeights(graph, {}, async () => null);
  assert.equal(offline.state, "unavailable");
  assert.equal(offline.positions_queried, 1);
  assert.match(offline.provenance[0]?.reason ?? "", /offline or returned no response/);

  const fallback = calculateStrategicRouteWeights(graph, offline.weighting);
  assert.equal(fallback.state, "fallback");
  assert.deepEqual(fallback.routes.map((route) => route.normalized_weight), [0.5, 0.5]);
  assert.equal(fallback.provenance.find((source) => source.kind === "opening-explorer")?.state, "unavailable");

  const report = analyzeStrategicFit(tree, {
    repertoireColor: "white",
    repertoireRevision: "revision:offline-popularity",
    weighting: unauthenticated.weighting,
  });
  assert.ok(report.summary);
  assert.equal(report.provenance.sources.find((source) => source.kind === "opening-explorer")?.state, "unavailable");
});

test("a later explorer failure retains successful weights with partial provenance", async () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(MULTI_DECISION), "white");
  let calls = 0;
  const collection = await collectStrategicPopularityWeights(graph, {}, async () => {
    calls++;
    return calls === 1
      ? position([{ uci: "e7e5", games: 75 }, { uci: "c7c5", games: 25 }])
      : null;
  });

  assert.equal(collection.state, "partial");
  assert.equal(collection.positions_weighted, 1);
  assert.equal(collection.positions_queried, 2);
  assert.equal(collection.provenance[0]?.state, "partial");
  assert.match(collection.provenance[0]?.reason ?? "", /remaining positions use explicit equal fallbacks/);
  assert.ok(collection.decision_weights.some((weight) => weight.weight === 75));
});

test("mocked population counts produce weighted routes and filter-specific report cache identities", async () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(ROOT_BRANCHES), "white");
  const lookup = async () => position([
    { uci: "e7e5", games: 900 },
    { uci: "c7c5", games: 100 },
  ]);
  const practical = await collectStrategicPopularityWeights(
    graph,
    { filters: { db: "lichess", speeds: ["rapid"], ratings: [1600], since: "2024-01" } },
    lookup,
  );
  const masters = await collectStrategicPopularityWeights(
    graph,
    { filters: { db: "masters", since: "2020" } },
    lookup,
  );
  const weights = calculateStrategicRouteWeights(graph, practical.weighting);
  const routeWeight = (reply: string) => weights.routes.find((weighted) =>
    graph.routes.find((route) => route.route_id === weighted.route_id)?.san_moves[1] === reply
  )!.normalized_weight;
  assert.equal(routeWeight("e5"), 0.9);
  assert.equal(routeWeight("c5"), 0.1);
  assert.equal(weights.state, "complete");
  assert.equal(weights.provenance.find((source) => source.kind === "opening-explorer")?.state, "available");

  const baseOptions = { repertoireColor: "white" as const, repertoireRevision: "revision:popular" };
  assert.notEqual(
    strategicFitReportCacheKey(ROOT_BRANCHES, { ...baseOptions, weighting: practical.weighting }),
    strategicFitReportCacheKey(ROOT_BRANCHES, { ...baseOptions, weighting: masters.weighting }),
    "identical counts from different populations cannot share a report cache entry",
  );
});
