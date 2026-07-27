import {
  REPLACEMENT_ENGINE_CACHE_STATUSES,
  REPLACEMENT_ENGINE_EVIDENCE_STATES,
  REPLACEMENT_ENGINE_ITEM_ERROR_CODES,
  REPLACEMENT_ENGINE_ITEM_STATUSES,
  REPLACEMENT_ENGINE_RESULT_ERROR_CODES,
  REPLACEMENT_ENGINE_RESULT_STATUSES,
  REPLACEMENT_REPERTOIRE_POV_VERDICTS,
  type ReplacementCandidate,
  type ReplacementEngineCacheStatus,
  type ReplacementEngineCandidateSeed,
  type ReplacementEngineEvidenceState,
  type ReplacementEngineItemErrorCode,
  type ReplacementEngineItemStatus,
  type ReplacementEngineResultErrorCode,
  type ReplacementEngineResultStatus,
  type ReplacementRepertoirePovVerdict,
} from "../../src/index.ts";

const evidenceStates: Record<ReplacementEngineEvidenceState, true> = {
  available: true,
  partial: true,
  unavailable: true,
  cancelled: true,
  stale: true,
  rejected: true,
  unverified: true,
};

const itemStatuses: Record<ReplacementEngineItemStatus, true> = {
  accepted: true,
  partial: true,
  illegal: true,
  "malformed-pv": true,
  unavailable: true,
  cancelled: true,
  stale: true,
  rejected: true,
  unverified: true,
  "budget-excluded": true,
};

const itemErrors: Record<ReplacementEngineItemErrorCode, true> = {
  "illegal-uci": true,
  "malformed-pv": true,
  "malformed-evaluation": true,
  "stale-engine-position": true,
  "stale-engine-request": true,
  "engine-version-mismatch": true,
  "engine-identity-mismatch": true,
  "engine-unavailable": true,
  "engine-cancelled": true,
  "engine-rejected": true,
  "engine-unverified": true,
  "engine-source-not-requested": true,
  "original-pivot-move": true,
  "outside-evaluation-tolerance": true,
  "forced-mate-against-repertoire": true,
  "duplicate-multipv-rank": true,
  "canonical-outcome-rejected": true,
  "multipv-budget-exceeded": true,
  "maximum-engine-positions-exceeded": true,
  "maximum-candidates-exceeded": true,
};

const resultStatuses: Record<ReplacementEngineResultStatus, true> = {
  complete: true,
  partial: true,
  unavailable: true,
  cancelled: true,
  stale: true,
  rejected: true,
  unverified: true,
  "non-actionable": true,
  "invalid-request": true,
};

const resultErrors: Record<ReplacementEngineResultErrorCode, true> = {
  "pivot-not-selected": true,
  "request-pivot-mismatch": true,
  "candidate-generation-mismatch": true,
  "repertoire-color-mismatch": true,
  "pivot-position-stale": true,
  "pivot-decision-stale": true,
  "invalid-engine-depth": true,
  "invalid-engine-multipv": true,
  "invalid-evaluation-tolerance": true,
  "invalid-engine-position-budget": true,
  "invalid-maximum-candidates": true,
};

const cacheStatuses: Record<ReplacementEngineCacheStatus, true> = {
  hit: true,
  miss: true,
  "not-configured": true,
  bypassed: true,
};

const verdicts: Record<ReplacementRepertoirePovVerdict, true> = {
  unverified: true,
  "within-tolerance": true,
  "outside-tolerance": true,
  "forced-mate-for-repertoire": true,
  "forced-mate-against-repertoire": true,
};

declare const engineSeed: ReplacementEngineCandidateSeed;
// @ts-expect-error Task 8.4 engine seeds still lack the mandatory Task 8.1 full subtree.
const invalidFinishedCandidate: ReplacementCandidate = engineSeed;

void evidenceStates;
void itemStatuses;
void itemErrors;
void resultStatuses;
void resultErrors;
void cacheStatuses;
void verdicts;
void invalidFinishedCandidate;
void REPLACEMENT_ENGINE_EVIDENCE_STATES;
void REPLACEMENT_ENGINE_ITEM_STATUSES;
void REPLACEMENT_ENGINE_ITEM_ERROR_CODES;
void REPLACEMENT_ENGINE_RESULT_STATUSES;
void REPLACEMENT_ENGINE_RESULT_ERROR_CODES;
void REPLACEMENT_ENGINE_CACHE_STATUSES;
void REPLACEMENT_REPERTOIRE_POV_VERDICTS;
