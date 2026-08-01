import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_FIT_JOB_CHECKPOINT_FORMAT_VERSION,
  STRATEGIC_FIT_PROGRESS_PHASES,
  StrategicFitIndexCache,
  analyzeStrategicFit,
  createStrategicFitJobRecorder,
  strategicFitCompleteAnalysisOptions,
  strategicFitJobCompatibility,
  type AnalyzeStrategicFitOptions,
  type StrategicFitJobCheckpoint,
  type StrategicFitJobRecovery,
} from "@chess-mcp/chess-tools";
import {
  createStrategicFitCheckpointPort,
  STRATEGIC_FIT_CHECKPOINT_KEY,
  type StrategicFitCheckpointPersistence,
} from "../src/application/strategic-fit-checkpoint-store.ts";
import { StrategicFitReportCache } from "../src/application/strategic-fit-report-cache.ts";
import {
  StrategicFitWorkerClient,
  type StrategicFitWorkerLike,
  type StrategicFitWorkerRequest,
  type StrategicFitWorkerResponse,
} from "../src/application/strategic-fit-worker.ts";
import { createStrategicFitWorkerHandler } from "../src/workers/strategic-fit.worker.ts";

const PGN = `
[Event "Strategic Fit resumable fixture"]

1. e4 (1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bf4 O-O 6. e3) e5
2. Nf3 (2. Nc3 Nf6 3. f4 d5 4. exd5 Nxd5 5. Nf3) Nc6 3. Bb5 a6 4. Ba4 Nf6
5. O-O Be7 6. Re1 *
`;

const OPTIONS: AnalyzeStrategicFitOptions = {
  repertoireColor: "white",
  repertoireRevision: "revision:resumable",
  generatedAt: "2026-07-31T09:00:00.000Z",
  runId: "run:resumable",
};

const analyzePayload = (resume?: StrategicFitJobCheckpoint) => ({
  pgn: PGN,
  repertoire_color: OPTIONS.repertoireColor,
  opening_table_entries: [],
  options: {},
  metadata: {
    repertoire_revision: OPTIONS.repertoireRevision,
    generated_at: OPTIONS.generatedAt,
    run_id: OPTIONS.runId,
  },
  ...(resume === undefined ? {} : { resume }),
});

function runThroughHandler(
  resume?: StrategicFitJobCheckpoint,
  requestId = "request:resumable",
): StrategicFitWorkerResponse[] {
  const responses: StrategicFitWorkerResponse[] = [];
  const handle = createStrategicFitWorkerHandler((response) => responses.push(response));
  handle({ type: "analyze", request_id: requestId, payload: analyzePayload(resume) });
  return responses;
}

const checkpointsOf = (responses: readonly StrategicFitWorkerResponse[]) =>
  responses.flatMap((response) => (response.type === "checkpoint" ? [response.checkpoint] : []));

const recoveryOf = (responses: readonly StrategicFitWorkerResponse[]) =>
  responses.flatMap((response) => (response.type === "recovery" ? [response.recovery] : []))[0];

/** A checkpoint as a reload leaves it: written by a worker that is gone, read as untrusted data. */
function storedCheckpoint(
  options: AnalyzeStrategicFitOptions = OPTIONS,
  contentKey = PGN,
): StrategicFitJobCheckpoint {
  const saved: StrategicFitJobCheckpoint[] = [];
  const record = createStrategicFitJobRecorder({
    compatibility: strategicFitJobCompatibility(
      contentKey,
      strategicFitCompleteAnalysisOptions(options),
    ),
    save: (checkpoint) => saved.push(checkpoint),
    now: () => "2026-07-31T09:30:00.000Z",
  });
  analyzeStrategicFit(GameTree.fromPgn(PGN), {
    ...strategicFitCompleteAnalysisOptions(options),
    index: new StrategicFitIndexCache(),
    onCheckpoint: record,
  });
  return structuredClone(saved.at(-1)!);
}

function memoryPersistence(seed?: readonly (readonly [string, unknown])[]) {
  const records = new Map<string, unknown>(seed ?? []);
  const persistence: StrategicFitCheckpointPersistence = {
    read: async (key) => (records.has(key) ? structuredClone(records.get(key)) : null),
    write: async (key, value) => {
      records.set(key, structuredClone(value));
    },
    remove: async (key) => {
      records.delete(key);
    },
  };
  return { records, persistence };
}

