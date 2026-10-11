import type { IntentionalResolutionReason, StrategicFinding } from "@chess-mcp/chess-tools";
import { isDecidableFinding } from "../decidable-finding";
import { INTENTIONAL_RESOLUTION_REASONS } from "@chess-mcp/chess-tools";
import { actions, color, currentTree, documentId, version } from "../../store/game";
import {
  analyzeStrategicFit,
  strategicFitEvidenceState,
  strategicFitLifecycle,
  type StrategicFitCompletedResult,
} from "../../store/strategic-fit";
import { strategicFitFindingQueue } from "../../store/strategic-fit-finding-queue";
import {
  displayStrategicFitFindingResolution,
  strategicFitFindingResolutionAvailability,
} from "../../store/strategic-fit-finding-resolutions";
import {
  strategicFitMetadataStatus,
  strategicFitMetadata,
} from "../../store/strategic-fit-metadata";
import { strategicFitProfile } from "../../store/strategic-fit-profile";
import { strategicFitProfileSetupRequired } from "../../store/strategic-fit-profile-setup";
import { replacementLab, replacementLabSnapshot } from "../../store/strategic-fit-replacement";
import { strategicFitResolutionProofSnapshot } from "../../store/strategic-fit-resolution-proof";
import {
  setStrategicFitBoardReturn,
  setStrategicFitWorkspaceOpen,
  setStrategicFitWorkspaceStage,
  strategicFitWorkspaceOpen,
  strategicFitWorkspaceStage,
} from "../../store/ui";
import {
  startStrategicFitDrillSession,
  strategicFitDrillSession,
  strategicFitDrillsFor,
} from "../../store/strategic-fit-training";
import {
  prepareDecision,
  type PreparedDecision,
  type PreparedDecisionState,
} from "../../store/strategic-fit-decision-drafts";
import {
  REPLACEMENT_CANDIDATE_SOURCE_KINDS,
  type ReplacementCandidateSourceKind,
} from "@chess-mcp/chess-tools";

export interface AdapterFailure {
  readonly error: string;
  readonly reason: string;
}

export { DECISION_STATES } from "./catalog";
export { INTENTIONAL_RESOLUTION_REASONS };

const FINDING_LIMIT = 12;
const CANDIDATE_LIMIT = 8;

export const strategicFitSetupRequired = () =>
  strategicFitMetadataStatus() === "ready" && strategicFitProfileSetupRequired();

const currentReport = (): StrategicFitCompletedResult | null => {
  const lifecycle = strategicFitLifecycle();
  return lifecycle.status === "completed" ? lifecycle.current_result : null;
};

function findingStory(finding: StrategicFinding) {
  return {
    findingId: finding.finding_id,
    classification: finding.classification,
    category: finding.plain_language_category,
    opening: finding.opening_scope,
    line: finding.affected_line_summary,
    resolution: displayStrategicFitFindingResolution(finding),
    // Uncertain evidence and equivalent move orders are information, with no decision to record.
    decidable: isDecidableFinding(finding),
    replacementPriority: finding.replacement_priority.label,
    trainingPriority: finding.training_priority.label,
  };
}

