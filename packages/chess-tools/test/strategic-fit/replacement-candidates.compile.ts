import {
  REPLACEMENT_CANDIDATE_GENERATION_ERROR_CODES,
  REPLACEMENT_CANDIDATE_GENERATION_STATUSES,
  REPLACEMENT_CANDIDATE_MEMORY_CLASSES,
  REPLACEMENT_CANDIDATE_SEED_STATUSES,
  REPLACEMENT_DATABASE_EVIDENCE_STATES,
  REPLACEMENT_DATABASE_ITEM_ERROR_CODES,
  REPLACEMENT_DATABASE_ITEM_RESULT_STATUSES,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
  type ReplacementCandidate,
  type ReplacementCandidateGenerationErrorCode,
  type ReplacementCandidateGenerationStatus,
  type ReplacementCandidateMemoryClass,
  type ReplacementCandidateSeed,
  type ReplacementCandidateSeedStatus,
  type ReplacementDatabaseEvidenceState,
  type ReplacementDatabaseItemErrorCode,
  type ReplacementDatabaseItemResultStatus,
  type ReplacementOpeningDatabaseEvidence,
} from "../../src/index.ts";

const version = {
  schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  replacement_schema_version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
} as const;

export const OPENING_DATABASE_EVIDENCE_FIXTURE = {
  ...version,
  evidence_id: "database-evidence:fixture",
  state: "available",
  database: "lichess",
  provider: "fixture-provider",
  version: "fixture-v1",
  snapshot: "2026-07-27T00:00:00Z",
  filter_key: "db=lichess|speeds=rapid|ratings=1800|since=|until=|moves=12",
  filters: {
    db: "lichess",
    speeds: ["rapid"],
    ratings: [1800],
    since: null,
    until: null,
    movesLimit: 12,
  },
  position: {
    position_id: "position:pivot",
    position_key: "pivot-key",
    fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  },
  moves: [{
    move_id: "database-move:Nf3",
    san: "Nf3",
    uci: "g1f3",
    popularity: {
      games: 100,
      played_pct: 50,
      white_pct: 40,
      draw_pct: 30,
      black_pct: 30,
      average_rating: 1900,
    },
    provenance: [{
      source_id: "opening-explorer:fixture-move",
      kind: "opening-explorer",
      state: "available",
      version: "fixture-v1",
      snapshot: "2026-07-27T00:00:00Z",
      reason: null,
    }],
  }],
  reason: null,
  provenance: [{
    source_id: "opening-explorer:fixture",
    kind: "opening-explorer",
    state: "available",
    version: "fixture-v1",
    snapshot: "2026-07-27T00:00:00Z",
    reason: null,
  }],
} satisfies ReplacementOpeningDatabaseEvidence;

const evidenceStates: Record<ReplacementDatabaseEvidenceState, true> = {
  available: true,
  partial: true,
  missing: true,
  offline: true,
  unavailable: true,
  stale: true,
  rejected: true,
};

const seedStatuses: Record<ReplacementCandidateSeedStatus, true> = {
  "ready-for-expansion": true,
  "partial-generation": true,
};

const memoryClasses: Record<ReplacementCandidateMemoryClass, true> = {
  low: true,
  unknown: true,
};

const itemStatuses: Record<ReplacementDatabaseItemResultStatus, true> = {
  accepted: true,
  illegal: true,
  stale: true,
  rejected: true,
  "budget-excluded": true,
};

const itemErrors: Record<ReplacementDatabaseItemErrorCode, true> = {
  "illegal-san": true,
  "illegal-uci": true,
  "san-uci-mismatch": true,
  "stale-pivot-position": true,
  "stale-source": true,
  "source-unavailable": true,
  "source-rejected": true,
  "source-not-requested": true,
  "database-filter-mismatch": true,
  "original-pivot-move": true,
  "maximum-candidates-exceeded": true,
};

const generationStatuses: Record<ReplacementCandidateGenerationStatus, true> = {
  complete: true,
  partial: true,
  "non-actionable": true,
  stale: true,
  "invalid-request": true,
};

const generationErrors: Record<ReplacementCandidateGenerationErrorCode, true> = {
  "pivot-not-selected": true,
  "request-pivot-mismatch": true,
  "repertoire-color-mismatch": true,
  "pivot-position-stale": true,
  "pivot-decision-stale": true,
  "invalid-maximum-candidates": true,
};

declare const seed: ReplacementCandidateSeed;
// @ts-expect-error Candidate seeds cannot satisfy Task 8.1 full-subtree candidates.
const invalidFinishedCandidate: ReplacementCandidate = seed;

const stateValues: readonly ReplacementDatabaseEvidenceState[] = REPLACEMENT_DATABASE_EVIDENCE_STATES;
const seedStatusValues: readonly ReplacementCandidateSeedStatus[] = REPLACEMENT_CANDIDATE_SEED_STATUSES;
const memoryValues: readonly ReplacementCandidateMemoryClass[] = REPLACEMENT_CANDIDATE_MEMORY_CLASSES;
const itemStatusValues: readonly ReplacementDatabaseItemResultStatus[] = REPLACEMENT_DATABASE_ITEM_RESULT_STATUSES;
const itemErrorValues: readonly ReplacementDatabaseItemErrorCode[] = REPLACEMENT_DATABASE_ITEM_ERROR_CODES;
const resultStatusValues: readonly ReplacementCandidateGenerationStatus[] = REPLACEMENT_CANDIDATE_GENERATION_STATUSES;
const resultErrorValues: readonly ReplacementCandidateGenerationErrorCode[] = REPLACEMENT_CANDIDATE_GENERATION_ERROR_CODES;

void evidenceStates;
void seedStatuses;
void memoryClasses;
void itemStatuses;
void itemErrors;
void generationStatuses;
void generationErrors;
void invalidFinishedCandidate;
void stateValues;
void seedStatusValues;
void memoryValues;
void itemStatusValues;
void itemErrorValues;
void resultStatusValues;
void resultErrorValues;
