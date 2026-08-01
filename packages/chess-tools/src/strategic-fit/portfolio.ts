/**
 * Deterministic half of constrained portfolio redesign (Task 11.5).
 *
 * A user can ask for a redesign in their own terms — "reduce unique pawn structures by 20% without
 * losing more than 0.15 and keep at least 95% popularity-weighted coverage" — and the assistant may
 * translate that into structured bounds. It may not decide which alternatives exist, what they cost,
 * or which one wins. This module owns the boundary that must not depend on a host: strict validation
 * of the requested bounds, deterministic conflict detection against declared intent, and a bounded
 * portfolio whose every option is one already-produced Task 8.7 candidate with its own Task 8.8
 * change set attached.
 *
 * Two rules make the portfolio impossible to fake. Every reported number is read out of retained
 * domain evidence rather than accepted as an argument, so the schema has nowhere to put a fabricated
 * evaluation or coverage figure. And missing evidence never passes a check: a candidate whose
 * constrained metric is unavailable is eliminated with that reason, exactly as Task 8.7 refuses to
 * convert an absent value into a passing safety claim.
 *
 * Nothing here selects, stages, applies, or persists. Pareto status comes from Task 8.6 and is
 * carried through unchanged rather than recomputed for the constrained subset.
 */
import type {
  ReplacementCandidateSafetySimulation,
  ReplacementSafetySimulationResult,
} from "./replacement-safety.js";
import type { ReplacementToolV2Item } from "./replacement-tool.js";
import type {
  ReplacementParetoStatus,
  ReplacementSafetyCheckKind,
  ReplacementSafetyCheckStatus,
} from "./replacement-types.js";
import type { StrategicFitProfile } from "./types.js";
import { assertDefined } from "../assert.js";

export const STRATEGIC_FIT_PORTFOLIO_VERSION = "1.0.0";

/** Fixed bounds for a model-authored request and the portfolio returned for it. */
export const STRATEGIC_FIT_PORTFOLIO_LIMITS = Object.freeze({
  constraints: 7,
  options: 6,
  eliminations: 24,
  rationale_characters: 400,
});

/**
 * The bounds a request may express. Each one names a metric the deterministic chain already
 * produces, so a constraint can be checked rather than believed. There is deliberately no way to
 * state a legality claim, an evaluation, a coverage figure, or a candidate move here.
 */
export const STRATEGIC_FIT_PORTFOLIO_CONSTRAINT_KINDS = [
  "maximum_engine_loss_cp",
  "minimum_expected_opponent_coverage",
  "maximum_added_theory_nodes",
  "maximum_new_concept_count",
  "maximum_homogenization_cost",
  "maximum_memorization_burden",
  "minimum_strategic_fit_delta",
] as const;
export type StrategicFitPortfolioConstraintKind =
  (typeof STRATEGIC_FIT_PORTFOLIO_CONSTRAINT_KINDS)[number];

export const STRATEGIC_FIT_PORTFOLIO_CONFLICT_SOURCES = [
  "declared-preference",
  "requested-constraints",
] as const;
export type StrategicFitPortfolioConflictSource =
  (typeof STRATEGIC_FIT_PORTFOLIO_CONFLICT_SOURCES)[number];

export const STRATEGIC_FIT_PORTFOLIO_ERROR_CODES = [
  "strategic_fit_portfolio_empty_constraints",
  "strategic_fit_portfolio_unknown_constraint",
  "strategic_fit_portfolio_invalid_value",
  "strategic_fit_portfolio_unconfirmed_constraints",
  "strategic_fit_portfolio_evidence_unavailable",
  "strategic_fit_portfolio_unknown_option",
  "strategic_fit_portfolio_stale",
  "strategic_fit_portfolio_not_pending",
] as const;
export type StrategicFitPortfolioErrorCode = (typeof STRATEGIC_FIT_PORTFOLIO_ERROR_CODES)[number];

export class StrategicFitPortfolioError extends Error {
  readonly code: StrategicFitPortfolioErrorCode;
  constructor(code: StrategicFitPortfolioErrorCode, message: string) {
    super(message);
    this.name = "StrategicFitPortfolioError";
    this.code = code;
  }
}

