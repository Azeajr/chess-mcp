import assert from "node:assert/strict";
import test from "node:test";

import { Chess } from "chessops/chess";
import { parsePgn } from "chessops/pgn";

import {
  GameTree,
  isPrefix,
  pruneTailPath,
  buildKeyIndex,
  landsInCrossBranchPrep,
  iterateLegal,
  enumerateLegal,
  someLegal,
  positionKey,
} from "../../src/index.ts";
// Not re-exported from the package index; imported from the module under test directly.
import { rejectFenSetup } from "../../src/pgn.ts";
import { ITALIAN_FEN, START_FEN, START_LEGAL_MOVES } from "./fixtures.ts";

const SIMPLE_PGN = '[Event "T"]\n\n1. e4 e5 2. Nf3 *\n';

/**
 * Both orders reach the Italian position — 1. e4 e5 2. Nf3 Nc6 3. Bc4 and 1. e4 e5 2. Bc4 Nc6
 * 3. Nf3 — confirmed identical by `validate_line`. The mainline and the variation converge, which
 * is what makes this usable for transposition and key-index assertions.
 */
const TRANSPOSITION_PGN = '[Event "T"]\n\n1. e4 e5 2. Nf3 (2. Bc4 Nc6 3. Nf3) 2... Nc6 3. Bc4 *\n';

test("fromPgn builds a tree and stats counts nodes, leaves and depth", () => {
  const tree = GameTree.fromPgn(SIMPLE_PGN);
  assert.deepEqual(tree.stats(), { nodes: 3, leaves: 1, maxDepth: 3 });
});

test("fromPgn keeps variations as branches rather than flattening them", () => {
  const tree = GameTree.fromPgn(TRANSPOSITION_PGN);
  const stats = tree.stats();
  assert.equal(stats.leaves, 2, "the mainline and the variation each end in a leaf");
  assert.deepEqual(tree.childSansAt([0, 0]), ["Nf3", "Bc4"], "both second moves are stored");
});

test("fromPgn merges additional games into one tree", () => {
  // Repertoire exports write each line as its own game; they must merge, not become two trees.
  const merged = GameTree.fromPgn(
    '[Event "A"]\n\n1. e4 e5 2. Nf3 *\n\n[Event "B"]\n\n1. e4 e5 2. Bc4 *\n',
  );
  assert.deepEqual(merged.childSansAt([0, 0]), ["Nf3", "Bc4"]);
  assert.equal(merged.stats().leaves, 2);
});

test("fromPgn rejects a PGN with no game in it", () => {
  assert.throws(() => GameTree.fromPgn(""), /no game found/u);
});

/**
 * chessops stores a syntactically valid but illegal SAN verbatim, so without the construction-time
 * replay such a PGN would load and only fail later, inconsistently: stats() counts structurally and
 * would report a leaf that leaves() skips.
 */
test("fromPgn rejects an illegal move at construction rather than at first use", () => {
  assert.throws(() => GameTree.fromPgn('[Event "T"]\n\n1. e4 e4 *\n'), /illegal move in PGN: e4/u);
});

test("fromPgn rejects a PGN that starts from a FEN setup position", () => {
  const pgn = '[Event "T"]\n[FEN "8/P6k/8/8/8/8/6K1/8 w - - 0 1"]\n\n1. a8=Q *\n';
  assert.throws(() => GameTree.fromPgn(pgn), /fen_setup_unsupported/u);
});

test("rejectFenSetup allows a FEN header that is just the standard start", () => {
  const standard = parsePgn(`[Event "T"]\n[FEN "${START_FEN}"]\n\n1. e4 *\n`)[0];
  assert.ok(standard);
  assert.doesNotThrow(() => rejectFenSetup(standard));

  const none = parsePgn(SIMPLE_PGN)[0];
  assert.ok(none);
  assert.doesNotThrow(() => rejectFenSetup(none));
});

test("rejectFenSetup treats an unparseable FEN header as non-standard", () => {
  const game = parsePgn('[Event "T"]\n[FEN "garbage"]\n\n1. e4 *\n')[0];
  assert.ok(game);
  assert.throws(() => rejectFenSetup(game), /fen_setup_unsupported/u);
});

test("detectColorFromPgn reads the ChessTempo colour header case-insensitively", () => {
  const white = '[ChesstempoRepertoireColour "White"]\n\n1. e4 *\n';
  const black = '[ChesstempoRepertoireColour "black"]\n\n1. e4 *\n';
  assert.equal(GameTree.detectColorFromPgn(white), "white");
  assert.equal(GameTree.detectColorFromPgn(black), "black");
  assert.equal(GameTree.detectColorFromPgn(SIMPLE_PGN), null, "no header means no answer");
  assert.equal(GameTree.detectColorFromPgn(""), null, "no game means no answer");
});

