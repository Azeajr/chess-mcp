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

// board-cursor.ts's own createEffect (which normally re-derives the cursor after a position
// change it doesn't directly control) never runs here: `tsx --test` resolves `solid-js` via
// Node's own export condition to its server/SSR build, where createEffect callbacks are no-ops —
// confirmed empirically, not assumed. resetCursorForTesting() is the synchronous seam that stands
// in for it between fixtures; store/board-cursor.ts itself resets synchronously at its own
// position-changing call site (confirmMove) for exactly this reason.
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
  // loadPgn leaves path at the tree root ([]) even when the PGN carries moves — actions.play both
  // appends and navigates, which is what actually puts a lastMove() in place.
  actions.play("e2", "e4");
  assert.equal(cursorKey(), "e4");
});

test("moveCursor clamps at the board edge and is orientation-aware (AC-2)", () => {
  reset("*", { color: "white" });
  // e1 -> h1 by repeated ArrowRight, then clamps.
  for (let i = 0; i < 10; i++) moveCursor("right");
  assert.equal(cursorKey(), "h1");
  for (let i = 0; i < 10; i++) moveCursor("left");
  assert.equal(cursorKey(), "a1");
  for (let i = 0; i < 10; i++) moveCursor("up");
  assert.equal(cursorKey(), "a8");

  // Flipped board: ArrowUp/ArrowRight are screen-relative, not rank/file-relative — from e8 (the
  // black home square) ArrowUp must move toward rank 1 (up the flipped screen), not rank 8.
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
  // Cursor is on e1 by default (no piece there); move to e2 to pick up the pawn.
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
  // e1 (the king's home square, blocked in) has no legal moves in the start position.
  assert.equal(cursorKey(), "e1");
  selectPiece();
  assert.equal(selectedSquare(), null);
  assert.equal(announcementLogForTesting().length, 0);
});

test("confirming a legal destination plays the move exactly like a drag (AC-4)", () => {
  reset("*");
  moveCursor("up"); // e1 -> e2
  selectPiece();
  moveCursor("up"); // e2 -> e3
  moveCursor("up"); // e3 -> e4
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
  moveCursor("up"); // e2
  selectPiece();
  const fenBefore = fen();
  // e5 is on the highlighted-dest square's file but two ranks further — not a legal destination
  // for the e2 pawn (only e3/e4 are).
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
  moveCursor("up"); // e2
  selectPiece();
  resetAnnouncementsForTesting();
  confirmMove();
  assert.equal(selectedSquare(), null);
  assert.equal(highlightedDests().size, 0);
  assert.equal(announcementLogForTesting().length, 0);
});

test("a keyboard move onto the last rank opens the promotion dialog instead of auto-queening (AC-5)", () => {
  // A short, fully legal line that leaves a white pawn on h7 able to capture the still-home g8
  // knight for a promotion — reached by real replayable SAN moves, not a FEN-setup header (the
  // UI's GameTree rejects those). loadPgn parses the whole line but leaves path at the tree root,
  // so navigate to its end explicitly (one child per ply throughout this line).
  reset("1. e4 f5 2. exf5 g6 3. fxg6 d5 4. gxh7 Nc6 *");
  actions.goto([0, 0, 0, 0, 0, 0, 0, 0]);
  resetCursorForTesting();
  assert.equal(fen().split(" ")[1], "w");
  assert.equal(pendingPromo(), null);
  assert.equal(cursorKey(), "c6", "default cursor follows the last move's destination");

  // c6 -> h7: five files right, one rank up (order is irrelevant, each axis is independent).
  for (let i = 0; i < 5; i++) moveCursor("right");
  moveCursor("up");
  assert.equal(cursorKey(), "h7");

  selectPiece();
  assert.notEqual(selectedSquare(), null);
  assert.ok(highlightedDests().has("g8"), "g8 (capturing the knight) must be a legal destination");

  moveCursor("left"); // h7 -> g7
  moveCursor("up"); // g7 -> g8
  assert.equal(cursorKey(), "g8");

  const fenBefore = fen();
  confirmMove();
  assert.equal(fen(), fenBefore, "the move must not play until the promotion piece is chosen");
  assert.deepEqual(pendingPromo(), { orig: "h7", dest: "g8", color: "white" });
  assert.equal(selectedSquare(), null, "selection clears once the dialog takes over");

  actions.play("h7", "g8", "queen");
  setPendingPromo(null);
  // b8 is empty (the knight that started there played ...Nc6 earlier); g8 now holds White's queen.
  assert.ok(
    fen().split(" ")[0]!.startsWith("r1bqkbQr"),
    `expected a white queen on g8, got ${fen()}`,
  );
});

test("Escape clears the selection without changing the position or moving the cursor (AC-6)", () => {
  reset("*");
  moveCursor("up"); // e2
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
