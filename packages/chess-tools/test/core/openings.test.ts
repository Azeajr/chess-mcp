import assert from "node:assert/strict";
import test from "node:test";

import {
  parseOpeningsTsv,
  identifyAt,
  identifyDeepest,
  identifyDeepestFromMoves,
  positionKey,
  type OpeningTable,
} from "../../src/index.ts";
import { AFTER_E4_E5_FEN, AFTER_E4_FEN, START_FEN } from "./fixtures.ts";

function openingTable(): OpeningTable {
  return parseOpeningsTsv(
    [
      `${positionKey(AFTER_E4_FEN)}\tB00\tKing's Pawn`,
      `${positionKey(AFTER_E4_E5_FEN)}\tC20\tKing's Pawn Game`,
    ].join("\n"),
  );
}

test("parseOpeningsTsv reads key, ECO and name off each line", () => {
  const table = openingTable();
  assert.equal(table.size, 2);
  assert.deepEqual(table.get(positionKey(AFTER_E4_FEN)), { eco: "B00", name: "King's Pawn" });
});

test("parseOpeningsTsv skips blank and incomplete lines instead of storing partial entries", () => {
  const table = parseOpeningsTsv(
    ["", "key-only", "key\tB00", "\t\t", "good\tA00\tNamed", ""].join("\n"),
  );
  assert.equal(table.size, 1);
  assert.deepEqual(table.get("good"), { eco: "A00", name: "Named" });
});

test("parseOpeningsTsv returns an empty table for empty text", () => {
  assert.equal(parseOpeningsTsv("").size, 0);
});

test("identifyAt names the position it is given and nothing else", () => {
  const table = openingTable();
  assert.deepEqual(identifyAt(table, AFTER_E4_FEN), { eco: "B00", name: "King's Pawn" });
  assert.equal(identifyAt(table, START_FEN), null, "the start position is not in this table");
});

test("identifyDeepest returns the deepest name the mainline reaches, with its ply", () => {
  const table = openingTable();
  const hit = identifyDeepest(table, '[Event "T"]\n\n1. e4 e5 2. Nf3 *\n');
  assert.deepEqual(hit, { eco: "C20", name: "King's Pawn Game", ply: 2 });
});

test("identifyDeepest stops at the last known position rather than the end of the game", () => {
  const table = parseOpeningsTsv(`${positionKey(AFTER_E4_FEN)}\tB00\tKing's Pawn`);
  const hit = identifyDeepest(table, '[Event "T"]\n\n1. e4 e5 2. Nf3 Nc6 *\n');
  assert.deepEqual(hit, { eco: "B00", name: "King's Pawn", ply: 1 });
});

test("identifyDeepest returns null when nothing on the mainline is named", () => {
  const table = openingTable();
  assert.equal(identifyDeepest(table, '[Event "T"]\n\n1. d4 d5 *\n'), null);
});

test("identifyDeepest returns null for a PGN with no game in it", () => {
  assert.equal(identifyDeepest(openingTable(), ""), null);
});

test("identifyDeepest follows the mainline and ignores variations", () => {
  const table = parseOpeningsTsv(`${positionKey(AFTER_E4_FEN)}\tB00\tKing's Pawn`);
  assert.equal(identifyDeepest(table, '[Event "T"]\n\n1. d4 (1. e4) 1... d5 *\n'), null);
});

test("identifyDeepestFromMoves gives the same answer as identifyDeepest for the same line", () => {
  const table = openingTable();
  assert.deepEqual(identifyDeepestFromMoves(table, ["e4", "e5", "Nf3"]), {
    eco: "C20",
    name: "King's Pawn Game",
    ply: 2,
  });
});

test("identifyDeepestFromMoves stops at the first unplayable SAN and keeps what it found", () => {
  const table = openingTable();
  assert.deepEqual(identifyDeepestFromMoves(table, ["e4", "e5", "Qxq9"]), {
    eco: "C20",
    name: "King's Pawn Game",
    ply: 2,
  });
});

test("identifyDeepestFromMoves returns null for an empty move list", () => {
  assert.equal(identifyDeepestFromMoves(openingTable(), []), null);
});