test("the worker checkpoints each completed stage of a job it is running", () => {
  const responses = runThroughHandler();
  const checkpoints = checkpointsOf(responses);

  assert.deepEqual(
    checkpoints.map((checkpoint) => checkpoint.completed_phase),
    ["normalizing-move-orders", "identifying-comparable-branches"],
  );
  assert.ok(checkpoints.every((checkpoint) => checkpoint.provisional === true));
  assert.equal(checkpoints[0]?.format_version, STRATEGIC_FIT_JOB_CHECKPOINT_FORMAT_VERSION);
  assert.equal(checkpoints[0]?.compatibility.content_key, PGN);
  assert.equal(checkpoints[0]?.compatibility.repertoire_revision, "revision:resumable");
  assert.equal(new Set(checkpoints.map((checkpoint) => checkpoint.job_id)).size, 1);
  assert.equal(recoveryOf(responses)?.state, "cold");
  // A checkpoint is job state, not a report: nothing in it can stand in for findings.
  assert.equal("findings" in (checkpoints.at(-1) as unknown as Record<string, unknown>), false);
});

test("a fresh worker resumes a compatible checkpoint and returns the cold result exactly", () => {
  const cold = runThroughHandler().find((response) => response.type === "result");
  assert.ok(cold && cold.type === "result");

  // The reload boundary: a new handler with an empty index, given only the stored record.
  const responses = runThroughHandler(storedCheckpoint(), "request:resumed");
  const recovery = recoveryOf(responses);
  assert.equal(recovery?.state, "resumed");
  assert.deepEqual(recovery?.restored_stages, ["graph", "trajectories"]);
  assert.equal(recovery?.saved_at, "2026-07-31T09:30:00.000Z");
  assert.equal(recovery?.completed_phase, "identifying-comparable-branches");

  const resumed = responses.find((response) => response.type === "result");
  assert.ok(resumed && resumed.type === "result");
  assert.deepStrictEqual(resumed.result, cold.result);
  assert.equal(JSON.stringify(resumed.result), JSON.stringify(cold.result));
});

test("a resumed job still reports the six phases in order", () => {
  const progress = runThroughHandler(storedCheckpoint(), "request:resumed-progress").flatMap(
    (response) => (response.type === "progress" ? [response.progress] : []),
  );

  assert.deepEqual(
    progress.filter((event) => event.state === "running").map((event) => event.phase),
    STRATEGIC_FIT_PROGRESS_PHASES,
  );
  assert.deepEqual(
    progress.filter((event) => event.state === "completed").map((event) => event.phase),
    STRATEGIC_FIT_PROGRESS_PHASES,
  );
  assert.equal(progress.at(-1)?.provisional_findings, false);
});

test("the worker refuses a checkpoint from another revision, document, or settings", () => {
  const cases: readonly (readonly [StrategicFitJobCheckpoint, string])[] = [
    [
      storedCheckpoint({ ...OPTIONS, repertoireRevision: "revision:other" }),
      "strategic_fit_checkpoint_stale_revision",
    ],
    [storedCheckpoint(OPTIONS, `${PGN}\n`), "strategic_fit_checkpoint_stale_content"],
    [
      storedCheckpoint({ ...OPTIONS, weighting: { mode: "manual" } }),
      "strategic_fit_checkpoint_stale_settings",
    ],
    [
      { ...storedCheckpoint(), provisional: false } as unknown as StrategicFitJobCheckpoint,
      "strategic_fit_checkpoint_corrupt",
    ],
  ];

  const cold = runThroughHandler().find((response) => response.type === "result");
  assert.ok(cold && cold.type === "result");

  for (const [checkpoint, code] of cases) {
    const responses = runThroughHandler(checkpoint, `request:refused:${code}`);
    const recovery = recoveryOf(responses);
    assert.equal(recovery?.state, "discarded", code);
    assert.equal(recovery?.code, code);
    const result = responses.find((response) => response.type === "result");
    assert.ok(result && result.type === "result");
    assert.equal(
      JSON.stringify(result.result),
      JSON.stringify(cold.result),
      "a refused checkpoint still leaves a complete, correct report",
    );
  }
});

