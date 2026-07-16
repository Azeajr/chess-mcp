import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GameTree, analyzeCongruence, parseOpeningsTsv } from "../../src/index.ts";

/**
 * This suite is a compatibility boundary for the pre-V2 analyzer, not a specification for
 * Strategic Fit. In particular, the legacy implementation compares terminal leaves, weights
 * them by raw count, clusters on a coarse opening-name prefix, and folds acknowledgement into a
 * severity filter. Those known limitations are intentionally pinned only until the V2 cutover.
 */

const OPENINGS = parseOpeningsTsv(
  readFileSync(new URL("../../../../apps/mcp-server/data/openings.tsv", import.meta.url), "utf8"),
);

const NIMZO_PGN =
  "1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. e3 Bxc3+ " +
  "( 4... O-O 5. Bd3 d5 6. Nf3 c5 ) " +
  "( 4... b6 5. Bd3 Bb7 6. Nf3 O-O ) 5. bxc3 O-O *";

const NIMZO_WEAKNESS_PATH = ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4", "e3", "Bxc3+", "bxc3", "O-O"];

const WEAKNESS_DESCRIPTION =
  "Most lines keep a sound pawn structure, but here you accept doubled/isolated pawns — inconsistent structural comfort.";

test("legacy golden: Nimzo weakness keeps the public result shape and default medium severity", () => {
  const actual = analyzeCongruence(GameTree.fromPgn(NIMZO_PGN), "white", OPENINGS);

  assert.deepEqual(actual, {
    total_flagged: 1,
    acknowledged_count: 0,
    leaves_analyzed: 3,
    clusters: { "Nimzo-Indian Defense": 3 },
    by_type: { weakness_inconsistency: 1 },
    incongruencies: [
      {
        type: "weakness_inconsistency",
        severity: "medium",
        description: WEAKNESS_DESCRIPTION,
        paths: [NIMZO_WEAKNESS_PATH],
        cluster: "Nimzo-Indian Defense",
      },
    ],
  });
});

test("legacy acknowledgment downgrades the weakness while exclusion removes its terminal leaf", () => {
  const tree = GameTree.fromPgn(NIMZO_PGN);

  const acknowledgedAtDefaultFloor = analyzeCongruence(tree, "white", OPENINGS, {
    acknowledgedWeaknesses: [NIMZO_WEAKNESS_PATH],
  });
  assert.deepEqual(acknowledgedAtDefaultFloor, {
    total_flagged: 0,
    acknowledged_count: 1,
    leaves_analyzed: 3,
    clusters: { "Nimzo-Indian Defense": 3 },
    by_type: {},
    incongruencies: [],
  });

  const acknowledgedAtLowFloor = analyzeCongruence(tree, "white", OPENINGS, {
    acknowledgedWeaknesses: [NIMZO_WEAKNESS_PATH],
    minSeverity: "low",
  });
  assert.deepEqual(acknowledgedAtLowFloor.incongruencies, [
    {
      type: "weakness_inconsistency",
      severity: "low",
      description: WEAKNESS_DESCRIPTION,
      paths: [NIMZO_WEAKNESS_PATH],
      acknowledged: true,
      cluster: "Nimzo-Indian Defense",
    },
  ]);
  assert.equal(acknowledgedAtLowFloor.total_flagged, 0);
  assert.equal(acknowledgedAtLowFloor.acknowledged_count, 1);
  assert.deepEqual(acknowledgedAtLowFloor.by_type, {});

  const excluded = analyzeCongruence(tree, "white", OPENINGS, {
    excludePaths: [NIMZO_WEAKNESS_PATH.slice(0, 8)],
  });
  assert.deepEqual(excluded, {
    total_flagged: 0,
    acknowledged_count: 0,
    leaves_analyzed: 2,
    clusters: { "Nimzo-Indian Defense": 2 },
    by_type: {},
    incongruencies: [],
  });
});

test("legacy single-line limitation reports no findings rather than incomplete evidence", () => {
  const actual = analyzeCongruence(GameTree.fromPgn("1. e4 e5 2. Nf3 *"), "white", OPENINGS);

  assert.deepEqual(actual, {
    total_flagged: 0,
    acknowledged_count: 0,
    leaves_analyzed: 1,
    clusters: { "King's Knight Opening": 1 },
    by_type: {},
    incongruencies: [],
  });
});

test("legacy equal-severity findings retain deterministic terminal-leaf traversal order", () => {
  const pgn =
    "1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. e3 Bxc3+ " +
    "( 4... O-O 5. Bd3 d5 6. Nf3 c5 ) " +
    "( 4... b6 5. Bd3 Bb7 6. Nf3 O-O ) " +
    "( 4... d5 5. Bd3 O-O 6. Nf3 c5 ) " +
    "5. bxc3 O-O ( 5... d5 ) *";
  const first = analyzeCongruence(GameTree.fromPgn(pgn), "white", OPENINGS, { limit: 50 });
  const second = analyzeCongruence(GameTree.fromPgn(pgn), "white", OPENINGS, { limit: 50 });

  assert.deepEqual(second, first);
  assert.deepEqual(
    first.incongruencies.map((finding) => finding.paths[0]),
    [NIMZO_WEAKNESS_PATH, [...NIMZO_WEAKNESS_PATH.slice(0, -1), "d5"]],
  );
  assert.deepEqual(
    first.incongruencies.map((finding) => finding.severity),
    ["medium", "medium"],
  );
});
