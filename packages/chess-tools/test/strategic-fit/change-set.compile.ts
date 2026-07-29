import {
  REPLACEMENT_CHANGE_SET_ERROR_CODES,
  TASK_8_8_CHANGE_OPERATION_KINDS,
  type ApplyReplacementChangeSetInput,
  type ConstructReplacementChangeSetInput,
  type ReplacementAtomicChangeSetResult,
  type ReplacementCandidate,
  type ReplacementCandidateExpansion,
  type ReplacementCandidateSafetySimulation,
  type ReplacementChangeSetErrorCode,
  type ReplacementEngineCandidateSeed,
  type ReplacementScoredCandidate,
  type Task88ChangeOperationKind,
} from "../../src/index.ts";

const operationKinds: Record<Task88ChangeOperationKind, true> = {
  "add-subtree": true,
  "link-transposition": true,
  "preserve-annotation": true,
  "archive-subtree": true,
  "prune-subtree": true,
  "reorder-variations": true,
};

const errors: Record<ReplacementChangeSetErrorCode, true> = {
  "stale-revision": true,
  "safety-not-current": true,
  "safety-candidate-not-safe": true,
  "change-set-identity-mismatch": true,
  "change-set-version-mismatch": true,
  "change-set-not-validated": true,
  "unsupported-operation": true,
  "duplicate-operation": true,
  "invalid-operation-order": true,
  "invalid-retention": true,
  "stale-semantic-path": true,
  "semantic-identity-mismatch": true,
  "candidate-subtree-mismatch": true,
  "illegal-operation": true,
  "transposition-link-mismatch": true,
  "annotation-not-equivalent": true,
  "archive-payload-mismatch": true,
  "archive-required": true,
  "prune-not-confirmed": true,
  "reorder-boundary-mismatch": true,
  "result-graph-mismatch": true,
  "transaction-failed": true,
};

declare const task81: ReplacementCandidate;
declare const task83: import("../../src/index.ts").ReplacementCandidateSeed;
declare const task84: ReplacementEngineCandidateSeed;
declare const task85: ReplacementCandidateExpansion;
declare const task86: ReplacementScoredCandidate;
declare const task87: ReplacementCandidateSafetySimulation;
declare const construction: ConstructReplacementChangeSetInput;
declare const application: ApplyReplacementChangeSetInput;
declare const result: ReplacementAtomicChangeSetResult;

// @ts-expect-error Task 8.1 finished candidate is not current Task 8.7 safety input.
const invalidTask81: ConstructReplacementChangeSetInput["safety"] = task81;
// @ts-expect-error Task 8.3 seed cannot cross Task 8.8 boundary.
const invalidTask83: ConstructReplacementChangeSetInput["safety"] = task83;
// @ts-expect-error Task 8.4 seed cannot cross Task 8.8 boundary.
const invalidTask84: ConstructReplacementChangeSetInput["safety"] = task84;
// @ts-expect-error Task 8.5 expansion cannot cross Task 8.8 boundary.
const invalidTask85: ConstructReplacementChangeSetInput["safety"] = task85;
// @ts-expect-error Task 8.6 score cannot cross Task 8.8 boundary.
const invalidTask86: ConstructReplacementChangeSetInput["safety"] = task86;
// @ts-expect-error One candidate simulation lacks complete Task 8.7 result evidence.
const invalidTask87: ConstructReplacementChangeSetInput["safety"] = task87;

void operationKinds;
void errors;
void construction;
void application;
void result;
void invalidTask81;
void invalidTask83;
void invalidTask84;
void invalidTask85;
void invalidTask86;
void invalidTask87;
void TASK_8_8_CHANGE_OPERATION_KINDS;
void REPLACEMENT_CHANGE_SET_ERROR_CODES;
