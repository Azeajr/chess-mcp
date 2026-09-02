import assert from "node:assert/strict";
import test from "node:test";

import { assertDefined } from "../../src/assert.ts";

test("assertDefined returns the value unchanged when it is present", () => {
  const value = { role: "pawn" };
  assert.equal(assertDefined(value), value);
  assert.equal(assertDefined("e4"), "e4");
});

test("assertDefined rejects null and undefined with a named error", () => {
  assert.throws(() => assertDefined(null), /assertDefined: expected value to be defined/u);
  assert.throws(() => assertDefined(undefined), /assertDefined: expected value to be defined/u);
});

/**
 * The guard is null/undefined only. Falsy-but-present values must pass through: an index of 0 and
 * an empty SAN list are both legitimate results from the lookups this helper wraps, and rejecting
 * them would turn a valid first element into a crash.
 */
test("assertDefined passes falsy values through rather than treating them as missing", () => {
  assert.equal(assertDefined(0), 0);
  assert.equal(assertDefined(""), "");
  assert.equal(assertDefined(false), false);
  assert.equal(assertDefined(Number.NaN as number | undefined), Number.NaN);
});
