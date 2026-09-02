import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeMainline,
  onlyMoveDeckCsv,
  type Analyse,
  type EngineLine,
  type OnlyMoveFinding,
} from "../../src/enginetools.ts";
import { START_FEN } from "./fixtures.ts";

const GAME = '[Event "T"]\n\n1. e4 e5 2. Nf3 *\n';

const line = (over: Partial<EngineLine> = {}): EngineLine => ({
  uci: "e2e4",
  cp: 0,
  mate: null,
  depth: 12,
  pv: ["e2e4"],
  ...over,
});

/**
 * A fake engine. `analyzeMainline` asks for one line per position in mainline order (N moves means
 * N+1 positions, the last being the position after the final move), so a script of white-POV
 * centipawn scores drives the whole calculation deterministically.
 */
function scriptedEngine(script: (readonly [number, string])[]): {
  analyse: Analyse;
  calls: { fen: string; multipv: number; depth: number }[];
} {
  const calls: { fen: string; multipv: number; depth: number }[] = [];
  let index = 0;
  const analyse: Analyse = async (fen, multipv, depth) => {
    calls.push({ fen, multipv, depth });
    const step = script[index++];
    if (!step) throw new Error(`engine asked ${String(index)} times, script has ${script.length}`);
    const [cp, uci] = step;
    return await Promise.resolve([line({ cp, uci })]);
  };
  return { analyse, calls };
}

test("analyzeMainline asks the engine once per position, one line at the given depth", async () => {
  const engine = scriptedEngine([
    [20, "e2e4"],
    [15, "e7e5"],
    [25, "g1f3"],
    [20, "b8c6"],
  ]);
  const records = await analyzeMainline(GAME, 18, engine.analyse);

  assert.equal(records?.length, 3, "three moves");
  assert.equal(engine.calls.length, 4, "three moves means four positions");
  assert.equal(engine.calls[0]?.fen, START_FEN);
  assert.ok(engine.calls.every((call) => call.multipv === 1 && call.depth === 18));
});

/**
 * cp_loss is the swing against the player who moved, so the subtraction flips with colour. A test
 * that only used one colour would pass with the branches transposed.
 */
test("analyzeMainline measures loss against whoever moved", async () => {
  const engine = scriptedEngine([
    [50, "e2e4"], // before White's 1. e4
    [10, "e7e5"], // after it: White dropped 40
    [60, "g1f3"], // after Black's 1... e5: White gained 50, so Black lost 50
    [60, "b8c6"], // after White's 2. Nf3: no change
  ]);
  const records = await analyzeMainline(GAME, 12, engine.analyse);

  assert.equal(records?.[0]?.color, "white");
  assert.equal(records?.[0]?.cp_loss, 40);
  assert.equal(records?.[1]?.color, "black");
  assert.equal(records?.[1]?.cp_loss, 50);
  assert.equal(records?.[2]?.cp_loss, 0);
});

test("analyzeMainline never reports a negative loss for a move that improved the evaluation", async () => {
  const engine = scriptedEngine([
    [0, "e2e4"],
    [200, "e7e5"], // White's move gained 200
    [200, "g1f3"],
    [200, "b8c6"],
  ]);
  const records = await analyzeMainline(GAME, 12, engine.analyse);
  assert.equal(records?.[0]?.cp_loss, 0, "a gain is zero loss, not a negative one");
  assert.equal(records?.[0]?.classification, "good");
});

test("analyzeMainline reports the evaluation after the move and the best move before it", async () => {
  const engine = scriptedEngine([
    [30, "d2d4"], // the engine preferred 1. d4
    [10, "e7e5"],
    [10, "g1f3"],
    [10, "b8c6"],
  ]);
  const records = await analyzeMainline(GAME, 12, engine.analyse);
  assert.equal(records?.[0]?.san, "e4", "the move actually played");
  assert.equal(records?.[0]?.best_move, "d4", "the move the engine preferred, as SAN");
  assert.equal(records?.[0]?.best_eval, 30);
  assert.equal(records?.[0]?.eval_cp, 10, "the evaluation after the played move");
});

test("analyzeMainline classifies each move from its own loss", async () => {
  const engine = scriptedEngine([
    [300, "e2e4"],
    [0, "e7e5"], // White lost 300 -> blunder
    [0, "g1f3"],
    [0, "b8c6"],
  ]);
  const records = await analyzeMainline(GAME, 12, engine.analyse);
  assert.equal(records?.[0]?.cp_loss, 300);
  assert.equal(records?.[0]?.classification, "blunder");
});

test("analyzeMainline returns an empty review for a game with no moves", async () => {
  const engine = scriptedEngine([]);
  assert.deepEqual(await analyzeMainline('[Event "T"]\n\n*\n', 12, engine.analyse), []);
  assert.equal(engine.calls.length, 0, "an empty game must not wake the engine");
});

test("analyzeMainline returns null when the engine is unavailable", async () => {
  const analyse: Analyse = async () => await Promise.resolve(null);
  assert.equal(await analyzeMainline(GAME, 12, analyse), null);
});

