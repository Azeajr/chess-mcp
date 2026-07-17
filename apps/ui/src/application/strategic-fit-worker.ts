import type {
  AnalyzeStrategicFitOptions,
  OpeningEntry,
  StrategicFitAnalysisResult,
  StrategicFitProgress,
} from "@chess-mcp/chess-tools";

export type StrategicFitSerializableOptions = Omit<
  AnalyzeStrategicFitOptions,
  | "repertoireColor"
  | "repertoireRevision"
  | "openingTable"
  | "generatedAt"
  | "runId"
  | "shouldCancel"
  | "onProgress"
>;

export interface StrategicFitWorkerMetadata {
  readonly repertoire_revision: string;
  readonly generated_at?: string;
  readonly run_id?: string;
}

export interface StrategicFitWorkerPayload {
  readonly pgn: string;
  readonly repertoire_color: AnalyzeStrategicFitOptions["repertoireColor"];
  readonly opening_table_entries: readonly (readonly [string, OpeningEntry])[];
  readonly options: StrategicFitSerializableOptions;
  readonly metadata: StrategicFitWorkerMetadata;
}

export interface StrategicFitWorkerAnalyzeRequest {
  readonly type: "analyze";
  readonly request_id: string;
  readonly payload: StrategicFitWorkerPayload;
}

export interface StrategicFitWorkerCancelRequest {
  readonly type: "cancel";
  readonly request_id: string;
}

export type StrategicFitWorkerRequest =
  | StrategicFitWorkerAnalyzeRequest
  | StrategicFitWorkerCancelRequest;

export interface StrategicFitWorkerErrorData {
  readonly code: string;
  readonly name: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>> | null;
}

export type StrategicFitWorkerResponse =
  | {
    readonly type: "progress";
    readonly request_id: string;
    readonly progress: StrategicFitProgress;
  }
  | {
    readonly type: "result";
    readonly request_id: string;
    readonly result: StrategicFitAnalysisResult;
  }
  | {
    readonly type: "error";
    readonly request_id: string;
    readonly error: StrategicFitWorkerErrorData;
  };

export interface StrategicFitWorkerExecutionOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: StrategicFitProgress) => void;
}

export interface StrategicFitWorkerLike {
  onmessage: ((event: MessageEvent<StrategicFitWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: StrategicFitWorkerRequest): void;
  terminate(): void;
}

export type StrategicFitWorkerFactory = () => StrategicFitWorkerLike;

interface ActiveAnalysis {
  readonly requestId: string;
  readonly worker: StrategicFitWorkerLike;
  readonly reject: (reason: unknown) => void;
  readonly cleanupSignal: () => void;
  settled: boolean;
}

let nextClientId = 0;

const abortError = (message = "Strategic Fit analysis cancelled") =>
  new DOMException(message, "AbortError");

function defaultWorkerFactory(): StrategicFitWorkerLike {
  return new Worker(
    new URL("../workers/strategic-fit.worker.ts", import.meta.url),
    { type: "module", name: "strategic-fit" },
  );
}

function requestPayload(
  pgn: string,
  options: AnalyzeStrategicFitOptions,
): StrategicFitWorkerPayload {
  const {
    repertoireColor,
    repertoireRevision,
    openingTable,
    generatedAt,
    runId,
    shouldCancel: _shouldCancel,
    onProgress: _onProgress,
    ...serializableOptions
  } = options;

  const openingTableEntries = [...(openingTable ?? new Map()).entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, entry]) => [key, { eco: entry.eco, name: entry.name }] as const);

  return {
    pgn,
    repertoire_color: repertoireColor,
    opening_table_entries: openingTableEntries,
    options: serializableOptions,
    metadata: {
      repertoire_revision: repertoireRevision,
      ...(generatedAt === undefined ? {} : { generated_at: generatedAt }),
      ...(runId === undefined ? {} : { run_id: runId }),
    },
  };
}

export class StrategicFitWorkerError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>> | null;

  constructor(error: StrategicFitWorkerErrorData) {
    super(error.message);
    this.name = error.name;
    this.code = error.code;
    this.details = error.details;
  }
}

