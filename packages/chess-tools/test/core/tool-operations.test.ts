import assert from "node:assert/strict";
import test from "node:test";

import { GameTree } from "../../src/index.ts";
import {
  groundPosition,
  shapeEvaluation,
  transpositionResult,
  repertoireCoverageResult,
  illustrativeLinesResult,
  structuralProfileResult,
} from "../../src/tool-operations.ts";
import type { EngineLine } from "../../src/enginetools.ts";
import {
  AFTER_E4_FEN,
  ITALIAN_FEN,
  KINGLESS_FEN,
  MALFORMED_FEN,
  START_FEN,
  START_LEGAL_MOVES,
} from "./fixtures.ts";

const TRANSPOSITION_PGN = '[Event "T"]\n\n1. e4 e5 2. Nf3 (2. Bc4 Nc6 3. Nf3) 2... Nc6 3. Bc4 *\n';

test("groundPosition returns the normalised FEN, the side to move, and the legal replies", () => {
  const grounded = groundPosition(START_FEN);
  assert.equal("error" in grounded, false);
  if ("error" in grounded) return;
  assert.equal(grounded.fen, START_FEN);
  assert.equal(grounded.turn, "white");
  assert.deepEqual([...grounded.legal_moves].sort(), [...START_LEGAL_MOVES].sort());
});

test("groundPosition reads the side to move from the FEN rather than assuming White", () => {
  const grounded = groundPosition(AFTER_E4_FEN);
  assert.equal("error" in grounded, false);
  if ("error" in grounded) return;
  assert.equal(grounded.turn, "black");
});

/** Grounding is the boundary in front of the walkers, so it must answer, never throw. */
test("groundPosition reports an unusable FEN as a named error instead of throwing", () => {
  for (const fen of [MALFORMED_FEN, KINGLESS_FEN, ""]) {
    const grounded = groundPosition(fen);
    assert.equal("error" in grounded, true, `${fen} was accepted`);
    if (!("error" in grounded)) continue;
    assert.equal(grounded.error, "invalid_fen");
    assert.ok(grounded.reason.length > 0, "the reason must say something");
  }
});

const engineLine = (over: Partial<EngineLine> = {}): EngineLine => ({
  uci: "e2e4",
  cp: 24,
  mate: null,
  depth: 20,
  pv: ["e2e4"],
  ...over,
});

test("shapeEvaluation states the point of view alongside the numbers", () => {
  const shaped = shapeEvaluation(START_FEN, [engineLine()], () => "e4");
  assert.equal(shaped.fen, START_FEN);
  assert.equal(shaped.eval_pov, "white");
  assert.match(shaped.eval_sign, /positive favors White/u);
});

test("shapeEvaluation carries every line through in order", () => {
  const shaped = shapeEvaluation(
    START_FEN,
    [engineLine({ uci: "e2e4", cp: 24 }), engineLine({ uci: "d2d4", cp: 18 })],
    (_fen, uci) => (uci === "e2e4" ? "e4" : "d4"),
  );
  assert.deepEqual(
    shaped.lines.map((line) => line.san),
    ["e4", "d4"],
  );
  assert.deepEqual(
    shaped.lines.map((line) => line.cp),
    [24, 18],
  );
});

test("shapeEvaluation preserves a mate score and a null centipawn score side by side", () => {
  const shaped = shapeEvaluation(START_FEN, [engineLine({ cp: null, mate: 3 })], () => "e4");
  assert.equal(shaped.lines[0]?.cp, null);
  assert.equal(shaped.lines[0]?.mate, 3);
});

/** The host injects the SAN conversion, so a conversion that fails must survive as a null. */
test("shapeEvaluation keeps a line whose SAN could not be derived", () => {
  const shaped = shapeEvaluation(START_FEN, [engineLine()], () => null);
  assert.equal(shaped.lines.length, 1, "the line is not dropped");
  assert.equal(shaped.lines[0]?.san, null);
  assert.equal(shaped.lines[0]?.uci, "e2e4", "the UCI is still usable by the caller");
});

