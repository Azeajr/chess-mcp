import { createSignal } from "solid-js";
import {
  type ReplacementCandidateSourceKind,
  type ReplacementPivotSelectionResult,
  type StrategicFinding,
} from "@chess-mcp/chess-tools";
import {
  REPLACEMENT_LAB_SUPPORTED_SOURCES,
  prepareReplacementLab,
  replacementLabActionability,
  runReplacementLabGeneration,
  type ReplacementLabActionability,
  type ReplacementLabApplicationBoundary,
  type ReplacementLabContext,
  type ReplacementLabControls,
  type ReplacementLabGenerationResult,
  type ReplacementLabPreparedContext,
  type ReplacementLabProgress,
} from "../application/strategic-fit-replacement";
import { defaultBrowserCommandDependencies } from "../application/browser-commands/default-context";
import { analysisDepth } from "./engine-settings";
import { rejectStrategicFitChangeSet } from "./strategic-fit-changes";
import {
  displayStrategicFitFindingResolution,
  type StrategicFitDisplayedResolutionState,
} from "./strategic-fit-finding-resolutions";
import {
  strategicFitCurrentSnapshot,
  strategicFitLifecycle,
  type StrategicFitCompletedResult,
} from "./strategic-fit";

export type ReplacementLabLifecycleStatus =
  | "closed"
  | "non-actionable"
  | "pivot-required"
  | "pivot-ready"
  | "ready"
  | "running"
  | "complete"
  | "partial"
  | "cancelled"
  | "failed"
  | "stale";

export interface ReplacementLabError {
  readonly code: string;
  readonly message: string;
}

export interface ReplacementLabIdentity {
  readonly document_id: string;
  readonly repertoire_revision: number;
  readonly repertoire_pgn: string;
  readonly repertoire_color: "white" | "black";
  readonly profile_identity: string;
  readonly settings_identity: string;
  readonly request_id: string;
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly cohort_id: string;
  readonly report_repertoire_revision: string;
  readonly schema_version: string;
  readonly analysis_version: string;
}

export interface ReplacementLabSnapshot {
  readonly open: boolean;
  readonly status: ReplacementLabLifecycleStatus;
  readonly identity: ReplacementLabIdentity | null;
  readonly finding: StrategicFinding | null;
  readonly actionability: ReplacementLabActionability | null;
  readonly pivot_result: ReplacementPivotSelectionResult | null;
  readonly selected_pivot_decision_id: string | null;
  readonly pivot_confirmed: boolean;
  readonly controls: ReplacementLabControls;
  readonly progress: ReplacementLabProgress | null;
  readonly error: ReplacementLabError | null;
  readonly result: ReplacementLabGenerationResult | null;
  readonly attempt: number;
}

export interface ReplacementLabStateBoundary extends ReplacementLabApplicationBoundary {
  currentFindingResolution(finding: StrategicFinding): StrategicFitDisplayedResolutionState;
  prepare(
    context: ReplacementLabContext,
    boundary: ReplacementLabApplicationBoundary,
    controls: ReplacementLabControls,
  ): ReplacementLabPreparedContext;
  run(
    prepared: ReplacementLabPreparedContext,
    controls: ReplacementLabControls,
    confirmedPivotDecisionId: string,
    attempt: number,
    boundary: ReplacementLabApplicationBoundary,
    options: {
      readonly signal: AbortSignal;
      readonly onLabProgress: (progress: ReplacementLabProgress) => void;
    },
  ): Promise<ReplacementLabGenerationResult>;
  discardStage(stageId: string): Promise<unknown>;
}

const DEFAULT_CONTROLS = (depth = 20): ReplacementLabControls => ({
  sources: [...REPLACEMENT_LAB_SUPPORTED_SOURCES],
  engine_depth: depth,
  maximum_candidates: 6,
  maximum_subtree_nodes_per_candidate: 48,
  maximum_engine_positions: 24,
  maximum_explorer_queries: 24,
  engine_multipv: 4,
  strategic_horizon_ply: 24,
  minimum_reply_popularity: 0.03,
  include_all_forcing_replies: true,
});