test("nodeAt and positionAt walk the path, and reject one that does not exist", () => {
  const tree = GameTree.fromPgn(SIMPLE_PGN);
  assert.equal(tree.nodeAt([]).children.length, 1, "the root holds the first move");
  assert.equal(tree.sanAt([0]), "e4");
  assert.equal(tree.sanAt([]), null, "the root is not a move");
  assert.equal(tree.fenAt([]), START_FEN, "the empty path is the start position");
  assert.throws(() => tree.nodeAt([5]), /invalid path/u);
  assert.throws(() => tree.positionAt([0, 3]), /invalid path/u);
});

test("appendSan creates a node once and navigates into it afterwards", () => {
  const tree = GameTree.fromPgn(SIMPLE_PGN);
  const created = tree.appendSan([0, 0], "Bc4");
  assert.equal(created.appended, true);
  assert.deepEqual(created.path, [0, 0, 1]);

  const navigated = tree.appendSan([0, 0], "Bc4");
  assert.equal(navigated.appended, false, "the second call must not duplicate the node");
  assert.deepEqual(navigated.path, created.path);
});

test("playMove converts board squares to SAN and auto-queens a promotion", () => {
  const tree = new GameTree();
  const opened = tree.playMove([], "e2", "e4");
  assert.equal(opened.appended, true);
  assert.equal(tree.sanAt(opened.path), "e4");
});

test("playMove rejects squares that are not on the board", () => {
  const tree = new GameTree();
  assert.throws(() => tree.playMove([], "zz", "e4"), /bad square/u);
  assert.throws(() => tree.playMove([], "e2", "hh"), /bad square/u);
});

/**
 * Regression guard. The original check was `makeSanAndPlay(...) === "--"`, which is chessops' SAN
 * for a null move rather than its answer for an illegal one — given e2e5 it returns "e5" and plays
 * it. Every one of these was therefore appended to the tree with a plausible SAN, breaking the
 * invariant `assertLegal` enforces on the PGN path: that every stored line can be replayed.
 */
test("playMove rejects an illegal move instead of appending it with a plausible SAN", () => {
  for (const [orig, dest] of [
    ["e2", "e5"], // pawn three squares
    ["e2", "e6"], // pawn four squares
    ["b1", "b5"], // knight moving like a rook
    ["e1", "e3"], // king two squares, through its own pawn
    ["a1", "a5"], // rook through its own pawn
  ] as const) {
    const tree = new GameTree();
    assert.throws(
      () => tree.playMove([], orig, dest),
      /illegal move/u,
      `${orig}${dest} must be refused`,
    );
    assert.equal(tree.stats().nodes, 0, `${orig}${dest} must not have been stored`);
  }
});

test("playMove refuses to move a piece that is not the side to move", () => {
  const tree = new GameTree();
  assert.throws(() => tree.playMove([], "e7", "e5"), /illegal move/u, "Black cannot open");
});

test("childSansAt and childMovesAt agree on the continuations stored at a node", () => {
  const tree = GameTree.fromPgn(TRANSPOSITION_PGN);
  assert.deepEqual(tree.childSansAt([0, 0]), ["Nf3", "Bc4"]);
  assert.deepEqual(tree.childMovesAt([0, 0]), [
    { san: "Nf3", orig: "g1", dest: "f3" },
    { san: "Bc4", orig: "f1", dest: "c4" },
  ]);
});

test("childSansAt returns nothing at a leaf", () => {
  assert.deepEqual(GameTree.fromPgn(SIMPLE_PGN).childSansAt([0, 0, 0]), []);
});

test("allPositionKeys collects one key per distinct position, not one per node", () => {
  const tree = GameTree.fromPgn(TRANSPOSITION_PGN);
  const keys = tree.allPositionKeys();
  // Eight nodes, but the two orders converge, so the Italian position is one key shared by two.
  assert.equal(tree.stats().nodes, 8);
  assert.equal(keys.size, 7);
  assert.ok(keys.has(positionKey(ITALIAN_FEN)));
});

test("transpositions reports a position the tree reaches by more than one order", () => {
  const found = GameTree.fromPgn(TRANSPOSITION_PGN).transpositions();
  assert.equal(found.length, 1);
  assert.equal(found[0]?.fen, ITALIAN_FEN);
  assert.deepEqual(found[0]?.paths, [
    ["e4", "e5", "Nf3", "Nc6", "Bc4"],
    ["e4", "e5", "Bc4", "Nc6", "Nf3"],
  ]);
});

test("transpositions reports nothing for a tree with a single line", () => {
  assert.deepEqual(GameTree.fromPgn(SIMPLE_PGN).transpositions(), []);
});

