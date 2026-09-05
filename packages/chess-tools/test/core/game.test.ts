import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  mainline,
  classifyCpLoss,
  moveAccuracy,
  walkGameVsRepertoire,
  aggregateGames,
  type GameRecord,
} from "../../src/index.ts";
import { AFTER_E4_FEN, START_FEN } from "./fixtures.ts";

test("mainline reports ply, colour, SAN, UCI and the positions either side of each move", () => {
  const moves = mainline('[Event "T"]\n\n1. e4 e5 *\n');
  assert.equal(moves.length, 2);
  assert.deepEqual(moves[0], {
    ply: 1,
    color: "white",
    san: "e4",
    uci: "e2e4",
    fenBefore: START_FEN,
    fenAfter: AFTER_E4_FEN,
  });
  assert.equal(moves[1]?.color, "black");
  assert.equal(moves[1]?.ply, 2, "ply counts half-moves, not full moves");
  assert.equal(moves[1]?.fenBefore, moves[0]?.fenAfter, "each move starts where the last ended");
});

test("mainline follows only the mainline, not variations", () => {
  const moves = mainline('[Event "T"]\n\n1. e4 (1. d4 d5) 1... e5 *\n');
  assert.deepEqual(
    moves.map((m) => m.san),
    ["e4", "e5"],
  );
});

test("mainline rejects a PGN with no game and one that starts from a FEN setup", () => {
  assert.throws(() => mainline(""), /no game found/u);
  assert.throws(
    () => mainline('[Event "T"]\n[FEN "8/P6k/8/8/8/8/6K1/8 w - - 0 1"]\n\n1. a8=Q *\n'),
    /fen_setup_unsupported/u,
  );
});

test("mainline returns nothing for a game with no moves", () => {
  assert.deepEqual(mainline('[Event "T"]\n\n*\n'), []);
});

test("classifyCpLoss puts its boundaries at 200, 100 and 50 exactly", () => {
  assert.equal(classifyCpLoss(201), "blunder");
  assert.equal(classifyCpLoss(200), "mistake", "exactly 200 is not yet a blunder");
  assert.equal(classifyCpLoss(101), "mistake");
  assert.equal(classifyCpLoss(100), "inaccuracy", "exactly 100 is not yet a mistake");
  assert.equal(classifyCpLoss(51), "inaccuracy");
  assert.equal(classifyCpLoss(50), "good", "exactly 50 is still good");
  assert.equal(classifyCpLoss(0), "good");
});

test("moveAccuracy decays from a perfect move and never exceeds one", () => {
  assert.equal(moveAccuracy(0), 1);
  assert.ok(moveAccuracy(100) < moveAccuracy(50), "more loss must score lower");
  assert.ok(moveAccuracy(300) > 0, "accuracy asymptotes towards zero without reaching it");
  assert.equal(moveAccuracy(300).toFixed(4), Math.exp(-1).toFixed(4));
});

test("moveAccuracy clamps a negative loss to a perfect score", () => {
  assert.equal(moveAccuracy(-500), 1);
});

function whiteRepertoire(): GameTree {
  return GameTree.fromPgn('[Event "R"]\n\n1. e4 e5 2. Nf3 *\n');
}

test("walkGameVsRepertoire counts the plies a game stayed in prep", () => {
  const walk = walkGameVsRepertoire(
    whiteRepertoire().moveMap(),
    "white",
    '[Event "G"]\n\n1. e4 e5 2. Nf3 *\n',
  );
  assert.equal(walk.in_book_plies, 3);
  assert.deepEqual(walk.player_deviations, []);
  assert.deepEqual(walk.uncovered_opponents, []);
});

test("walkGameVsRepertoire records the repertoire side leaving its own prep", () => {
  const walk = walkGameVsRepertoire(
    whiteRepertoire().moveMap(),
    "white",
    '[Event "G"]\n\n1. d4 *\n',
  );
  assert.equal(walk.in_book_plies, 0);
  assert.equal(walk.player_deviations.length, 1);
  assert.equal(walk.player_deviations[0]?.ply, 1);
  assert.equal(walk.player_deviations[0]?.played, "d4");
  assert.deepEqual(walk.player_deviations[0]?.prescribed, ["e4"]);
  assert.deepEqual(walk.uncovered_opponents, [], "White's own choice is not an opponent novelty");
});

test("walkGameVsRepertoire records an opponent move the prep does not cover", () => {
  const walk = walkGameVsRepertoire(
    whiteRepertoire().moveMap(),
    "white",
    '[Event "G"]\n\n1. e4 c5 *\n',
  );
  assert.equal(walk.in_book_plies, 1, "White's own first move was still in book");
  assert.deepEqual(walk.player_deviations, []);
  assert.equal(walk.uncovered_opponents.length, 1);
  assert.equal(walk.uncovered_opponents[0]?.played, "c5");
  assert.equal(walk.uncovered_opponents[0]?.ply, 2);
});