export interface StrategicFitPortfolioErrorResult {
  readonly error: StrategicFitPortfolioErrorCode;
  readonly reason: string;
}

/** Shared host mapping from a validation failure to one structured, code-bearing result. */
export function strategicFitPortfolioErrorResult(error: unknown): StrategicFitPortfolioErrorResult {
  if (error instanceof StrategicFitPortfolioError)
    return { error: error.code, reason: error.message };
  throw error;
}

interface ConstraintDefinition {
  readonly direction: "maximum" | "minimum";
  readonly unit: string;
  readonly label: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly integer: boolean;
}

const CONSTRAINT_DEFINITIONS: Readonly<
  Record<StrategicFitPortfolioConstraintKind, ConstraintDefinition>
> = {
  maximum_engine_loss_cp: {
    direction: "maximum",
    unit: "centipawns",
    label: "Evaluation loss from best, repertoire POV",
    minimum: 0,
    maximum: 1000,
    integer: true,
  },
  minimum_expected_opponent_coverage: {
    direction: "minimum",
    unit: "share of expected opponent replies",
    label: "Expected opponent coverage",
    minimum: 0,
    maximum: 1,
    integer: false,
  },
  maximum_added_theory_nodes: {
    direction: "maximum",
    unit: "theory nodes",
    label: "Theory nodes added",
    minimum: 0,
    maximum: 10_000,
    integer: true,
  },
  maximum_new_concept_count: {
    direction: "maximum",
    unit: "concepts",
    label: "New strategic concepts introduced",
    minimum: 0,
    maximum: 128,
    integer: true,
  },
  maximum_homogenization_cost: {
    direction: "maximum",
    unit: "normalized cost",
    label: "Structural homogenization cost",
    minimum: 0,
    maximum: 1,
    integer: false,
  },
  maximum_memorization_burden: {
    direction: "maximum",
    // Task 8.6 reports this as unnormalized burden points (expected new concepts plus added
    // positions weighted by the profile's memorization tolerance), so the bound uses the same
    // scale. A 0-1 bound would silently exclude every candidate.
    unit: "burden points",
    label: "Memorization burden",
    minimum: 0,
    maximum: 10_000,
    integer: false,
  },
  minimum_strategic_fit_delta: {
    direction: "minimum",
    unit: "normalized change in strategic fit",
    label: "Strategic-fit improvement",
    minimum: -1,
    maximum: 1,
    integer: false,
  },
};

export interface StrategicFitPortfolioConstraint {
  readonly kind: StrategicFitPortfolioConstraintKind;
  readonly direction: "maximum" | "minimum";
  readonly value: number;
  readonly unit: string;
  /** Plain text for the confirmation the user sees before anything binds. */
  readonly label: string;
}

export interface StrategicFitPortfolioConstraintSet {
  readonly constraints: readonly StrategicFitPortfolioConstraint[];
  readonly rationale: string | null;
}

export interface StrategicFitPortfolioConstraintInput {
  readonly constraints?: unknown;
  readonly rationale?: unknown;
}

function invalidValue(field: string, requirement: string): never {
  throw new StrategicFitPortfolioError(
    "strategic_fit_portfolio_invalid_value",
    `${field} ${requirement}. Propose a bound the user could have stated themselves; values are never adjusted to fit.`,
  );
}

/**
 * Validate the requested bounds. Rejection rather than repair, for the same reason as the intent
 * interview: a number the user typed has a witness, a number the model produced does not.
 */
