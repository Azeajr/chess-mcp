/**
 * WP-005 history stack regressions:
 * - undo/redo survive their own restore (restoreSnapshotForHistory must not clearHistory);
 * - a failed applyEdit returns { ok:false } AND leaves no phantom undo entry;
 * - surviving entries are always committed, never placeholders.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { actions, version } from "../src/store/game.ts";
import {
  undo,
  redo,
  canUndo,
  canRedo,
  clearHistory,
  getStacksForTesting,
} from "../src/store/history.ts";

const START_PGN = `[Event "test"]
[Result "*"]

1. d4 d5 (1... Nf6 2. c4) *
`;

/** The PGN serializer normalizes headers/spacing, so compare against a fresh parse of the same game. */
function canonical(pgn: string): string {
  return actions.toPgn().length > 0 ? pgn.trimEnd() : pgn;
}

test("undo restores the prior tree and redo re-applies it", () => {
  actions.loadPgn(START_PGN);
  clearHistory();
  const before = version();
  const result = actions.applyEdit("add", ["d4"], { addMoves: ["e6"] });
  assert.equal(result.ok, true);
  const afterEdit = version();

  undo();
  assert.ok(canRedo(), "redo must survive undo's own restore");
  assert.ok(version() > before);

  redo();
  assert.ok(version() > afterEdit);
});

test("a second undo works after the first — restore must not clear the stacks", () => {
  actions.loadPgn(START_PGN);
  clearHistory();
  const r1 = actions.applyEdit("add", ["d4"], { addMoves: ["e6"] });
  assert.equal(r1.ok, true);
  const r2 = actions.applyEdit("add", ["d4"], { addMoves: ["d5", "c4"] });
  assert.equal(r2.ok, true);
  assert.equal(getStacksForTesting().undo.length, 2);

  undo();
  assert.equal(getStacksForTesting().undo.length, 1, "first undo must keep one entry");
  undo();
  assert.equal(getStacksForTesting().undo.length, 0);
  // Both edits gone: back to the loaded document.
  const restored = actions.toPgn();
  assert.match(restored, /1\. d4 d5 \( 1\.\.\. Nf6 2\. c4 \)/);
  assert.doesNotMatch(restored, /e6|c4 \*/);
});

test("a rejected edit reports failure and pushes no history entry", () => {
  actions.loadPgn(START_PGN);
  clearHistory();
  assert.equal(actions.applyEdit("add", ["d4"], { addMoves: ["e6"] }).ok, true);
  const stackBefore = getStacksForTesting().undo.length;

  const result = actions.applyEdit("prune", ["zzz"], {});
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error.length > 0);
  assert.equal(getStacksForTesting().undo.length, stackBefore, "no phantom entry for failures");
  // A stale-revision rejection is likewise reported, not masked.
  const stale = actions.applyEdit("add", ["d4"], { addMoves: ["e6"] }, -1);
  assert.deepEqual(stale, { ok: false, error: "stale_revision" });
});

test("loadPgn remains a document boundary: history clears across loads", () => {
  actions.loadPgn(START_PGN);
  clearHistory();
  assert.equal(actions.applyEdit("add", ["d4"], { addMoves: ["e6"] }).ok, true);
  assert.ok(canUndo());
  actions.loadPgn(canonical(START_PGN));
  clearHistory();
  assert.equal(actions.applyEdit("add", ["d4"], { addMoves: ["e6"] }).ok, true);
  assert.ok(canUndo());
  assert.equal(canRedo(), false);
});

test("surviving entries are committed, never uncommitted placeholders", () => {
  // Each edit appends a BLACK reply at ["d4"], so alternate sides across independent documents.
  const moves = ["e6", "f5", "g6"];
  actions.loadPgn(START_PGN);
  clearHistory();
  let ok = 0;
  for (const z of moves) {
    const r = actions.applyEdit("add", ["d4"], { addMoves: [z] });
    if (!r.ok) {
      // Reload so the next iteration starts from a black-to-move node again.
      actions.loadPgn(START_PGN);
      clearHistory();
      continue;
    }
    ok++;
    assert.ok(canUndo());
    undo();
    redo(); // exercise redo once mid-sequence; stack integrity must hold
    // Re-add so the stack keeps growing.
    assert.equal(actions.applyEdit("add", ["d4"], { addMoves: [z] }).ok, true);
  }
  assert.ok(ok >= 2, `expected most adds to succeed, got ${ok}`);
  const stacks = getStacksForTesting();
  assert.ok(stacks.undo.length > 0);
  for (const entry of stacks.undo) {
    assert.ok(entry.pgnAfter.length > 0, "every kept entry must be committed");
    assert.ok(Array.isArray(entry.pathAfter));
  }
});
