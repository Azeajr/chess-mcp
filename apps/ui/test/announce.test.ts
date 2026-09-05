import assert from "node:assert/strict";
import test from "node:test";

import {
  assertiveMessage,
  announce,
  politeMessage,
  resetAnnouncementsForTesting,
} from "../src/store/announce.ts";

test.beforeEach(() => resetAnnouncementsForTesting());

test("announcements default to the polite region", () => {
  const announcement = announce("Saved game.pgn.");
  assert.ok(announcement);
  assert.equal(politeMessage()?.message, "Saved game.pgn.");
  assert.equal(assertiveMessage(), null);
});

test("errors route to the assertive region", () => {
  announce("The chess engine went offline.", { assertive: true });
  assert.equal(assertiveMessage()?.message, "The chess engine went offline.");
  assert.equal(politeMessage(), null);
});

test("two identical messages within the rate-limit window produce one announcement", () => {
  const first = announce("Prescribed-move audit started.");
  const second = announce("Prescribed-move audit started.");
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(politeMessage()?.id, first.id);
});

test("a different message always gets through, even immediately after one", () => {
  assert.ok(announce("Prescribed-move audit started."));
  assert.ok(announce("Prescribed-move audit completed with 3 result(s)."));
  assert.equal(politeMessage()?.message, "Prescribed-move audit completed with 3 result(s).");
});

test("the same message again after a state reset announces once more", async () => {
  assert.ok(announce("Saved game.pgn."));
  await new Promise((resolve) => setTimeout(resolve, 510));
  const second = announce("Saved game.pgn.");
  assert.ok(second, "a repeat after the window must announce (fresh event, not a duplicate)");
});

test("empty or whitespace-only messages are ignored", () => {
  assert.equal(announce(""), null);
  assert.equal(announce("   "), null);
  assert.equal(politeMessage(), null);
});