/** Bounded Strategic Fit state: identities and labels, never the full report. */
export function strategicFitSnapshot() {
  const lifecycle = strategicFitLifecycle();
  const report = currentReport();
  const queue = strategicFitFindingQueue.snapshot();
  const lab = replacementLabSnapshot();
  const loaded = report !== null && findingsLoaded(report.report_id);
  const findings = loaded ? queue.findings : [];
  const unresolved = findings.filter(
    (finding) => displayStrategicFitFindingResolution(finding) === "unresolved",
  );
  const selected = findings.find((finding) => finding.finding_id === queue.selected_finding_id);
  const ordered = selected ? [selected, ...unresolved.filter((f) => f !== selected)] : unresolved;
  const pivots =
    lab.pivot_result?.status === "selected"
      ? [lab.pivot_result.pivot, ...lab.pivot_result.alternative_pivots]
      : lab.pivot_result?.status === "alternatives-required"
        ? lab.pivot_result.alternative_pivots
        : [];
  const training = selected ? trainingFor(report, selected) : null;
  return {
    workspaceOpen: strategicFitWorkspaceOpen(),
    stage: strategicFitWorkspaceStage(),
    profile: {
      status: strategicFitMetadataStatus(),
      setupRequired: strategicFitSetupRequired(),
      mode: strategicFitProfile().mode,
    },
    analysis: {
      status: lifecycle.status,
      reportId: report?.report_id ?? null,
      progress: lifecycle.progress
        ? {
            done: lifecycle.progress.done,
            total: lifecycle.progress.total ?? null,
            detail: lifecycle.progress.detail ?? null,
          }
        : null,
      error: lifecycle.error
        ? { code: lifecycle.error.code, message: lifecycle.error.message }
        : null,
      staleReason: lifecycle.stale_reason,
      evidence: strategicFitEvidenceState(),
      preflight: report
        ? {
            state: report.result.preflight.state,
            issues: report.result.preflight.issues.slice(0, 6).map((issue) => issue.code),
          }
        : null,
    },
    findings: report
      ? {
          reportId: report.report_id,
          // Findings load with the workspace; until then the report's own count is the total, and
          // nothing is known about which are unresolved.
          loaded,
          total: loaded ? findings.length : report.result.finding_page.total_count,
          unresolved: loaded ? unresolved.length : null,
          selectedFindingId: queue.selected_finding_id,
          items: ordered.slice(0, FINDING_LIMIT).map(findingStory),
          truncated: ordered.length > FINDING_LIMIT,
        }
      : null,
    training,
    lab: lab.open
      ? {
          status: lab.status,
          findingId: lab.identity?.finding_id ?? null,
          resultId: lab.result ? lab.result.request.request_id : null,
          pivots: pivots.map((pivot) => ({
            decisionId: pivot.decision_id,
            san: pivot.san,
            ply: pivot.ply,
          })),
          selectedPivot: lab.selected_pivot_decision_id,
          pivotConfirmed: lab.pivot_confirmed,
          sources: lab.controls.sources,
          depth: lab.controls.engine_depth,
          error: lab.error,
          candidates: (lab.result?.scoring.candidates ?? [])
            .slice(0, CANDIDATE_LIMIT)
            .map((candidate) => ({
              candidateId: candidate.candidate_id,
              state: candidate.state,
              pareto: candidate.pareto.status,
            })),
          review: lab.review
            ? {
                candidateId: lab.review.candidate_id,
                action: lab.review.action,
                status: lab.review.status,
                stageId: lab.review.stage?.stage_id ?? null,
                error: lab.review.error,
              }
            : null,
        }
      : null,
    resolutionProof: strategicFitResolutionProofSnapshot().status,
  };
}

function trainingFor(report: StrategicFitCompletedResult | null, finding: StrategicFinding) {
  if (!report) return null;
  const active = strategicFitMetadata().resolutions.find(
    (entry) =>
      entry.record_state === "active" &&
      entry.semantic_finding_id === finding.semantic_finding_id &&
      entry.state === "train-as-exception",
  );
  const trainingId = active?.linked_training_ids[0] ?? null;
  return {
    findingId: finding.finding_id,
    trainingId,
    drillOpen: trainingId === null ? false : strategicFitDrillSession(trainingId) !== null,
  };
}

const waitStep = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 50);
  });

/**
 * Reuses a current report, waits for one already running, and starts analysis only when none
 * exists. Starting another run would abort the one the workspace already scheduled.
 */
export async function awaitStrategicFitReport(
  signal?: AbortSignal,
): Promise<
  { report: StrategicFitCompletedResult; reused: boolean } | { error: string; reason: string }
> {
  if (strategicFitMetadataStatus() !== "ready")
    return { error: "profile_loading", reason: "Strategic Fit settings are still loading." };
  if (strategicFitSetupRequired())
    return {
      error: "profile_setup_required",
      reason:
        "Strategic Fit needs the user's review preference first. The setup is open; the user completes it or accepts a proposed profile.",
    };
  const status = strategicFitLifecycle().status;
  const reused = currentReport() !== null;
  if (status !== "running" && status !== "provisional" && !reused) void analyzeStrategicFit();
  for (;;) {
    if (signal?.aborted) return { error: "cancelled", reason: "The request stopped." };
    const lifecycle = strategicFitLifecycle();
    if (lifecycle.status === "completed" && lifecycle.current_result)
      return { report: lifecycle.current_result, reused };
    if (lifecycle.status === "failed")
      return {
        error: lifecycle.error?.code ?? "strategic_fit_failed",
        reason: lifecycle.error?.message ?? "Strategic Fit analysis failed.",
      };
    if (
      lifecycle.status === "cancelled" ||
      lifecycle.status === "stale" ||
      lifecycle.status === "idle"
    )
      return {
        error: `strategic_fit_${lifecycle.status}`,
        reason: lifecycle.stale_reason ?? "Strategic Fit analysis did not complete.",
      };
    await waitStep();
  }
}

export async function awaitFindingQueue(reportId: string, signal?: AbortSignal) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (signal?.aborted) return false;
    const queue = strategicFitFindingQueue.snapshot();
    if (queue.report_id === reportId && queue.status === "ready") return true;
    if (queue.report_id === reportId && queue.status === "error") return false;
    await waitStep();
  }
  return false;
}

