/**
 * Deterministic Strategic Fit diversity classification and priority policy.
 *
 * This stage deliberately consumes already-calculated evidence. It does not infer intent,
 * objective soundness, coverage, or practical benefits. Those facts must be injected with their
 * provenance by the host/domain stages that own them. Unsupported benefits and unknown
 * alternatives therefore remain unknown rather than becoming recommendations.
 */
import type { StrategicModeSelectionState } from "./modes.js";
import type {
  CausalAttribution,
  FindingConfidence,
  FindingPriority,
  FindingPriorityKind,
  FindingPriorityLabel,
  FindingResolutionState,
  StrategicDifference,
  StrategicFitClassification,
  StrategicFitSourceProvenance,
} from "./types.js";
import {
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_ANALYSIS_VERSION,
} from "./version.js";

export const STRATEGIC_FINDINGS_VERSION = STRATEGIC_FIT_ANALYSIS_MANIFEST.components.findings;

export const STRATEGIC_ALTERNATIVE_STATES = [
  "viable-more-congruent",
  "no-acceptable-alternative",
  "not-assessed",
] as const;
export type StrategicAlternativeState = (typeof STRATEGIC_ALTERNATIVE_STATES)[number];

export const PRODUCTIVE_DIVERSITY_BENEFITS = [
  "stronger-evaluation",
  "better-coverage",
  "surprise-value",
  "move-order-robustness",
  "reduced-opponent-preparation",
  "better-personal-results",
] as const;
export type ProductiveDiversityBenefit = (typeof PRODUCTIVE_DIVERSITY_BENEFITS)[number];

/** A practical benefit is classification evidence only when an upstream source supports it. */
export interface ProductiveDiversityTradeoff {
  readonly benefit: ProductiveDiversityBenefit;
  readonly supported: boolean;
  readonly explanation: string;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface StrategicDiversityIntent {
  /** Confirmed profile or repertoire intent, never a merely inferred majority. */
  readonly matches_declared_objective: boolean;
  /** Active persisted/user resolution, when one exists for this finding identity. */
  readonly resolution_state: FindingResolutionState | null;
}

export interface StrategicDiversityClassificationInput {
  readonly confidence: FindingConfidence;
  readonly difference: StrategicDifference;
  readonly causality: CausalAttribution;
  readonly mode_selection_state: StrategicModeSelectionState;
  readonly conflicts_with_selected_profile: boolean;
  readonly introduces_meaningful_additional_learning: boolean;
  readonly alternative_state: StrategicAlternativeState;
  readonly intent: StrategicDiversityIntent;
  readonly productive_tradeoffs: readonly ProductiveDiversityTradeoff[];
  /** Only issues that prevented a valid comparison belong here. */
  readonly blocking_data_quality_issue_ids: readonly string[];
  /** Supplied by graph/distance evidence; move-order difference alone is insufficient. */
  readonly transpositionally_equivalent: boolean;
}

export const STRATEGIC_CLASSIFICATION_REASONS = [
  "blocking-data-quality",
  "canonical-transposition",
  "confirmed-user-intent",
  "supported-practical-benefit",
  "multiple-supported-modes",
  "insufficient-mode-evidence",
  "low-confidence",
  "no-persistent-difference",
  "unknown-causal-ownership",
  "opponent-controlled",
  "no-acceptable-alternative",
  "profile-conflict-player-controlled-and-actionable",
  "difference-alone-is-not-inconsistency",
] as const;
export type StrategicClassificationReason = (typeof STRATEGIC_CLASSIFICATION_REASONS)[number];

export interface StrategicDiversityClassification {
  readonly analysis_version: string;
  readonly findings_version: string;
  readonly classification: StrategicFitClassification;
  readonly reasons: readonly StrategicClassificationReason[];
  /** Only supported tradeoffs are carried forward for explanation. */
  readonly productive_tradeoffs: readonly ProductiveDiversityTradeoff[];
}

export interface StrategicPriorityComponents {
  /** Normalized magnitude score from the confidence/difference stage. */
  readonly difference: number;
  readonly expected_frequency: number;
  readonly learning_burden: number;
  readonly preference_mismatch: number;
  /** Training can remain actionable when replacement is not. */
  readonly training_actionability: number;
}

export interface StrategicFindingAssessmentInput extends StrategicDiversityClassificationInput {
  readonly priority: StrategicPriorityComponents;
}

export interface StrategicFindingAssessment extends StrategicDiversityClassification {
  readonly replacement_priority: FindingPriority;
  readonly training_priority: FindingPriority;
}

export const STRATEGIC_PRIORITY_WEIGHTS = Object.freeze({
  difference: 0.3,
  expected_frequency: 0.25,
  learning_burden: 0.2,
  preference_mismatch: 0.15,
  actionability: 0.1,
});

/** Deterministic presentation boundaries for the four frozen priority labels. */
export const STRATEGIC_PRIORITY_THRESHOLDS = Object.freeze({
  review_now: 0.6,
  review_later: 0.3,
});

const EPSILON = 1e-12;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function requireUnitInterval(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`strategic_fit_findings_invalid_unit_value: ${name} ${String(value)}`);
  }
  return value;
}

