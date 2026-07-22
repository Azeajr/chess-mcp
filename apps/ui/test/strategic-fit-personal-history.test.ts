import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  analyzeStrategicFit,
  buildRepertoireGraph,
  calculateStrategicRouteWeights,
  completeStrategicFitReport,
  strategicFitCompleteAnalysisOptions,
  type AnalyzeStrategicFitOptions,
  type ExplorerPosition,
  type GameMeta,
} from "@chess-mcp/chess-tools";
import { executeBrowserCommand } from "../src/application/browser-commands/client.ts";
import { defaultBrowserCommandDependencies } from "../src/application/browser-commands/default-context.ts";

const PGN = `
[Event "King pawn"]
[Result "*"]

1. e4 e5 2. Nf3 *

[Event "Sicilian"]
[Result "*"]

1. e4 c5 2. Nf3 *`;

const tree = GameTree.fromPgn(PGN);

function game(pgn: string | undefined, userColor: "white" | "black" = "white"): GameMeta {
  return {
    white: userColor === "white" ? "SampleUser" : "Opponent",
    black: userColor === "black" ? "SampleUser" : "Opponent",
    result: "*",
    white_elo: null,
    black_elo: null,
    eco: null,
    opening: null,
    date: null,
    time_control: null,
    user_color: userColor,
    user_result: null,
    ...(pgn === undefined ? {} : { pgn }),
  };
}

const explorer = (): ExplorerPosition => ({
  total_games: 100,
  white_pct: 50,
  draw_pct: 30,
  black_pct: 20,
  opening: null,
  moves: [
    { san: "e5", uci: "e7e5", games: 90, played_pct: 90, white_pct: 50, draw_pct: 30, black_pct: 20, average_rating: null },
    { san: "c5", uci: "c7c5", games: 10, played_pct: 10, white_pct: 50, draw_pct: 30, black_pct: 20, average_rating: null },
  ],
});

const report = (pgn: string, options: AnalyzeStrategicFitOptions) =>
  completeStrategicFitReport(analyzeStrategicFit(
    GameTree.fromPgn(pgn),
    strategicFitCompleteAnalysisOptions(options),
  ));

function dependencies(overrides: Partial<typeof defaultBrowserCommandDependencies> = {}) {
  return {
    ...defaultBrowserCommandDependencies,
    currentTree: () => tree,
    currentPgn: () => PGN,
    currentColor: () => "white" as const,
    currentRevision: () => 72,
    openings: async () => new Map(),
    strategicFitReport: async (pgn: string, options: AnalyzeStrategicFitOptions) => report(pgn, options),
    ...overrides,
  };
}

test("browser blends fetched Lichess PGNs with population weights before the Worker boundary", async () => {
  let received: AnalyzeStrategicFitOptions | undefined;
  let fetchArgs: unknown;
  const progress: Array<{ done: number; total?: number; detail?: string }> = [];
  const personalGames = Array.from({ length: 5 }, () => game("1. e4 c5 2. Nf3 *"));
  const result = await executeBrowserCommand(
    "analyze_repertoire_congruence",
    {
      popularity: { db: "lichess" },
      personal_history: { username: "SampleUser", max_games: 5 },
    },
    { onProgress: (done, total, detail) => progress.push({ done, total, detail }) },
    dependencies({
      hasExplorerToken: () => true,
      explorerPosition: async () => explorer(),
      lichessGames: async (...args) => {
        fetchArgs = args.slice(0, 4);
        return personalGames;
      },
      strategicFitReport: async (pgn, options) => {
        received = options;
        return report(pgn, options);
      },
    }),
  ) as { provenance: { sources: Array<{ kind: string; state: string }> } };

  assert.deepEqual(fetchArgs, ["SampleUser", 5, undefined, true]);
  const weights = calculateStrategicRouteWeights(buildRepertoireGraph(tree, "white"), received?.weighting);
  const byReply = (reply: string) => weights.routes.find((weighted) =>
    buildRepertoireGraph(tree, "white").routes.find((route) =>
      route.route_id === weighted.route_id && route.san_moves[1] === reply
    )
  )!.normalized_weight;
  assert.equal(byReply("e5"), 0.72);
  assert.equal(byReply("c5"), 0.28);
  assert.equal(result.provenance.sources.find((source) => source.kind === "opening-explorer")?.state, "available");
  assert.equal(result.provenance.sources.find((source) => source.kind === "personal-history")?.state, "available");
  assert.deepEqual(progress.slice(0, 4), [
    { done: 0, total: 8, detail: "Collecting opening popularity" },
    { done: 1, total: 8, detail: "Collecting opening popularity" },
    { done: 1, total: 8, detail: "Fetching personal game history" },
    { done: 2, total: 8, detail: "Mapped personal game history" },
  ]);
});

test("browser selects Chess.com month fetches and reports no-PGN evidence as insufficient", async () => {
  let fetchArgs: unknown;
  const result = await executeBrowserCommand(
    "analyze_repertoire_congruence",
    {
      personal_history: {
        username: "SampleUser",
        platform: "chesscom",
        year: 2026,
        month: 7,
      },
    },
    {},
    dependencies({
      chesscomGames: async (...args) => {
        fetchArgs = args.slice(0, 5);
        return [game(undefined)];
      },
    }),
  ) as { error?: string; provenance: { sources: Array<{ kind: string; state: string; reason: string }> } };

  assert.deepEqual(fetchArgs, ["SampleUser", 2026, 7, undefined, true]);
  assert.equal(result.error, undefined);
  const source = result.provenance.sources.find((item) => item.kind === "personal-history");
  assert.equal(source?.state, "unavailable");
  assert.match(source?.reason ?? "", /metadata records contain no PGN/);
});

test("browser abort during personal-history fetch never starts the report Worker", async () => {
  const controller = new AbortController();
  let reports = 0;
  const pending = executeBrowserCommand(
    "analyze_repertoire_congruence",
    { personal_history: { username: "SampleUser" } },
    { signal: controller.signal },
    dependencies({
      lichessGames: async (_username, _max, _eco, _includePgn, signal) =>
        new Promise<never>((_resolve, reject) => {
          const abort = () => reject(new DOMException("Cancelled", "AbortError"));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        }),
      strategicFitReport: async (pgn, options) => {
        reports++;
        return report(pgn, options);
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(reports, 0);
});