const initialSnapshot = (depth = 20): ReplacementLabSnapshot => ({
  open: false,
  status: "closed",
  identity: null,
  finding: null,
  actionability: null,
  pivot_result: null,
  selected_pivot_decision_id: null,
  pivot_confirmed: false,
  controls: DEFAULT_CONTROLS(depth),
  progress: null,
  error: null,
  result: null,
  attempt: 0,
});

function contextFrom(completed: StrategicFitCompletedResult, finding: StrategicFinding): ReplacementLabContext {
  return {
    completed,
    report: completed.result,
    finding,
    cohort_id: finding.evidence.cohort_id,
    request_snapshot: completed.request_snapshot,
  };
}

function identity(prepared: ReplacementLabPreparedContext): ReplacementLabIdentity {
  const context = prepared.context;
  const request = prepared.request;
  return {
    ...context.request_snapshot,
    request_id: request?.request_id ?? "unavailable",
    report_id: context.report.report_id,
    finding_id: context.finding.finding_id,
    semantic_finding_id: context.finding.semantic_finding_id,
    cohort_id: context.cohort_id,
    report_repertoire_revision: context.report.repertoire_revision,
    schema_version: context.report.schema_version,
    analysis_version: context.report.analysis_version,
  };
}

function resultStageIds(result: ReplacementLabGenerationResult | null): string[] {
  if (result === null) return [];
  return result.preview.items.flatMap((item) => {
    const stage = item.stage;
    if (stage === null || typeof stage !== "object") return [];
    const staged = "stage" in stage ? stage.stage : null;
    const stageId = staged && typeof staged === "object" && "stage_id" in staged ? staged.stage_id : null;
    return typeof stageId === "string" ? [stageId] : [];
  });
}

function errorFrom(value: unknown): ReplacementLabError {
  if (typeof value === "object" && value !== null) {
    const candidate = value as { code?: unknown; name?: unknown; message?: unknown };
    return {
      code: typeof candidate.code === "string"
        ? candidate.code
        : typeof candidate.name === "string" ? candidate.name : "replacement-lab-failed",
      message: typeof candidate.message === "string"
        ? candidate.message : "Replacement candidate generation failed.",
    };
  }
  return { code: "replacement-lab-failed", message: String(value) };
}

function isAbort(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "AbortError";
}

function currentActionability(
  prepared: ReplacementLabPreparedContext,
  boundary: ReplacementLabStateBoundary,
): ReplacementLabActionability {
  const actionability = replacementLabActionability(
    prepared.context,
    boundary.currentSnapshot(),
    boundary.currentCompletedReport(),
  );
  return actionability.actionable && boundary.currentFindingResolution(prepared.context.finding) !== "unresolved"
    ? {
        actionable: false,
        code: "resolved-finding",
        message: "Only an unresolved current finding can open Replacement Lab.",
      }
    : actionability;
}

