import {
  type ReplacementCausalPivotEvidence,
  type ReplacementPivotNonActionableReason,
  type ReplacementPivotResultStatus,
  type ReplacementPivotSelectionResult,
  type ReplacementUserCandidateLineErrorCode,
  type ReplacementUserCandidateLineStatus,
} from "../../src/index.ts";

const resultStatuses: Record<ReplacementPivotResultStatus, true> = {
  selected: true,
  "alternatives-required": true,
  "non-actionable": true,
};

const nonActionableReasons: Record<ReplacementPivotNonActionableReason, true> = {
  "request-finding-mismatch": true,
  "request-cohort-mismatch": true,
  "repertoire-revision-mismatch": true,
  "repertoire-color-mismatch": true,
  "finding-evidence-cohort-mismatch": true,
  "finding-routes-stale": true,
  "opponent-controlled": true,
  "unknown-causality": true,
  "no-supported-causal-pivot": true,
  "unknown-user-selected-decision": true,
  "stale-user-selected-decision": true,
  "user-selected-decision-not-repertoire-owned": true,
};

const candidateStatuses: Record<ReplacementUserCandidateLineStatus, true> = {
  valid: true,
  illegal: true,
  stale: true,
};

const candidateErrors: Record<ReplacementUserCandidateLineErrorCode, true> = {
  "empty-line": true,
  "illegal-san": true,
  "pivot-selection-required": true,
  "pivot-unavailable": true,
};

declare const selectionResult: ReplacementPivotSelectionResult;
const task81CompatiblePivot: ReplacementCausalPivotEvidence = selectionResult.pivot;

if (selectionResult.status === "selected") {
  const decisionId: string = selectionResult.pivot.decision_id;
  void decisionId;
}
if (selectionResult.status === "alternatives-required") {
  const firstAlternative = selectionResult.alternative_pivots[0];
  const decisionId: string = firstAlternative.decision_id;
  void decisionId;
}
if (selectionResult.status === "non-actionable") {
  const decisionId: null = selectionResult.pivot.decision_id;
  const reason: ReplacementPivotNonActionableReason = selectionResult.non_actionable_reason;
  void decisionId;
  void reason;
}

void resultStatuses;
void nonActionableReasons;
void candidateStatuses;
void candidateErrors;
void task81CompatiblePivot;
