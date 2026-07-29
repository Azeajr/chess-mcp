import {
  REPLACEMENT_PARETO_AXES,
  REPLACEMENT_PARETO_STATUSES,
  REPLACEMENT_SCORING_ERROR_CODES,
  REPLACEMENT_SCORING_RESULT_STATUSES,
  REPLACEMENT_SCORE_STATES,
  REPLACEMENT_STRATEGIC_SCORE_AXES,
  type ReplacementCandidate,
  type ReplacementCandidateExpansion,
  type ReplacementCandidateSeed,
  type ReplacementEngineCandidateSeed,
  type ReplacementParetoAxis,
  type ReplacementParetoStatus,
  type ReplacementScoredCandidate,
  type ReplacementScoringErrorCode,
  type ReplacementScoringResultStatus,
  type ReplacementScoreState,
  type ReplacementStrategicScoreAxis,
} from "../../src/index.ts";

const scoreStates: Record<ReplacementScoreState, true> = {
  available: true,
  partial: true,
  unavailable: true,
};

const scoreAxes: Record<ReplacementStrategicScoreAxis, true> = {
  "strategic-fit": true,
  "strategic-familiarity": true,
  "memorization-burden": true,
  "expected-coverage": true,
  "new-concepts": true,
  "theory-size": true,
  popularity: true,
  "homogenization-cost": true,
  "training-cost": true,
};

const paretoAxes: Record<ReplacementParetoAxis, true> = {
  "objective-quality": true,
  ...scoreAxes,
};

const paretoStatuses: Record<ReplacementParetoStatus, true> = {
  unscored: true,
  "pareto-optimal": true,
  dominated: true,
};

const resultStatuses: Record<ReplacementScoringResultStatus, true> = {
  complete: true,
  partial: true,
  unavailable: true,
  stale: true,
  "invalid-request": true,
};

const errors: Record<ReplacementScoringErrorCode, true> = {
  "request-expansion-mismatch": true,
  "expansion-not-current": true,
  "graph-context-mismatch": true,
  "cohort-context-mismatch": true,
  "trajectory-context-mismatch": true,
  "concept-context-mismatch": true,
  "invalid-training-evidence": true,
  "invalid-profile": true,
  "malformed-expansion": true,
};

declare const scored: ReplacementScoredCandidate;
declare const task83Seed: ReplacementCandidateSeed;
declare const task84Seed: ReplacementEngineCandidateSeed;
declare const task85Expansion: ReplacementCandidateExpansion;

// @ts-expect-error Task 8.6 does not fabricate Task 8.7 coverage or Task 8.8 change-set fields.
const invalidFinishedCandidate: ReplacementCandidate = scored;
// @ts-expect-error Task 8.3 seed cannot cross the Task 8.6 expansion boundary.
const invalidTask83Score: ReplacementScoredCandidate = task83Seed;
// @ts-expect-error Task 8.4 seed cannot cross the Task 8.6 expansion boundary.
const invalidTask84Score: ReplacementScoredCandidate = task84Seed;
// @ts-expect-error Task 8.5 expansion lacks Task 8.6 score and Pareto fields.
const invalidTask85Score: ReplacementScoredCandidate = task85Expansion;

void scoreStates;
void scoreAxes;
void paretoAxes;
void paretoStatuses;
void resultStatuses;
void errors;
void invalidFinishedCandidate;
void invalidTask83Score;
void invalidTask84Score;
void invalidTask85Score;
void REPLACEMENT_SCORE_STATES;
void REPLACEMENT_STRATEGIC_SCORE_AXES;
void REPLACEMENT_PARETO_AXES;
void REPLACEMENT_PARETO_STATUSES;
void REPLACEMENT_SCORING_RESULT_STATUSES;
void REPLACEMENT_SCORING_ERROR_CODES;