test("shapeEvaluation shapes an empty line list without inventing one", () => {
  const shaped = shapeEvaluation(START_FEN, [], () => null);
  assert.deepEqual(shaped.lines, []);
});

/** Every truncating result reports the true total separately, so a caller can tell it was cut. */
test("transpositionResult separates how many exist from how many it returned", () => {
  const tree = GameTree.fromPgn(TRANSPOSITION_PGN);

  const full = transpositionResult(tree, 10);
  assert.equal(full.total, 1);
  assert.equal(full.returned, 1);
  assert.equal(full.transpositions[0]?.fen, ITALIAN_FEN);

  const truncated = transpositionResult(tree, 0);
  assert.equal(truncated.total, 1, "the total still reflects everything found");
  assert.equal(truncated.returned, 0);
  assert.deepEqual(truncated.transpositions, []);
});

test("transpositionResult reports nothing for a tree with a single line", () => {
  const result = transpositionResult(GameTree.fromPgn('[Event "T"]\n\n1. e4 e5 *\n'), 10);
  assert.equal(result.total, 0);
  assert.equal(result.returned, 0);
});

test("repertoireCoverageResult renames the coverage fields for the tool surface", () => {
  const tree = GameTree.fromPgn(TRANSPOSITION_PGN);
  const result = repertoireCoverageResult(tree, "white", 10);

  assert.equal(result.color, "white");
  for (const key of [
    "leaves",
    "dangling_count",
    "frontier_count",
    "max_depth",
    "shallowest_leaf_ply",
    "dangling_lines",
  ]) {
    assert.ok(key in result, `${key} is missing from the tool shape`);
  }
  assert.equal(typeof result.max_depth, "number");
  assert.ok(Array.isArray(result.dangling_lines));
});

test("repertoireCoverageResult honours the dangling-line limit", () => {
  const tree = GameTree.fromPgn(TRANSPOSITION_PGN);
  assert.deepEqual(repertoireCoverageResult(tree, "white", 0).dangling_lines, []);
});

test("repertoireCoverageResult answers for either colour", () => {
  const tree = GameTree.fromPgn(TRANSPOSITION_PGN);
  assert.equal(repertoireCoverageResult(tree, "black", 5).color, "black");
});

test("illustrativeLinesResult flags truncation rather than silently shortening", () => {
  const tree = GameTree.fromPgn(TRANSPOSITION_PGN);
  const full = illustrativeLinesResult(tree, "white", 100);
  assert.equal(full.truncated, false);
  assert.equal(full.leaves_total, tree.stats().leaves);

  const cut = illustrativeLinesResult(tree, "white", 0);
  assert.deepEqual(cut.lines, []);
  assert.equal(cut.truncated, full.lines.length > 0, "truncated only when something was dropped");
});

test("structuralProfileResult names a variation path it cannot find", () => {
  const tree = GameTree.fromPgn(TRANSPOSITION_PGN);
  const missing = structuralProfileResult(tree, "white", ["d4", "d5"]);
  assert.ok("error" in missing);
  if (!("error" in missing)) return;
  assert.equal(missing.error, "variation_not_found");
  assert.match(missing.reason, /does not match a line/u);
});

test("structuralProfileResult profiles a real variation path", () => {
  const tree = GameTree.fromPgn(TRANSPOSITION_PGN);
  const found = structuralProfileResult(tree, "white", ["e4", "e5", "Nf3"]);
  assert.equal("error" in found, false, "a path that exists must not be reported as missing");
});

test("structuralProfileResult profiles the whole repertoire when no path is given", () => {
  const tree = GameTree.fromPgn(TRANSPOSITION_PGN);
  assert.equal("error" in structuralProfileResult(tree, "white"), false);
  assert.equal(
    "error" in structuralProfileResult(tree, "white", []),
    false,
    "an empty path is all",
  );
});