export function resolveStrategicFitPortfolioConstraints(
  input: StrategicFitPortfolioConstraintInput,
): StrategicFitPortfolioConstraintSet {
  if (
    typeof input !== "object" ||
    // input's declared type promises an object, but this is a model-authored request from an
    // untrusted external caller at runtime — this revalidates it.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    input === null ||
    Array.isArray(input)
  ) {
    invalidValue("request", "must be an object with constraints");
  }
  const raw = input.constraints;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new StrategicFitPortfolioError(
      "strategic_fit_portfolio_empty_constraints",
      "A redesign request must state at least one bound. Ask the user what they want to hold fixed — evaluation, coverage, theory, concepts, structure, or memorization — rather than proposing a redesign with nothing to satisfy.",
    );
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) {
    throw new StrategicFitPortfolioError(
      "strategic_fit_portfolio_empty_constraints",
      "constraints must contain at least one bound.",
    );
  }
  if (entries.length > STRATEGIC_FIT_PORTFOLIO_LIMITS.constraints) {
    invalidValue(
      "constraints",
      `must contain at most ${STRATEGIC_FIT_PORTFOLIO_LIMITS.constraints} bounds`,
    );
  }
  const constraints: StrategicFitPortfolioConstraint[] = [];
  for (const kind of STRATEGIC_FIT_PORTFOLIO_CONSTRAINT_KINDS) {
    if (!(kind in (raw as Record<string, unknown>))) continue;
    const definition = CONSTRAINT_DEFINITIONS[kind];
    const value = (raw as Record<string, unknown>)[kind];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      invalidValue(
        `constraints.${kind}`,
        `must be a finite number from ${definition.minimum} to ${definition.maximum}`,
      );
    }
    if (value < definition.minimum || value > definition.maximum) {
      invalidValue(
        `constraints.${kind}`,
        `must be from ${definition.minimum} to ${definition.maximum}, but ${value} was requested`,
      );
    }
    if (definition.integer && !Number.isInteger(value)) {
      invalidValue(`constraints.${kind}`, `must be a whole number of ${definition.unit}`);
    }
    constraints.push({
      kind,
      direction: definition.direction,
      value,
      unit: definition.unit,
      label: `${definition.label}: ${definition.direction === "maximum" ? "at most" : "at least"} ${value} ${definition.unit}`,
    });
  }
  for (const [key] of entries) {
    if (!(STRATEGIC_FIT_PORTFOLIO_CONSTRAINT_KINDS as readonly string[]).includes(key)) {
      throw new StrategicFitPortfolioError(
        "strategic_fit_portfolio_unknown_constraint",
        `constraints.${key} is not a Strategic Fit redesign bound. Valid bounds: ${STRATEGIC_FIT_PORTFOLIO_CONSTRAINT_KINDS.join(", ")}. A bound this list does not contain would have no deterministic measurement to check it against.`,
      );
    }
  }
  let rationale: string | null = null;
  if (input.rationale !== undefined) {
    if (
      typeof input.rationale !== "string" ||
      input.rationale.length > STRATEGIC_FIT_PORTFOLIO_LIMITS.rationale_characters
    ) {
      invalidValue(
        "rationale",
        `must be a string of at most ${STRATEGIC_FIT_PORTFOLIO_LIMITS.rationale_characters} characters`,
      );
    }
    const trimmed = input.rationale.trim();
    rationale = trimmed.length ? trimmed : null;
  }
  return { constraints, rationale };
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

/** Stable identity of one confirmed constraint set; a changed bound is a different request. */
export function strategicFitPortfolioConstraintIdentity(
  set: StrategicFitPortfolioConstraintSet,
): string {
  return `strategic-fit-portfolio-constraints:${stableHash(
    JSON.stringify(set.constraints.map((constraint) => [constraint.kind, constraint.value])),
  )}`;
}

export interface StrategicFitPortfolioConflict {
  readonly source: StrategicFitPortfolioConflictSource;
  readonly constraint_kinds: readonly StrategicFitPortfolioConstraintKind[];
  readonly explanation: string;
  /** The decision to put to the user. Nothing here resolves the contradiction on their behalf. */
  readonly question: string;
}

export interface StrategicFitPortfolioConflictContext {
  readonly profile: StrategicFitProfile;
}

/**
 * Contradictions between what the user declared and what they just requested. Detection stops at
 * naming the contradiction: relaxing a bound, dropping one, or preferring the profile would all be
 * the assistant deciding something the user has to decide.
 *
 * The two sources here are the ones a constraint set alone can prove. Contradictions with existing
 * repertoire choices show up later, against retained evidence, as an elimination that names the
 * binding constraint — asserting one before that evidence exists would be a guess.
 */
