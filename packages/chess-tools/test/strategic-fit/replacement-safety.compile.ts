import {
  REPLACEMENT_SAFETY_ACTIONS,
  REPLACEMENT_SAFETY_CANDIDATE_STATUSES,
  REPLACEMENT_SAFETY_ERROR_CODES,
  REPLACEMENT_SAFETY_RESULT_STATUSES,
  type ReplacementCandidate,
  type ReplacementCandidateExpansion,
  type ReplacementCandidateSafetySimulation,
  type ReplacementEngineCandidateSeed,
  type ReplacementSafetyAction,
  type ReplacementSafetyCandidateStatus,
  type ReplacementSafetyErrorCode,
  type ReplacementSafetyResultStatus,
  type ReplacementScoredCandidate,
} from "../../src/index.ts";

const actions: Record<ReplacementSafetyAction, true> = {
  "add-alternative": true,
  replace: true,
};

const candidateStatuses: Record<ReplacementSafetyCandidateStatus, true> = {
  safe: true,
  partial: true,
  blocked: true,
  unavailable: true,
};

const resultStatuses: Record<ReplacementSafetyResultStatus, true> = {
  complete: true,
  partial: true,
  blocked: true,
  unavailable: true,
  stale: true,
  "invalid-request": true,
};

const errors: Record<ReplacementSafetyErrorCode, true> = {
  "request-scoring-mismatch": true,
  "scoring-not-current": true,
  "source-graph-mismatch": true,
  "duplicate-candidate-action": true,
  "unknown-candidate": true,
  "invalid-candidate-action": true,
  "prune-not-confirmed": true,
  "candidate-unscored": true,
  "candidate-expansion-incomplete": true,
  "candidate-identity-mismatch": true,
  "simulation-failed": true,
  "required-reply-uncovered": true,
  "objective-safety-blocked": true,
};

declare const task83: import("../../src/index.ts").ReplacementCandidateSeed;
declare const task84: ReplacementEngineCandidateSeed;
declare const task85: ReplacementCandidateExpansion;
declare const task86: ReplacementScoredCandidate;
declare const task87: ReplacementCandidateSafetySimulation;

// @ts-expect-error Task 8.3 seed cannot cross the Task 8.7 boundary.
const invalidTask83: ReplacementCandidateSafetySimulation = task83;
// @ts-expect-error Task 8.4 seed cannot cross the Task 8.7 boundary.
const invalidTask84: ReplacementCandidateSafetySimulation = task84;
// @ts-expect-error Task 8.5 expansion cannot cross the Task 8.7 boundary.
const invalidTask85: ReplacementCandidateSafetySimulation = task85;
// @ts-expect-error Task 8.6 score lacks clone safety effects.
const invalidTask86: ReplacementCandidateSafetySimulation = task86;
// @ts-expect-error Task 8.7 does not fabricate Task 8.8 retention/change-set fields.
const invalidFinishedCandidate: ReplacementCandidate = task87;

void actions;
void candidateStatuses;
void resultStatuses;
void errors;
void invalidTask83;
void invalidTask84;
void invalidTask85;
void invalidTask86;
void invalidFinishedCandidate;
void REPLACEMENT_SAFETY_ACTIONS;
void REPLACEMENT_SAFETY_CANDIDATE_STATUSES;
void REPLACEMENT_SAFETY_RESULT_STATUSES;
void REPLACEMENT_SAFETY_ERROR_CODES;
