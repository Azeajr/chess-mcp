import { createEffect, createSignal, untrack } from "solid-js";
import type { StrategicFitAnalysisResult } from "@chess-mcp/chess-tools";
import { executeDirectBrowserCommand } from "./commands";
import { actions, color, documentId, version } from "./game";
import {
  strategicFitProfile,
  strategicFitProfileIdentity,
} from "./strategic-fit-profile";
import { strategicFitAnalysisSettingsIdentity } from "./strategic-fit-resolutions";
import type { BrowserCommandExecutionOptions } from "../application/browser-commands/types";

export type StrategicFitLifecycleStatus =
  | "idle"
  | "running"
  | "provisional"
  | "completed"
  | "cancelled"
  | "failed"
  | "stale";

export interface StrategicFitRequestSnapshot {
  readonly document_id: string;
  readonly repertoire_revision: number;
  readonly repertoire_pgn: string;
  readonly repertoire_color: "white" | "black";
  readonly profile_identity: string;
  readonly settings_identity: string;
}

export interface StrategicFitLifecycleProgress {
  readonly done: number;
  readonly total?: number;
  /** Retained for Task 5.4's detailed phase UI; Task 5.3 presents only generic progress. */
  readonly detail?: string;
}

export interface StrategicFitLifecycleError {
  readonly code: string;
  readonly message: string;
}

export interface StrategicFitCompletedResult {
  readonly request_id: string;
  readonly report_id: string;
  readonly request_snapshot: StrategicFitRequestSnapshot;
  readonly result: StrategicFitAnalysisResult;
  readonly completed_at: string;
}

export interface StrategicFitLifecycleSnapshot {
  readonly status: StrategicFitLifecycleStatus;
  readonly request_id: string | null;
  readonly request_snapshot: StrategicFitRequestSnapshot | null;
  readonly progress: StrategicFitLifecycleProgress | null;
  readonly error: StrategicFitLifecycleError | null;
  readonly stale_reason: string | null;
  readonly current_result: StrategicFitCompletedResult | null;
  readonly last_completed: StrategicFitCompletedResult | null;
}

export interface StrategicFitLifecycleBoundary {
  currentSnapshot(): StrategicFitRequestSnapshot;
  execute(
    command: "analyze_repertoire_congruence",
    args: Record<string, unknown>,
    options: BrowserCommandExecutionOptions,
  ): Promise<unknown>;
  now(): string;
}

export interface StrategicFitLifecycleState {
  snapshot(): StrategicFitLifecycleSnapshot;
  analyze(): Promise<void>;
  cancel(): void;
  retry(): Promise<void>;
  synchronize(current?: StrategicFitRequestSnapshot): void;
}

interface ActiveRequest {
  readonly id: string;
  readonly controller: AbortController;
  readonly snapshot: StrategicFitRequestSnapshot;
}

const initialSnapshot = (): StrategicFitLifecycleSnapshot => ({
  status: "idle",
  request_id: null,
  request_snapshot: null,
  progress: null,
  error: null,
  stale_reason: null,
  current_result: null,
  last_completed: null,
});

function sameSnapshot(left: StrategicFitRequestSnapshot, right: StrategicFitRequestSnapshot): boolean {
  return left.document_id === right.document_id
    && left.repertoire_revision === right.repertoire_revision
    && left.repertoire_pgn === right.repertoire_pgn
    && left.repertoire_color === right.repertoire_color
    && left.profile_identity === right.profile_identity
    && left.settings_identity === right.settings_identity;
}

function staleReason(
  previous: StrategicFitRequestSnapshot,
  current: StrategicFitRequestSnapshot,
): string {
  if (
    previous.document_id !== current.document_id ||
    previous.repertoire_revision !== current.repertoire_revision ||
    previous.repertoire_pgn !== current.repertoire_pgn ||
    previous.repertoire_color !== current.repertoire_color
  ) return "The repertoire document, content, revision, or analysis color changed.";
  if (previous.profile_identity !== current.profile_identity) {
    return "The Strategic Fit profile changed.";
  }
  return "Strategic Fit resolutions or analysis overrides changed.";
}

