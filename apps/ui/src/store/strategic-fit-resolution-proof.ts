import { createSignal } from "solid-js";
import type {
  StrategicFinding,
  StrategicFitAnalysisResult,
  StrategicFitMetric,
} from "@chess-mcp/chess-tools";
import {
  strategicFitUndoRecordForStage,
  undoStrategicFitChange,
  type StrategicFitChangeOperationResult,
  type StrategicFitStagedChange,
  type StrategicFitUndoRecordSummary,
} from "./strategic-fit-changes";
import {
  strategicFitCurrentSnapshot,
  strategicFitLifecycle,
  type StrategicFitCompletedResult,
  type StrategicFitLifecycleSnapshot,
  type StrategicFitRequestSnapshot,
} from "./strategic-fit";

type StrategicFitResolutionProofPhase = "acceptance" | "undo";

type StrategicFitResolutionProofStatus =
  | "idle"
  | "awaiting-rescan"
  | "rescanning"
  | "proven"
  | "superseded"
  | "rescan-failed"
  | "rescan-cancelled"
  | "undoing"
  | "undo-blocked"
  | "undone";

export type StrategicFitResolutionProofOutcome =
  | {
      readonly kind: "resolved";
      readonly semantic_finding_id: string;
      readonly resolving_revision: string;
      readonly reconciled: boolean;
    }
  | {
      readonly kind: "still-open";
      readonly finding: StrategicFinding;
      readonly changed_evidence: boolean;
    }
  | { readonly kind: "restored-open"; readonly finding: StrategicFinding }
  | { readonly kind: "restored-absent"; readonly semantic_finding_id: string };

export interface StrategicFitResolutionProofMetricClaim {
  readonly claim_id: string;
  readonly label: string;
  readonly before: StrategicFitMetric<number> | null;
  readonly after: StrategicFitMetric<number> | null;
}

interface StrategicFitResolutionProofCountClaim {
  readonly claim_id: string;
  readonly label: string;
  readonly before: number | string | null;
  readonly after: number | string;
}

export interface StrategicFitResolutionProofReportClaims {
  readonly before_report_id: string | null;
  readonly before_repertoire_revision: string | null;
  readonly after_report_id: string;
  readonly after_repertoire_revision: string;
  readonly metrics: readonly StrategicFitResolutionProofMetricClaim[];
  readonly counts: readonly StrategicFitResolutionProofCountClaim[];
}

interface StrategicFitTrackedAcceptance {
  readonly stage_id: string;
  readonly document_id: string;
  readonly base_revision: number;
  readonly accepted_revision: number;
  readonly action_summary: {
    readonly archive: StrategicFitStagedChange["change_set"]["retention"]["archive"];
    readonly prune: StrategicFitStagedChange["change_set"]["retention"]["prune"];
  };
  readonly candidate_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly report_id: string;
  readonly repertoire_color: "white" | "black";
  readonly accepted_at: string;
}

interface StrategicFitResolutionProofError {
  readonly code: string;
  readonly message: string;
}

export interface StrategicFitResolutionProofSnapshot {
  readonly status: StrategicFitResolutionProofStatus;
  readonly phase: StrategicFitResolutionProofPhase;
  readonly tracked: StrategicFitTrackedAcceptance | null;
  readonly outcome: StrategicFitResolutionProofOutcome | null;
  readonly new_findings: readonly StrategicFinding[];
  readonly reanalysis: StrategicFitCompletedResult["reanalysis"] | null;
  readonly claims: StrategicFitResolutionProofReportClaims | null;
  readonly undo_record: StrategicFitUndoRecordSummary | null;
  readonly superseded_reason: string | null;
  readonly error: StrategicFitResolutionProofError | null;
}

export interface StrategicFitResolutionProofBoundary {
  lifecycle(): StrategicFitLifecycleSnapshot;
  currentSnapshot(): StrategicFitRequestSnapshot;
  undoRecordForStage(stageId: string): Promise<StrategicFitUndoRecordSummary | null>;
  undo(undoId: string): Promise<StrategicFitChangeOperationResult>;
  now(): string;
}