function requireCompatibleEvidence(input: StrategicDiversityClassificationInput): void {
  if (
    input.confidence.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    input.difference.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    input.causality.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION
  ) {
    throw new Error("strategic_fit_findings_version_mismatch");
  }
}

function supportedTradeoffs(
  tradeoffs: readonly ProductiveDiversityTradeoff[],
): ProductiveDiversityTradeoff[] {
  const seen = new Set<ProductiveDiversityBenefit>();
  return tradeoffs
    .filter((tradeoff) => tradeoff.supported)
    .sort((left, right) => compareStrings(left.benefit, right.benefit))
    .filter((tradeoff) => {
      if (seen.has(tradeoff.benefit)) return false;
      seen.add(tradeoff.benefit);
      return true;
    });
}

function result(
  classification: StrategicFitClassification,
  reasons: readonly StrategicClassificationReason[],
  tradeoffs: readonly ProductiveDiversityTradeoff[] = [],
): StrategicDiversityClassification {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    findings_version: STRATEGIC_FINDINGS_VERSION,
    classification,
    reasons,
    productive_tradeoffs: tradeoffs,
  };
}

function hasPersistentDifference(difference: StrategicDifference): boolean {
  return difference.distance > EPSILON &&
    difference.persistence > EPSILON &&
    difference.stable_from_ply !== null;
}

/**
 * Apply the frozen classification order conservatively. Validity and canonical equivalence are
 * resolved before user/product evidence; confirmed intent then takes precedence over inferred
 * cohort majorities. A route becomes a genuine inconsistency only when every frozen criterion is
 * supported.
 */
export function classifyStrategicDiversity(
  input: StrategicDiversityClassificationInput,
): StrategicDiversityClassification {
  requireCompatibleEvidence(input);
  if (input.blocking_data_quality_issue_ids.length > 0) {
    return result("data-quality-issue", ["blocking-data-quality"]);
  }
  if (input.transpositionally_equivalent) {
    return result("transpositional-equivalence", ["canonical-transposition"]);
  }
  if (
    input.intent.matches_declared_objective ||
    input.intent.resolution_state === "keep-intentionally"
  ) {
    return result("intentional-diversity", ["confirmed-user-intent"]);
  }
  const productive = supportedTradeoffs(input.productive_tradeoffs);
  if (productive.length > 0) {
    return result("productive-diversity", ["supported-practical-benefit"], productive);
  }
  if (input.mode_selection_state === "mixed-profile") {
    return result("mixed-strategic-profile", ["multiple-supported-modes"]);
  }
  if (
    input.mode_selection_state === "insufficient-evidence" ||
    input.intent.resolution_state === "insufficient-evidence"
  ) {
    return result("uncertain", ["insufficient-mode-evidence"]);
  }
  if (input.confidence.label === "low") {
    return result("uncertain", ["low-confidence"]);
  }
  if (!hasPersistentDifference(input.difference)) {
    return result("uncertain", ["no-persistent-difference"]);
  }
  if (input.causality.label === "unknown" || input.causality.controllability === null) {
    return result("uncertain", ["unknown-causal-ownership"]);
  }
  if (input.causality.label === "mostly-opponent-forced") {
    return result("forced-diversity", ["opponent-controlled"]);
  }
  if (input.alternative_state === "no-acceptable-alternative") {
    return result("forced-diversity", ["no-acceptable-alternative"]);
  }
  if (
    input.confidence.label === "high" &&
    input.conflicts_with_selected_profile &&
    input.introduces_meaningful_additional_learning &&
    input.causality.label === "mostly-player-controlled" &&
    input.alternative_state === "viable-more-congruent"
  ) {
    return result("genuine-inconsistency", ["profile-conflict-player-controlled-and-actionable"]);
  }
  return result("uncertain", ["difference-alone-is-not-inconsistency"]);
}

