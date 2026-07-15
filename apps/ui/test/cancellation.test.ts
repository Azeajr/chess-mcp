import test from "node:test";
import assert from "node:assert/strict";
import { GameTree, auditRepertoireMoves, compareMoves, findOnlyMoves, theoryDepth } from "@chess-mcp/chess-tools";
import { executeBrowserCommand } from "../src/application/browser-commands/client.ts";
import { defaultBrowserCommandDependencies } from "../src/application/browser-commands/default-context.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function boundedCancellation(operation: "audit" | "only") {
  const tree = GameTree.fromPgn("1. e4 (1. d4 d5 2. c4 e6 3. Nc3) e5 2. Nf3 (2. Nc3 Nf6 3. f4) Nc6 3. Bb5 (3. Bc4 Nf6 4. d3) a6 4. Ba4 *");
  let cancelled = false;
  let started = 0;
  const pending: ((lines: []) => void)[] = [];
  const progress: { done: number; total: number }[] = [];
  const analyse = async () => new Promise<[]>((resolve) => { started++; pending.push(resolve); });
  const controls = {
    concurrency: 2,
    shouldCancel: () => cancelled,
    onProgress: (done: number, total: number) => progress.push({ done, total }),
  };
  const resultPromise = operation === "audit"
    ? auditRepertoireMoves(tree, "white", { ...controls, maxPositions: 20 }, analyse)
    : findOnlyMoves(tree, "white", { ...controls, maxPositions: 20 }, analyse);
  await tick();
  assert.equal(started, 2, `${operation} schedules only the configured concurrency`);
  cancelled = true;
  for (const resolve of pending) resolve([]);
  const result = await resultPromise;
  assert.deepEqual(result, { cancelled: true });
  assert.equal(started, 2, `${operation} starts no new analysis after cancellation`);
  assert.equal(progress.every((item, index) => index === 0 || item.done >= progress[index - 1]!.done), true);
  assert.equal(progress.every((item) => item.done >= 0 && item.done <= item.total), true);
}

test("audit and only-move scans use bounded, cancellation-aware scheduling", async () => {
  await boundedCancellation("audit");
  await boundedCancellation("only");
});

test("candidate comparison and explorer walks stop scheduling cooperatively", async () => {
  let compareCancelled = false;
  let compareStarted = 0;
  const comparePending: ((lines: []) => void)[] = [];
  const comparison = compareMoves(
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    ["e4", "d4", "Nf3", "c4"],
    12,
    async () => new Promise<[]>((resolve) => { compareStarted++; comparePending.push(resolve); }),
    { concurrency: 2, shouldCancel: () => compareCancelled },
  );
  await tick();
  assert.equal(compareStarted, 2);
  compareCancelled = true;
  for (const resolve of comparePending) resolve([]);
  assert.equal((await comparison).cancelled, true);
  assert.equal(compareStarted, 2, "comparison starts no queued candidates after cancellation");

  let explorerCancelled = false;
  let explorerStarted = 0;
  let releaseExplorer: ((value: { total_games: number }) => void) | undefined;
  const explorer = theoryDepth(
    GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *"),
    { shouldCancel: () => explorerCancelled },
    async () => new Promise((resolve) => { explorerStarted++; releaseExplorer = resolve; }) as never,
  );
  await tick();
  assert.equal(explorerStarted, 1);
  explorerCancelled = true;
  releaseExplorer?.({ total_games: 1000 });
  const explorerResult = await explorer;
  assert.equal("cancelled" in explorerResult && explorerResult.cancelled, true);
  assert.equal(explorerStarted, 1, "explorer walk starts no child query after cancellation");
});

