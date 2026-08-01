import assert from "node:assert/strict";
import test from "node:test";

import { GameTree } from "../../src/pgn.js";
import { buildRepertoireGraph } from "../../src/strategic-fit/graph.js";
import {
  STRATEGIC_FIT_TRAINING_PERFORMANCE_VERSION,
  createStrategicFitTrainingPerformanceData,
  deriveStrategicFitTrainingMastery,
  mergeStrategicFitTrainingPerformance,
  parseStrategicFitTrainingPerformance,
  recordStrategicFitTrainingAttempt,
  serializeStrategicFitTrainingPerformance,
  upsertStrategicFitTrainingTarget,
} from "../../src/strategic-fit/training.js";

const DOCUMENT_ID = "document:training-performance";
const NOW = "2026-07-22T16:00:00.000Z";

function fixture() {
  const graph = buildRepertoireGraph(GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *"), "white");
  const decision = graph.decisions.find((entry) => entry.san === "e4")!;
  let data = createStrategicFitTrainingPerformanceData(DOCUMENT_ID);
  data = upsertStrategicFitTrainingTarget(data, {
    training_id: "training:ruy",
    position_id: decision.from_position_id,
    decision_id: decision.decision_id,
    concept_ids: ["concept:center-control", "concept:development"],
    created_at: "2026-07-20T12:00:00-04:00",
  });
  const target = data.targets[0]!;
  return { graph, decision, target, data };
}

test("training targets remain explicitly untrained until a real attempt exists", () => {
  const subject = fixture();
  const report = deriveStrategicFitTrainingMastery(subject.data, subject.graph, NOW);

  assert.equal(report.decision_mastery[0]?.state, "untrained");
  assert.equal(report.decision_mastery[0]?.attempt_count, 0);
  assert.equal(report.decision_mastery[0]?.recall_rate, null);
  assert.equal(report.decision_mastery[0]?.mastery, null);
  assert.deepEqual(
    report.concept_mastery.map((entry) => [entry.identity_id, entry.state, entry.mastery]),
    [
      ["concept:center-control", "untrained", null],
      ["concept:development", "untrained", null],
    ],
  );
  assert.deepEqual(report.metric_evidence.concept_mastery, []);
});

test("mastery uses recall shrinkage plus only measured response/confidence inputs", () => {
  const subject = fixture();
  let data = recordStrategicFitTrainingAttempt(subject.data, {
    target_id: subject.target.target_id,
    attempted_at: "2026-07-20T13:00:00-04:00",
    recalled: true,
    response_time_ms: 5_000,
    confidence: 0.8,
    next_due_at: "2026-07-21T17:00:00Z",
  });
  data = recordStrategicFitTrainingAttempt(data, {
    target_id: subject.target.target_id,
    attempted_at: "2026-07-21T17:00:00Z",
    recalled: true,
    response_time_ms: 10_000,
    confidence: 0.9,
    next_due_at: "2026-07-22T17:00:00Z",
  });
  data = recordStrategicFitTrainingAttempt(data, {
    target_id: subject.target.target_id,
    attempted_at: "2026-07-22T15:00:00Z",
    recalled: false,
    response_time_ms: 20_000,
    lapse: true,
    confidence: 0.4,
    next_due_at: "2026-07-22T18:00:00Z",
  });

  const report = deriveStrategicFitTrainingMastery(data, subject.graph, NOW);
  const decision = report.decision_mastery[0]!;
  assert.equal(decision.state, "observed");
  assert.equal(decision.attempt_count, 3);
  assert.equal(decision.successful_recall_count, 2);
  assert.equal(decision.recall_rate, 0.666667);
  assert.equal(decision.average_response_time_ms, 11_667);
  assert.equal(decision.lapse_count, 1);
  assert.equal(decision.lapse_rate, 0.333333);
  assert.equal(decision.average_confidence, 0.7);
  assert.equal(decision.next_due_at, "2026-07-22T18:00:00.000Z");
  assert.equal(decision.mastery, 0.512996);
  assert.deepEqual(
    report.metric_evidence.concept_mastery.map((entry) => [entry.concept_id, entry.mastery]),
    [
      ["concept:center-control", 0.512996],
      ["concept:development", 0.512996],
    ],
  );
});

test("a failed first attempt is observed failure, never an untrained zero", () => {
  const subject = fixture();
  const data = recordStrategicFitTrainingAttempt(subject.data, {
    target_id: subject.target.target_id,
    attempted_at: NOW,
    recalled: false,
    lapse: true,
  });
  const report = deriveStrategicFitTrainingMastery(data, subject.graph, NOW);
  const decision = report.decision_mastery[0]!;

  assert.equal(decision.state, "observed");
  assert.equal(decision.recall_rate, 0);
  assert.equal(decision.average_response_time_ms, null);
  assert.equal(decision.average_confidence, null);
  assert.equal(decision.mastery, 0.166667);
});

test("a declared lapse lowers mastery without inferring missing response or confidence", () => {
  const subject = fixture();
  const input = {
    target_id: subject.target.target_id,
    attempted_at: NOW,
    recalled: true,
  } as const;
  const retained = deriveStrategicFitTrainingMastery(
    recordStrategicFitTrainingAttempt(subject.data, input),
    subject.graph,
    NOW,
  ).decision_mastery[0]!;
  const lapsed = deriveStrategicFitTrainingMastery(
    recordStrategicFitTrainingAttempt(subject.data, { ...input, lapse: true }),
    subject.graph,
    NOW,
  ).decision_mastery[0]!;

  assert.equal(retained.mastery, 0.666667);
  assert.equal(lapsed.mastery, 0.333333);
  assert.equal(lapsed.average_response_time_ms, null);
  assert.equal(lapsed.average_confidence, null);
});

test("stale semantic targets retain history and provenance but leave metric evidence", () => {
  const subject = fixture();
  const data = recordStrategicFitTrainingAttempt(subject.data, {
    target_id: subject.target.target_id,
    attempted_at: NOW,
    recalled: true,
    response_time_ms: 3_000,
  });
  const changedGraph = buildRepertoireGraph(GameTree.fromPgn("1. d4 d5 2. c4 e6 *"), "white");
  const report = deriveStrategicFitTrainingMastery(data, changedGraph, NOW);

  assert.deepEqual(report.stale_target_ids, [subject.target.target_id]);
  assert.equal(report.decision_mastery[0]?.state, "stale");
  assert.equal(report.decision_mastery[0]?.attempt_count, 1);
  assert.ok(report.decision_mastery[0]?.provenance.some((entry) => entry.state === "stale"));
  assert.deepEqual(report.metric_evidence.concept_mastery, []);
  assert.equal(data.attempts.length, 1, "derivation must not delete historical attempts");
});

test("training performance exports and imports a strict versioned UTC-stable envelope", () => {
  const subject = fixture();
  const data = recordStrategicFitTrainingAttempt(subject.data, {
    target_id: subject.target.target_id,
    attempted_at: "2026-07-22T12:00:00-04:00",
    recalled: true,
    scheduled_at: "2026-07-22T11:30:00-04:00",
    next_due_at: "2026-07-23T12:00:00-04:00",
  });
  const serialized = serializeStrategicFitTrainingPerformance(data);
  const parsed = parseStrategicFitTrainingPerformance(serialized);
  assert.ok("ok" in parsed);
  if (!("ok" in parsed)) return;
  assert.equal(
    parsed.data.training_performance_version,
    STRATEGIC_FIT_TRAINING_PERFORMANCE_VERSION,
  );
  assert.equal(parsed.data.targets[0]?.created_at, "2026-07-20T16:00:00.000Z");
  assert.equal(parsed.data.attempts[0]?.attempted_at, "2026-07-22T16:00:00.000Z");
  assert.equal(parsed.data.attempts[0]?.scheduled_at, "2026-07-22T15:30:00.000Z");
  assert.equal(parsed.data.attempts[0]?.next_due_at, "2026-07-23T16:00:00.000Z");
  assert.equal(serializeStrategicFitTrainingPerformance(parsed.data), serialized);

  const merged = mergeStrategicFitTrainingPerformance(
    createStrategicFitTrainingPerformanceData(DOCUMENT_ID),
    parsed.data,
  );
  assert.deepEqual(merged, parsed.data);

  const incompatible = JSON.parse(serialized) as Record<string, unknown>;
  incompatible.training_performance_version = "99.0.0";
  const rejected = parseStrategicFitTrainingPerformance(incompatible);
  assert.ok(!("ok" in rejected));
  if (!("ok" in rejected)) assert.equal(rejected.code, "unsupported-version");

  const forged = JSON.parse(serialized) as {
    targets: Array<{ target_id: string }>;
  };
  forged.targets[0]!.target_id = "strategic-fit-training-target:forged";
  const forgedResult = parseStrategicFitTrainingPerformance(forged);
  assert.ok(!("ok" in forgedResult));
  if (!("ok" in forgedResult)) assert.equal(forgedResult.code, "invalid-field");
});