class FakeWorker implements StrategicFitWorkerLike {
  onmessage: ((event: MessageEvent<StrategicFitWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: StrategicFitWorkerRequest[] = [];
  terminated = false;

  postMessage(message: StrategicFitWorkerRequest): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(response: StrategicFitWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<StrategicFitWorkerResponse>);
  }
}

test("the client sends a resume checkpoint and forwards job bookkeeping without settling", async () => {
  const worker = new FakeWorker();
  const client = new StrategicFitWorkerClient(() => worker);
  const resume = storedCheckpoint();
  const checkpoints: StrategicFitJobCheckpoint[] = [];
  const recoveries: StrategicFitJobRecovery[] = [];
  const pending = client.analyze(PGN, OPTIONS, {
    resume,
    onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
    onRecovery: (recovery) => recoveries.push(recovery),
  });

  const request = worker.posted[0]!;
  assert.equal(request.type, "analyze");
  if (request.type !== "analyze") return;
  assert.deepEqual(request.payload.resume, resume);
  assert.equal("index" in request.payload.options, false, "the index never crosses the port");

  worker.emit({
    type: "recovery",
    request_id: request.request_id,
    recovery: {
      state: "resumed",
      job_id: resume.job_id,
      saved_at: resume.saved_at,
      completed_phase: resume.completed_phase,
      completed_phase_index: resume.completed_phase_index,
      restored_stages: ["graph", "trajectories"],
      code: null,
      reason: "Resumed the interrupted analysis.",
    },
  });
  worker.emit({ type: "checkpoint", request_id: request.request_id, checkpoint: resume });
  assert.equal(recoveries.length, 1);
  assert.equal(checkpoints.length, 1);
  assert.equal(worker.terminated, false, "bookkeeping messages never settle the request");

  const report = analyzeStrategicFit(GameTree.fromPgn(PGN), OPTIONS);
  worker.emit({ type: "result", request_id: request.request_id, result: report });
  assert.deepEqual(await pending, report);
});

test("an aborted request ignores late checkpoint and recovery messages", async () => {
  const worker = new FakeWorker();
  const client = new StrategicFitWorkerClient(() => worker);
  const controller = new AbortController();
  let bookkeeping = 0;
  const pending = client.analyze(PGN, OPTIONS, {
    signal: controller.signal,
    onCheckpoint: () => {
      bookkeeping++;
    },
    onRecovery: () => {
      bookkeeping++;
    },
  });
  const request = worker.posted[0]!;

  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  worker.emit({
    type: "checkpoint",
    request_id: request.request_id,
    checkpoint: storedCheckpoint(),
  });
  assert.equal(bookkeeping, 0);
});

test("the checkpoint store keeps one versioned record and settles its writes in order", async () => {
  const { records, persistence } = memoryPersistence();
  const port = createStrategicFitCheckpointPort(persistence);
  const checkpoint = storedCheckpoint();

  port.save(checkpoint);
  await port.settled();
  assert.deepEqual([...records.keys()], [STRATEGIC_FIT_CHECKPOINT_KEY]);

  const compatibility = strategicFitJobCompatibility(
    PGN,
    strategicFitCompleteAnalysisOptions(OPTIONS),
  );
  assert.deepEqual(await port.load(compatibility), checkpoint);
  assert.equal(port.lastRejection(), null);

  port.discard("The analysis completed.");
  await port.settled();
  assert.equal(records.size, 0);
  assert.equal(port.lastDiscardReason(), "The analysis completed.");
  assert.equal(await port.load(compatibility), null);
});

test("a stored record from another format, job, or shape is deleted rather than resumed", async () => {
  const compatibility = strategicFitJobCompatibility(
    PGN,
    strategicFitCompleteAnalysisOptions(OPTIONS),
  );
  const cases: readonly (readonly [unknown, string])[] = [
    [
      { ...storedCheckpoint(), format_version: STRATEGIC_FIT_JOB_CHECKPOINT_FORMAT_VERSION + 1 },
      "strategic_fit_checkpoint_format_version",
    ],
    [
      storedCheckpoint({ ...OPTIONS, repertoireRevision: "revision:other" }),
      "strategic_fit_checkpoint_stale_revision",
    ],
    [{ nonsense: true }, "strategic_fit_checkpoint_corrupt"],
  ];

  for (const [record, code] of cases) {
    const { records, persistence } = memoryPersistence([[STRATEGIC_FIT_CHECKPOINT_KEY, record]]);
    const port = createStrategicFitCheckpointPort(persistence);
    assert.equal(await port.load(compatibility), null, code);
    assert.equal(port.lastRejection()?.code, code);
    await port.settled();
    assert.equal(records.size, 0, "an unusable record is removed, not left to be re-read");
  }
});

interface AnalyzerCall {
  readonly resume: StrategicFitJobCheckpoint | undefined;
}

function checkpointingCache(
  persistence: StrategicFitCheckpointPersistence,
  behavior: { readonly fail?: boolean } = {},
) {
  const calls: AnalyzerCall[] = [];
  const port = createStrategicFitCheckpointPort(persistence);
  const cache = new StrategicFitReportCache(
    async (pgn, options, execution = {}) => {
      calls.push({ resume: execution.resume });
      execution.onRecovery?.({
        state: execution.resume === undefined ? "cold" : "resumed",
        job_id: execution.resume?.job_id ?? null,
        saved_at: execution.resume?.saved_at ?? null,
        completed_phase: execution.resume?.completed_phase ?? null,
        completed_phase_index: execution.resume?.completed_phase_index ?? null,
        restored_stages: execution.resume === undefined ? [] : ["graph", "trajectories"],
        code: null,
        reason: execution.resume === undefined ? "Cold start." : "Resumed.",
      });
      const record = createStrategicFitJobRecorder({
        compatibility: strategicFitJobCompatibility(pgn, options),
        save: (checkpoint) => execution.onCheckpoint?.(checkpoint),
        now: () => "2026-07-31T09:45:00.000Z",
      });
      const result = analyzeStrategicFit(GameTree.fromPgn(pgn), {
        ...options,
        index: new StrategicFitIndexCache(),
        onCheckpoint: (stage) => {
          record(stage);
          if (behavior.fail === true) throw new Error("fixture interruption");
        },
      });
      return result;
    },
    4,
    port,
  );
  return { cache, calls, port };
}

test("a completed browser analysis leaves no checkpoint behind", async () => {
  const { records, persistence } = memoryPersistence();
  const { cache, calls, port } = checkpointingCache(persistence);

  const report = await cache.getReport(PGN, OPTIONS);
  await port.settled();

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.resume, undefined);
  assert.equal(cache.lastRecovery()?.state, "cold");
  assert.equal(records.size, 0, "the complete report replaces the job it came from");
  assert.ok(report.report_id.length > 0);
});

