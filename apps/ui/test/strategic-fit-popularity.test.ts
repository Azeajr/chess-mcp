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

const explorer = (): ExplorerPosition => ({
  total_games: 1000,
  white_pct: 50,
  draw_pct: 30,
  black_pct: 20,
  opening: null,
  moves: [
    { san: "e5", uci: "e7e5", games: 800, played_pct: 80, white_pct: 50, draw_pct: 30, black_pct: 20, average_rating: null },
    { san: "c5", uci: "c7c5", games: 200, played_pct: 20, white_pct: 50, draw_pct: 30, black_pct: 20, average_rating: null },
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
    currentRevision: () => 71,
    openings: async () => new Map(),
    strategicFitReport: async (pgn: string, options: AnalyzeStrategicFitOptions) => report(pgn, options),
    ...overrides,
  };
}

test("browser adapter injects configured mocked popularity weights and combined progress", async () => {
  let received: AnalyzeStrategicFitOptions | undefined;
  let receivedFilters: unknown;
  const progress: Array<{ done: number; total?: number; detail?: string }> = [];
  const result = await executeBrowserCommand(
    "analyze_repertoire_congruence",
    {
      popularity: {
        db: "lichess",
        speeds: ["rapid"],
        ratings: [1600, 1800],
        since: "2024-01",
        until: "2026-06",
        max_positions: 4,
      },
    },
    { onProgress: (done, total, detail) => progress.push({ done, total, detail }) },
    dependencies({
      hasExplorerToken: () => true,
      explorerPosition: async (_fen, filters) => {
        receivedFilters = filters;
        return explorer();
      },
      strategicFitReport: async (pgn, options) => {
        received = options;
        return report(pgn, options);
      },
    }),
  ) as { provenance: { sources: Array<{ kind: string; state: string }> } };

  assert.deepEqual(receivedFilters, {
    db: "lichess",
    speeds: ["rapid"],
    ratings: [1600, 1800],
    since: "2024-01",
    until: "2026-06",
    movesLimit: 30,
  });
  assert.equal(received?.weighting?.mode, "external");
  const weights = calculateStrategicRouteWeights(
    // The analyzer rebuilds this same canonical graph inside the Worker boundary.
    buildRepertoireGraph(tree, "white"),
    received?.weighting,
  );
  assert.deepEqual(weights.routes.map((route) => route.normalized_weight).sort(), [0.2, 0.8]);
  assert.equal(result.provenance.sources.find((source) => source.kind === "opening-explorer")?.state, "available");
  assert.deepEqual(progress.slice(0, 2), [
    { done: 0, total: 7, detail: "Collecting opening popularity" },
    { done: 1, total: 7, detail: "Collecting opening popularity" },
  ]);
});

test("missing browser authentication and authenticated offline lookup preserve the base report", async () => {
  let unauthenticatedCalls = 0;
  const unauthenticated = await executeBrowserCommand(
    "analyze_repertoire_congruence",
    { popularity: { db: "masters", since: "2020", max_positions: 3 } },
    {},
    dependencies({
      hasExplorerToken: () => false,
      explorerPosition: async () => {
        unauthenticatedCalls++;
        return explorer();
      },
    }),
  ) as { error?: string; provenance: { sources: Array<{ kind: string; state: string; reason: string }> } };
  assert.equal(unauthenticated.error, undefined);
  assert.equal(unauthenticatedCalls, 0);
  assert.equal(unauthenticated.provenance.sources.find((source) => source.kind === "opening-explorer")?.state, "unavailable");
  assert.match(
    unauthenticated.provenance.sources.find((source) => source.kind === "opening-explorer")?.reason ?? "",
    /requires authentication/,
  );

  const offline = await executeBrowserCommand(
    "analyze_repertoire_congruence",
    { popularity: { db: "lichess", max_positions: 3 } },
    {},
    dependencies({
      hasExplorerToken: () => true,
      explorerPosition: async () => null,
    }),
  ) as { error?: string; provenance: { sources: Array<{ kind: string; state: string; reason: string }> } };
  assert.equal(offline.error, undefined);
  assert.equal(offline.provenance.sources.find((source) => source.kind === "opening-explorer")?.state, "unavailable");
  assert.match(
    offline.provenance.sources.find((source) => source.kind === "opening-explorer")?.reason ?? "",
    /offline or returned no response/,
  );
});

test("browser abort during popularity collection never starts the report Worker", async () => {
  const controller = new AbortController();
  let reports = 0;
  const pending = executeBrowserCommand(
    "analyze_repertoire_congruence",
    { popularity: { db: "lichess" } },
    { signal: controller.signal },
    dependencies({
      hasExplorerToken: () => true,
      explorerPosition: async (_fen, _filters, signal) => new Promise<never>((_resolve, reject) => {
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
