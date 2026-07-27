import {
  REPLACEMENT_EXPANSION_EVIDENCE_STATES,
  REPLACEMENT_EXPANSION_ITEM_ERROR_CODES,
  REPLACEMENT_EXPANSION_ITEM_STATUSES,
  REPLACEMENT_EXPANSION_OMISSION_REASONS,
  REPLACEMENT_EXPANSION_PROGRESS_STATES,
  REPLACEMENT_EXPANSION_RISK_KINDS,
  REPLACEMENT_EXPANSION_RESULT_ERROR_CODES,
  REPLACEMENT_EXPANSION_RESULT_STATUSES,
  type ReplacementCandidate,
  type ReplacementCandidateExpansion,
  type ReplacementCandidateSeed,
  type ReplacementEngineCandidateSeed,
  type ReplacementExpansionEvidenceState,
  type ReplacementExpansionItemErrorCode,
  type ReplacementExpansionItemStatus,
  type ReplacementExpansionOmissionReason,
  type ReplacementExpansionProgressState,
  type ReplacementExpansionRiskKind,
  type ReplacementExpansionResultErrorCode,
  type ReplacementExpansionResultStatus,
} from "../../src/index.ts";

const evidenceStates: Record<ReplacementExpansionEvidenceState, true> = {
  available: true,
  partial: true,
  unavailable: true,
  cancelled: true,
  stale: true,
  malformed: true,
};

const itemStatuses: Record<ReplacementExpansionItemStatus, true> = {
  complete: true,
  truncated: true,
  "budget-exhausted": true,
  unresolved: true,
  illegal: true,
  malformed: true,
  unavailable: true,
  cancelled: true,
  stale: true,
};

const itemErrors: Record<ReplacementExpansionItemErrorCode, true> = {
  "illegal-san": true,
  "illegal-uci": true,
  "san-uci-mismatch": true,
  "malformed-pv": true,
  "malformed-popularity": true,
  "malformed-evidence": true,
  "stale-position": true,
  "stale-request": true,
  "provider-unavailable": true,
  "provider-cancelled": true,
  "subtree-node-budget-exhausted": true,
  "engine-position-budget-exhausted": true,
  "explorer-query-budget-exhausted": true,
  "strategic-horizon-unresolved": true,
  "reply-policy-excluded": true,
  "popularity-filtered": true,
  "no-legal-continuation": true,
  "transposition-unresolved": true,
};

const resultStatuses: Record<ReplacementExpansionResultStatus, true> = {
  complete: true,
  partial: true,
  unavailable: true,
  cancelled: true,
  stale: true,
  "invalid-request": true,
};

const resultErrors: Record<ReplacementExpansionResultErrorCode, true> = {
  "pivot-not-selected": true,
  "request-pivot-mismatch": true,
  "candidate-generation-mismatch": true,
  "engine-generation-mismatch": true,
  "repertoire-color-mismatch": true,
  "pivot-position-stale": true,
  "pivot-decision-stale": true,
  "invalid-maximum-candidates": true,
  "invalid-subtree-node-budget": true,
  "invalid-engine-position-budget": true,
  "invalid-explorer-query-budget": true,
  "invalid-engine-depth": true,
  "invalid-engine-multipv": true,
  "invalid-strategic-horizon": true,
  "invalid-popularity-threshold": true,
  "invalid-reply-policy": true,
};

const progressStates: Record<ReplacementExpansionProgressState, true> = {
  running: true,
  completed: true,
  cancelled: true,
};

const omissionReasons: Record<ReplacementExpansionOmissionReason, true> = {
  "popularity-filtered": true,
  "reply-policy-excluded": true,
  "subtree-node-budget-exhausted": true,
  "engine-position-budget-exhausted": true,
  "explorer-query-budget-exhausted": true,
  "provider-unavailable": true,
  "provider-cancelled": true,
  "illegal-evidence": true,
  "malformed-evidence": true,
  "strategic-horizon-unresolved": true,
  "no-legal-continuation": true,
  "transposition-unresolved": true,
};

const riskKinds: Record<ReplacementExpansionRiskKind, true> = {
  "incomplete-expansion": true,
  "unresolved-forcing-reply": true,
  "engine-unverified": true,
  "transposition-uncertain": true,
  "stale-source": true,
};

declare const expansion: ReplacementCandidateExpansion;
declare const task83Seed: ReplacementCandidateSeed;
declare const task84Seed: ReplacementEngineCandidateSeed;

// @ts-expect-error Task 8.5 expansion intentionally lacks Task 8.6 scoring/Pareto/change-set fields.
const invalidFinishedCandidate: ReplacementCandidate = expansion;
// @ts-expect-error Task 8.3 seed is not a Task 8.5 expansion.
const invalidTask83Expansion: ReplacementCandidateExpansion = task83Seed;
// @ts-expect-error Task 8.4 enriched seed is not a Task 8.5 expansion.
const invalidTask84Expansion: ReplacementCandidateExpansion = task84Seed;

void evidenceStates;
void itemStatuses;
void itemErrors;
void resultStatuses;
void resultErrors;
void progressStates;
void omissionReasons;
void riskKinds;
void invalidFinishedCandidate;
void invalidTask83Expansion;
void invalidTask84Expansion;
void REPLACEMENT_EXPANSION_EVIDENCE_STATES;
void REPLACEMENT_EXPANSION_ITEM_STATUSES;
void REPLACEMENT_EXPANSION_ITEM_ERROR_CODES;
void REPLACEMENT_EXPANSION_RESULT_STATUSES;
void REPLACEMENT_EXPANSION_RESULT_ERROR_CODES;
void REPLACEMENT_EXPANSION_PROGRESS_STATES;
void REPLACEMENT_EXPANSION_OMISSION_REASONS;
void REPLACEMENT_EXPANSION_RISK_KINDS;
