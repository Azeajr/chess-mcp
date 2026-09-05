import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_FIT_JOB_CHECKPOINT_FORMAT_VERSION,
  StrategicFitAnalysisCancelledError,
  StrategicFitIndexCache,
  analyzeStrategicFit,
  createStrategicFitJobRecorder,
  restoreStrategicFitJobCheckpoint,
  strategicFitJobCheckpointRejection,
  strategicFitJobCompatibility,
  type AnalyzeStrategicFitOptions,
  type StrategicFitAnalysisResult,
  type StrategicFitJobCheckpoint,
} from "../../src/index.ts";
import { BROAD_ECO_FIXTURE } from "./fixtures.ts";

const PGN = BROAD_ECO_FIXTURE.pgn;

const options = (
  overrides: Partial<AnalyzeStrategicFitOptions> = {},
): AnalyzeStrategicFitOptions => ({
  repertoireColor: "white",
  repertoireRevision: "rev-1",
  ...overrides,
});

function assertIdentical(
  actual: StrategicFitAnalysisResult,
  expected: StrategicFitAnalysisResult,
): void {
  assert.deepStrictEqual(actual, expected);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

interface InterruptedJob {
  readonly checkpoints: readonly StrategicFitJobCheckpoint[];
  readonly cancelledPhaseIndex: number;
}

function interruptAfterPhase(
  analysisOptions: AnalyzeStrategicFitOptions,
  interruptAfterPhaseIndex = 1,
  clock = () => "2026-07-31T10:00:00.000Z",
): InterruptedJob {
  const checkpoints: StrategicFitJobCheckpoint[] = [];
  const record = createStrategicFitJobRecorder({
    compatibility: strategicFitJobCompatibility(GameTree.fromPgn(PGN).toPgn(), analysisOptions),
    save: (checkpoint) => checkpoints.push(checkpoint),
    now: clock,
  });
  let interrupted = false;
  let cancelledPhaseIndex = -1;
  try {
    analyzeStrategicFit(GameTree.fromPgn(PGN), {
      ...analysisOptions,
      index: new StrategicFitIndexCache(),
      shouldCancel: () => interrupted,
      onCheckpoint: (stage) => {
        record(stage);
        if (stage.completed_phase_index >= interruptAfterPhaseIndex) interrupted = true;
      },
    });
  } catch (error) {
    assert.ok(error instanceof StrategicFitAnalysisCancelledError);
    cancelledPhaseIndex = error.phase_index;
  }
  assert.ok(
    cancelledPhaseIndex > interruptAfterPhaseIndex,
    "the job must stop before it completes",
  );
  return { checkpoints, cancelledPhaseIndex };
}

test("a job resumed from a checkpoint returns exactly what a cold full scan returns", () => {
  const analysisOptions = options();
  const cold = analyzeStrategicFit(GameTree.fromPgn(PGN), analysisOptions);
  const { checkpoints } = interruptAfterPhase(analysisOptions);

  assert.deepStrictEqual(
    checkpoints.map((checkpoint) => checkpoint.completed_phase),
    ["normalizing-move-orders", "identifying-comparable-branches"],
  );
  assert.ok(checkpoints.every((checkpoint) => checkpoint.provisional));
  assert.equal(checkpoints[0]?.stages.trajectories, null);
  assert.equal(new Set(checkpoints.map((checkpoint) => checkpoint.job_id)).size, 1);

  const stored = structuredClone(checkpoints.at(-1)!);
  const index = new StrategicFitIndexCache();
  const recovery = restoreStrategicFitJobCheckpoint(
    index,
    stored,
    strategicFitJobCompatibility(GameTree.fromPgn(PGN).toPgn(), analysisOptions),
  );

  assert.equal(recovery.state, "resumed");
  assert.equal(recovery.job_id, stored.job_id);
  assert.equal(recovery.saved_at, "2026-07-31T10:00:00.000Z");
  assert.equal(recovery.completed_phase, "identifying-comparable-branches");
  assert.deepStrictEqual(recovery.restored_stages, ["graph", "trajectories"]);
  assert.match(recovery.reason, /Resumed the interrupted analysis/);
  assert.equal(index.stats.restorations, 2);

  const resumed = analyzeStrategicFit(GameTree.fromPgn(PGN), { ...analysisOptions, index });
  assertIdentical(resumed, cold);
  assert.ok(
    index.stats.hits >= 2,
    "the restored graph and trajectory report are reused, not rebuilt",
  );
});

test("a checkpoint saved before the trajectory phase still resumes and still equals a cold scan", () => {
  const analysisOptions = options();
  const cold = analyzeStrategicFit(GameTree.fromPgn(PGN), analysisOptions);
  const { checkpoints } = interruptAfterPhase(analysisOptions, 0);
  const stored = structuredClone(checkpoints[0]!);

  const index = new StrategicFitIndexCache();
  const recovery = restoreStrategicFitJobCheckpoint(
    index,
    stored,
    strategicFitJobCompatibility(GameTree.fromPgn(PGN).toPgn(), analysisOptions),
  );
  assert.equal(recovery.state, "resumed");
  assert.deepStrictEqual(recovery.restored_stages, ["graph"]);
  assert.equal(recovery.completed_phase, "normalizing-move-orders");

  assertIdentical(analyzeStrategicFit(GameTree.fromPgn(PGN), { ...analysisOptions, index }), cold);
});

test("a resumed job still reports the six phases in order", () => {
  const analysisOptions = options();
  const { checkpoints } = interruptAfterPhase(analysisOptions);
  const index = new StrategicFitIndexCache();
  restoreStrategicFitJobCheckpoint(
    index,
    structuredClone(checkpoints.at(-1)!),
    strategicFitJobCompatibility(GameTree.fromPgn(PGN).toPgn(), analysisOptions),
  );

  const running: string[] = [];
  const completed: string[] = [];
  analyzeStrategicFit(GameTree.fromPgn(PGN), {
    ...analysisOptions,
    index,
    onProgress: (progress) => {
      if (progress.state === "running") running.push(progress.phase);
      if (progress.state === "completed") completed.push(progress.phase);
    },
  });

  assert.deepStrictEqual(running, [
    "normalizing-move-orders",
    "identifying-comparable-branches",
    "extracting-strategic-patterns",
    "measuring-learning-burden",
    "attributing-differences-to-decisions",
    "ranking-findings",
  ]);
  assert.deepStrictEqual(completed, running);
});

test("an incompatible checkpoint is discarded with a specific reason and restores nothing", () => {
  const analysisOptions = options();
  const contentKey = GameTree.fromPgn(PGN).toPgn();
  const stored = structuredClone(interruptAfterPhase(analysisOptions).checkpoints.at(-1)!);

  const cases: readonly (readonly [AnalyzeStrategicFitOptions, string, string])[] = [
    [
      options({ repertoireRevision: "rev-2" }),
      "strategic_fit_checkpoint_stale_revision",
      contentKey,
    ],
    [analysisOptions, "strategic_fit_checkpoint_stale_content", "1. d4 d5 *"],
    [
      options({ weighting: { mode: "manual" } }),
      "strategic_fit_checkpoint_stale_settings",
      contentKey,
    ],
    [
      options({ trajectory: { configuredPlies: [6, 10] } }),
      "strategic_fit_checkpoint_stale_settings",
      contentKey,
    ],
    [options({ repertoireColor: "black" }), "strategic_fit_checkpoint_stale_settings", contentKey],
  ];

  for (const [candidateOptions, code, candidateContentKey] of cases) {
    const index = new StrategicFitIndexCache();
    const recovery = restoreStrategicFitJobCheckpoint(
      index,
      stored,
      strategicFitJobCompatibility(candidateContentKey, candidateOptions),
    );
    assert.equal(recovery.state, "discarded", code);
    assert.equal(recovery.code, code);
    assert.deepStrictEqual(recovery.restored_stages, []);
    assert.equal(recovery.job_id, stored.job_id, "a discarded checkpoint still names the job");
    assert.equal(index.stats.size, 0, "a discarded checkpoint seeds nothing");
    assert.equal(index.stats.restorations, 0);
  }
});

test("a retired index generation discards a checkpoint whose report identity still matches", () => {
  const analysisOptions = options();
  const contentKey = GameTree.fromPgn(PGN).toPgn();
  const stored = structuredClone(interruptAfterPhase(analysisOptions).checkpoints.at(-1)!);
  const expected = strategicFitJobCompatibility(contentKey, analysisOptions);
  const retired = { ...expected, index_generation: `${expected.index_generation}:advanced` };

  const rejection = strategicFitJobCheckpointRejection(stored, retired);
  assert.equal(rejection?.code, "strategic_fit_checkpoint_retired_generation");

  const index = new StrategicFitIndexCache();
  assert.equal(restoreStrategicFitJobCheckpoint(index, stored, retired).state, "discarded");
  assert.equal(index.stats.size, 0);
});

test("corrupted and foreign-format checkpoints are discarded rather than partially read", () => {
  const analysisOptions = options();
  const contentKey = GameTree.fromPgn(PGN).toPgn();
  const expected = strategicFitJobCompatibility(contentKey, analysisOptions);
  const stored = structuredClone(interruptAfterPhase(analysisOptions).checkpoints.at(-1)!);

  const corrupt: readonly (readonly [unknown, string])[] = [
    [null, "strategic_fit_checkpoint_corrupt"],
    ["not-a-record", "strategic_fit_checkpoint_corrupt"],
    [
      { ...stored, format_version: STRATEGIC_FIT_JOB_CHECKPOINT_FORMAT_VERSION + 1 },
      "strategic_fit_checkpoint_format_version",
    ],
    [{ ...stored, provisional: false }, "strategic_fit_checkpoint_corrupt"],
    [{ ...stored, saved_at: "not-a-time" }, "strategic_fit_checkpoint_corrupt"],
    [{ ...stored, completed_phase: "ranking-findings" }, "strategic_fit_checkpoint_corrupt"],
    [{ ...stored, job_id: "strategic-fit-job:forged" }, "strategic_fit_checkpoint_corrupt"],
    [
      { ...stored, stages: { ...stored.stages, graph: { graph_id: "graph:truncated" } } },
      "strategic_fit_checkpoint_corrupt",
    ],
    [
      { ...stored, stages: { ...stored.stages, graph_content_key: "" } },
      "strategic_fit_checkpoint_corrupt",
    ],
    [
      { ...stored, stages: { ...stored.stages, trajectories: { graph_id: 7 } } },
      "strategic_fit_checkpoint_corrupt",
    ],
    [
      { ...stored, compatibility: { ...stored.compatibility, index_generation: "" } },
      "strategic_fit_checkpoint_corrupt",
    ],
  ];

  for (const [candidate, code] of corrupt) {
    const index = new StrategicFitIndexCache();
    const recovery = restoreStrategicFitJobCheckpoint(index, candidate, expected);
    assert.equal(recovery.state, "discarded", JSON.stringify(candidate).slice(0, 80));
    assert.equal(recovery.code, code, JSON.stringify(candidate).slice(0, 80));
    assert.equal(index.stats.size, 0);
  }
});

test("a trajectory report that does not belong to the restored graph is dropped, not installed", () => {
  const analysisOptions = options();
  const contentKey = GameTree.fromPgn(PGN).toPgn();
  const stored = structuredClone(interruptAfterPhase(analysisOptions).checkpoints.at(-1)!);
  const mismatched: StrategicFitJobCheckpoint = {
    ...stored,
    stages: {
      ...stored.stages,
      trajectories: { ...stored.stages.trajectories!, graph_id: "graph:other" },
    },
  };

  const index = new StrategicFitIndexCache();
  const recovery = restoreStrategicFitJobCheckpoint(
    index,
    mismatched,
    strategicFitJobCompatibility(contentKey, analysisOptions),
  );
  assert.equal(recovery.state, "resumed");
  assert.deepStrictEqual(recovery.restored_stages, ["graph"]);
  assert.equal(index.stats.restorations, 1);

  const cold = analyzeStrategicFit(GameTree.fromPgn(PGN), analysisOptions);
  assertIdentical(analyzeStrategicFit(GameTree.fromPgn(PGN), { ...analysisOptions, index }), cold);
});

test("the recorder refuses a stage from a generation other than the job's", () => {
  const analysisOptions = options();
  const compatibility = strategicFitJobCompatibility(
    GameTree.fromPgn(PGN).toPgn(),
    analysisOptions,
  );
  const saved: StrategicFitJobCheckpoint[] = [];
  const record = createStrategicFitJobRecorder({
    compatibility,
    save: (checkpoint) => saved.push(checkpoint),
    now: () => "2026-07-31T10:00:00.000Z",
  });
  const stage = interruptAfterPhase(analysisOptions).checkpoints.at(-1)!.stages;

  record({
    generation: "strategic-fit-index:foreign",
    graph_content_key: stage.graph_content_key,
    graph: stage.graph,
    trajectories: stage.trajectories,
    completed_phase: "identifying-comparable-branches",
    completed_phase_index: 1,
  });
  assert.deepStrictEqual(saved, []);

  record({
    generation: compatibility.index_generation,
    graph_content_key: stage.graph_content_key,
    graph: stage.graph,
    trajectories: stage.trajectories,
    completed_phase: "identifying-comparable-branches",
    completed_phase_index: 1,
  });
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.compatibility.report_cache_key, compatibility.report_cache_key);
});

test("an analysis without an index emits no checkpoint at all", () => {
  let emitted = 0;
  analyzeStrategicFit(GameTree.fromPgn(PGN), {
    ...options(),
    onCheckpoint: () => {
      emitted++;
    },
  });
  assert.equal(emitted, 0, "checkpointing is expressed in index identities and requires an index");
});