const initialSnapshot = (): StrategicFitResolutionProofSnapshot => ({
  status: "idle",
  phase: "acceptance",
  tracked: null,
  outcome: null,
  new_findings: [],
  reanalysis: null,
  claims: null,
  undo_record: null,
  superseded_reason: null,
  error: null,
});

function completedFindings(completed: StrategicFitCompletedResult): readonly StrategicFinding[] {
  return completed.findings_snapshot ?? completed.result.findings;
}

function reportClaims(
  before: StrategicFitCompletedResult | null,
  after: StrategicFitAnalysisResult,
): StrategicFitResolutionProofReportClaims {
  const beforeResult = before?.result ?? null;
  const metric = (
    claimId: string,
    label: string,
    pick: (result: StrategicFitAnalysisResult) => StrategicFitMetric<number>,
  ): StrategicFitResolutionProofMetricClaim => ({
    claim_id: claimId,
    label,
    before: beforeResult === null ? null : pick(beforeResult),
    after: pick(after),
  });
  const count = (
    claimId: string,
    label: string,
    pick: (result: StrategicFitAnalysisResult) => number | string,
  ): StrategicFitResolutionProofCountClaim => ({
    claim_id: claimId,
    label,
    before: beforeResult === null ? null : pick(beforeResult),
    after: pick(after),
  });
  return {
    before_report_id: beforeResult?.report_id ?? null,
    before_repertoire_revision: beforeResult?.repertoire_revision ?? null,
    after_report_id: after.report_id,
    after_repertoire_revision: after.repertoire_revision,
    metrics: [
      metric(
        "familiarity-adjusted-coverage",
        "Familiarity-adjusted coverage",
        (result) => result.summary.metrics.familiarity_adjusted_coverage,
      ),
      metric(
        "training-adjusted-workload",
        "Training-adjusted strategic workload",
        (result) => result.summary.metrics.training_adjusted_workload,
      ),
      metric(
        "strategic-entropy",
        "Strategic entropy",
        (result) => result.summary.metrics.strategic_entropy,
      ),
    ],
    counts: [
      count(
        "unresolved-finding-count",
        "Unresolved findings",
        (result) => result.summary.unresolved_finding_count,
      ),
      count(
        "strategic-family-count",
        "Strategic families",
        (result) => result.summary.strategic_family_count,
      ),
      count("workload-rating", "Workload rating", (result) => result.summary.workload),
    ],
  };
}

function acceptanceOutcome(
  tracked: StrategicFitTrackedAcceptance,
  completed: StrategicFitCompletedResult,
): StrategicFitResolutionProofOutcome {
  const findings = completedFindings(completed);
  const open = findings.find(
    (finding) => finding.semantic_finding_id === tracked.semantic_finding_id,
  );
  const summary = completed.reanalysis ?? null;
  if (open !== undefined) {
    return {
      kind: "still-open",
      finding: open,
      changed_evidence:
        summary?.changed_evidence_semantic_finding_ids.includes(tracked.semantic_finding_id) ===
        true,
    };
  }
  const reconciled =
    summary?.auto_resolved_semantic_finding_ids.includes(tracked.semantic_finding_id) === true ||
    summary?.disappeared_semantic_finding_ids.includes(tracked.semantic_finding_id) === true;
  return {
    kind: "resolved",
    semantic_finding_id: tracked.semantic_finding_id,
    resolving_revision: summary?.resolving_revision ?? completed.result.repertoire_revision,
    reconciled,
  };
}

function undoOutcome(
  tracked: StrategicFitTrackedAcceptance,
  completed: StrategicFitCompletedResult,
): StrategicFitResolutionProofOutcome {
  const open = completedFindings(completed).find(
    (finding) => finding.semantic_finding_id === tracked.semantic_finding_id,
  );
  return open !== undefined
    ? { kind: "restored-open", finding: open }
    : { kind: "restored-absent", semantic_finding_id: tracked.semantic_finding_id };
}

