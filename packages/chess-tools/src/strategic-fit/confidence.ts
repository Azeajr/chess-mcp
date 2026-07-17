/**
 * Deterministic confidence and difference-magnitude calculations for Strategic Fit.
 *
 * Confidence measures whether a strategic difference is correctly identified and explained. It
 * deliberately does not measure chess quality or how different the positions are. Difference
 * magnitude similarly excludes engine and database quality: it combines only strategic distance,
 * persistence, supported concept novelty, and how early the difference becomes stable.
 */
import type {
  ConfidenceCap,
  ConfidenceCapReason,
  ConfidenceComponent,
  ConfidenceComponentKind,
  ConfidenceLabel,
  DifferenceMagnitude,
  FindingConfidence,
  StrategicDifference,
} from "./types.js";
import { CONFIDENCE_CAP_REASONS, CONFIDENCE_COMPONENTS } from "./types.js";
import {
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_ANALYSIS_VERSION,
} from "./version.js";

export const STRATEGIC_CONFIDENCE_VERSION = STRATEGIC_FIT_ANALYSIS_MANIFEST.components.confidence;

/** The frozen design does not privilege one confidence component, so each receives equal weight. */
export const STRATEGIC_CONFIDENCE_COMPONENT_WEIGHTS: Readonly<Record<ConfidenceComponentKind, number>> =
  Object.freeze(Object.fromEntries(CONFIDENCE_COMPONENTS.map((component) => [component, 1])) as
    Record<ConfidenceComponentKind, number>);

export const STRATEGIC_CONFIDENCE_CAP_MAXIMUMS: Readonly<Record<ConfidenceCapReason, number>> =
  Object.freeze({
    "effective-sample-below-four": 39,
    "substantial-incomplete-line-share": 49,
    "unresolved-classifier-conflict": 59,
    "missing-taxonomy-with-strong-structural-evidence": 69,
  });

export const DIFFERENCE_MAGNITUDE_THRESHOLDS = Object.freeze({
  moderate: 1 / 3,
  major: 2 / 3,
});

export const DEFAULT_DIFFERENCE_STABILITY_HORIZON_PLY = 24;

export interface StrategicConfidenceInput {
  readonly classifier_confidence: number;
  readonly checkpoint_completeness: number;
  readonly effective_sample_size: number;
  readonly temporal_persistence: number;
  readonly cohort_coherence: number;
  readonly opening_data_quality: number;
  readonly causal_attribution_quality: number;
  /** Set by the evidence layer when incomplete routes materially limit comparison. */
  readonly substantial_incomplete_line_share: boolean;
  readonly unresolved_classifier_conflict: boolean;
  readonly opening_taxonomy_available: boolean;
  /** Allows useful structural evidence to survive missing taxonomy, but only under the frozen cap. */
  readonly strong_structural_evidence: boolean;
}

export interface StrategicDifferenceInput {
  readonly distance: number;
  readonly persistence: number;
  readonly new_concept_count: number;
  readonly stable_from_ply: number | null;
  /** Defaults to the frozen engine-free analysis horizon at ply 24. */
  readonly stability_horizon_ply?: number;
}

export interface StrategicDifferenceMagnitudeComponents {
  readonly strategic_distance: number;
  readonly temporal_persistence: number;
  readonly concept_novelty: number;
  readonly stability_depth: number;
}

export interface StrategicDifferenceMagnitudeScore {
  readonly score: number;
  readonly magnitude: DifferenceMagnitude;
  readonly components: StrategicDifferenceMagnitudeComponents;
}

function round(value: number, places = 6): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function requireUnitInterval(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`strategic_fit_confidence_invalid_unit_value: ${name} ${String(value)}`);
  }
  return value;
}

function confidenceLabel(score: number): ConfidenceLabel {
  if (score >= 75) return "high";
  if (score >= 50) return "moderate";
  return "low";
}

