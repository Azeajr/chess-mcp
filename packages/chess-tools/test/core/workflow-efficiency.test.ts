import assert from "node:assert/strict";
import test from "node:test";
import { GameTree } from "../../src/pgn.ts";
import { findRepertoireGaps, type Analyse } from "../../src/enginetools.ts";
import { resolveStructureName } from "../../src/structure.ts";

test("F17 structure queries fold accents/apostrophes and only resolve unambiguous names", () => {
  assert.equal(resolveStructureName("Kings Indian"), "King's Indian");
  assert.equal(resolveStructureName("grunfeld"), "Grünfeld Centre");
  assert.equal(resolveStructureName("Carlsbad structure"), "Carlsbad");
  assert.equal(resolveStructureName(""), undefined);
  assert.equal(resolveStructureName("not a structure"), undefined);
});

test("F5 gap pages cover disjoint decision positions and retain full available count", async () => {
  const tree = GameTree.fromPgn("1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 *");
  const calls: string[] = [];
  const analyse: Analyse = async (fen) => {
    calls.push(fen);
    return [];
  };
  const first = await findRepertoireGaps(
    tree,
    "white",
    { maxPositions: 1, positionStart: 0 },
    analyse,
  );
  const firstFen = calls[0];
  calls.length = 0;
  const second = await findRepertoireGaps(
    tree,
    "white",
    { maxPositions: 1, positionStart: 1 },
    analyse,
  );
  assert.ok("gaps" in first);
  assert.ok("gaps" in second);
  assert.equal(first.positions_scanned, 1);
  assert.equal(second.positions_scanned, 1);
  assert.equal(first.positions_available, second.positions_available);
  assert.ok(first.positions_available > 1);
  assert.notEqual(calls[0], firstFen);
  const end = await findRepertoireGaps(
    tree,
    "white",
    { positionStart: first.positions_available },
    analyse,
  );
  assert.ok("gaps" in end);
  assert.equal(end.positions_scanned, 0);
});

test("F24 low-severity White gaps remain observable without changing severity semantics", async () => {
  const tree = GameTree.fromPgn("1. d4 d5 2. c4 e6 *");
  const analyse: Analyse = async () => [
    { uci: "g8f6", cp: 30, mate: null, depth: 12, pv: ["g8f6"] },
  ];
  const low = await findRepertoireGaps(
    tree,
    "white",
    { maxPositions: 1, minSeverity: "low" },
    analyse,
  );
  const medium = await findRepertoireGaps(
    tree,
    "white",
    { maxPositions: 1, minSeverity: "medium" },
    analyse,
  );
  assert.ok("gaps" in low);
  assert.ok("gaps" in medium);
  assert.ok(low.gaps.some((gap) => gap.uncovered_move === "Nf6" && gap.severity === "low"));
  assert.equal(medium.gaps.length, 0);
});