test("buildKeyIndex counts occurrences and keeps the shallowest path for each key", () => {
  const tree = GameTree.fromPgn(TRANSPOSITION_PGN);
  const { keyMap, keyCount } = buildKeyIndex(tree.game.moves);
  const italian = positionKey(ITALIAN_FEN);
  assert.equal(keyCount.get(italian), 2, "two nodes carry the converged position");
  assert.equal(keyMap.get(italian)?.ply, 5);
  // Both routes are five plies, so the first one visited wins; the mainline is visited first.
  assert.deepEqual(keyMap.get(italian)?.sanPath, ["e4", "e5", "Nf3", "Nc6", "Bc4"]);
});

test("isPrefix accepts an ancestor or the path itself and rejects a sibling", () => {
  assert.equal(isPrefix([], [0, 1]), true, "the root precedes everything");
  assert.equal(isPrefix([0], [0, 1]), true);
  assert.equal(isPrefix([0, 1], [0, 1]), true, "a path is its own prefix");
  assert.equal(isPrefix([0, 1], [0]), false, "longer cannot precede shorter");
  assert.equal(isPrefix([0, 0], [0, 1]), false, "siblings are unrelated");
});

/** A transposition into the line's own continuation is not a cross-branch find. */
test("landsInCrossBranchPrep ignores the line's own ancestors and descendants", () => {
  const tree = GameTree.fromPgn(TRANSPOSITION_PGN);
  const { keyMap } = buildKeyIndex(tree.game.moves);
  const italianPos = tree.positionAt([0, 0, 0, 0, 0]);

  // Asking from the mainline node that already owns the shallowest path: same line, so null.
  assert.equal(landsInCrossBranchPrep(keyMap, italianPos, [0, 0, 0, 0, 0]), null);

  // Asking from the variation branch: a different line reaches it, so it is a real target.
  const found = landsInCrossBranchPrep(keyMap, italianPos, [0, 0, 1, 0, 0]);
  assert.deepEqual(found?.sanPath, ["e4", "e5", "Nf3", "Nc6", "Bc4"]);
  assert.equal(found?.ply, 5);
});

test("landsInCrossBranchPrep returns null for a position the tree never reaches", () => {
  const tree = GameTree.fromPgn(SIMPLE_PGN);
  const { keyMap } = buildKeyIndex(tree.game.moves);
  assert.equal(landsInCrossBranchPrep(keyMap, Chess.default(), [0]), null);
});

test("pruneTailPath keeps the line up to and including the re-route node", () => {
  const linePath = ["e4", "e5", "Nf3", "Nc6", "Bc4"];
  assert.deepEqual(pruneTailPath({ linePath, atPly: 2 }), ["e4", "e5", "Nf3"]);
  assert.deepEqual(pruneTailPath({ linePath, atPly: 0 }), ["e4"]);
});

test("enumerateLegal produces every legal move with the position it leads to", () => {
  const moves = enumerateLegal(Chess.default());
  assert.equal(moves.length, START_LEGAL_MOVES.length);
  // `after` must be a distinct position, not an alias of the one passed in.
  const start = Chess.default();
  const [first] = enumerateLegal(start);
  assert.ok(first);
  assert.notEqual(first.after, start);
  assert.equal(start.turn, "white", "the source position must not be mutated");
  assert.equal(first.after.turn, "black");
});

test("iterateLegal yields lazily so a consumer can stop early", () => {
  let produced = 0;
  for (const _move of iterateLegal(Chess.default())) {
    produced++;
    if (produced === 3) break;
  }
  assert.equal(produced, 3, "stopping early must not have enumerated all twenty");
});

test("someLegal answers without enumerating the whole move list", () => {
  const start = Chess.default();
  let examined = 0;
  const found = someLegal(start, () => {
    examined++;
    return true;
  });
  assert.equal(found, true);
  assert.equal(examined, 1, "the first candidate satisfied the predicate");
  assert.equal(
    someLegal(start, () => false),
    false,
  );
});

test("toPgn round-trips through fromPgn without losing the tree shape", () => {
  const tree = GameTree.fromPgn(TRANSPOSITION_PGN);
  const reparsed = GameTree.fromPgn(tree.toPgn());
  assert.deepEqual(reparsed.stats(), tree.stats());
  assert.deepEqual(reparsed.transpositions(), tree.transpositions());
});

test("clone produces a tree that can be edited without touching the original", () => {
  const tree = GameTree.fromPgn(SIMPLE_PGN);
  const copy = tree.clone();
  copy.appendSan([0, 0], "Bc4");
  assert.deepEqual(tree.childSansAt([0, 0]), ["Nf3"], "the original is unchanged");
  assert.deepEqual(copy.childSansAt([0, 0]), ["Nf3", "Bc4"]);
});