/** Whether the finding queue holds this report's findings; it loads when the workspace opens. */
export function findingsLoaded(reportId: string): boolean {
  const queue = strategicFitFindingQueue.snapshot();
  return (
    currentReport()?.report_id === reportId &&
    queue.report_id === reportId &&
    queue.status === "ready"
  );
}

export const FINDINGS_NOT_LOADED: AdapterFailure = {
  error: "findings_not_loaded",
  reason:
    "This report's findings are not loaded yet. Navigate to strategicFit.review so they load, then try again.",
};

export function findingIn(reportId: string, findingId: string): StrategicFinding | null {
  const report = currentReport();
  const queue = strategicFitFindingQueue.snapshot();
  if (report?.report_id !== reportId || queue.report_id !== reportId) return null;
  return queue.findings.find((finding) => finding.finding_id === findingId) ?? null;
}

/** Selects a finding by exact report and finding identity; stale links never pick another. */
export function selectFinding(reportId: string, findingId: string) {
  const finding = findingIn(reportId, findingId);
  if (!finding) return null;
  strategicFitFindingQueue.selectFinding(findingId);
  setStrategicFitWorkspaceStage("evidence");
  return finding;
}

/** Puts the board on the finding's line. The workspace closes, as its own Go to line does. */
export function showFindingOnBoard(reportId: string, findingId: string) {
  const report = currentReport();
  const finding = findingIn(reportId, findingId);
  const path = finding?.references.source_san_paths[0];
  if (
    !report ||
    !finding ||
    !path ||
    report.request_snapshot.document_id !== documentId() ||
    report.request_snapshot.repertoire_revision !== version() ||
    report.request_snapshot.repertoire_pgn !== actions.toPgn() ||
    report.request_snapshot.repertoire_color !== color()
  )
    return null;
  let target: number[] | null = null;
  try {
    target = currentTree().indexPathOfSan([...path]) ?? null;
  } catch {
    target = null;
  }
  if (target === null) return null;
  strategicFitFindingQueue.selectFinding(findingId);
  actions.goto(target);
  setStrategicFitBoardReturn(documentId());
  setStrategicFitWorkspaceOpen(false);
  return { sanPath: [...path] };
}

/** Refuses before anything is revealed when a finding has no decision to record. */
export function decisionPrecheck(findingId: string): AdapterFailure | null {
  const report = currentReport();
  if (!report) return { error: "no_report", reason: "No current Strategic Fit report." };
  if (!findingsLoaded(report.report_id)) return FINDINGS_NOT_LOADED;
  const finding = findingIn(report.report_id, findingId);
  if (!finding)
    return { error: "stale_result", reason: "That finding is not in the current report." };
  if (!isDecidableFinding(finding))
    return {
      error: "not_decidable",
      reason:
        finding.classification === "transpositional-equivalence"
          ? "These move orders reach the same position; there is no decision to record."
          : "This finding reports insufficient or unreliable evidence; there is no decision to record. Explain what is missing instead.",
    };
  return null;
}

export function prepareFindingDecision(input: {
  findingId: string;
  decision: PreparedDecisionState;
  reason: IntentionalResolutionReason | null;
  note: string;
}): PreparedDecision | { error: string; reason: string } {
  const report = currentReport();
  if (!report) return { error: "no_report", reason: "No current Strategic Fit report." };
  if (!findingsLoaded(report.report_id)) return FINDINGS_NOT_LOADED;
  const finding = findingIn(report.report_id, input.findingId);
  if (!finding)
    return { error: "stale_result", reason: "That finding is not in the current report." };
  const undecidable = decisionPrecheck(finding.finding_id);
  if (undecidable) return undecidable;
  const availability = strategicFitFindingResolutionAvailability(
    report.report_id,
    finding.finding_id,
    finding.semantic_finding_id,
  );
  if (!availability.available)
    return {
      error: availability.code ?? "resolution_unavailable",
      reason: availability.message ?? "This finding cannot be resolved now.",
    };
  if (displayStrategicFitFindingResolution(finding) !== "unresolved")
    return { error: "already_resolved", reason: "This finding already has a decision." };
  if (input.decision === "keep-intentionally" && input.reason === "custom" && !input.note.trim())
    return { error: "note_required", reason: "A custom keep-intentionally reason needs a note." };
  strategicFitFindingQueue.selectFinding(finding.finding_id);
  setStrategicFitWorkspaceStage("evidence");
  return prepareDecision({
    reportId: report.report_id,
    findingId: finding.finding_id,
    semanticFindingId: finding.semantic_finding_id,
    state: input.decision,
    reason: input.decision === "keep-intentionally" ? input.reason : null,
    note: input.note,
  });
}