export function detectStrategicFitPortfolioConflicts(
  set: StrategicFitPortfolioConstraintSet,
  context: StrategicFitPortfolioConflictContext,
): readonly StrategicFitPortfolioConflict[] {
  const conflicts: StrategicFitPortfolioConflict[] = [];
  const value = (kind: StrategicFitPortfolioConstraintKind): number | null =>
    set.constraints.find((constraint) => constraint.kind === kind)?.value ?? null;

  const declaredLoss = context.profile.preferences.maximum_engine_loss_cp;
  const requestedLoss = value("maximum_engine_loss_cp");
  if (declaredLoss != null && requestedLoss !== null && requestedLoss > declaredLoss) {
    conflicts.push({
      source: "declared-preference",
      constraint_kinds: ["maximum_engine_loss_cp"],
      explanation: `The request accepts up to ${requestedLoss} centipawns of loss, but the confirmed profile allows at most ${declaredLoss}.`,
      question:
        "Should this redesign use the wider tolerance just this once, or should the profile's evaluation tolerance change?",
    });
  }

  const declaredCoverage = context.profile.preferences.minimum_opponent_coverage;
  const requestedCoverage = value("minimum_expected_opponent_coverage");
  if (
    declaredCoverage != null &&
    requestedCoverage !== null &&
    requestedCoverage < declaredCoverage
  ) {
    conflicts.push({
      source: "declared-preference",
      constraint_kinds: ["minimum_expected_opponent_coverage"],
      explanation: `The request keeps only ${requestedCoverage} expected opponent coverage, but the confirmed profile requires at least ${declaredCoverage}.`,
      question:
        "Should this redesign drop below the declared coverage floor, or should the floor itself change?",
    });
  }

  const addedTheory = value("maximum_added_theory_nodes");
  const coverageFloor = requestedCoverage;
  if (addedTheory === 0 && coverageFloor !== null && coverageFloor > 0) {
    conflicts.push({
      source: "requested-constraints",
      constraint_kinds: ["maximum_added_theory_nodes", "minimum_expected_opponent_coverage"],
      explanation: `The request forbids any added theory while still requiring ${coverageFloor} expected opponent coverage. Only an alternative that already transposes into prepared lines can satisfy both, so the two bounds may leave nothing.`,
      question: "Which matters more here — adding no new theory, or holding the coverage floor?",
    });
  }

  const newConcepts = value("maximum_new_concept_count");
  const fitDelta = value("minimum_strategic_fit_delta");
  if (newConcepts === 0 && fitDelta !== null && fitDelta > 0) {
    conflicts.push({
      source: "requested-constraints",
      constraint_kinds: ["maximum_new_concept_count", "minimum_strategic_fit_delta"],
      explanation: `The request allows no new strategic concept while requiring strategic fit to improve by at least ${fitDelta}. An alternative that changes nothing conceptual rarely moves the fit measurement.`,
      question:
        "Should a redesign be allowed to introduce a concept, or should the fit target come down?",
    });
  }

  return conflicts;
}

export const STRATEGIC_FIT_PORTFOLIO_MEASUREMENT_STATES = ["available", "unavailable"] as const;
export type StrategicFitPortfolioMeasurementState =
  (typeof STRATEGIC_FIT_PORTFOLIO_MEASUREMENT_STATES)[number];

export interface StrategicFitPortfolioMeasurement {
  readonly kind: StrategicFitPortfolioConstraintKind;
  readonly label: string;
  readonly unit: string;
  readonly value: number | null;
  readonly state: StrategicFitPortfolioMeasurementState;
  readonly reason: string | null;
  /** The requested bound, or null when this metric was not constrained. */
  readonly constraint_value: number | null;
  /** Null when unconstrained; false whenever the evidence could not prove the bound was met. */
  readonly satisfies_constraint: boolean | null;
}

export const STRATEGIC_FIT_PORTFOLIO_ELIMINATION_REASONS = [
  "blocked-safety-check",
  "no-validated-change-set",
  "unscored-candidate",
  "unavailable-evidence",
  "constraint-not-met",
] as const;
export type StrategicFitPortfolioEliminationReason =
  (typeof STRATEGIC_FIT_PORTFOLIO_ELIMINATION_REASONS)[number];

export interface StrategicFitPortfolioElimination {
  readonly candidate_id: string;
  readonly reason: StrategicFitPortfolioEliminationReason;
  readonly constraint_kinds: readonly StrategicFitPortfolioConstraintKind[];
  readonly explanation: string;
}

