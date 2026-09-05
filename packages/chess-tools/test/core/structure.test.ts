import assert from "node:assert/strict";
import test from "node:test";

import type { Board } from "chessops/board";
import { parseFen } from "chessops/fen";

import {
  doubledPawns,
  isolatedPawns,
  passedPawns,
  themes,
  centerState,
  classifyStructureFromFen,
} from "../../src/index.ts";
import { pawnChains, openFiles, halfOpenFiles } from "../../src/structure.ts";
import { START_FEN } from "./fixtures.ts";

function boardOf(fen: string): Board {
  return parseFen(fen).unwrap().board;
}

const MIXED_FEN = "6k1/p4p1p/8/3p4/4P3/2P5/PPP4P/6K1 w - - 0 1";

const PASSERS_FEN = "7k/7p/8/P7/8/8/8/7K w - - 0 1";

test("doubledPawns reports every pawn on a file that holds more than one", () => {
  const board = boardOf(MIXED_FEN);
  assert.deepEqual(doubledPawns(board, "white"), ["c2", "c3"]);
  assert.deepEqual(doubledPawns(board, "black"), [], "Black has one pawn per file");
});

test("doubledPawns finds nothing in the start position", () => {
  assert.deepEqual(doubledPawns(boardOf(START_FEN), "white"), []);
});

test("isolatedPawns reports pawns with no friendly pawn on either neighbouring file", () => {
  const board = boardOf(MIXED_FEN);
  assert.deepEqual(isolatedPawns(board, "white"), ["e4", "h2"]);
});

test("isolatedPawns counts a doubled pair as connected when a neighbour file is occupied", () => {
  assert.equal(isolatedPawns(boardOf(MIXED_FEN), "white").includes("c2"), false);
});

test("isolatedPawns finds nothing in the start position", () => {
  assert.deepEqual(isolatedPawns(boardOf(START_FEN), "white"), []);
});

test("passedPawns reports a pawn no enemy pawn can stop", () => {
  const board = boardOf(PASSERS_FEN);
  assert.deepEqual(passedPawns(board, "white"), ["a5"]);
  assert.deepEqual(passedPawns(board, "black"), ["h7"]);
});

test("passedPawns reports none when every file is contested", () => {
  assert.deepEqual(passedPawns(boardOf(START_FEN), "white"), []);
  assert.deepEqual(passedPawns(boardOf(MIXED_FEN), "white"), []);
});

test("passedPawns measures ahead in each colour's own direction", () => {
  const board = boardOf("7k/3p4/8/8/3P4/8/8/7K w - - 0 1");
  assert.deepEqual(passedPawns(board, "white"), []);
  assert.deepEqual(passedPawns(board, "black"), []);
});

test("pawnChains groups pawns that defend each other diagonally forward", () => {
  assert.deepEqual(pawnChains(boardOf(MIXED_FEN), "white"), [["b2", "c3"]]);
});

test("pawnChains reports nothing when no pawn defends another", () => {
  assert.deepEqual(pawnChains(boardOf(START_FEN), "white"), [], "a rank of pawns defends nothing");
  assert.deepEqual(pawnChains(boardOf(PASSERS_FEN), "white"), []);
});

test("openFiles reports files with no pawn of either colour", () => {
  assert.deepEqual(openFiles(boardOf(MIXED_FEN)), ["g"]);
  assert.deepEqual(openFiles(boardOf(START_FEN)), [], "no file is open at the start");
});

test("halfOpenFiles is relative to the colour asking", () => {
  const board = boardOf(MIXED_FEN);
  assert.deepEqual(halfOpenFiles(board, "white"), ["d", "f"]);
  assert.deepEqual(halfOpenFiles(board, "black"), ["b", "c", "e"]);
});

test("halfOpenFiles excludes a file that is open to both", () => {
  assert.equal(halfOpenFiles(boardOf(MIXED_FEN), "white").includes("g"), false);
});

test("themes detects a fianchettoed bishop for the colour that has one", () => {
  const board = boardOf("6k1/6b1/8/8/8/6P1/6B1/6K1 w - - 0 1");
  const result = themes(board, "white");
  assert.equal(result.fianchetto_white, true, "a bishop on g2");
  assert.equal(result.fianchetto_black, true, "a bishop on g7");
  assert.equal(themes(boardOf(START_FEN), "white").fianchetto_white, false);
});

test("themes counts space as pawns advanced into the middle ranks", () => {
  assert.equal(themes(boardOf(START_FEN), "white").space_white, 0, "nothing has advanced yet");
  assert.equal(themes(boardOf(MIXED_FEN), "white").space_white, 1);
});

test("themes and centerState return the same cached object for the same placement", () => {
  const first = themes(boardOf(MIXED_FEN), "white");
  const second = themes(boardOf(MIXED_FEN), "white");
  assert.equal(first, second, "same placement and colour is one cached entry");

  const asBlack = themes(boardOf(MIXED_FEN), "black");
  assert.notEqual(first, asBlack, "colour is part of the key");

  assert.equal(centerState(boardOf(MIXED_FEN)), centerState(boardOf(MIXED_FEN)));
});

test("centerState answers with one of its four named states", () => {
  const states = new Set(["tense", "locked", "open", "semi-open"]);
  assert.ok(states.has(centerState(boardOf(START_FEN))));
  assert.ok(states.has(centerState(boardOf(MIXED_FEN))));
  assert.ok(states.has(centerState(boardOf(PASSERS_FEN))));
});

test("classifyStructureFromFen falls back to unknown rather than guessing a label", () => {
  const bare = classifyStructureFromFen(PASSERS_FEN);
  assert.equal(bare.structure_class, "unknown");
  assert.equal(typeof bare.confidence, "number");
});

test("classifyStructureFromFen reports a confidence in the unit interval", () => {
  for (const fen of [START_FEN, MIXED_FEN, PASSERS_FEN]) {
    const { confidence } = classifyStructureFromFen(fen);
    assert.ok(confidence >= 0 && confidence <= 1, `${fen} gave ${String(confidence)}`);
  }
});