/**
 * Latest-request-wins client for the dedicated Strategic Fit worker.
 *
 * The synchronous deterministic core cannot observe a newly delivered worker message while it is
 * calculating. Cancellation therefore terminates the active worker as well as invalidating the
 * request ID. A late event from a test double or already-queued browser task is ignored.
 */
export class StrategicFitWorkerClient {
  private readonly factory: StrategicFitWorkerFactory;
  private readonly clientId: number;
  private requestSequence = 0;
  private active: ActiveAnalysis | null = null;

  constructor(factory: StrategicFitWorkerFactory = defaultWorkerFactory) {
    this.factory = factory;
    this.clientId = ++nextClientId;
  }

  analyze(
    pgn: string,
    options: AnalyzeStrategicFitOptions,
    execution: StrategicFitWorkerExecutionOptions = {},
  ): Promise<StrategicFitAnalysisResult> {
    if (execution.signal?.aborted) return Promise.reject(abortError());
    this.cancelActive("Strategic Fit analysis superseded by a newer request");

    const requestId = `strategic-fit-worker:${this.clientId}:${++this.requestSequence}`;
    let worker: StrategicFitWorkerLike;
    try {
      worker = this.factory();
    } catch (error) {
      return Promise.reject(new StrategicFitWorkerError({
        code: "strategic_fit_worker_unavailable",
        name: "StrategicFitWorkerError",
        message: error instanceof Error ? error.message : "The Strategic Fit worker is unavailable.",
        details: null,
      }));
    }

    return new Promise<StrategicFitAnalysisResult>((resolve, reject) => {
      const abort = () => {
        if (this.active?.requestId !== requestId) return;
        this.cancelActive();
      };
      const cleanupSignal = () => execution.signal?.removeEventListener("abort", abort);
      const active: ActiveAnalysis = {
        requestId,
        worker,
        reject,
        cleanupSignal,
        settled: false,
      };
      this.active = active;
      execution.signal?.addEventListener("abort", abort, { once: true });
      if (execution.signal?.aborted) {
        this.cancelActive();
        return;
      }

      worker.onmessage = (event) => {
        if (this.active !== active || active.settled) return;
        const response = event.data;
        if (response.request_id !== requestId) return;
        if (response.type === "progress") {
          execution.onProgress?.(response.progress);
          return;
        }
        this.finish(active);
        if (response.type === "result") resolve(response.result);
        else reject(new StrategicFitWorkerError(response.error));
      };
      worker.onerror = (event) => {
        if (this.active !== active || active.settled) return;
        this.finish(active);
        reject(new StrategicFitWorkerError({
          code: "strategic_fit_worker_runtime_error",
          name: "StrategicFitWorkerError",
          message: event.message || "The Strategic Fit worker failed.",
          details: {
            filename: event.filename || null,
            lineno: event.lineno || null,
            colno: event.colno || null,
          },
        }));
      };

      try {
        worker.postMessage({
          type: "analyze",
          request_id: requestId,
          payload: requestPayload(pgn, options),
        });
      } catch (error) {
        this.finish(active);
        reject(new StrategicFitWorkerError({
          code: "strategic_fit_worker_serialization_failed",
          name: "StrategicFitWorkerError",
          message: error instanceof Error ? error.message : "The Strategic Fit request could not be serialized.",
          details: null,
        }));
      }
    });
  }

  cancel(): void {
    this.cancelActive();
  }

  dispose(): void {
    this.cancelActive("Strategic Fit worker disposed");
  }

  private finish(active: ActiveAnalysis): void {
    if (active.settled) return;
    active.settled = true;
    active.cleanupSignal();
    active.worker.onmessage = null;
    active.worker.onerror = null;
    active.worker.terminate();
    if (this.active === active) this.active = null;
  }

  private cancelActive(message?: string): void {
    const active = this.active;
    if (!active || active.settled) return;
    try {
      active.worker.postMessage({ type: "cancel", request_id: active.requestId });
    } finally {
      this.finish(active);
      active.reject(abortError(message));
    }
  }
}

const defaultClient = new StrategicFitWorkerClient();

export const analyzeStrategicFitInWorker = (
  pgn: string,
  options: AnalyzeStrategicFitOptions,
  execution?: StrategicFitWorkerExecutionOptions,
) => defaultClient.analyze(pgn, options, execution);