function newFindings(completed: StrategicFitCompletedResult): readonly StrategicFinding[] {
  const summary = completed.reanalysis ?? null;
  if (summary === null || summary.new_semantic_finding_ids.length === 0) return [];
  const ids = new Set(summary.new_semantic_finding_ids);
  return completedFindings(completed).filter((finding) => ids.has(finding.semantic_finding_id));
}

export function createStrategicFitResolutionProofState(
  boundary: StrategicFitResolutionProofBoundary,
) {
  const [snapshot, setSnapshot] =
    createSignal<StrategicFitResolutionProofSnapshot>(initialSnapshot());
  let beforeCompleted: StrategicFitCompletedResult | null = null;
  let expectedRevision: number | null = null;
  let sequence = 0;

  const refreshUndoRecord = (stageId: string, requestSequence: number) => {
    void boundary.undoRecordForStage(stageId).then((record) => {
      if (sequence !== requestSequence) return;
      setSnapshot((previous) =>
        previous.tracked?.stage_id === stageId ? { ...previous, undo_record: record } : previous,
      );
    });
  };

  const track = (stage: StrategicFitStagedChange, before: StrategicFitCompletedResult | null) => {
    if (stage.status !== "accepted" || stage.accepted_revision === null) return false;
    const requestSequence = ++sequence;
    beforeCompleted = before;
    expectedRevision = stage.accepted_revision;
    setSnapshot({
      ...initialSnapshot(),
      status: "awaiting-rescan",
      phase: "acceptance",
      tracked: {
        stage_id: stage.stage_id,
        document_id: stage.document_id,
        base_revision: stage.base_revision,
        accepted_revision: stage.accepted_revision,
        action_summary: {
          archive: stage.change_set.retention.archive,
          prune: stage.change_set.retention.prune,
        },
        candidate_id: stage.change_set.candidate_id,
        finding_id: stage.safety.finding_id,
        semantic_finding_id: stage.safety.semantic_finding_id,
        report_id: stage.safety.report_id,
        repertoire_color: stage.safety.repertoire_color,
        accepted_at: boundary.now(),
      },
    });
    refreshUndoRecord(stage.stage_id, requestSequence);
    return true;
  };

  const synchronize = () => {
    const current = snapshot();
    const tracked = current.tracked;
    if (tracked === null || expectedRevision === null) return;
    if (current.status === "undoing" || current.status === "undo-blocked") return;
    const documentSnapshot = boundary.currentSnapshot();
    if (
      documentSnapshot.document_id !== tracked.document_id ||
      documentSnapshot.repertoire_color !== tracked.repertoire_color ||
      documentSnapshot.repertoire_revision !== expectedRevision
    ) {
      if (current.status === "superseded") return;
      setSnapshot((previous) => ({
        ...previous,
        status: "superseded",
        outcome: null,
        new_findings: [],
        reanalysis: null,
        claims: null,
        superseded_reason:
          documentSnapshot.document_id !== tracked.document_id
            ? "The repertoire document changed, so this change's rescan evidence no longer applies."
            : `Another edit moved the document to revision ${documentSnapshot.repertoire_revision}, so no resolution claim can bind to revision ${expectedRevision}.`,
        error: null,
      }));
      return;
    }
    const lifecycle = boundary.lifecycle();
    const proven: StrategicFitResolutionProofStatus =
      current.phase === "undo" ? "undone" : "proven";
    let next: Partial<StrategicFitResolutionProofSnapshot> & {
      status: StrategicFitResolutionProofStatus;
    };
    if (lifecycle.status === "running" || lifecycle.status === "provisional") {
      next = { status: "rescanning" };
    } else if (lifecycle.status === "failed") {
      next = {
        status: "rescan-failed",
        error: lifecycle.error ?? {
          code: "strategic_fit_rescan_failed",
          message: "The affected-cohort rescan failed, so no resolution claim exists.",
        },
      };
    } else if (lifecycle.status === "cancelled") {
      next = { status: "rescan-cancelled", error: null };
    } else if (
      lifecycle.status === "completed" &&
      lifecycle.current_result !== null &&
      lifecycle.current_result.request_snapshot.document_id === tracked.document_id &&
      lifecycle.current_result.request_snapshot.repertoire_revision === expectedRevision
    ) {
      const completed = lifecycle.current_result;
      next = {
        status: proven,
        outcome:
          current.phase === "undo"
            ? undoOutcome(tracked, completed)
            : acceptanceOutcome(tracked, completed),
        new_findings: current.phase === "undo" ? [] : newFindings(completed),
        reanalysis: completed.reanalysis ?? null,
        claims: reportClaims(beforeCompleted, completed.result),
        error: null,
      };
    } else {
      next = { status: "awaiting-rescan" };
    }
    if (
      next.status === current.status &&
      (next.status !== proven ||
        current.claims?.after_report_id === (lifecycle.current_result?.result.report_id ?? null))
    )
      return;
    setSnapshot((previous) => ({ ...previous, superseded_reason: null, ...next }));
  };

  const undo = async () => {
    const current = snapshot();
    const tracked = current.tracked;
    const record = current.undo_record;
    if (tracked === null || record === null || current.phase === "undo") return false;
    if (current.status === "undoing" || current.status === "undone") return false;
    if (record.status !== "available") return false;
    const requestSequence = ++sequence;
    setSnapshot((previous) => ({ ...previous, status: "undoing", error: null }));
    let result: StrategicFitChangeOperationResult;
    try {
      result = await boundary.undo(record.undo_id);
    } catch (error) {
      if (sequence !== requestSequence) return false;
      setSnapshot((previous) => ({
        ...previous,
        status: "undo-blocked",
        error: {
          code: "undo-failed",
          message: error instanceof Error ? error.message : String(error),
        },
      }));
      refreshUndoRecord(tracked.stage_id, requestSequence);
      return false;
    }
    if (sequence !== requestSequence) return false;
    if (!result.ok) {
      setSnapshot((previous) => ({
        ...previous,
        status: "undo-blocked",
        error: {
          code: result.error,
          message: `Undo was rejected without mutation: ${result.error}.`,
        },
      }));
      refreshUndoRecord(tracked.stage_id, requestSequence);
      return false;
    }
    expectedRevision = result.stage.accepted_revision ?? tracked.accepted_revision + 1;
    setSnapshot((previous) => ({
      ...previous,
      status: "awaiting-rescan",
      phase: "undo",
      outcome: null,
      new_findings: [],
      reanalysis: null,
      claims: null,
      superseded_reason: null,
      error: null,
    }));
    refreshUndoRecord(tracked.stage_id, requestSequence);
    return true;
  };

  const clear = () => {
    sequence++;
    beforeCompleted = null;
    expectedRevision = null;
    setSnapshot(initialSnapshot());
  };

  const setForTesting = (
    value: StrategicFitResolutionProofSnapshot,
    before: StrategicFitCompletedResult | null = null,
    expected: number | null = null,
  ) => {
    if (!import.meta.env.DEV)
      throw new Error("Resolution proof fixture injection is development-only.");
    sequence++;
    beforeCompleted = before;
    expectedRevision = expected ?? value.tracked?.accepted_revision ?? null;
    setSnapshot(value);
  };

  return {
    snapshot,
    track,
    synchronize,
    undo,
    clear,
    setForTesting,
  };
}

export const strategicFitResolutionProof = createStrategicFitResolutionProofState({
  lifecycle: strategicFitLifecycle,
  currentSnapshot: strategicFitCurrentSnapshot,
  undoRecordForStage: strategicFitUndoRecordForStage,
  undo: undoStrategicFitChange,
  now: () => new Date().toISOString(),
});
export const strategicFitResolutionProofSnapshot = strategicFitResolutionProof.snapshot;
