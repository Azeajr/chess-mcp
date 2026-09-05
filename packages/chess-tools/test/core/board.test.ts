import assert from "node:assert/strict";
import test from "node:test";

import { pieceAt, isCheck } from "../../src/index.ts";
import { FOOLS_MATE_FEN, KINGLESS_FEN, MALFORMED_FEN, START_FEN } from "./fixtures.ts";

test("pieceAt reads role and colour off both sides of the start position", () => {
  assert.deepEqual(pieceAt(START_FEN, "e1"), { role: "king", color: "white" });
  assert.deepEqual(pieceAt(START_FEN, "d8"), { role: "queen", color: "black" });
  assert.deepEqual(pieceAt(START_FEN, "b1"), { role: "knight", color: "white" });
  assert.deepEqual(pieceAt(START_FEN, "h7"), { role: "pawn", color: "black" });
});

test("pieceAt returns undefined for an empty square", () => {
  assert.equal(pieceAt(START_FEN, "e4"), undefined);
});

test("pieceAt returns undefined rather than throwing on unusable input", () => {
  assert.equal(pieceAt(MALFORMED_FEN, "e1"), undefined, "malformed FEN");
  assert.equal(pieceAt(START_FEN, "e9"), undefined, "square off the board");
  assert.equal(pieceAt(START_FEN, "zz"), undefined, "not a square");
  assert.equal(pieceAt(START_FEN, ""), undefined, "empty square name");
});

test("isCheck is true for the side to move in Fool's Mate and false in the start position", () => {
  assert.equal(isCheck(FOOLS_MATE_FEN), true);
  assert.equal(isCheck(START_FEN), false);
});

test("isCheck reports false for unparseable and for illegal positions", () => {
  assert.equal(isCheck(MALFORMED_FEN), false, "unparseable");
  assert.equal(isCheck(KINGLESS_FEN), false, "parses, but is not a legal position");
});
