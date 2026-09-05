import assert from "node:assert/strict";
import test from "node:test";

import { drillOrientation, sanForDrillMove } from "../src/application/drill-move.ts";
import {
  advanceStrategicFitDrillSession,
  endStrategicFitDrillSession,
  playStrategicFitDrill,
  refreshStrategicFitDrillClock,
  startStrategicFitDrillSession,
  strategicFitDrillAttemptWasRecorded,
  strategicFitDrillSession,
} from "../src/store/strategic-fit-training.ts";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4_FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const PROMOTION_FEN = "8/P6k/8/8/8/8/6K1/8 w - - 0 1";
const MALFORMED_FEN = "not a fen";

test("drillOrientation follows the side to move in the drill position", () => {
  assert.equal(drillOrientation(START_FEN), "white");
  assert.equal(drillOrientation(AFTER_E4_FEN), "black");
  assert.equal(drillOrientation(PROMOTION_FEN), "white");
});

test("drillOrientation defaults to white rather than throwing on an unusable FEN", () => {
  assert.equal(drillOrientation(MALFORMED_FEN), "white");
  assert.equal(drillOrientation(""), "white");
});

test("sanForDrillMove converts a legal board move to the SAN a drill is compared against", () => {
  assert.equal(sanForDrillMove(START_FEN, "e2", "e4"), "e4");
  assert.equal(sanForDrillMove(START_FEN, "g1", "f3"), "Nf3");
  assert.equal(sanForDrillMove(AFTER_E4_FEN, "e7", "e5"), "e5");
});

test("sanForDrillMove returns null for a move that is not legal in the position", () => {
  assert.equal(sanForDrillMove(START_FEN, "e2", "e5"), null, "pawn three squares");
  assert.equal(sanForDrillMove(START_FEN, "b1", "b5"), null, "knight moving like a rook");
  assert.equal(sanForDrillMove(START_FEN, "a1", "a5"), null, "rook through its own pawn");
  assert.equal(sanForDrillMove(START_FEN, "e7", "e5"), null, "not this side's move");
});

test("sanForDrillMove returns null for squares that are not on the board or an unusable FEN", () => {
  assert.equal(sanForDrillMove(START_FEN, "zz", "e4"), null);
  assert.equal(sanForDrillMove(START_FEN, "e2", "e9"), null);
  assert.equal(sanForDrillMove(MALFORMED_FEN, "e2", "e4"), null);
});

test("sanForDrillMove auto-queens a promotion", () => {
  assert.equal(sanForDrillMove(PROMOTION_FEN, "a7", "a8"), "a8=Q");
});

test("sanForDrillMove produces the canonical spelling a drill's expected_san uses", () => {
  const beforeCheck = "r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3";
  assert.equal(sanForDrillMove(beforeCheck, "h5", "f7"), "Qxf7+");
});

test("a drill is recalled only when the played SAN equals the expected SAN exactly", () => {
  const expected = "Nf3";
  assert.equal(sanForDrillMove(START_FEN, "g1", "f3") === expected, true);
  assert.equal(
    sanForDrillMove(START_FEN, "b1", "c3") === expected,
    false,
    "a different legal move",
  );
  assert.equal(sanForDrillMove(START_FEN, "e2", "e5") === expected, false, "an illegal move");
});

const DRILL = {
  drill_id: "strategic-fit-drill:test-1",
  position_id: "position:test-1",
  decision_id: "decision:test-1",
  fen: START_FEN,
  expected_san: "Nf3",
} as const;

const SECOND_DRILL = { ...DRILL, drill_id: "strategic-fit-drill:test-2", expected_san: "e4" };

test("playStrategicFitDrill refuses when no session is open", () => {
  const trainingId = "strategic-fit-training:no-session";
  endStrategicFitDrillSession(trainingId);
  assert.equal(
    playStrategicFitDrill({ trainingId, drill: DRILL, orig: "g1", dest: "f3" }),
    null,
    "no session means no outcome",
  );
  assert.equal(strategicFitDrillSession(trainingId), null);
});

test("a correct move is scored as recalled and timed from when the position was shown", () => {
  const trainingId = "strategic-fit-training:recalled";
  startStrategicFitDrillSession(trainingId, 1000);
  const outcome = playStrategicFitDrill({
    trainingId,
    drill: DRILL,
    orig: "g1",
    dest: "f3",
    now: 4500,
  });
  assert.equal(outcome?.recalled, true);
  assert.equal(outcome?.played_san, "Nf3");
  assert.equal(outcome?.response_time_ms, 3500);
  endStrategicFitDrillSession(trainingId);
});

