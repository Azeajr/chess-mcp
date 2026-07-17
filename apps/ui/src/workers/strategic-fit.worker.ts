import {
  GameTree,
  StrategicFitAnalysisCancelledError,
  analyzeStrategicFit,
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
  if (value.repertoire_color !== "white" && value.repertoire_color !== "black" && value.repertoire_color !== null) {
    return false;
  }
  if (!Array.isArray(value.opening_table_entries) || !value.opening_table_entries.every((entry) =>
    Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && isOpeningEntry(entry[1])
  )) return false;
  if (!isObject(value.options) || !isObject(value.metadata)) return false;
  return typeof value.metadata.repertoire_revision === "string" && value.metadata.repertoire_revision.length > 0 &&
    (value.metadata.generated_at === undefined || typeof value.metadata.generated_at === "string") &&
    (value.metadata.run_id === undefined || typeof value.metadata.run_id === "string");
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
): AnalyzeStrategicFitOptions {
  const { payload, request_id: requestId } = request;
  return {
    ...payload.options,
    repertoireColor: payload.repertoire_color,
    repertoireRevision: payload.metadata.repertoire_revision,
    openingTable: new Map(payload.opening_table_entries),
    ...(payload.metadata.generated_at === undefined ? {} : { generatedAt: payload.metadata.generated_at }),
    ...(payload.metadata.run_id === undefined ? {} : { runId: payload.metadata.run_id }),
    shouldCancel,
    onProgress: (progress) => post({ type: "progress", request_id: requestId, progress }),
  };
}

/** Pure message dispatcher exported so the worker protocol can be exercised without browser globals. */
export function createStrategicFitWorkerHandler(post: PostResponse) {
  const cancelled = new Set<string>();

  return (message: unknown): void => {
    if (!isObject(message) || typeof message.type !== "string" || typeof message.request_id !== "string") {
      post({
        type: "error",
        request_id: isObject(message) && typeof message.request_id === "string" ? message.request_id : "unknown",
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
    if (request.type !== "analyze" || !isPayload(request.payload)) {
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
      const result = analyzeStrategicFit(
        tree,
        analyzerOptions(request, () => cancelled.has(request.request_id), post),
      );
      if (!cancelled.has(request.request_id)) {
        post({ type: "result", request_id: request.request_id, result });
      }
    } catch (error) {
      if (cancelled.has(request.request_id)) return;
      const workerCode = isObject(error) && typeof error.strategicFitWorkerCode === "string"
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
if (scope.document === undefined && typeof scope.postMessage === "function" && typeof scope.addEventListener === "function") {
  const handle = createStrategicFitWorkerHandler((response) => scope.postMessage!(response));
  scope.addEventListener("message", (event) => handle(event.data));
}