test("a reload resumes the interrupted job from its stored checkpoint", async () => {
  const { records, persistence } = memoryPersistence();
  const interrupted = checkpointingCache(persistence, { fail: true });
  await assert.rejects(interrupted.cache.getReport(PGN, OPTIONS), /fixture interruption/);
  await interrupted.port.settled();
  // A failure the host observes is a decision to stop, so it drops its own checkpoint.
  assert.equal(records.size, 0);

  // A reload is different: the job never settles, so the record written mid-run survives the page.
  records.set(STRATEGIC_FIT_CHECKPOINT_KEY, storedCheckpoint());
  const reloaded = checkpointingCache(persistence);
  const report = await reloaded.cache.getReport(PGN, OPTIONS);
  await reloaded.port.settled();

  assert.equal(reloaded.calls[0]?.resume?.completed_phase, "identifying-comparable-branches");
  assert.equal(reloaded.cache.lastRecovery()?.state, "resumed");
  assert.equal(reloaded.cache.lastRecovery()?.saved_at, "2026-07-31T09:30:00.000Z");
  assert.equal(records.size, 0, "the resumed job settles and stops being resumable");

  const cold = await checkpointingCache(memoryPersistence().persistence).cache.getReport(
    PGN,
    OPTIONS,
  );
  assert.equal(JSON.stringify(report), JSON.stringify(cold));
});

test("cancelling an analysis drops its checkpoint instead of silently restarting it", async () => {
  const { records, persistence } = memoryPersistence();
  const port = createStrategicFitCheckpointPort(persistence);
  const controller = new AbortController();
  const cache = new StrategicFitReportCache(
    async (pgn, options, execution = {}) => {
      const record = createStrategicFitJobRecorder({
        compatibility: strategicFitJobCompatibility(pgn, options),
        save: (checkpoint) => execution.onCheckpoint?.(checkpoint),
        now: () => "2026-07-31T09:50:00.000Z",
      });
      analyzeStrategicFit(GameTree.fromPgn(pgn), {
        ...options,
        index: new StrategicFitIndexCache(),
        onCheckpoint: (stage) => {
          record(stage);
          controller.abort();
        },
        shouldCancel: () => controller.signal.aborted,
      });
      throw new Error("unreachable: the fixture cancels before it completes");
    },
    4,
    port,
  );

  await assert.rejects(
    cache.getReport(PGN, OPTIONS, { signal: controller.signal }),
    (error: unknown) =>
      (error as { code?: string }).code === "strategic_fit_analysis_cancelled" ||
      (error as Error).name === "AbortError",
  );
  await port.settled();

  assert.equal(records.size, 0, "a cancelled job leaves nothing that could restart it");
  assert.match(port.lastDiscardReason() ?? "", /cancelled/);
});

test("a stored checkpoint for other settings never reaches the analyzer", async () => {
  const { records, persistence } = memoryPersistence([
    [
      STRATEGIC_FIT_CHECKPOINT_KEY,
      storedCheckpoint({ ...OPTIONS, repertoireRevision: "revision:previous" }),
    ],
  ]);
  const { cache, calls, port } = checkpointingCache(persistence);

  await cache.getReport(PGN, OPTIONS);
  await port.settled();

  assert.equal(
    calls[0]?.resume,
    undefined,
    "an incompatible checkpoint is not offered as a resume",
  );
  assert.equal(port.lastRejection()?.code, "strategic_fit_checkpoint_stale_revision");
  assert.equal(cache.lastRecovery()?.state, "cold");
  assert.equal(records.size, 0);
});
