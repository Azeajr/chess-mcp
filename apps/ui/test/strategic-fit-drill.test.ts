import assert from "node:assert/strict";
import test from "node:test";

import { drillOrientation, sanForDrillMove } from "../src/components/strategic-fit/DrillBoard.tsx";

/** Confirmed legal by this repo's MCP server (`validate_fen`) rather than written by hand. */
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4_FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const PROMOTION_FEN = "8/P6k/8/8/8/8/6K1/8 w - - 0 1";
const MALFORMED_FEN = "not a fen";

/**
 * The board is oriented to whoever is on move in the drilled position, so the move being asked for
 * is always played up the board.
 */
test("drillOrientation follows the side to move in the drill position", () => {
  assert.equal(drillOrientation(START_FEN), "white");
  assert.equal(drillOrientation(AFTER_E4_FEN), "black");
  assert.equal(drillOrientation(PROMOTION_FEN), "white");
});

test("drillOrientation defaults to white rather than throwing on an unusable FEN", () => {
  assert.equal(drillOrientation(MALFORMED_FEN), "white");
  assert.equal(drillOrientation(""), "white");
});

test("sanForDrillMove converts a legal board move to the SAN a drill is compared against", () => {
  assert.equal(sanForDrillMove(START_FEN, "e2", "e4"), "e4");
  assert.equal(sanForDrillMove(START_FEN, "g1", "f3"), "Nf3");
  assert.equal(sanForDrillMove(AFTER_E4_FEN, "e7", "e5"), "e5");
});

/**
 * An illegal move must read as null, not as some other SAN: the drill compares this result against
 * `expected_san`, and a wrong-but-parsed move would be scored as a miss rather than as no move.
 */
test("sanForDrillMove returns null for a move that is not legal in the position", () => {
  assert.equal(sanForDrillMove(START_FEN, "e2", "e5"), null, "pawn three squares");
  assert.equal(sanForDrillMove(START_FEN, "b1", "b5"), null, "knight moving like a rook");
  assert.equal(sanForDrillMove(START_FEN, "a1", "a5"), null, "rook through its own pawn");
  assert.equal(sanForDrillMove(START_FEN, "e7", "e5"), null, "not this side's move");
});

test("sanForDrillMove returns null for squares that are not on the board or an unusable FEN", () => {
  assert.equal(sanForDrillMove(START_FEN, "zz", "e4"), null);
  assert.equal(sanForDrillMove(START_FEN, "e2", "e9"), null);
  assert.equal(sanForDrillMove(MALFORMED_FEN, "e2", "e4"), null);
});

/** There is no promotion picker on the drill surface, so a promoting move auto-queens. */
test("sanForDrillMove auto-queens a promotion", () => {
  assert.equal(sanForDrillMove(PROMOTION_FEN, "a7", "a8"), "a8=Q");
});

/**
 * Recall is a plain equality against the drill's expected SAN, so the conversion has to produce the
 * library's own spelling — including a check marker the player never typed.
 */
test("sanForDrillMove produces the canonical spelling a drill's expected_san uses", () => {
  // After 1. e4 e5 2. Qh5 Nc6, per `validate_line`. The check marker on Qxf7 is part of the
  // canonical SAN and is added by the library whether or not the player would have written it.
  const beforeCheck = "r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3";
  assert.equal(sanForDrillMove(beforeCheck, "h5", "f7"), "Qxf7+");
});

test("a drill is recalled only when the played SAN equals the expected SAN exactly", () => {
  const expected = "Nf3";
  assert.equal(sanForDrillMove(START_FEN, "g1", "f3") === expected, true);
  assert.equal(
    sanForDrillMove(START_FEN, "b1", "c3") === expected,
    false,
    "a different legal move",
  );
  assert.equal(sanForDrillMove(START_FEN, "e2", "e5") === expected, false, "an illegal move");
});