export function createReplacementLabState(boundary: ReplacementLabStateBoundary) {
  const [snapshot, setSnapshot] = createSignal<ReplacementLabSnapshot>(initialSnapshot());
  let prepared: ReplacementLabPreparedContext | null = null;
  let active: { readonly sequence: number; readonly controller: AbortController } | null = null;
  let sequence = 0;

  const discard = (result: ReplacementLabGenerationResult | null) => {
    for (const stageId of resultStageIds(result)) void boundary.discardStage(stageId);
  };

  const stopActive = () => {
    active?.controller.abort();
    active = null;
    sequence++;
  };

  const availability = (completed: StrategicFitCompletedResult, finding: StrategicFinding) => {
    const actionability = replacementLabActionability(
      contextFrom(completed, finding),
      boundary.currentSnapshot(),
      boundary.currentCompletedReport(),
    );
    return actionability.actionable && boundary.currentFindingResolution(finding) !== "unresolved"
      ? {
          actionable: false,
          code: "resolved-finding" as const,
          message: "Only an unresolved current finding can open Replacement Lab.",
        }
      : actionability;
  };

  const open = (completed: StrategicFitCompletedResult, finding: StrategicFinding) => {
    const available = availability(completed, finding);
    if (!available.actionable) return false;
    stopActive();
    discard(snapshot().result);
    const context = contextFrom(completed, finding);
    const controls = DEFAULT_CONTROLS(boundary.dependencies.analysisDepth());
    let next: ReplacementLabPreparedContext;
    try {
      next = boundary.prepare(context, boundary, controls);
    } catch (error) {
      const actionability: ReplacementLabActionability = {
        actionable: false,
        code: "unsupported-document",
        message: errorFrom(error).message,
      };
      prepared = { context, actionability, request: null, pivot_result: null };
      setSnapshot({
        ...initialSnapshot(controls.engine_depth),
        open: true,
        status: "non-actionable",
        identity: identity(prepared),
        finding,
        actionability,
      });
      return false;
    }
    prepared = next;
    const pivot = next.pivot_result;
    const selected = pivot?.status === "selected" ? pivot.pivot.decision_id : null;
    const actionability = !next.actionability.actionable
      ? next.actionability
      : pivot?.status === "non-actionable"
        ? {
            actionable: false,
            code: pivot.non_actionable_reason === "opponent-controlled"
              ? "opponent-owned-finding" as const
              : "non-causal-finding" as const,
            message: pivot.pivot.explanation,
          }
        : next.actionability;
    const status: ReplacementLabLifecycleStatus = !actionability.actionable
      ? "non-actionable"
      : pivot?.status === "alternatives-required" ? "pivot-required" : "pivot-ready";
    setSnapshot({
      ...initialSnapshot(controls.engine_depth),
      open: true,
      status,
      identity: identity(next),
      finding,
      actionability,
      pivot_result: pivot,
      selected_pivot_decision_id: selected,
      controls,
    });
    return actionability.actionable;
  };

  const selectPivot = (decisionId: string) => {
    const current = snapshot();
    const alternatives = current.pivot_result?.status === "alternatives-required"
      ? current.pivot_result.alternative_pivots
      : current.pivot_result?.status === "selected"
        ? [current.pivot_result.pivot, ...current.pivot_result.alternative_pivots]
        : [];
    if (!alternatives.some((pivot) => pivot.decision_id === decisionId)) return false;
    if (current.selected_pivot_decision_id === decisionId && !current.pivot_confirmed) return true;
    discard(current.result);
    setSnapshot((previous) => ({
      ...previous,
      status: "pivot-ready",
      selected_pivot_decision_id: decisionId,
      pivot_confirmed: false,
      error: null,
      result: null,
    }));
    return true;
  };

  const confirmPivot = () => {
    if (snapshot().selected_pivot_decision_id === null) return false;
    setSnapshot((previous) => ({ ...previous, status: "ready", pivot_confirmed: true, error: null }));
    return true;
  };

  const setSource = (kind: ReplacementCandidateSourceKind, enabled: boolean) => {
    const current = snapshot();
    if (!(REPLACEMENT_LAB_SUPPORTED_SOURCES as readonly string[]).includes(kind) || current.status === "running") {
      return false;
    }
    const sources = new Set(current.controls.sources);
    const unchanged = sources.has(kind) === enabled;
    if (unchanged) return true;
    if (enabled) sources.add(kind);
    else sources.delete(kind);
    if (sources.size === 0) return false;
    discard(current.result);
    setSnapshot((previous) => ({
      ...previous,
      controls: { ...previous.controls, sources: [...sources].sort() },
      result: null,
      error: null,
      status: previous.pivot_confirmed ? "ready" : previous.status,
    }));
    return true;
  };

  const setDepth = (depth: number) => {
    const current = snapshot();
    if (current.status === "running" || !Number.isInteger(depth) || depth < 1 || depth > 30) return false;
    const minimum = boundary.dependencies.analysisDepth() === 30 ? 30 : 1;
    const nextDepth = Math.max(minimum, depth);
    if (current.controls.engine_depth === nextDepth) return true;
    discard(current.result);
    setSnapshot((previous) => ({
      ...previous,
      controls: { ...previous.controls, engine_depth: nextDepth },
      result: null,
      error: null,
      status: previous.pivot_confirmed ? "ready" : previous.status,
    }));
    return true;
  };

  const generate = async () => {
    const current = snapshot();
    if (
      prepared === null || !current.open || !current.pivot_confirmed ||
      current.selected_pivot_decision_id === null || current.status === "running"
    ) return false;
    const before = currentActionability(prepared, boundary);
    if (!before.actionable) {
      setSnapshot((previous) => ({
        ...previous,
        status: "stale",
        actionability: before,
        error: { code: before.code, message: before.message },
        progress: null,
        result: null,
      }));
      return false;
    }
    discard(current.result);
    const controller = new AbortController();
    const requestSequence = ++sequence;
    const nextAttempt = current.attempt + 1;
    active = { sequence: requestSequence, controller };
    setSnapshot((previous) => ({
      ...previous,
      status: "running",
      attempt: nextAttempt,
      progress: { phase: "validating", completed: 0, total: 7, detail: "Starting candidate generation" },
      error: null,
      result: null,
    }));
    try {
      const result = await boundary.run(
        prepared,
        snapshot().controls,
        current.selected_pivot_decision_id,
        nextAttempt,
        boundary,
        {
          signal: controller.signal,
          onLabProgress(progress) {
            if (active?.sequence !== requestSequence || controller.signal.aborted) return;
            setSnapshot((previous) => ({ ...previous, progress }));
          },
        },
      );
      if (active?.sequence !== requestSequence || controller.signal.aborted) {
        discard(result);
        return false;
      }
      const after = currentActionability(prepared, boundary);
      if (!after.actionable) {
        discard(result);
        active = null;
        setSnapshot((previous) => ({
          ...previous,
          status: "stale",
          actionability: after,
          error: { code: after.code, message: after.message },
          progress: null,
          result: null,
        }));
        return false;
      }
      active = null;
      const partial = result.preview.status !== "complete" ||
        result.candidate_generation.status !== "complete" ||
        result.engine_generation.status !== "complete" ||
        result.expansion.status !== "complete" ||
        result.safety.status !== "complete";
      setSnapshot((previous) => ({
        ...previous,
        status: partial ? "partial" : "complete",
        identity: { ...previous.identity!, request_id: result.request.request_id },
        progress: null,
        error: null,
        result,
      }));
      return true;
    } catch (error) {
      if (active?.sequence !== requestSequence) return false;
      active = null;
      if (controller.signal.aborted || isAbort(error)) {
        setSnapshot((previous) => ({ ...previous, status: "cancelled", progress: null, error: null }));
        return false;
      }
      const failure = errorFrom(error);
      const status = failure.code.includes("stale") ? "stale" : "failed";
      setSnapshot((previous) => ({ ...previous, status, progress: null, error: failure }));
      return false;
    }
  };

  const cancel = () => {
    if (active === null) return false;
    active.controller.abort();
    active = null;
    sequence++;
    setSnapshot((previous) => ({ ...previous, status: "cancelled", progress: null, error: null }));
    return true;
  };

  const retry = () => generate();

  const close = () => {
    stopActive();
    discard(snapshot().result);
    prepared = null;
    setSnapshot(initialSnapshot(boundary.dependencies.analysisDepth()));
  };

  const synchronize = () => {
    if (prepared === null || !snapshot().open) return;
    const checked = currentActionability(prepared, boundary);
    if (checked.actionable) return;
    stopActive();
    discard(snapshot().result);
    setSnapshot((previous) => ({
      ...previous,
      status: "stale",
      actionability: checked,
      progress: null,
      error: { code: checked.code, message: checked.message },
      result: null,
    }));
  };

  return {
    snapshot,
    availability,
    open,
    close,
    selectPivot,
    confirmPivot,
    setSource,
    setDepth,
    generate,
    cancel,
    retry,
    synchronize,
  };
}

const browserBoundary: ReplacementLabStateBoundary = {
  dependencies: defaultBrowserCommandDependencies,
  currentSnapshot: strategicFitCurrentSnapshot,
  currentCompletedReport: () => strategicFitLifecycle().current_result,
  currentFindingResolution: displayStrategicFitFindingResolution,
  prepare: prepareReplacementLab,
  run: runReplacementLabGeneration,
  discardStage: rejectStrategicFitChangeSet,
};

export const replacementLab = createReplacementLabState(browserBoundary);
export const replacementLabSnapshot = replacementLab.snapshot;