function basePriorityLabel(score: number): FindingPriorityLabel {
  if (score >= STRATEGIC_PRIORITY_THRESHOLDS.review_now) return "review-now";
  if (score >= STRATEGIC_PRIORITY_THRESHOLDS.review_later) return "review-later";
  return "informational";
}

function priorityLabel(
  kind: FindingPriorityKind,
  classification: StrategicFitClassification,
  score: number,
): FindingPriorityLabel {
  if (classification === "uncertain" || classification === "data-quality-issue") {
    return "insufficient-evidence";
  }
  if (
    kind === "replacement" &&
    classification !== "genuine-inconsistency"
  ) {
    return "informational";
  }
  if (
    kind === "training" &&
    (classification === "mixed-strategic-profile" ||
      classification === "transpositional-equivalence")
  ) {
    return "informational";
  }
  return basePriorityLabel(score);
}

export interface CalculateFindingPriorityInput {
  readonly kind: FindingPriorityKind;
  readonly classification: StrategicFitClassification;
  readonly confidence: FindingConfidence;
  readonly difference: number;
  readonly expected_frequency: number;
  readonly learning_burden: number;
  readonly preference_mismatch: number;
  readonly actionability: number;
}

/** Calculate one replacement or training priority with the frozen five-component formula. */
export function calculateFindingPriority(
  input: CalculateFindingPriorityInput,
): FindingPriority {
  if (input.confidence.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION) {
    throw new Error("strategic_fit_findings_version_mismatch");
  }
  const confidence = requireUnitInterval("confidence", input.confidence.score / 100);
  const difference = requireUnitInterval("difference", input.difference);
  const expectedFrequency = requireUnitInterval("expected-frequency", input.expected_frequency);
  const learningBurden = requireUnitInterval("learning-burden", input.learning_burden);
  const preferenceMismatch = requireUnitInterval("preference-mismatch", input.preference_mismatch);
  const actionability = requireUnitInterval("actionability", input.actionability);
  const score = round(confidence * (
    STRATEGIC_PRIORITY_WEIGHTS.difference * difference +
    STRATEGIC_PRIORITY_WEIGHTS.expected_frequency * expectedFrequency +
    STRATEGIC_PRIORITY_WEIGHTS.learning_burden * learningBurden +
    STRATEGIC_PRIORITY_WEIGHTS.preference_mismatch * preferenceMismatch +
    STRATEGIC_PRIORITY_WEIGHTS.actionability * actionability
  ));
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    kind: input.kind,
    score,
    label: priorityLabel(input.kind, input.classification, score),
    confidence: round(confidence),
    difference: round(difference),
    expected_frequency: round(expectedFrequency),
    learning_burden: round(learningBurden),
    preference_mismatch: round(preferenceMismatch),
    actionability: round(actionability),
  };
}

/** Classify once, then calculate independently actionable replacement and training priorities. */
export function assessStrategicFinding(
  input: StrategicFindingAssessmentInput,
): StrategicFindingAssessment {
  const classification = classifyStrategicDiversity(input);
  const controllability = input.causality.controllability ?? 0;
  const replacementActionability = input.alternative_state === "viable-more-congruent"
    ? controllability
    : 0;
  const common = {
    classification: classification.classification,
    confidence: input.confidence,
    difference: input.priority.difference,
    expected_frequency: input.priority.expected_frequency,
    learning_burden: input.priority.learning_burden,
    preference_mismatch: input.priority.preference_mismatch,
  } as const;
  return {
    ...classification,
    replacement_priority: calculateFindingPriority({
      ...common,
      kind: "replacement",
      actionability: replacementActionability,
    }),
    training_priority: calculateFindingPriority({
      ...common,
      kind: "training",
      actionability: input.priority.training_actionability,
    }),
  };
}
