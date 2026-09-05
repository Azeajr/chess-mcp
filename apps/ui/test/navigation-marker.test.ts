import assert from "node:assert/strict";
import test from "node:test";
import { actions, currentPath } from "../src/store/game.ts";
import { lastNavigationSource, setLastNavigationSource } from "../src/store/ui.ts";

const CARD = { kind: "chat", id: "suggestion-1" } as const;

function gotoFromCard(path: readonly number[]) {
  actions.goto([...path]);
  setLastNavigationSource(CARD);
}

function reset(pgn = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *") {
  actions.loadPgn(pgn);
  setLastNavigationSource(null);
}

test("F14 a card's own navigation keeps its marker", () => {
  reset();
  gotoFromCard([0, 0]);
  assert.deepEqual(lastNavigationSource(), CARD);
  assert.deepEqual(currentPath(), [0, 0]);
});

test("F14 move-tree navigation to another line clears the marker", () => {
  reset();
  gotoFromCard([0, 0]);
  actions.goto([0, 0, 0]);
  assert.equal(lastNavigationSource(), null, "a plain goto is not the card's navigation");
});

test("F14 navigating back to the same path still clears the marker", () => {
  reset();
  gotoFromCard([0, 0]);
  actions.goto([0, 0]);
  assert.equal(lastNavigationSource(), null);
});

test("F14 keyboard navigation clears the marker", () => {
  reset();

  gotoFromCard([0, 0, 0]);
  actions.back();
  assert.equal(lastNavigationSource(), null, "back() clears");

  gotoFromCard([0, 0]);
  actions.forward();
  assert.equal(lastNavigationSource(), null, "forward() clears");
});

test("F14 playing a move clears the marker", () => {
  reset();
  gotoFromCard([0, 0]);
  actions.play("g1", "f3");
  assert.equal(lastNavigationSource(), null);
});

test("F14 loading a different document clears the marker", () => {
  reset();
  gotoFromCard([0, 0]);
  actions.loadPgn("1. d4 d5 *", "other.pgn");
  assert.equal(lastNavigationSource(), null);
});

test("F14 undo clears the marker", () => {
  reset("1. e4 e5 2. Nf3 *");
  gotoFromCard([0, 0, 0]);
  actions.undo();
  assert.equal(lastNavigationSource(), null);
});
