import assert from "node:assert/strict";
import test from "node:test";

import {
  validateLine,
  validateFen,
  validatePgn,
  isPromotion,
  legalMoves,
} from "../../src/index.ts";
import {
  FOOLS_MATE_FEN,
  KINGLESS_FEN,
  MALFORMED_FEN,
  PROMOTION_FEN,
  PROMOTION_LEGAL_MOVES,
  START_FEN,
  START_LEGAL_MOVES,
} from "./fixtures.ts";

test("validateLine accepts a legal line and reports canonical SANs, first UCI, and final FEN", () => {
  const result = validateLine(START_FEN, ["e4", "e5", "Nf3"]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.canonical, ["e4", "e5", "Nf3"]);
  assert.equal(result.firstUci, "e2e4");
  assert.equal(result.badIndex, undefined);
  assert.equal(typeof result.finalFen, "string");
  // The final FEN must be the position after the whole line, so it is Black to move again.
  assert.match(result.finalFen ?? "", /\sb\s/u);
});

test("validateLine stops at the first illegal move and reports where", () => {
  const result = validateLine(START_FEN, ["e4", "e5", "Qxf7"]);
  assert.equal(result.ok, false);
  assert.equal(result.badIndex, 2);
  // Everything before the bad move is still canonicalised, so a caller can show how far it got.
  assert.deepEqual(result.canonical, ["e4", "e5"]);
  assert.equal(result.finalFen, undefined);
});

test("validateLine rejects the very first move without inventing a partial line", () => {
  const result = validateLine(START_FEN, ["Ke2"]);
  assert.equal(result.ok, false);
  assert.equal(result.badIndex, 0);
  assert.deepEqual(result.canonical, []);
  assert.equal(result.firstUci, undefined);
});

test("validateLine canonicalises the SAN it was given rather than echoing it", () => {
  // A check marker the caller omitted is added back, so `canonical` is the library's spelling.
  const result = validateLine(START_FEN, ["e4", "e5", "Qh5", "Nc6", "Qxf7"]);
  assert.equal(result.ok, true);
  assert.equal(result.canonical.at(-1), "Qxf7+");
});

/**
 * Castling must be spelled with the letter O. The digit form `0-0` is widespread in PGN written by
 * other tools, and an LLM proposing a line will produce it sooner or later, but `parseSan` rejects
 * it — the line fails at the castling index rather than being normalised. Recorded as behaviour so
 * that a future decision to accept `0-0` is a deliberate change with a test to flip, not a
 * surprise. See ROADMAP.md.
 */
test("validateLine accepts O-O but rejects the digit spelling 0-0", () => {
  const opening = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"];

  const letters = validateLine(START_FEN, [...opening, "O-O"]);
  assert.equal(letters.ok, true);
  assert.equal(letters.canonical.at(-1), "O-O");

  const digits = validateLine(START_FEN, [...opening, "0-0"]);
  assert.equal(digits.ok, false);
  assert.equal(digits.badIndex, 6);

  const lowercase = validateLine(START_FEN, [...opening, "o-o"]);
  assert.equal(lowercase.ok, false);
  assert.equal(lowercase.badIndex, 6);
});

/**
 * Regression guard. `firstUci` is built with `makeUci`, not a from+to concatenation, because the
 * latter silently drops the promotion piece and the board arrow then points at the wrong move.
 */
test("validateLine keeps the promotion suffix on firstUci", () => {
  const result = validateLine(PROMOTION_FEN, ["a8=Q"]);
  assert.equal(result.ok, true);
  assert.equal(result.firstUci, "a7a8q");
});

test("validateLine accepts an empty line as trivially valid", () => {
  const result = validateLine(START_FEN, []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.canonical, []);
  assert.equal(result.firstUci, undefined);
  assert.equal(result.finalFen, makeNormalisedStart());
});

/**
 * Documented sharp edge: `validateLine` unwraps the parse result, so an unusable FEN throws
 * instead of returning `{ ok: false }`. Callers vetting untrusted input must run `validateFen`
 * first — this test exists so that contract cannot be changed without noticing.
 */
test("validateLine throws on an unusable FEN instead of returning a failed check", () => {
  assert.throws(() => validateLine(MALFORMED_FEN, ["e4"]));
  assert.throws(() => validateLine(KINGLESS_FEN, ["Qe4"]));
});

test("validateFen normalises a legal FEN and reports why an illegal one failed", () => {
  const ok = validateFen(START_FEN);
  assert.equal(ok.valid, true);
  assert.equal(ok.fen, START_FEN);
  assert.equal(ok.reason, undefined);

  const malformed = validateFen(MALFORMED_FEN);
  assert.equal(malformed.valid, false);
  assert.equal(malformed.fen, undefined);
  assert.equal(typeof malformed.reason, "string");

  // Parses as a board but is not a reachable position; it must fail at the position stage.
  const kingless = validateFen(KINGLESS_FEN);
  assert.equal(kingless.valid, false);
  assert.equal(typeof kingless.reason, "string");
});

test("validatePgn counts games and explains an unusable PGN", () => {
  const single = validatePgn('[Event "T"]\n\n1. e4 e5 2. Nf3 *\n');
  assert.equal(single.valid, true);
  assert.equal(single.games, 1);

  const pair = validatePgn('[Event "A"]\n\n1. e4 *\n\n[Event "B"]\n\n1. d4 *\n');
  assert.equal(pair.valid, true);
  assert.equal(pair.games, 2);

  const empty = validatePgn("");
  assert.equal(empty.valid, false);
  assert.equal(empty.reason, "no game found");
});

test("isPromotion is true only for a pawn arriving on the last rank", () => {
  assert.equal(isPromotion(PROMOTION_FEN, "a7", "a8"), true);
  assert.equal(isPromotion(PROMOTION_FEN, "g2", "g3"), false, "king move, not a promotion");
  assert.equal(isPromotion(START_FEN, "e2", "e4"), false, "pawn, but not to the last rank");
});

test("isPromotion returns false for squares that are not on the board", () => {
  assert.equal(isPromotion(PROMOTION_FEN, "zz", "a8"), false);
  assert.equal(isPromotion(PROMOTION_FEN, "a7", "a9"), false);
});

test("legalMoves returns every legal reply in the start position", () => {
  assert.deepEqual([...legalMoves(START_FEN)].sort(), [...START_LEGAL_MOVES].sort());
});

/**
 * The doc contract is that a pawn reaching the last rank is listed once, as a queen promotion —
 * not as four separate under-promotion entries.
 */
test("legalMoves lists a promotion once, as a queen promotion", () => {
  const moves = legalMoves(PROMOTION_FEN);
  assert.deepEqual([...moves].sort(), [...PROMOTION_LEGAL_MOVES].sort());
  assert.equal(
    moves.filter((san) => san.startsWith("a8")).length,
    1,
    "under-promotions must not be enumerated",
  );
});

test("legalMoves returns nothing in a checkmated position", () => {
  assert.deepEqual(legalMoves(FOOLS_MATE_FEN), []);
});

test("legalMoves throws on an unusable FEN, matching validateLine", () => {
  assert.throws(() => legalMoves(MALFORMED_FEN));
});

/** The start position is already canonical, so validateFen echoes it back unchanged. */
function makeNormalisedStart(): string {
  const normalised = validateFen(START_FEN).fen;
  assert.ok(normalised);
  return normalised;
}
