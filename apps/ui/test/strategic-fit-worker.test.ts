import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_FIT_PROGRESS_PHASES,
  analyzeStrategicFit,
  type AnalyzeStrategicFitOptions,
  type StrategicFitAnalysisResult,
} from "@chess-mcp/chess-tools";
import {
  StrategicFitWorkerClient,
  type StrategicFitWorkerLike,
  type StrategicFitWorkerRequest,
  type StrategicFitWorkerResponse,
} from "../src/application/strategic-fit-worker.ts";
import { createStrategicFitWorkerHandler } from "../src/workers/strategic-fit.worker.ts";

const PGN = `
[Event "Strategic Fit worker fixture"]

1. e4 (1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bf4 O-O 6. e3) e5
2. Nf3 (2. Nc3 Nf6 3. f4 d5 4. exd5 Nxd5 5. Nf3) Nc6 3. Bb5 a6 4. Ba4 Nf6
5. O-O Be7 6. Re1 *
`;

const OPTIONS: AnalyzeStrategicFitOptions = {
  repertoireColor: "white",
  repertoireRevision: "revision:worker-fixture",
  generatedAt: "2026-07-17T12:00:00.000Z",
  runId: "run:worker-fixture",
  openingTable: new Map([
    ["z-position", { eco: "Z99", name: "Last" }],
    ["a-position", { eco: "A00", name: "First" }],
  ]),
};

function analyzeThroughHandler() {
  const responses: StrategicFitWorkerResponse[] = [];
  const handle = createStrategicFitWorkerHandler((response) => responses.push(response));
  handle({
    type: "analyze",
    request_id: "request:parity",
    payload: {
      pgn: PGN,
      repertoire_color: OPTIONS.repertoireColor,
      opening_table_entries: [...OPTIONS.openingTable!.entries()],
      options: {},
      metadata: {
        repertoire_revision: OPTIONS.repertoireRevision,
        generated_at: OPTIONS.generatedAt,
        run_id: OPTIONS.runId,
      },
    },
  });
  return responses;
}

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

test("worker reconstruction is byte-equivalent to direct deterministic core analysis", () => {
  const responses = analyzeThroughHandler();
  const result = responses.find((response) => response.type === "result");
  assert.ok(result && result.type === "result");

  const direct = analyzeStrategicFit(GameTree.fromPgn(PGN), OPTIONS);
  assert.equal(JSON.stringify(result.result), JSON.stringify(direct));
});

test("worker forwards the six core progress phases in frozen order", () => {
  const progress = analyzeThroughHandler()
    .filter((response) => response.type === "progress")
    .map((response) => response.progress);

  assert.deepEqual(
    progress.filter((event) => event.state === "running").map((event) => event.phase),
    STRATEGIC_FIT_PROGRESS_PHASES,
  );
  assert.deepEqual(
    progress.filter((event) => event.state === "completed").map((event) => event.phase),
    STRATEGIC_FIT_PROGRESS_PHASES,
  );
  assert.ok(progress.slice(0, -1).every((event) => event.provisional_findings));
  assert.equal(progress.at(-1)?.provisional_findings, false);
});

test("typed client serializes clone-safe inputs and waits for its worker result", async () => {
  const worker = new FakeWorker();
  const client = new StrategicFitWorkerClient(() => worker);
  const pending = client.analyze(PGN, OPTIONS);

  assert.equal(worker.posted.length, 1);
  const request = worker.posted[0]!;
  assert.equal(request.type, "analyze");
  if (request.type !== "analyze") return;
  assert.equal(request.payload.pgn, PGN);
  assert.equal(request.payload.repertoire_color, "white");
  assert.deepEqual(request.payload.opening_table_entries.map(([key]) => key), ["a-position", "z-position"]);
  assert.deepEqual(request.payload.metadata, {
    repertoire_revision: "revision:worker-fixture",
    generated_at: "2026-07-17T12:00:00.000Z",
    run_id: "run:worker-fixture",
  });
  assert.equal("shouldCancel" in request.payload.options, false);
  assert.equal("onProgress" in request.payload.options, false);

  let settled = false;
  void pending.finally(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false, "the client does not run the analyzer on the caller's thread");

  const report = analyzeStrategicFit(GameTree.fromPgn(PGN), OPTIONS);
  worker.emit({ type: "result", request_id: request.request_id, result: report });
  assert.deepEqual(await pending, report);
  assert.equal(worker.terminated, true);
});