/** Opens the Replacement Lab for the selected finding when the report allows it. */
export function openReplacementLab(findingId: string): { ok: true } | AdapterFailure {
  const report = currentReport();
  if (!report) return { error: "no_report", reason: "No current Strategic Fit report." };
  if (!findingsLoaded(report.report_id)) return FINDINGS_NOT_LOADED;
  const finding = findingIn(report.report_id, findingId);
  if (!finding)
    return { error: "stale_result", reason: "That finding is not in the current report." };
  const availability = replacementLab.availability(report, finding);
  if (!availability.actionable) return { error: availability.code, reason: availability.message };
  strategicFitFindingQueue.selectFinding(findingId);
  if (!replacementLabSnapshot().open || replacementLabSnapshot().identity?.finding_id !== findingId)
    replacementLab.open(report, finding);
  return { ok: true };
}

export function configureReplacementLab(values: {
  pivotDecisionId?: string;
  sources?: readonly ReplacementCandidateSourceKind[];
  depth?: number;
}): { ok: true } | AdapterFailure {
  if (!replacementLabSnapshot().open)
    return { error: "lab_closed", reason: "Open the Replacement Lab for a finding first." };
  if (values.pivotDecisionId !== undefined) {
    if (!replacementLab.selectPivot(values.pivotDecisionId))
      return { error: "invalid_pivot", reason: "That pivot is not offered for this finding." };
    replacementLab.confirmPivot();
  }
  if (values.sources !== undefined) {
    const enabled = replacementLabSnapshot().controls.sources;
    for (const kind of REPLACEMENT_CANDIDATE_SOURCE_KINDS)
      if (values.sources.includes(kind) !== enabled.includes(kind))
        replacementLab.setSource(kind, values.sources.includes(kind));
  }
  if (values.depth !== undefined) replacementLab.setDepth(values.depth);
  return { ok: true };
}

export async function generateReplacementCandidates(
  signal?: AbortSignal,
): Promise<{ resultId: string; candidates: number; status: string } | AdapterFailure> {
  const lab = replacementLabSnapshot();
  if (!lab.open) return { error: "lab_closed", reason: "Open the Replacement Lab first." };
  if (!lab.pivot_confirmed)
    return { error: "pivot_unconfirmed", reason: "Choose the decision to replace first." };
  const abort = () => {
    replacementLab.cancel();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await replacementLab.generate();
  } finally {
    signal?.removeEventListener("abort", abort);
  }
  const after = replacementLabSnapshot();
  return after.result
    ? {
        resultId: after.result.request.request_id,
        candidates: after.result.scoring.candidates.length,
        status: after.status,
      }
    : {
        error: after.error?.code ?? `lab_${after.status}`,
        reason: after.error?.message ?? "No candidates were generated.",
      };
}

export async function stageReplacementCandidate(
  candidateId: string,
  action: "add-alternative" | "replace",
): Promise<{ stageId: string; status: string } | AdapterFailure> {
  const lab = replacementLabSnapshot();
  if (!lab.result) return { error: "no_candidates", reason: "Generate candidates first." };
  const staged = await replacementLab.stageReview(candidateId, action);
  const review = replacementLabSnapshot().review;
  return staged && review?.stage
    ? { stageId: review.stage.stage_id, status: review.status }
    : {
        error: review?.error?.code ?? "stage_failed",
        reason: review?.error?.message ?? "The candidate could not be staged.",
      };
}

/** Opens an accepted training item's drill. It never plays or records the user's recall move. */
export function openDrill(
  findingId: string,
): { trainingId: string; positions: number } | AdapterFailure {
  const report = currentReport();
  const finding = report ? findingIn(report.report_id, findingId) : null;
  if (!report || !finding) return { error: "stale_result", reason: "That finding is not current." };
  const training = trainingFor(report, finding);
  if (!training?.trainingId)
    return { error: "no_training_item", reason: "Accept a training plan for this finding first." };
  const drills = strategicFitDrillsFor({
    report_id: report.report_id,
    finding_id: finding.finding_id,
    semantic_finding_id: finding.semantic_finding_id,
  });
  if (!drills) return { error: "no_drills", reason: "This training item has no drill positions." };
  strategicFitFindingQueue.selectFinding(findingId);
  if (strategicFitDrillSession(training.trainingId) === null)
    startStrategicFitDrillSession(training.trainingId);
  return { trainingId: training.trainingId, positions: drills.drills.length };
}