function commandError(value: unknown): StrategicFitLifecycleError | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { error?: unknown; reason?: unknown };
  if (typeof candidate.error !== "string") return null;
  return {
    code: candidate.error,
    message: typeof candidate.reason === "string" ? candidate.reason : candidate.error,
  };
}

function thrownError(value: unknown): StrategicFitLifecycleError {
  if (typeof value === "object" && value !== null) {
    const candidate = value as { code?: unknown; message?: unknown; name?: unknown };
    return {
      code: typeof candidate.code === "string"
        ? candidate.code
        : typeof candidate.name === "string"
          ? candidate.name
          : "strategic_fit_analysis_failed",
      message: typeof candidate.message === "string"
        ? candidate.message
        : "Strategic Fit analysis failed.",
    };
  }
  return { code: "strategic_fit_analysis_failed", message: String(value) };
}

function isAbortError(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "AbortError";
}

function analysisResult(value: unknown): StrategicFitAnalysisResult | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<StrategicFitAnalysisResult>;
  return typeof candidate.report_id === "string" && candidate.report_id.length > 0 &&
    typeof candidate.repertoire_revision === "string"
    ? candidate as StrategicFitAnalysisResult
    : null;
}

/**
 * Lifecycle orchestration only. The injected command remains responsible for opening data,
 * profile/settings injection, Worker/cache use, projection, and its own final stale-result guard.
 */
export function createStrategicFitLifecycleState(
  boundary: StrategicFitLifecycleBoundary,
): StrategicFitLifecycleState {
  const [state, setState] = createSignal<StrategicFitLifecycleSnapshot>(initialSnapshot());
  let requestSequence = 0;
  let active: ActiveRequest | null = null;

  const finishAsStale = (request: ActiveRequest, current: StrategicFitRequestSnapshot) => {
    if (active === request) active = null;
    request.controller.abort();
    setState((previous) => ({
      ...previous,
      status: "stale",
      request_id: request.id,
      request_snapshot: request.snapshot,
      progress: null,
      error: null,
      stale_reason: staleReason(request.snapshot, current),
      current_result: null,
    }));
  };

  const analyze = async () => {
    const previousActive = active;
    if (previousActive) {
      active = null;
      previousActive.controller.abort();
    }

    const request: ActiveRequest = {
      id: `strategic-fit-lifecycle:${++requestSequence}`,
      controller: new AbortController(),
      snapshot: boundary.currentSnapshot(),
    };
    active = request;
    setState((previous) => ({
      status: "running",
      request_id: request.id,
      request_snapshot: request.snapshot,
      progress: null,
      error: null,
      stale_reason: null,
      current_result: null,
      last_completed: previous.last_completed,
    }));

    try {
      const value = await boundary.execute("analyze_repertoire_congruence", {}, {
        signal: request.controller.signal,
        onProgress: (done, total, detail) => {
          if (active !== request || request.controller.signal.aborted) return;
          setState((previous) => {
            if (previous.request_id !== request.id ||
              (previous.status !== "running" && previous.status !== "provisional")) return previous;
            const boundedTotal = typeof total === "number" && Number.isFinite(total) && total > 0
              ? Math.max(1, Math.floor(total))
              : undefined;
            const boundedDone = Math.max(0, Math.floor(Number.isFinite(done) ? done : 0));
            const nextDone = Math.max(previous.progress?.done ?? 0, boundedDone);
            const nextTotal = boundedTotal ?? previous.progress?.total;
            return {
              ...previous,
              status: "provisional",
              progress: {
                done: nextTotal === undefined ? nextDone : Math.min(nextDone, nextTotal),
                ...(nextTotal === undefined ? {} : { total: nextTotal }),
                ...(typeof detail === "string" && detail.length > 0
                  ? { detail }
                  : previous.progress?.detail === undefined
                    ? {}
                    : { detail: previous.progress.detail }),
              },
            };
          });
        },
      });

      if (active !== request || request.controller.signal.aborted) return;
      const current = boundary.currentSnapshot();
      if (!sameSnapshot(request.snapshot, current)) {
        finishAsStale(request, current);
        return;
      }

      const error = commandError(value);
      if (error) {
        active = null;
        setState((previous) => ({
          ...previous,
          status: error.code === "strategic_fit_stale_report" ? "stale" : "failed",
          progress: null,
          error: error.code === "strategic_fit_stale_report" ? null : error,
          stale_reason: error.code === "strategic_fit_stale_report" ? error.message : null,
          current_result: null,
        }));
        return;
      }

      const result = analysisResult(value);
      if (!result) {
        active = null;
        setState((previous) => ({
          ...previous,
          status: "failed",
          progress: null,
          error: {
            code: "strategic_fit_invalid_result",
            message: "Strategic Fit returned an invalid analysis result.",
          },
          stale_reason: null,
          current_result: null,
        }));
        return;
      }

      active = null;
      const completed: StrategicFitCompletedResult = {
        request_id: request.id,
        report_id: result.report_id,
        request_snapshot: request.snapshot,
        result,
        completed_at: boundary.now(),
      };
      setState({
        status: "completed",
        request_id: request.id,
        request_snapshot: request.snapshot,
        progress: null,
        error: null,
        stale_reason: null,
        current_result: completed,
        last_completed: completed,
      });
    } catch (error) {
      if (active !== request) return;
      active = null;
      if (request.controller.signal.aborted || isAbortError(error)) {
        setState((previous) => ({
          ...previous,
          status: "cancelled",
          progress: null,
          error: null,
          stale_reason: null,
          current_result: null,
        }));
        return;
      }
      setState((previous) => ({
        ...previous,
        status: "failed",
        progress: null,
        error: thrownError(error),
        stale_reason: null,
        current_result: null,
      }));
    }
  };

  return {
    snapshot: state,
    analyze,
    cancel() {
      const request = active;
      if (!request) return;
      active = null;
      request.controller.abort();
      setState((previous) => ({
        ...previous,
        status: "cancelled",
        progress: null,
        error: null,
        stale_reason: null,
        current_result: null,
      }));
    },
    retry: analyze,
    synchronize(suppliedCurrent) {
      const current = suppliedCurrent ?? boundary.currentSnapshot();
      if (active && !sameSnapshot(active.snapshot, current)) {
        finishAsStale(active, current);
        return;
      }
      const completed = state().current_result;
      if (completed && !sameSnapshot(completed.request_snapshot, current)) {
        setState((previous) => ({
          ...previous,
          status: "stale",
          progress: null,
          error: null,
          stale_reason: staleReason(completed.request_snapshot, current),
          current_result: null,
        }));
      }
    },
  };
}