/**
 * Regression guard for a named past bug. A game ending in mate has no legal move in its final
 * position, so the engine returns [] for that one lookup. Treating [] as engine-unavailable
 * aborted the review of every game that ended in checkmate; it must instead be read as a terminal
 * score. Fool's Mate is the shortest such game.
 */
test("analyzeMainline reviews a game that ends in checkmate instead of aborting", async () => {
  const mateGame = '[Event "T"]\n\n1. f3 e5 2. g4 Qh4# 0-1\n';
  let call = 0;
  const analyse: Analyse = async () => {
    call++;
    // Four moves means five positions; only the last is terminal.
    return await Promise.resolve(call === 5 ? [] : [line({ cp: 0, uci: "f2f3" })]);
  };

  const records = await analyzeMainline(mateGame, 12, analyse);
  assert.notEqual(records, null, "a mated game must still produce a review");
  assert.equal(records?.length, 4);
  // The final position is mate with White to move, which is -100000 from White's point of view.
  assert.equal(records?.[3]?.eval_cp, -100_000);
});

/** An interior position always has a legal move, so a missing best move there is engine trouble. */
test("analyzeMainline returns null when the engine gives no line for a non-terminal position", async () => {
  const analyse: Analyse = async () => await Promise.resolve([]);
  assert.equal(await analyzeMainline(GAME, 12, analyse), null);
});

test("analyzeMainline reports progress and stops when cancelled", async () => {
  const progress: [number, number][] = [];
  const engine = scriptedEngine([
    [0, "e2e4"],
    [0, "e7e5"],
    [0, "g1f3"],
    [0, "b8c6"],
  ]);
  await analyzeMainline(GAME, 12, engine.analyse, {
    concurrency: 1,
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.deepEqual(progress[0], [0, 4], "it announces the total before starting");
  assert.deepEqual(progress.at(-1), [4, 4]);
});

test("analyzeMainline returns null once cancellation is requested", async () => {
  const analyse: Analyse = async () => await Promise.resolve([line()]);
  const records = await analyzeMainline(GAME, 12, analyse, {
    concurrency: 1,
    shouldCancel: () => true,
  });
  assert.equal(records, null, "a cancelled review is not a partial one");
});

const finding = (over: Partial<OnlyMoveFinding> = {}): OnlyMoveFinding =>
  ({
    path: ["e4", "e5"],
    fen: START_FEN,
    prescribed: ["Nf3"],
    margin: 120,
    ...over,
  }) as OnlyMoveFinding;

test("onlyMoveDeckCsv writes a header and one row per finding", () => {
  const csv = onlyMoveDeckCsv("white", [finding(), finding({ margin: 80 })]);
  const rows = csv.trimEnd().split("\n");
  assert.equal(rows[0], "front,back,fen,margin");
  assert.equal(rows.length, 3);
  assert.ok(csv.endsWith("\n"), "the file ends with a newline");
});

test("onlyMoveDeckCsv names the side to move on the front of the card", () => {
  assert.match(onlyMoveDeckCsv("white", [finding()]), /\(White to move\)/u);
  assert.match(onlyMoveDeckCsv("black", [finding()]), /\(Black to move\)/u);
});

test("onlyMoveDeckCsv labels the root as the start position rather than an empty line", () => {
  const csv = onlyMoveDeckCsv("white", [finding({ path: [] })]);
  assert.match(csv, /\(start position\)/u);
});

/** A decisive margin is a mate sentinel, not a centipawn count, so it must not be printed as one. */
test("onlyMoveDeckCsv describes a decisive margin in words instead of centipawns", () => {
  const decisive = onlyMoveDeckCsv("white", [finding({ margin: 100_000 })]);
  assert.match(decisive, /alternatives are decisively worse/u);
  assert.equal(decisive.includes("-100000cp"), false);

  const ordinary = onlyMoveDeckCsv("white", [finding({ margin: 120 })]);
  assert.match(ordinary, /next best -120cp/u);
});

test("onlyMoveDeckCsv joins several prescribed moves rather than dropping any", () => {
  const csv = onlyMoveDeckCsv("white", [finding({ prescribed: ["Nf3", "Nc3"] })]);
  assert.match(csv, /Nf3 \/ Nc3/u);
});

/** A FEN contains commas nowhere but the front text contains parentheses and spaces; quoting must
 *  survive a round trip through a naive splitter for the fields that cannot contain a comma. */
test("onlyMoveDeckCsv emits exactly four fields per row", () => {
  const csv = onlyMoveDeckCsv("white", [finding()]);
  const row = csv.trimEnd().split("\n")[1] ?? "";
  // Fields may be quoted, so count separators outside quotes rather than splitting naively.
  let outside = 0;
  let inQuotes = false;
  for (const char of row) {
    if (char === '"') inQuotes = !inQuotes;
    else if (char === "," && !inQuotes) outside++;
  }
  assert.equal(outside, 3, "three separators means four fields");
});

test("onlyMoveDeckCsv produces just a header when there is nothing to drill", () => {
  assert.equal(onlyMoveDeckCsv("white", []), "front,back,fen,margin\n");
});