test("abort terminates active computation and discards late results", async () => {
  const worker = new FakeWorker();
  const client = new StrategicFitWorkerClient(() => worker);
  const controller = new AbortController();
  let progressEvents = 0;
  const pending = client.analyze(PGN, OPTIONS, {
    signal: controller.signal,
    onProgress: () => { progressEvents++; },
  });
  const request = worker.posted[0]!;
  assert.equal(request.type, "analyze");

  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(worker.terminated, true);
  assert.deepEqual(worker.posted.at(-1), { type: "cancel", request_id: request.request_id });

  worker.emit({
    type: "progress",
    request_id: request.request_id,
    progress: analyzeThroughHandler().find((response) => response.type === "progress")!.progress,
  });
  assert.equal(progressEvents, 0, "queued messages after abort are ignored");
});

test("a newer analysis rejects the stale request and ignores its late result", async () => {
  const workers: FakeWorker[] = [];
  const client = new StrategicFitWorkerClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  const first = client.analyze(PGN, { ...OPTIONS, repertoireRevision: "revision:stale" });
  const firstRejected = assert.rejects(first, { name: "AbortError" });
  const second = client.analyze(PGN, { ...OPTIONS, repertoireRevision: "revision:current" });
  await firstRejected;

  const staleRequest = workers[0]!.posted[0]!;
  const currentRequest = workers[1]!.posted[0]!;
  assert.equal(staleRequest.type, "analyze");
  assert.equal(currentRequest.type, "analyze");
  const staleReport = analyzeStrategicFit(GameTree.fromPgn(PGN), {
    ...OPTIONS,
    repertoireRevision: "revision:stale",
  });
  workers[0]!.emit({ type: "result", request_id: staleRequest.request_id, result: staleReport });

  const currentReport = analyzeStrategicFit(GameTree.fromPgn(PGN), {
    ...OPTIONS,
    repertoireRevision: "revision:current",
  });
  workers[1]!.emit({ type: "result", request_id: currentRequest.request_id, result: currentReport });
  assert.equal((await second).repertoire_revision, "revision:current");
});

test("malformed payloads and invalid PGNs return structured errors", () => {
  const responses: StrategicFitWorkerResponse[] = [];
  const handle = createStrategicFitWorkerHandler((response) => responses.push(response));
  handle({ type: "analyze", request_id: "request:bad-payload", payload: { pgn: 42 } });
  handle({
    type: "analyze",
    request_id: "request:bad-pgn",
    payload: {
      pgn: "1. e4 e4 *",
      repertoire_color: "white",
      opening_table_entries: [],
      options: {},
      metadata: { repertoire_revision: "revision:bad" },
    },
  });

  const errors = responses.filter((response) => response.type === "error").map((response) => response.error);
  assert.equal(errors[0]?.code, "strategic_fit_worker_invalid_payload");
  assert.equal(errors[0]?.name, "StrategicFitWorkerPayloadError");
  assert.equal(errors[1]?.code, "strategic_fit_worker_invalid_pgn");
  assert.equal(errors[1]?.details, null);
});

test("client surfaces worker errors with stable code and details", async () => {
  const worker = new FakeWorker();
  const client = new StrategicFitWorkerClient(() => worker);
  const pending = client.analyze(PGN, OPTIONS);
  const request = worker.posted[0]!;
  worker.emit({
    type: "error",
    request_id: request.request_id,
    error: {
      code: "strategic_fit_worker_invalid_payload",
      name: "StrategicFitWorkerPayloadError",
      message: "Malformed",
      details: { field: "pgn" },
    },
  });

  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as Error & { code: string }).code, "strategic_fit_worker_invalid_payload");
    assert.deepEqual((error as Error & { details: unknown }).details, { field: "pgn" });
    return true;
  });
});