test("a wrong move and an illegal move are both misses, and an illegal one has no SAN", () => {
  const trainingId = "strategic-fit-training:missed";
  startStrategicFitDrillSession(trainingId, 0);
  const wrong = playStrategicFitDrill({ trainingId, drill: DRILL, orig: "b1", dest: "c3" });
  assert.equal(wrong?.recalled, false);
  assert.equal(wrong?.played_san, "Nc3", "a legal but unprepared move is still named");

  const illegalTraining = "strategic-fit-training:illegal";
  startStrategicFitDrillSession(illegalTraining, 0);
  const illegal = playStrategicFitDrill({
    trainingId: illegalTraining,
    drill: DRILL,
    orig: "e2",
    dest: "e5",
  });
  assert.equal(illegal?.recalled, false);
  assert.equal(illegal?.played_san, null);

  endStrategicFitDrillSession(trainingId);
  endStrategicFitDrillSession(illegalTraining);
});

test("a drill already answered in this session cannot be answered again", () => {
  const trainingId = "strategic-fit-training:first-only";
  startStrategicFitDrillSession(trainingId, 0);
  const first = playStrategicFitDrill({ trainingId, drill: DRILL, orig: "b1", dest: "c3" });
  assert.equal(first?.recalled, false);

  const retry = playStrategicFitDrill({ trainingId, drill: DRILL, orig: "g1", dest: "f3" });
  assert.equal(retry, null, "the correct move played second is refused");

  const session = strategicFitDrillSession(trainingId);
  assert.equal(session?.outcomes.length, 1, "the first result stands alone");
  assert.equal(session?.outcomes[0]?.recalled, false, "and is not overwritten by the retry");
  endStrategicFitDrillSession(trainingId);
});

test("an answered drill survives a remount of the runner", () => {
  const trainingId = "strategic-fit-training:remount";
  startStrategicFitDrillSession(trainingId, 0);
  playStrategicFitDrill({ trainingId, drill: DRILL, orig: "g1", dest: "f3", now: 2000 });

  refreshStrategicFitDrillClock(trainingId, 99_000);
  const session = strategicFitDrillSession(trainingId);
  assert.equal(session?.outcomes.length, 1);
  assert.equal(session?.outcomes[0]?.drill_id, DRILL.drill_id);
  assert.equal(session?.index, 0, "still on the position that was answered");
  assert.equal(
    playStrategicFitDrill({ trainingId, drill: DRILL, orig: "b1", dest: "c3" }),
    null,
    "the remounted runner cannot re-answer it",
  );
  endStrategicFitDrillSession(trainingId);
});

test("advancing moves to the next position and restarts the clock for it", () => {
  const trainingId = "strategic-fit-training:advance";
  startStrategicFitDrillSession(trainingId, 0);
  playStrategicFitDrill({ trainingId, drill: DRILL, orig: "g1", dest: "f3", now: 500 });
  advanceStrategicFitDrillSession(trainingId, 10_000);

  assert.equal(strategicFitDrillSession(trainingId)?.index, 1);
  const second = playStrategicFitDrill({
    trainingId,
    drill: SECOND_DRILL,
    orig: "e2",
    dest: "e4",
    now: 12_000,
  });
  assert.equal(second?.recalled, true);
  assert.equal(second?.response_time_ms, 2000, "timed from the advance, not from session start");
  assert.equal(strategicFitDrillSession(trainingId)?.outcomes.length, 2);
  endStrategicFitDrillSession(trainingId);
});

test("restarting a session clears its outcomes and returns to the first position", () => {
  const trainingId = "strategic-fit-training:restart";
  startStrategicFitDrillSession(trainingId, 0);
  playStrategicFitDrill({ trainingId, drill: DRILL, orig: "g1", dest: "f3" });
  advanceStrategicFitDrillSession(trainingId);

  startStrategicFitDrillSession(trainingId, 0);
  const session = strategicFitDrillSession(trainingId);
  assert.equal(session?.index, 0);
  assert.deepEqual(session?.outcomes, []);
  endStrategicFitDrillSession(trainingId);
});

test("only a non-blocked result counts as recorded", () => {
  assert.equal(strategicFitDrillAttemptWasRecorded(null), false, "no target was addressed");
  const shape = {
    code: null,
    message: "",
    data: null,
    mastery: null,
    artifact_id: null,
    error: null,
  };
  assert.equal(
    strategicFitDrillAttemptWasRecorded({ ...shape, state: "blocked" } as never),
    false,
    "a refused write is not evidence",
  );
  assert.equal(strategicFitDrillAttemptWasRecorded({ ...shape, state: "updated" } as never), true);
  assert.equal(
    strategicFitDrillAttemptWasRecorded({ ...shape, state: "unchanged" } as never),
    true,
    "the identical attempt already being logged still means it is logged",
  );
});

test("an attempt against an unregistered target is reported as unrecorded, with the reason", () => {
  const trainingId = "strategic-fit-training:unregistered";
  startStrategicFitDrillSession(trainingId, 0);
  const outcome = playStrategicFitDrill({ trainingId, drill: DRILL, orig: "g1", dest: "f3" });
  assert.equal(outcome?.recorded, false);
  assert.equal(outcome?.unrecorded_reason, "target-not-registered");
  endStrategicFitDrillSession(trainingId);
});