test("walkGameVsRepertoire keeps walking after a departure instead of stopping at the first", () => {
  const rep = GameTree.fromPgn('[Event "R"]\n\n1. e4 e5 2. Nf3 (2. Bc4 Nc6 3. Nf3) 2... Nc6 *\n');
  const walk = walkGameVsRepertoire(
    rep.moveMap(),
    "white",
    '[Event "G"]\n\n1. e4 e5 2. Bc4 Nf6 *\n',
  );
  assert.equal(walk.uncovered_opponents.length, 1);
  assert.equal(walk.uncovered_opponents[0]?.played, "Nf6");
});

function record(over: Partial<GameRecord> = {}): GameRecord {
  return {
    result: "win",
    group_key: "e4",
    group_name: "King's Pawn",
    avg_cpl: 20,
    blunders: [],
    ...over,
  };
}

test("aggregateGames returns an empty shape for no records at all", () => {
  assert.deepEqual(aggregateGames([], true), {
    total_games: 0,
    groups: [],
    worst_group: null,
    best_group: null,
  });
});

test("aggregateGames groups by key, averages CPL to one decimal, and sorts by game count", () => {
  const result = aggregateGames(
    [
      record({ avg_cpl: 10 }),
      record({ avg_cpl: 25 }),
      record({ group_key: "d4", group_name: "Queen's Pawn", avg_cpl: 40 }),
    ],
    false,
  );
  assert.equal(result.total_games, 3);
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[0]?.key, "e4", "the larger group comes first");
  assert.equal(result.groups[0]?.games, 2);
  assert.equal(result.groups[0]?.avg_cpl, 17.5);
  assert.equal(result.groups[1]?.avg_cpl, 40);
});

test("aggregateGames counts blunders by frequency, most frequent first", () => {
  const blunder = (move: string) => ({ move, classification: "blunder" as const });
  const result = aggregateGames(
    [
      record({ blunders: [blunder("Qh5"), blunder("Nf3")] }),
      record({ blunders: [blunder("Qh5")] }),
    ],
    false,
  );
  assert.deepEqual(result.groups[0]?.top_blunders, [
    { move: "Qh5", frequency: 2 },
    { move: "Nf3", frequency: 1 },
  ]);
});

test("aggregateGames omits win rates and headline groups when no result POV exists", () => {
  const result = aggregateGames([record(), record(), record()], false);
  assert.equal("win_rate" in (result.groups[0] ?? {}), false);
  assert.equal(result.worst_group, null);
  assert.equal(result.best_group, null);
});

test("aggregateGames reports win, draw and loss rates when a result POV exists", () => {
  const result = aggregateGames(
    [record({ result: "win" }), record({ result: "draw" }), record({ result: "loss" })],
    true,
  );
  const group = result.groups[0] as { win_rate: number; draw_rate: number; loss_rate: number };
  assert.equal(group.win_rate, 1 / 3);
  assert.equal(group.draw_rate, 1 / 3);
  assert.equal(group.loss_rate, 1 / 3);
});

test("aggregateGames refuses to crown a headline group below three games", () => {
  const twoGames = aggregateGames([record({ result: "loss" }), record({ result: "loss" })], true);
  assert.equal(twoGames.groups.length, 1, "the group itself is still reported");
  assert.equal(twoGames.worst_group, null);
  assert.equal(twoGames.best_group, null);

  const threeGames = aggregateGames(
    [record({ result: "loss" }), record({ result: "loss" }), record({ result: "loss" })],
    true,
  );
  assert.equal(threeGames.worst_group?.key, "e4");
  assert.equal(threeGames.worst_group?.games, 3);
});

test("aggregateGames picks the lowest and highest win rates among eligible groups", () => {
  const good = (over: Partial<GameRecord>) =>
    record({ group_key: "e4", group_name: "King's Pawn", ...over });
  const bad = (over: Partial<GameRecord>) =>
    record({ group_key: "d4", group_name: "Queen's Pawn", ...over });
  const result = aggregateGames(
    [
      good({ result: "win" }),
      good({ result: "win" }),
      good({ result: "win" }),
      bad({ result: "loss" }),
      bad({ result: "loss" }),
      bad({ result: "loss" }),
    ],
    true,
  );
  assert.equal(result.worst_group?.key, "d4");
  assert.equal(result.worst_group?.win_rate, 0);
  assert.equal(result.best_group?.key, "e4");
  assert.equal(result.best_group?.win_rate, 1);
});
