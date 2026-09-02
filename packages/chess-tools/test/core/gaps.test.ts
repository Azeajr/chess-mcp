import assert from "node:assert/strict";
import test from "node:test";

import { gapSeverity, SEVERITY_RANK, moveSan } from "../../src/index.ts";
import { MALFORMED_FEN, START_FEN } from "./fixtures.ts";

test("SEVERITY_RANK orders the three severities so they can be compared numerically", () => {
  assert.ok(SEVERITY_RANK.low < SEVERITY_RANK.medium);
  assert.ok(SEVERITY_RANK.medium < SEVERITY_RANK.high);
});

/**
 * First dimension: how much the uncovered move gives up against the opponent's best reply. All
 * scores are from the opponent's point of view, and `bestMoverCp` is held well above the edge caps
 * here so only the loss term is being measured.
 */
test("gapSeverity grades by how close the uncovered move is to the opponent's best", () => {
  assert.equal(gapSeverity(200, 180), "high", "loses 20 — nearly as good as best");
  assert.equal(gapSeverity(200, 140), "medium", "loses 60");
  assert.equal(gapSeverity(200, 60), "low", "loses 140 — the opponent would not choose it");
});

test("gapSeverity puts its loss thresholds exactly at 30 and 80", () => {
  assert.equal(gapSeverity(200, 170), "high", "loss of exactly 30 is still high");
  assert.equal(gapSeverity(200, 169), "medium", "loss of 31 drops to medium");
  assert.equal(gapSeverity(200, 120), "medium", "loss of exactly 80 is still medium");
  assert.equal(gapSeverity(200, 119), "low", "loss of 81 drops to low");
});

/**
 * Second dimension, the cap: a move the opponent barely benefits from is not a high-severity gap
 * however close to best it is. Below +25 for the opponent everything collapses to low.
 */
test("gapSeverity caps everything at low when the opponent gains almost nothing", () => {
  assert.equal(gapSeverity(24, 24), "low", "zero loss, but the opponent stays level");
  assert.equal(gapSeverity(30, 24), "low");
  assert.equal(gapSeverity(24, 0), "low");
});

test("gapSeverity demotes high to medium in the middle band, and leaves medium alone", () => {
  assert.equal(gapSeverity(50, 50), "medium", "zero loss would be high, but +50 caps it to medium");
  assert.equal(gapSeverity(59, 30), "medium", "loss of 29 would be high; +59 caps it to medium");
  assert.equal(gapSeverity(60, 60), "high", "at +60 the cap no longer applies");
});

test("gapSeverity puts its edge thresholds exactly at 25 and 60", () => {
  assert.equal(gapSeverity(25, 25), "medium", "+25 escapes the low cap into the middle band");
  assert.equal(gapSeverity(24, 24), "low", "+24 does not");
  assert.equal(gapSeverity(60, 60), "high", "+60 escapes the middle band");
  assert.equal(gapSeverity(59, 59), "medium", "+59 does not");
});

/** A move better than the engine's best still scores as no loss rather than a negative one. */
test("gapSeverity treats a move that beats best as maximally close to best", () => {
  assert.equal(gapSeverity(100, 150), "high");
});

test("moveSan converts a UCI move to SAN at the given position", () => {
  assert.equal(moveSan(START_FEN, "e2e4"), "e4");
  assert.equal(moveSan(START_FEN, "g1f3"), "Nf3");
});

test("moveSan rejects a UCI string it cannot parse", () => {
  assert.throws(() => moveSan(START_FEN, "not-a-move"), /bad uci/u);
});

test("moveSan throws on an unusable FEN rather than returning a placeholder", () => {
  assert.throws(() => moveSan(MALFORMED_FEN, "e2e4"));
});