function componentExplanation(
  component: ConfidenceComponentKind,
  score: number,
  effectiveSampleSize: number,
): string {
  const percent = Math.round(score * 100);
  switch (component) {
    case "classifier-confidence":
      return `Strategic classifiers support the evidence at ${percent}%.`;
    case "checkpoint-completeness":
      return `${percent}% of the required matched-checkpoint evidence is complete.`;
    case "effective-sample-size":
      return `Effective sample size is ${round(effectiveSampleSize)}; support reaches full component weight at four.`;
    case "temporal-persistence":
      return `The strategic difference persists across ${percent}% of the supported comparison window.`;
    case "cohort-coherence":
      return `The comparison cohort is ${percent}% coherent around its supported modes.`;
    case "opening-data-quality":
      return `Opening-data support for the comparison is ${percent}%.`;
    case "causal-attribution-quality":
      return `Causal-attribution evidence quality is ${percent}%.`;
  }
}

function confidenceComponents(input: StrategicConfidenceInput): ConfidenceComponent[] {
  if (!Number.isFinite(input.effective_sample_size) || input.effective_sample_size < 0) {
    throw new Error(
      `strategic_fit_confidence_invalid_effective_sample_size: ${String(input.effective_sample_size)}`,
    );
  }
  const scores: Record<ConfidenceComponentKind, number> = {
    "classifier-confidence": requireUnitInterval("classifier-confidence", input.classifier_confidence),
    "checkpoint-completeness": requireUnitInterval("checkpoint-completeness", input.checkpoint_completeness),
    "effective-sample-size": Math.min(1, input.effective_sample_size / 4),
    "temporal-persistence": requireUnitInterval("temporal-persistence", input.temporal_persistence),
    "cohort-coherence": requireUnitInterval("cohort-coherence", input.cohort_coherence),
    "opening-data-quality": requireUnitInterval("opening-data-quality", input.opening_data_quality),
    "causal-attribution-quality": requireUnitInterval(
      "causal-attribution-quality",
      input.causal_attribution_quality,
    ),
  };
  return CONFIDENCE_COMPONENTS.map((component) => ({
    component,
    score: round(scores[component]),
    weight: STRATEGIC_CONFIDENCE_COMPONENT_WEIGHTS[component],
    explanation: componentExplanation(component, scores[component], input.effective_sample_size),
  }));
}

function capExplanation(reason: ConfidenceCapReason): string {
  switch (reason) {
    case "effective-sample-below-four":
      return "Effective sample size is below four, so confidence cannot exceed 39.";
    case "substantial-incomplete-line-share":
      return "A substantial share of lines is incomplete, so confidence cannot exceed 49.";
    case "unresolved-classifier-conflict":
      return "Strategic classifiers have an unresolved conflict, so confidence cannot exceed 59.";
    case "missing-taxonomy-with-strong-structural-evidence":
      return "Opening taxonomy is missing; strong structural evidence remains usable, but confidence cannot exceed 69.";
  }
}

function appliedCaps(input: StrategicConfidenceInput): ConfidenceCap[] {
  const applies: Record<ConfidenceCapReason, boolean> = {
    "effective-sample-below-four": input.effective_sample_size < 4,
    "substantial-incomplete-line-share": input.substantial_incomplete_line_share,
    "unresolved-classifier-conflict": input.unresolved_classifier_conflict,
    "missing-taxonomy-with-strong-structural-evidence":
      !input.opening_taxonomy_available && input.strong_structural_evidence,
  };
  return CONFIDENCE_CAP_REASONS.filter((reason) => applies[reason]).map((reason) => ({
    reason,
    maximum_score: STRATEGIC_CONFIDENCE_CAP_MAXIMUMS[reason],
    explanation: capExplanation(reason),
  }));
}

function weightedGeometricScore(components: readonly ConfidenceComponent[]): number {
  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  if (totalWeight <= 0) throw new Error("strategic_fit_confidence_no_component_weight");
  if (components.some((component) => component.score === 0)) return 0;
  return Math.exp(components.reduce(
    (sum, component) => sum + component.weight * Math.log(component.score),
    0,
  ) / totalWeight);
}