test("browser command cancellation prevents a repertoire artifact and settles as cancellation", async () => {
  const tree = GameTree.fromPgn("1. e4 (1. d4 d5 2. c4 e6 3. Nc3) e5 2. Nf3 (2. Nc3 Nf6 3. f4) Nc6 3. Bb5 a6 *");
  const controller = new AbortController();
  let started = 0;
  let artifacts = 0;
  const progress: { done: number; total?: number }[] = [];
  const dependencies = {
    ...defaultBrowserCommandDependencies,
    currentTree: () => tree,
    currentPgn: () => tree.toPgn(),
    currentColor: () => "white" as const,
    openings: async () => new Map(),
    createArtifact: () => { artifacts++; return { kind: "artifact" }; },
    analyse: async (_fen: string, _multipv: number, _depth: number, _movetime?: number, signal?: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        started++;
        const abort = () => reject(new DOMException("Cancelled", "AbortError"));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      }),
  };
  const pending = executeBrowserCommand(
    "export_annotated_repertoire",
    { include: ["audit"], max_positions: 20 },
    { signal: controller.signal, onProgress: (done, total) => progress.push({ done, total }) },
    dependencies,
  );
  await tick();
  assert.equal(started, 4, "the command schedules only the domain concurrency bound");
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(started, 4, "the command starts no further analyses after abort");
  assert.equal(artifacts, 0, "cancelled annotation cannot create an artifact");
  assert.equal(progress.every((item, index) => index === 0 || item.done >= progress[index - 1]!.done), true);
});

test("engine queue removes queued jobs, stops exclusive work, and preserves shared searches", async () => {
  const counters = { started: 0, stopped: 0, completed: 0 };
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    timer: ReturnType<typeof setTimeout> | undefined;
    postMessage(command: string) {
      if (command.startsWith("go ")) {
        counters.started++;
        this.timer = setTimeout(() => this.finish(), 40);
      } else if (command === "stop") {
        counters.stopped++;
        clearTimeout(this.timer);
        queueMicrotask(() => this.finish());
      }
    }
    finish() {
      counters.completed++;
      this.onmessage?.({ data: "info depth 12 multipv 1 score cp 20 pv e2e4 e7e5" } as MessageEvent);
      this.onmessage?.({ data: "bestmove e2e4" } as MessageEvent);
    }
    terminate() { clearTimeout(this.timer); }
  }
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeWorker });
  const { analyseMulti } = await import("../src/engine/stockfish.ts");
  const fens = [
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2",
    "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1",
    "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq - 0 1",
  ];
  const controllers = fens.map(() => new AbortController());
  const calls = fens.map((fen, index) => analyseMulti(fen, 1, 12, undefined, controllers[index]!.signal));
  await tick();
  const initiallyStarted = counters.started;
  assert.ok(initiallyStarted >= 1 && initiallyStarted < calls.length);
  controllers.at(-1)!.abort();
  await assert.rejects(calls.at(-1)!, { name: "AbortError" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(counters.started, initiallyStarted, "queued aborted job never starts");
  await Promise.all(calls.slice(0, -1));

  const exclusiveController = new AbortController();
  const exclusive = analyseMulti("8/8/8/8/8/8/4K3/7k w - - 1 60", 1, 13, undefined, exclusiveController.signal);
  await tick();
  const stopsBeforeExclusive = counters.stopped;
  exclusiveController.abort();
  await assert.rejects(exclusive, { name: "AbortError" });
  await tick();
  assert.equal(counters.stopped, stopsBeforeExclusive + 1, "exclusive in-flight abort issues UCI stop");

  const first = new AbortController();
  const second = new AbortController();
  const sharedFen = "8/8/8/8/8/8/4K3/7k w - - 2 61";
  const sharedA = analyseMulti(sharedFen, 1, 14, undefined, first.signal);
  const sharedB = analyseMulti(sharedFen, 1, 14, undefined, second.signal);
  await tick();
  const stopsBeforeShared = counters.stopped;
  first.abort();
  await assert.rejects(sharedA, { name: "AbortError" });
  assert.equal(counters.stopped, stopsBeforeShared, "one subscriber cannot stop shared analysis");
  assert.equal((await sharedB)?.[0]?.depth, 12);
  assert.equal(counters.stopped, stopsBeforeShared);
});
