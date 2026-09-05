import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSelection,
  confirmMove,
  cursor,
  cursorKey,
  highlightedDests,
  moveCursor,
  resetCursorForTesting,
  selectedSquare,
  selectPiece,
  squareKey,
} from "../src/store/board-cursor.ts";
import { actions, color, currentPath, dirty, fen } from "../src/store/game.ts";
import { pendingPromo, setPendingPromo } from "../src/store/promotion.ts";
import { announcementLogForTesting, resetAnnouncementsForTesting } from "../src/store/announce.ts";

function reset(pgn = "*", options: { color?: "white" | "black" } = {}) {
  actions.loadPgn(pgn);
  actions.setColor(options.color ?? "white");
  setPendingPromo(null);
  resetAnnouncementsForTesting();
  resetCursorForTesting();
}

test("cursor defaults to e1/e8 at the start position, by orientation", () => {
  reset("*", { color: "white" });
  assert.equal(cursorKey(), "e1");
  reset("*", { color: "black" });
  assert.equal(cursorKey(), "e8");
});

test("cursor defaults to the last move's destination once one exists", () => {
  reset("*");
  actions.play("e2", "e4");
  assert.equal(cursorKey(), "e4");
});

test("moveCursor clamps at the board edge and is orientation-aware (AC-2)", () => {
  reset("*", { color: "white" });
  for (let i = 0; i < 10; i++) moveCursor("right");
  assert.equal(cursorKey(), "h1");
  for (let i = 0; i < 10; i++) moveCursor("left");
  assert.equal(cursorKey(), "a1");
  for (let i = 0; i < 10; i++) moveCursor("up");
  assert.equal(cursorKey(), "a8");

  reset("*", { color: "black" });
  assert.equal(color(), "black");
  assert.equal(cursorKey(), "e8");
  moveCursor("up");
  assert.equal(cursorKey(), "e7", "ArrowUp on a flipped board moves toward rank 1 on screen");
  moveCursor("left");
  assert.equal(cursorKey(), "f7", "ArrowLeft on a flipped board moves toward the h-file on screen");
});

test("selectPiece announces the legal destination count and highlights only those squares (AC-3)", () => {
  reset("*");
  moveCursor("up");
  assert.equal(cursorKey(), "e2");
  selectPiece();
  assert.deepEqual(selectedSquare(), { file: 4, rank: 1 });
  assert.deepEqual([...highlightedDests()].sort(), ["e3", "e4"]);
  const log = announcementLogForTesting();
  assert.equal(log.length, 1);
  assert.match(log[0]!.message, /^2 legal destinations\.$/u);
});

test("selectPiece on a square with no legal moves is a silent no-op", () => {
  reset("*");
  assert.equal(cursorKey(), "e1");
  selectPiece();
  assert.equal(selectedSquare(), null);
  assert.equal(announcementLogForTesting().length, 0);
});

test("confirming a legal destination plays the move exactly like a drag (AC-4)", () => {
  reset("*");
  moveCursor("up");
  selectPiece();
  moveCursor("up");
  moveCursor("up");
  assert.equal(cursorKey(), "e4");
  const dirtyBefore = dirty();
  assert.equal(dirtyBefore, false);
  confirmMove();
  assert.equal(fen().split(" ")[0], "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR");
  assert.equal(dirty(), true);
  assert.deepEqual(currentPath(), [0]);
  assert.equal(selectedSquare(), null);
  assert.equal(highlightedDests().size, 0);
});

test("confirming an illegal destination refuses with an announcement and no state change (AC-3)", () => {
  reset("*");
  moveCursor("up");
  selectPiece();
  const fenBefore = fen();
  moveCursor("up");
  moveCursor("up");
  moveCursor("up");
  assert.equal(cursorKey(), "e5");
  resetAnnouncementsForTesting();
  confirmMove();
  assert.equal(fen(), fenBefore, "an illegal target must not change the position");
  assert.deepEqual(selectedSquare(), { file: 4, rank: 1 }, "selection is preserved, not cleared");
  const log = announcementLogForTesting();
  assert.equal(log.length, 1);
  assert.match(log[0]!.message, /e5 is not a legal destination\./u);
});

test("confirming the same square again cancels the pick without an announcement", () => {
  reset("*");
  moveCursor("up");
  selectPiece();
  resetAnnouncementsForTesting();
  confirmMove();
  assert.equal(selectedSquare(), null);
  assert.equal(highlightedDests().size, 0);
  assert.equal(announcementLogForTesting().length, 0);
});

test("a keyboard move onto the last rank opens the promotion dialog instead of auto-queening (AC-5)", () => {
  reset("1. e4 f5 2. exf5 g6 3. fxg6 d5 4. gxh7 Nc6 *");
  actions.goto([0, 0, 0, 0, 0, 0, 0, 0]);
  resetCursorForTesting();
  assert.equal(fen().split(" ")[1], "w");
  assert.equal(pendingPromo(), null);
  assert.equal(cursorKey(), "c6", "default cursor follows the last move's destination");

  for (let i = 0; i < 5; i++) moveCursor("right");
  moveCursor("up");
  assert.equal(cursorKey(), "h7");

  selectPiece();
  assert.notEqual(selectedSquare(), null);
  assert.ok(highlightedDests().has("g8"), "g8 (capturing the knight) must be a legal destination");

  moveCursor("left");
  moveCursor("up");
  assert.equal(cursorKey(), "g8");

  const fenBefore = fen();
  confirmMove();
  assert.equal(fen(), fenBefore, "the move must not play until the promotion piece is chosen");
  assert.deepEqual(pendingPromo(), { orig: "h7", dest: "g8", color: "white" });
  assert.equal(selectedSquare(), null, "selection clears once the dialog takes over");

  actions.play("h7", "g8", "queen");
  setPendingPromo(null);
  assert.ok(
    fen().split(" ")[0]!.startsWith("r1bqkbQr"),
    `expected a white queen on g8, got ${fen()}`,
  );
});

test("Escape clears the selection without changing the position or moving the cursor (AC-6)", () => {
  reset("*");
  moveCursor("up");
  selectPiece();
  assert.notEqual(selectedSquare(), null);
  const fenBefore = fen();
  const cursorBefore = cursor();
  clearSelection();
  assert.equal(selectedSquare(), null);
  assert.equal(highlightedDests().size, 0);
  assert.equal(fen(), fenBefore);
  assert.deepEqual(cursor(), cursorBefore);
});

test("squareKey/cursorKey round-trip file/rank consistently", () => {
  reset("*");
  assert.equal(squareKey({ file: 0, rank: 0 }), "a1");
  assert.equal(squareKey({ file: 7, rank: 7 }), "h8");
});
