import {
  GameTree,
  StrategicFitAnalysisCancelledError,
  StrategicFitIndexCache,
  analyzeStrategicFit,
  createStrategicFitJobRecorder,
  restoreStrategicFitJobCheckpoint,
  strategicFitColdJobRecovery,
  strategicFitJobCompatibility,
  type AnalyzeStrategicFitOptions,
} from "@chess-mcp/chess-tools";
import type {
  StrategicFitWorkerAnalyzeRequest,
  StrategicFitWorkerErrorData,
  StrategicFitWorkerPayload,
  StrategicFitWorkerRequest,
  StrategicFitWorkerResponse,
} from "../application/strategic-fit-worker";

type PostResponse = (response: StrategicFitWorkerResponse) => void;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function isOpeningEntry(value: unknown): value is { eco: string; name: string } {
  return isObject(value) && typeof value.eco === "string" && typeof value.name === "string";
}

function isPayload(value: unknown): value is StrategicFitWorkerPayload {
  if (!isObject(value)) return false;
  if (typeof value.pgn !== "string") return false;
  if (
    value.repertoire_color !== "white" &&
    value.repertoire_color !== "black" &&
    value.repertoire_color !== null
  ) {
    return false;
  }
  if (
    !Array.isArray(value.opening_table_entries) ||
    !value.opening_table_entries.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        isOpeningEntry(entry[1]),
    )
  )
    return false;
  if (!isObject(value.options) || !isObject(value.metadata)) return false;
  if (value.resume !== undefined && value.resume !== null && !isObject(value.resume)) return false;
  return (
    typeof value.metadata.repertoire_revision === "string" &&
    value.metadata.repertoire_revision.length > 0 &&
    (value.metadata.generated_at === undefined ||
      typeof value.metadata.generated_at === "string") &&
    (value.metadata.run_id === undefined || typeof value.metadata.run_id === "string")
  );
}

function structuredError(error: unknown, fallbackCode: string): StrategicFitWorkerErrorData {
  if (error instanceof StrategicFitAnalysisCancelledError) {
    return {
      code: error.code,
      name: error.name,
      message: error.message,
      details: {
        run_id: error.run_id,
        phase: error.phase,
        phase_index: error.phase_index,
      },
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  const explicitCode = /^(strategic_fit_[a-z0-9_]+)/.exec(message)?.[1];
  return {
    code: explicitCode ?? fallbackCode,
    name: error instanceof Error ? error.name : "StrategicFitWorkerError",
    message,
    details: null,
  };
}

function analyzerOptions(
  request: StrategicFitWorkerAnalyzeRequest,
  shouldCancel: () => boolean,
  post: PostResponse,
  index: StrategicFitIndexCache,
): AnalyzeStrategicFitOptions {
  const { payload, request_id: requestId } = request;
  return {
    ...payload.options,
    index,
    repertoireColor: payload.repertoire_color,
    repertoireRevision: payload.metadata.repertoire_revision,
    openingTable: new Map(payload.opening_table_entries),
    ...(payload.metadata.generated_at === undefined
      ? {}
      : { generatedAt: payload.metadata.generated_at }),
    ...(payload.metadata.run_id === undefined ? {} : { runId: payload.metadata.run_id }),
    shouldCancel,
    onProgress: (progress) => {
      post({ type: "progress", request_id: requestId, progress });
    },
  };
}

function recoverJob(
  request: StrategicFitWorkerAnalyzeRequest,
  compatibility: ReturnType<typeof strategicFitJobCompatibility>,
  index: StrategicFitIndexCache,
  post: PostResponse,
): void {
  const { payload, request_id: requestId } = request;
  const recovery =
    payload.resume === undefined
      ? strategicFitColdJobRecovery(
          "No checkpoint was supplied, so the analysis ran from a cold start.",
        )
      : restoreStrategicFitJobCheckpoint(index, payload.resume, compatibility);
  post({ type: "recovery", request_id: requestId, recovery });
}

export function createStrategicFitWorkerHandler(post: PostResponse) {
  const cancelled = new Set<string>();
  const index = new StrategicFitIndexCache();

  return (message: unknown): void => {
    if (
      !isObject(message) ||
      typeof message.type !== "string" ||
      typeof message.request_id !== "string"
    ) {
      post({
        type: "error",
        request_id:
          isObject(message) && typeof message.request_id === "string"
            ? message.request_id
            : "unknown",
        error: {
          code: "strategic_fit_worker_invalid_payload",
          name: "StrategicFitWorkerPayloadError",
          message: "The Strategic Fit worker request is malformed.",
          details: null,
        },
      });
      return;
    }
    const request = message as unknown as StrategicFitWorkerRequest;
    if (request.type === "cancel") {
      cancelled.add(request.request_id);
      return;
    }
    if (!isPayload(request.payload)) {
      post({
        type: "error",
        request_id: request.request_id,
        error: {
          code: "strategic_fit_worker_invalid_payload",
          name: "StrategicFitWorkerPayloadError",
          message: "The Strategic Fit worker request is malformed.",
          details: null,
        },
      });
      return;
    }

    try {
      if (cancelled.has(request.request_id)) return;
      let tree: GameTree;
      try {
        tree = GameTree.fromPgn(request.payload.pgn);
      } catch (error) {
        throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), {
          strategicFitWorkerCode: "strategic_fit_worker_invalid_pgn",
        });
      }
      const isCancelled = () => cancelled.has(request.request_id);
      const options = analyzerOptions(request, isCancelled, post, index);
      const compatibility = strategicFitJobCompatibility(request.payload.pgn, options);
      recoverJob(request, compatibility, index, post);
      const record = createStrategicFitJobRecorder({
        compatibility,
        save: (checkpoint) => {
          if (isCancelled()) return;
          post({ type: "checkpoint", request_id: request.request_id, checkpoint });
        },
      });
      const result = analyzeStrategicFit(tree, { ...options, onCheckpoint: record });
      if (!cancelled.has(request.request_id)) {
        post({ type: "result", request_id: request.request_id, result });
      }
    } catch (error) {
      if (cancelled.has(request.request_id)) return;
      const workerCode =
        isObject(error) && typeof error.strategicFitWorkerCode === "string"
          ? error.strategicFitWorkerCode
          : "strategic_fit_worker_analysis_failed";
      post({
        type: "error",
        request_id: request.request_id,
        error: structuredError(error, workerCode),
      });
    } finally {
      cancelled.delete(request.request_id);
    }
  };
}

interface WorkerScopeLike {
  readonly document?: unknown;
  postMessage(message: StrategicFitWorkerResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
}

const scope = globalThis as unknown as Partial<WorkerScopeLike>;
if (
  scope.document === undefined &&
  typeof scope.postMessage === "function" &&
  typeof scope.addEventListener === "function"
) {
  const handle = createStrategicFitWorkerHandler((response) => {
    if (scope.postMessage) scope.postMessage(response);
  });
  scope.addEventListener("message", (event) => {
    handle(event.data);
  });
}
