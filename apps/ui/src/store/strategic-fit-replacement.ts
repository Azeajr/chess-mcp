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
  stageReplacementLabChangeReview,
  type ReplacementLabActionability,
  type ReplacementLabApplicationBoundary,
  type ReplacementLabChangeReviewAction,
  type ReplacementLabChangeReviewResult,
  type ReplacementLabContext,
  type ReplacementLabControls,
  type ReplacementLabGenerationResult,
  type ReplacementLabPreparedContext,
  type ReplacementLabProgress,
} from "../application/strategic-fit-replacement";
import { defaultBrowserCommandDependencies } from "../application/browser-commands/default-context";
import { analysisDepth } from "./engine-settings";
import {
  acceptConfirmedStrategicFitChangeSet,
  registerStrategicFitStageForTesting,
  rejectStrategicFitChangeSet,
  type StrategicFitChangeConfirmation,
  type StrategicFitChangeOperationResult,
  type StrategicFitStagedChange,
} from "./strategic-fit-changes";
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
  readonly review: ReplacementLabChangeReviewSnapshot | null;
  readonly attempt: number;
}

export type ReplacementLabChangeReviewStatus =
  | "loading" | "ready" | "accepting" | "blocked" | "stale" | "error" | "accepted" | "rejected";

export interface ReplacementLabChangeReviewSnapshot {
  readonly candidate_id: string;
  readonly action: ReplacementLabChangeReviewAction;
  readonly status: ReplacementLabChangeReviewStatus;
  readonly evidence: ReplacementLabChangeReviewResult | null;
  readonly stage: StrategicFitStagedChange | null;
  readonly error: ReplacementLabError | null;
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
  stageReview(
    result: ReplacementLabGenerationResult,
    candidateId: string,
    action: ReplacementLabChangeReviewAction,
    boundary: ReplacementLabApplicationBoundary,
    options: { readonly signal: AbortSignal },
  ): Promise<ReplacementLabChangeReviewResult>;
  acceptStage(confirmation: StrategicFitChangeConfirmation): Promise<StrategicFitChangeOperationResult>;
  discardStage(stageId: string): Promise<StrategicFitChangeOperationResult>;
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
  review: null,
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

function stagedChange(result: ReplacementLabChangeReviewResult): StrategicFitStagedChange | null {
  const wrapper = result.item.stage;
  if (!wrapper || typeof wrapper !== "object" || !("ok" in wrapper) || wrapper.ok !== true || !("stage" in wrapper)) {
    return null;
  }
  const stage = wrapper.stage;
  return stage && typeof stage === "object" && "stage_id" in stage && typeof stage.stage_id === "string"
    ? stage as StrategicFitStagedChange
    : null;
}

export function replacementLabChangeReviewStatus(
  itemStatus: ReplacementLabChangeReviewResult["item"]["status"],
  stage: StrategicFitStagedChange | null,
): ReplacementLabChangeReviewStatus {
  if (stage?.status === "staged" && itemStatus === "previewed") return "ready";
  if (itemStatus === "stale") return "stale";
  if (itemStatus === "blocked") return "blocked";
  return "error";
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
  let reviewActive: { readonly sequence: number; readonly controller: AbortController } | null = null;
  let sequence = 0;

  const discard = (result: ReplacementLabGenerationResult | null) => {
    for (const stageId of resultStageIds(result)) void boundary.discardStage(stageId);
  };

  const discardReview = (review: ReplacementLabChangeReviewSnapshot | null) => {
    reviewActive?.controller.abort();
    reviewActive = null;
    if (review?.stage?.status === "staged") void boundary.discardStage(review.stage.stage_id);
  };

  const stopActive = () => {
    active?.controller.abort();
    active = null;
    reviewActive?.controller.abort();
    reviewActive = null;
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
    discardReview(snapshot().review);
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
    discardReview(current.review);
    discard(current.result);
    setSnapshot((previous) => ({
      ...previous,
      status: "pivot-ready",
      selected_pivot_decision_id: decisionId,
      pivot_confirmed: false,
      error: null,
      result: null,
      review: null,
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
    discardReview(current.review);
    discard(current.result);
    setSnapshot((previous) => ({
      ...previous,
      controls: { ...previous.controls, sources: [...sources].sort() },
      result: null,
      review: null,
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
    discardReview(current.review);
    discard(current.result);
    setSnapshot((previous) => ({
      ...previous,
      controls: { ...previous.controls, engine_depth: nextDepth },
      result: null,
      review: null,
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
      discardReview(current.review);
      discard(current.result);
      setSnapshot((previous) => ({
        ...previous,
        status: "stale",
        actionability: before,
        error: { code: before.code, message: before.message },
        progress: null,
        result: null,
        review: null,
      }));
      return false;
    }
    discardReview(current.review);
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
      review: null,
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

  const stageReview = async (
    candidateId: string,
    action: ReplacementLabChangeReviewAction = "add-alternative",
  ) => {
    const current = snapshot();
    if (!current.result || !current.open || current.status === "running") return false;
    if (current.review?.status === "accepting") return false;
    if (!current.result.scoring.candidates.some((candidate) => candidate.candidate_id === candidateId)) return false;
    const before = prepared === null ? null : currentActionability(prepared, boundary);
    if (!before?.actionable) {
      setSnapshot((previous) => ({
        ...previous,
        review: {
          candidate_id: candidateId,
          action,
          status: "stale",
          evidence: null,
          stage: null,
          error: { code: before?.code ?? "stale-result", message: before?.message ?? "Replacement context is stale." },
        },
      }));
      return false;
    }
    reviewActive?.controller.abort();
    const priorStage = current.review?.stage;
    const controller = new AbortController();
    const requestSequence = ++sequence;
    reviewActive = { sequence: requestSequence, controller };
    setSnapshot((previous) => ({
      ...previous,
      review: { candidate_id: candidateId, action, status: "loading", evidence: null, stage: null, error: null },
    }));
    if (priorStage?.status === "staged") {
      const discarded = await boundary.discardStage(priorStage.stage_id);
      if (!discarded.ok) {
        if (reviewActive?.sequence === requestSequence) {
          reviewActive = null;
          setSnapshot((previous) => ({
            ...previous,
            review: {
              candidate_id: candidateId,
              action,
              status: discarded.error.includes("stale") ? "stale" : "error",
              evidence: null,
              stage: discarded.stage,
              error: { code: discarded.error, message: `Prior staged review could not be rejected: ${discarded.error}.` },
            },
          }));
        }
        return false;
      }
    }
    if (reviewActive?.sequence !== requestSequence || controller.signal.aborted) return false;
    try {
      const evidence = await boundary.stageReview(current.result, candidateId, action, boundary, {
        signal: controller.signal,
      });
      const stage = stagedChange(evidence);
      if (reviewActive?.sequence !== requestSequence || controller.signal.aborted) {
        if (stage?.status === "staged") await boundary.discardStage(stage.stage_id);
        return false;
      }
      reviewActive = null;
      const status = replacementLabChangeReviewStatus(evidence.item.status, stage);
      setSnapshot((previous) => ({
        ...previous,
        review: {
          candidate_id: candidateId,
          action,
          status,
          evidence,
          stage,
          error: status === "ready" ? null : {
            code: evidence.item.error_code ?? evidence.item.status,
            message: evidence.item.explanation,
          },
        },
      }));
      return status === "ready";
    } catch (error) {
      if (reviewActive?.sequence !== requestSequence) return false;
      reviewActive = null;
      if (controller.signal.aborted || isAbort(error)) return false;
      const failure = errorFrom(error);
      setSnapshot((previous) => ({
        ...previous,
        review: {
          candidate_id: candidateId,
          action,
          status: failure.code.includes("stale") ? "stale" : "error",
          evidence: null,
          stage: null,
          error: failure,
        },
      }));
      return false;
    }
  };

  const acceptReview = async (confirmation: StrategicFitChangeConfirmation) => {
    const review = snapshot().review;
    if (review?.status !== "ready" || review.stage?.stage_id !== confirmation.stage_id) return false;
    const acceptanceSequence = ++sequence;
    setSnapshot((previous) => ({
      ...previous,
      review: previous.review && { ...previous.review, status: "accepting", error: null },
    }));
    let result: StrategicFitChangeOperationResult;
    try {
      result = await boundary.acceptStage(confirmation);
    } catch (error) {
      const current = snapshot().review;
      if (sequence !== acceptanceSequence || current?.candidate_id !== review.candidate_id ||
          current.action !== review.action || current.stage?.stage_id !== review.stage.stage_id) return false;
      const failure = errorFrom(error);
      setSnapshot((previous) => ({
        ...previous,
        review: previous.review && { ...previous.review, status: "error", error: failure },
      }));
      return false;
    }
    const current = snapshot().review;
    if (sequence !== acceptanceSequence || current?.candidate_id !== review.candidate_id ||
        current.action !== review.action || current.stage?.stage_id !== review.stage.stage_id) return false;
    setSnapshot((previous) => ({
      ...previous,
      review: previous.review && {
        ...previous.review,
        status: result.ok ? "accepted" : result.error.includes("stale") ? "stale" : "error",
        stage: result.stage,
        error: result.ok ? null : { code: result.error, message: `Atomic acceptance rejected: ${result.error}.` },
      },
    }));
    return result.ok;
  };

  const rejectReview = async () => {
    reviewActive?.controller.abort();
    reviewActive = null;
    const review = snapshot().review;
    if (!review || review.status === "accepting") return false;
    const stageId = review.stage?.status === "staged" ? review.stage.stage_id : null;
    const rejectionSequence = ++sequence;
    const result = stageId ? await boundary.discardStage(stageId) : null;
    const current = snapshot().review;
    if (sequence !== rejectionSequence || current?.candidate_id !== review.candidate_id ||
        current.action !== review.action || current.stage?.stage_id !== review.stage?.stage_id) return false;
    if (result && !result.ok) {
      setSnapshot((previous) => ({
        ...previous,
        review: previous.review && {
          ...previous.review,
          status: result.error.includes("stale") ? "stale" : "error",
          stage: result.stage,
          error: { code: result.error, message: `Preview rejection failed: ${result.error}.` },
        },
      }));
      return false;
    }
    setSnapshot((previous) => ({
      ...previous,
      review: previous.review && {
        ...previous.review,
        status: "rejected",
        stage: result?.stage ?? previous.review.stage,
        error: null,
      },
    }));
    return true;
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
    discardReview(snapshot().review);
    discard(snapshot().result);
    prepared = null;
    setSnapshot(initialSnapshot(boundary.dependencies.analysisDepth()));
  };

  const synchronize = () => {
    if (prepared === null || !snapshot().open) return;
    if (snapshot().review?.status === "accepting" || snapshot().review?.status === "accepted") return;
    const checked = currentActionability(prepared, boundary);
    if (checked.actionable) return;
    stopActive();
    discardReview(snapshot().review);
    discard(snapshot().result);
    setSnapshot((previous) => ({
      ...previous,
      status: "stale",
      actionability: checked,
      progress: null,
      error: { code: checked.code, message: checked.message },
      result: null,
      review: null,
    }));
  };

  const setResultForTesting = (result: ReplacementLabGenerationResult) => {
    if (!import.meta.env.DEV) throw new Error("Replacement Lab fixture injection is development-only.");
    stopActive();
    discardReview(snapshot().review);
    discard(snapshot().result);
    const partial = result.scoring.status !== "complete" || result.safety.status !== "complete" ||
      result.expansion.status !== "complete";
    setSnapshot((previous) => ({
      ...previous,
      status: partial ? "partial" : "complete",
      progress: null,
      error: null,
      result,
      review: null,
    }));
  };

  const setReviewForTesting = (review: ReplacementLabChangeReviewSnapshot | null) => {
    if (!import.meta.env.DEV) throw new Error("Replacement Lab review fixture injection is development-only.");
    reviewActive?.controller.abort();
    reviewActive = null;
    const registeredStage = review?.stage ? registerStrategicFitStageForTesting(review.stage) : null;
    const registeredReview = review && registeredStage ? {
      ...review,
      stage: registeredStage,
      evidence: review.evidence && {
        ...review.evidence,
        item: {
          ...review.evidence.item,
          stage: { ok: true as const, stage: registeredStage },
        },
      },
    } : review;
    setSnapshot((previous) => ({ ...previous, review: registeredReview }));
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
    stageReview,
    acceptReview,
    rejectReview,
    synchronize,
    /** DEV harness only: installs immutable presentation evidence without running providers. */
    setResultForTesting,
    /** DEV harness only: installs a revision-bound review snapshot for accessibility coverage. */
    setReviewForTesting,
  };
}

const browserBoundary: ReplacementLabStateBoundary = {
  dependencies: defaultBrowserCommandDependencies,
  currentSnapshot: strategicFitCurrentSnapshot,
  currentCompletedReport: () => strategicFitLifecycle().current_result,
  currentFindingResolution: displayStrategicFitFindingResolution,
  prepare: prepareReplacementLab,
  run: runReplacementLabGeneration,
  stageReview: stageReplacementLabChangeReview,
  acceptStage: acceptConfirmedStrategicFitChangeSet,
  discardStage: rejectStrategicFitChangeSet,
};

export const replacementLab = createReplacementLabState(browserBoundary);
export const replacementLabSnapshot = replacementLab.snapshot;
