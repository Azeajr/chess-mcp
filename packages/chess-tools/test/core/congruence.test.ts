import assert from "node:assert/strict";
import test from "node:test";

import { positionKey, classifyUciMove, weightFor, validateFen } from "../../src/index.ts";
import { AFTER_E4_FEN, START_FEN } from "./fixtures.ts";

test("positionKey keeps placement, turn, castling and en passant but drops both clocks", () => {
  assert.equal(positionKey(START_FEN), "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");
});

test("positionKey makes two routes to the same position compare equal despite different clocks", () => {
  const early = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const later = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 7 24";
  assert.equal(positionKey(early), positionKey(later));
});

test("positionKey treats a stale en-passant target as a different position", () => {
  const normalised = AFTER_E4_FEN;
  const withStaleTarget = AFTER_E4_FEN.replace(" - ", " e3 ");

  assert.equal(validateFen(withStaleTarget).fen, normalised, "the library normalises e3 away");
  assert.notEqual(
    positionKey(withStaleTarget),
    positionKey(normalised),
    "but positionKey compares the raw field, so the caller must normalise first",
  );
});

test("classifyUciMove reports in-book when the move is a stored continuation here", () => {
  const result = classifyUciMove(START_FEN, "e2e4", ["e4", "d4"], new Set());
  assert.equal(result.san, "e4");
  assert.equal(result.fit, "in-book");
  assert.equal(result.key, positionKey(AFTER_E4_FEN));
});

test("classifyUciMove reports adjacent when the move transposes into the repertoire", () => {
  const result = classifyUciMove(START_FEN, "e2e4", ["d4"], new Set([positionKey(AFTER_E4_FEN)]));
  assert.equal(result.fit, "adjacent");
});

test("classifyUciMove reports out when the move is neither stored nor a transposition", () => {
  const result = classifyUciMove(START_FEN, "e2e4", ["d4"], new Set(["some other key"]));
  assert.equal(result.fit, "out");
});

test("classifyUciMove prefers in-book over adjacent when a move is both", () => {
  const result = classifyUciMove(START_FEN, "e2e4", ["e4"], new Set([positionKey(AFTER_E4_FEN)]));
  assert.equal(result.fit, "in-book");
});

test("classifyUciMove rejects a UCI string it cannot parse", () => {
  assert.throws(() => classifyUciMove(START_FEN, "not-a-move", [], new Set()), /bad uci/u);
});

test("weightFor reads the score from White's side for White", () => {
  assert.equal(weightFor(120, null, "white"), "thick");
  assert.equal(weightFor(0, null, "white"), "medium");
  assert.equal(weightFor(-200, null, "white"), "thin");
});

test("weightFor flips the score for Black", () => {
  assert.equal(weightFor(-120, null, "black"), "thick");
  assert.equal(weightFor(120, null, "black"), "thin");
  assert.equal(weightFor(0, null, "black"), "medium");
});

test("weightFor puts its thresholds exactly at +50 and -30", () => {
  assert.equal(weightFor(50, null, "white"), "thick", "+50 is thick");
  assert.equal(weightFor(49, null, "white"), "medium", "just below is medium");
  assert.equal(weightFor(-30, null, "white"), "medium", "-30 is still medium");
  assert.equal(weightFor(-31, null, "white"), "thin", "just below is thin");
});

test("weightFor treats a mate score as decisive in whichever direction it points", () => {
  assert.equal(weightFor(null, 3, "white"), "thick");
  assert.equal(weightFor(null, -3, "white"), "thin");
  assert.equal(weightFor(null, 3, "black"), "thin");
  assert.equal(weightFor(null, -3, "black"), "thick");
});

test("weightFor lets a mate score override the centipawn score entirely", () => {
  assert.equal(weightFor(-900, 2, "white"), "thick", "mate wins over a losing cp");
});

test("weightFor treats a missing centipawn score as level", () => {
  assert.equal(weightFor(null, null, "white"), "medium");
  assert.equal(weightFor(null, null, "black"), "medium");
});