export interface StrategicFitPortfolioSafetyCheckSummary {
  readonly kind: ReplacementSafetyCheckKind;
  readonly status: ReplacementSafetyCheckStatus;
}

export interface StrategicFitPortfolioOption {
  readonly option_id: string;
  readonly candidate_id: string;
  readonly change_set_id: string;
  readonly action: "add-alternative" | "replace";
  readonly action_label: string;
  /** Task 8.6 status, carried through unchanged; the constrained subset is not re-raced. */
  readonly pareto_status: ReplacementParetoStatus;
  readonly dominated_by_candidate_ids: readonly string[];
  readonly measurements: readonly StrategicFitPortfolioMeasurement[];
  readonly safety_checks: readonly StrategicFitPortfolioSafetyCheckSummary[];
  readonly unresolved_risk_count: number;
  /** Identity of the exact retained evidence this option came from; a change voids it. */
  readonly evidence_identity: string;
}

export const STRATEGIC_FIT_PORTFOLIO_STATUSES = ["available", "infeasible", "unavailable"] as const;
export type StrategicFitPortfolioStatus = (typeof STRATEGIC_FIT_PORTFOLIO_STATUSES)[number];

export interface StrategicFitPortfolioResult {
  readonly portfolio_version: typeof STRATEGIC_FIT_PORTFOLIO_VERSION;
  readonly status: StrategicFitPortfolioStatus;
  readonly explanation: string;
  readonly constraint_identity: string;
  readonly constraints: readonly StrategicFitPortfolioConstraint[];
  readonly options: readonly StrategicFitPortfolioOption[];
  readonly omitted_option_count: number;
  readonly eliminations: readonly StrategicFitPortfolioElimination[];
  readonly omitted_elimination_count: number;
  /** The bounds that alone kept a candidate out. Empty when constraints are not what eliminated. */
  readonly binding_constraint_kinds: readonly StrategicFitPortfolioConstraintKind[];
  readonly request_id: string;
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly cohort_id: string;
  readonly repertoire_revision: string;
  readonly repertoire_color: "white" | "black";
  /** No option is preselected and none is applied; both are the user's explicit action. */
  readonly automatic_selection: false;
  readonly applied: false;
}

export interface StrategicFitPortfolioInput {
  readonly constraint_set: StrategicFitPortfolioConstraintSet;
  readonly safety: ReplacementSafetySimulationResult;
  readonly previews: readonly ReplacementToolV2Item[];
  readonly limit?: number;
}

/** Identity over the retained evidence one option stands on. */
export function strategicFitPortfolioEvidenceIdentity(
  safety: ReplacementSafetySimulationResult,
  candidate: ReplacementCandidateSafetySimulation,
  item: ReplacementToolV2Item,
): string {
  return `strategic-fit-portfolio-evidence:${stableHash(
    JSON.stringify({
      request_id: safety.request_id,
      report_id: safety.report_id,
      finding_id: safety.finding_id,
      semantic_finding_id: safety.semantic_finding_id,
      repertoire_revision: safety.repertoire_revision,
      candidate_id: candidate.candidate_id,
      action: candidate.action,
      status: candidate.status,
      simulated_graph_id: candidate.simulated_graph_id,
      change_set_id: item.change_set?.change_set_id ?? null,
      item_status: item.status,
    }),
  )}`;
}

const measurementReason = (metric: string): string =>
  `${metric} is unavailable in the retained evidence for this candidate. Missing evidence cannot satisfy a bound.`;