/** Combine the seven frozen confidence components, then apply every evidence-derived hard cap. */
export function calculateFindingConfidence(input: StrategicConfidenceInput): FindingConfidence {
  const components = confidenceComponents(input);
  const uncappedScore = Math.round(weightedGeometricScore(components) * 100);
  const caps = appliedCaps(input);
  const score = Math.min(uncappedScore, ...caps.map((cap) => cap.maximum_score), 100);
  const label = confidenceLabel(score);
  const strictestCap = caps.reduce<ConfidenceCap | null>(
    (strictest, cap) => strictest === null || cap.maximum_score < strictest.maximum_score ? cap : strictest,
    null,
  );
  const explanation = strictestCap === null
    ? `${label[0]!.toUpperCase()}${label.slice(1)} confidence: the seven evidence components combine to ${score}.`
    : `${label[0]!.toUpperCase()}${label.slice(1)} confidence: the geometric component score of ${uncappedScore} is capped at ${score}. ${strictestCap.explanation}`;
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    score,
    label,
    components,
    applied_caps: caps,
    explanation,
  };
}

function validateDifferenceInput(input: StrategicDifferenceInput): number {
  requireUnitInterval("distance", input.distance);
  requireUnitInterval("persistence", input.persistence);
  if (!Number.isInteger(input.new_concept_count) || input.new_concept_count < 0) {
    throw new Error(`strategic_fit_difference_invalid_concept_count: ${String(input.new_concept_count)}`);
  }
  if (input.stable_from_ply !== null && (!Number.isInteger(input.stable_from_ply) || input.stable_from_ply < 0)) {
    throw new Error(`strategic_fit_difference_invalid_stable_ply: ${String(input.stable_from_ply)}`);
  }
  const horizon = input.stability_horizon_ply ?? DEFAULT_DIFFERENCE_STABILITY_HORIZON_PLY;
  if (!Number.isInteger(horizon) || horizon <= 0) {
    throw new Error(`strategic_fit_difference_invalid_stability_horizon: ${String(horizon)}`);
  }
  return horizon;
}

/** Classify a normalized magnitude score at the deterministic one-third boundaries. */
export function classifyDifferenceMagnitude(score: number): DifferenceMagnitude {
  requireUnitInterval("magnitude-score", score);
  if (score >= DIFFERENCE_MAGNITUDE_THRESHOLDS.major) return "major";
  if (score >= DIFFERENCE_MAGNITUDE_THRESHOLDS.moderate) return "moderate";
  return "minor";
}

/**
 * Score the four frozen magnitude dimensions with equal weight. Concept novelty saturates without
 * an arbitrary maximum; stability depth is normalized over the configured comparison horizon.
 */
export function scoreStrategicDifferenceMagnitude(
  input: StrategicDifferenceInput,
): StrategicDifferenceMagnitudeScore {
  const horizon = validateDifferenceInput(input);
  const components: StrategicDifferenceMagnitudeComponents = {
    strategic_distance: input.distance,
    temporal_persistence: input.persistence,
    concept_novelty: input.new_concept_count === 0
      ? 0
      : input.new_concept_count / (input.new_concept_count + 1),
    stability_depth: input.stable_from_ply === null
      ? 0
      : Math.max(0, 1 - input.stable_from_ply / horizon),
  };
  const score = round(Object.values(components).reduce((sum, value) => sum + value, 0) / 4);
  return {
    score,
    magnitude: classifyDifferenceMagnitude(score),
    components: Object.freeze({
      strategic_distance: round(components.strategic_distance),
      temporal_persistence: round(components.temporal_persistence),
      concept_novelty: round(components.concept_novelty),
      stability_depth: round(components.stability_depth),
    }),
  };
}

/** Calculate the finding-facing difference object; objective-quality data is intentionally absent. */
export function calculateStrategicDifference(input: StrategicDifferenceInput): StrategicDifference {
  const assessment = scoreStrategicDifferenceMagnitude(input);
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    distance: round(input.distance),
    magnitude: assessment.magnitude,
    persistence: round(input.persistence),
    new_concept_count: input.new_concept_count,
    stable_from_ply: input.stable_from_ply,
  };
}