function currentBrowserSnapshot(): StrategicFitRequestSnapshot {
  const repertoireRevision = version();
  const repertoirePgn = actions.toPgn();
  return {
    document_id: documentId(),
    repertoire_revision: repertoireRevision,
    repertoire_pgn: repertoirePgn,
    repertoire_color: color(),
    profile_identity: strategicFitProfileIdentity(strategicFitProfile()),
    settings_identity: strategicFitAnalysisSettingsIdentity(),
  };
}

const browserLifecycle = createStrategicFitLifecycleState({
  currentSnapshot: currentBrowserSnapshot,
  execute: (command, args, options) => executeDirectBrowserCommand(command, args, options),
  now: () => new Date().toISOString(),
});
let lifecycleWatcherStarted = false;

/** Install the current-document/settings watcher once from the App component's reactive owner. */
export function startStrategicFitLifecycle(): void {
  if (lifecycleWatcherStarted) return;
  lifecycleWatcherStarted = true;
  createEffect(() => {
    const current = currentBrowserSnapshot();
    // Lifecycle state/progress writes must not retrigger graph/settings identity construction.
    untrack(() => browserLifecycle.synchronize(current));
  });
}

export const strategicFitLifecycle = () => browserLifecycle.snapshot();
export const analyzeStrategicFit = () => browserLifecycle.analyze();
export const cancelStrategicFitAnalysis = () => browserLifecycle.cancel();
export const retryStrategicFitAnalysis = () => browserLifecycle.retry();