function measurementsFor(
  candidate: ReplacementCandidateSafetySimulation,
  set: StrategicFitPortfolioConstraintSet,
): readonly StrategicFitPortfolioMeasurement[] {
  const scored = candidate.scored_candidate;
  const objective = scored.objective_quality;
  const strategic = scored.strategic_score;
  const raw: Readonly<Record<StrategicFitPortfolioConstraintKind, number | null>> = {
    maximum_engine_loss_cp: objective.repertoire_pov_loss_from_best_cp,
    minimum_expected_opponent_coverage: strategic.expected_opponent_coverage,
    maximum_added_theory_nodes: strategic.theory_nodes_added,
    maximum_new_concept_count:
      strategic.state === "unavailable" ? null : strategic.new_concept_ids.length,
    maximum_homogenization_cost: strategic.homogenization_cost,
    maximum_memorization_burden: strategic.memorization_burden,
    minimum_strategic_fit_delta: strategic.strategic_fit_delta,
  };
  return STRATEGIC_FIT_PORTFOLIO_CONSTRAINT_KINDS.map((kind) => {
    const definition = CONSTRAINT_DEFINITIONS[kind];
    const value = raw[kind];
    const constraint = set.constraints.find((entry) => entry.kind === kind) ?? null;
    const available = typeof value === "number" && Number.isFinite(value);
    return {
      kind,
      label: definition.label,
      unit: definition.unit,
      value: available ? value : null,
      state: available ? "available" : "unavailable",
      reason: available ? null : measurementReason(definition.label),
      constraint_value: constraint?.value ?? null,
      satisfies_constraint:
        constraint === null
          ? null
          : available &&
            (definition.direction === "maximum"
              ? value <= constraint.value
              : value >= constraint.value),
    } satisfies StrategicFitPortfolioMeasurement;
  });
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/**
 * Build the bounded portfolio. Options are the candidates that already survived Task 8.7 safety and
 * have a validated Task 8.8 change set, restricted to those the requested bounds can be shown to
 * admit. When nothing survives, the result names the bounds that alone kept candidates out so the
 * user can decide which one to move; it never relaxes a bound to produce a portfolio.
 */
export function buildStrategicFitPortfolio(
  input: StrategicFitPortfolioInput,
): StrategicFitPortfolioResult {
  const { constraint_set: set, safety, previews } = input;
  const limit = Math.max(
    1,
    Math.min(
      input.limit ?? STRATEGIC_FIT_PORTFOLIO_LIMITS.options,
      STRATEGIC_FIT_PORTFOLIO_LIMITS.options,
    ),
  );
  const constraintIdentity = strategicFitPortfolioConstraintIdentity(set);
  const base = {
    portfolio_version: STRATEGIC_FIT_PORTFOLIO_VERSION,
    constraint_identity: constraintIdentity,
    constraints: set.constraints,
    request_id: safety.request_id,
    report_id: safety.report_id,
    finding_id: safety.finding_id,
    semantic_finding_id: safety.semantic_finding_id,
    cohort_id: safety.cohort_id,
    repertoire_revision: safety.repertoire_revision,
    repertoire_color: safety.repertoire_color,
    automatic_selection: false,
    applied: false,
  } as const;

  const previewById = new Map(previews.map((item) => [item.candidate_id, item]));
  const eliminations: StrategicFitPortfolioElimination[] = [];
  const admitted: StrategicFitPortfolioOption[] = [];
  /** Candidates kept out by exactly one bound; that bound is what the user would have to move. */
  const soleFailures = new Map<StrategicFitPortfolioConstraintKind, number>();

  for (const candidate of [...safety.candidates].sort((left, right) =>
    compareStrings(left.candidate_id, right.candidate_id),
  )) {
    if (candidate.status === "blocked") {
      eliminations.push({
        candidate_id: candidate.candidate_id,
        reason: "blocked-safety-check",
        constraint_kinds: [],
        explanation: `A safety check blocked this candidate: ${candidate.explanation}`,
      });
      continue;
    }
    if (candidate.scored_candidate.pareto.status === "unscored") {
      eliminations.push({
        candidate_id: candidate.candidate_id,
        reason: "unscored-candidate",
        constraint_kinds: [],
        explanation: "This candidate was never scored, so no bound can be checked against it.",
      });
      continue;
    }
    const item = previewById.get(candidate.candidate_id);
    if (item?.status !== "previewed" || item.change_set === null) {
      eliminations.push({
        candidate_id: candidate.candidate_id,
        reason: "no-validated-change-set",
        constraint_kinds: [],
        explanation: item
          ? `No validated change set exists for this candidate: ${item.explanation}`
          : "No change-set preview exists for this candidate, so there is nothing a portfolio option could stage.",
      });
      continue;
    }
    const measurements = measurementsFor(candidate, set);
    const unavailable = measurements.filter(
      (measurement) => measurement.constraint_value !== null && measurement.state === "unavailable",
    );
    const failed = measurements.filter(
      (measurement) =>
        measurement.satisfies_constraint === false && measurement.state === "available",
    );
    const offending = [...unavailable, ...failed].map((measurement) => measurement.kind);
    if (offending.length > 0) {
      if (offending.length === 1) {
        const offendingKind = assertDefined(offending[0]);
        soleFailures.set(offendingKind, (soleFailures.get(offendingKind) ?? 0) + 1);
      }
      eliminations.push({
        candidate_id: candidate.candidate_id,
        reason: unavailable.length > 0 ? "unavailable-evidence" : "constraint-not-met",
        constraint_kinds: offending,
        explanation:
          unavailable.length > 0
            ? `${unavailable.map((measurement) => measurement.label).join(", ")} could not be measured for this candidate, so the bound cannot be shown to hold.`
            : failed
                .map(
                  (measurement) =>
                    `${measurement.label} is ${measurement.value} ${measurement.unit}, outside the requested ${measurement.constraint_value}.`,
                )
                .join(" "),
      });
      continue;
    }
    admitted.push({
      option_id: `strategic-fit-portfolio-option:${candidate.candidate_id}`,
      candidate_id: candidate.candidate_id,
      change_set_id: item.change_set.change_set_id,
      action: candidate.action === "replace" ? "replace" : "add-alternative",
      action_label: candidate.action_label,
      pareto_status: candidate.scored_candidate.pareto.status,
      dominated_by_candidate_ids: candidate.scored_candidate.pareto.dominated_by_candidate_ids,
      measurements,
      safety_checks: candidate.safety_checks.map((check) => ({
        kind: check.kind,
        status: check.status,
      })),
      unresolved_risk_count: candidate.safety_checks.reduce(
        (total, check) => total + check.risk_ids.length,
        0,
      ),
      evidence_identity: strategicFitPortfolioEvidenceIdentity(safety, candidate, item),
    });
  }

  const ordered = [...admitted].sort((left, right) => {
    const rank = (option: StrategicFitPortfolioOption) =>
      option.pareto_status === "pareto-optimal" ? 0 : 1;
    return rank(left) - rank(right) || compareStrings(left.candidate_id, right.candidate_id);
  });
  const options = ordered.slice(0, limit);
  const boundedEliminations = eliminations.slice(0, STRATEGIC_FIT_PORTFOLIO_LIMITS.eliminations);
  const binding = STRATEGIC_FIT_PORTFOLIO_CONSTRAINT_KINDS.filter(
    (kind) => (soleFailures.get(kind) ?? 0) > 0,
  );

  if (options.length > 0) {
    return {
      ...base,
      status: "available",
      explanation: `${options.length} of ${safety.candidates.length} generated candidates satisfy every requested bound. Nothing is selected and nothing is applied; the user chooses an option and then confirms the staged change.`,
      options,
      omitted_option_count: ordered.length - options.length,
      eliminations: boundedEliminations,
      omitted_elimination_count: eliminations.length - boundedEliminations.length,
      binding_constraint_kinds: binding,
    };
  }
  if (safety.candidates.length === 0) {
    return {
      ...base,
      status: "unavailable",
      explanation:
        "No candidates were generated for this finding, so there is nothing to build a portfolio from. Say the evidence is unavailable rather than describing alternatives from chess knowledge.",
      options: [],
      omitted_option_count: 0,
      eliminations: boundedEliminations,
      omitted_elimination_count: eliminations.length - boundedEliminations.length,
      binding_constraint_kinds: [],
    };
  }
  return {
    ...base,
    status: "infeasible",
    explanation:
      binding.length > 0
        ? `No candidate satisfies every requested bound. ${binding
            .map(
              (kind) =>
                `${CONSTRAINT_DEFINITIONS[kind].label} alone excluded ${soleFailures.get(kind)} candidate(s)`,
            )
            .join("; ")}. Ask the user which bound to move; do not relax one on their behalf.`
        : "No candidate satisfies every requested bound, and no single bound is responsible: each remaining candidate misses several at once, was blocked by a safety check, or has no validated change set. Report what eliminated them rather than proposing an alternative of your own.",
    options: [],
    omitted_option_count: 0,
    eliminations: boundedEliminations,
    omitted_elimination_count: eliminations.length - boundedEliminations.length,
    binding_constraint_kinds: binding,
  };
}
