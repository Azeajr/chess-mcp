import assert from "node:assert/strict";
import test from "node:test";
import {
  CONFIDENCE_CAP_REASONS,
  CONFIDENCE_COMPONENTS,
  DIFFERENCE_MAGNITUDE_THRESHOLDS,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  calculateFindingConfidence,
  calculateStrategicDifference,
  classifyDifferenceMagnitude,
  scoreStrategicDifferenceMagnitude,
  type StrategicConfidenceInput,
} from "../../src/index.js";

function completeConfidence(
  overrides: Partial<StrategicConfidenceInput> = {},
): StrategicConfidenceInput {
  return {
    classifier_confidence: 1,
    checkpoint_completeness: 1,
    effective_sample_size: 8,
    temporal_persistence: 1,
    cohort_coherence: 1,
    opening_data_quality: 1,
    causal_attribution_quality: 1,
    substantial_incomplete_line_share: false,
    unresolved_classifier_conflict: false,
    opening_taxonomy_available: true,
    strong_structural_evidence: true,
    ...overrides,
  };
}

test("a complete fixture produces high confidence with all expert components serialized", () => {
  const result = calculateFindingConfidence(completeConfidence({
    classifier_confidence: 0.96,
    checkpoint_completeness: 0.94,
    temporal_persistence: 0.98,
    cohort_coherence: 0.92,
    opening_data_quality: 0.97,
    causal_attribution_quality: 0.9,
  }));
  const serialized = JSON.parse(JSON.stringify(result)) as typeof result;

  assert.equal(result.analysis_version, STRATEGIC_FIT_ANALYSIS_VERSION);
  assert.equal(result.label, "high");
  assert.equal(result.score, 95);
  assert.deepEqual(result.components.map((component) => component.component), CONFIDENCE_COMPONENTS);
  assert.equal(result.components.every((component) => component.weight === 1), true);
  assert.deepEqual(serialized.components, result.components);
  assert.deepEqual(result.applied_caps, []);
  assert.match(result.explanation, /seven evidence components/);
});

test("effective sample below four applies the frozen 39 cap", () => {
  const result = calculateFindingConfidence(completeConfidence({ effective_sample_size: 3.9 }));

  assert.equal(result.score, 39);
  assert.equal(result.label, "low");
  assert.deepEqual(result.applied_caps.map((cap) => [cap.reason, cap.maximum_score]), [
    ["effective-sample-below-four", 39],
  ]);
});

test("substantial incomplete evidence applies the frozen 49 cap", () => {
  const result = calculateFindingConfidence(completeConfidence({
    substantial_incomplete_line_share: true,
  }));

  assert.equal(result.score, 49);
  assert.equal(result.label, "low");
  assert.deepEqual(result.applied_caps.map((cap) => [cap.reason, cap.maximum_score]), [
    ["substantial-incomplete-line-share", 49],
  ]);
});

test("an unresolved classifier conflict applies the frozen 59 cap", () => {
  const result = calculateFindingConfidence(completeConfidence({
    unresolved_classifier_conflict: true,
  }));

  assert.equal(result.score, 59);
  assert.equal(result.label, "moderate");
  assert.deepEqual(result.applied_caps.map((cap) => [cap.reason, cap.maximum_score]), [
    ["unresolved-classifier-conflict", 59],
  ]);
});

test("missing taxonomy falls back to strong structural evidence under the frozen 69 cap", () => {
  const result = calculateFindingConfidence(completeConfidence({
    opening_taxonomy_available: false,
  }));

  assert.equal(result.score, 69);
  assert.equal(result.label, "moderate");
  assert.deepEqual(result.applied_caps.map((cap) => [cap.reason, cap.maximum_score]), [
    ["missing-taxonomy-with-strong-structural-evidence", 69],
  ]);
  assert.match(result.applied_caps[0]!.explanation, /strong structural evidence remains usable/);
});

test("all applicable hard caps remain explicit and the strictest cap controls", () => {
  const result = calculateFindingConfidence(completeConfidence({
    effective_sample_size: 3.9,
    substantial_incomplete_line_share: true,
    unresolved_classifier_conflict: true,
    opening_taxonomy_available: false,
  }));

  assert.equal(result.score, 39);
  assert.deepEqual(result.applied_caps.map((cap) => cap.reason), CONFIDENCE_CAP_REASONS);
});

test("low classifier confidence limits the geometric confidence score", () => {
  const result = calculateFindingConfidence(completeConfidence({ classifier_confidence: 0 }));

  assert.equal(result.score, 0);
  assert.equal(result.label, "low");
  assert.equal(
    result.components.find((component) => component.component === "classifier-confidence")!.score,
    0,
  );
  assert.deepEqual(result.applied_caps, []);
});

test("difference magnitude uses deterministic minor, moderate, and major boundaries", () => {
  const moderate = DIFFERENCE_MAGNITUDE_THRESHOLDS.moderate;
  const major = DIFFERENCE_MAGNITUDE_THRESHOLDS.major;

  assert.equal(classifyDifferenceMagnitude(moderate - 0.000001), "minor");
  assert.equal(classifyDifferenceMagnitude(moderate), "moderate");
  assert.equal(classifyDifferenceMagnitude(major - 0.000001), "moderate");
  assert.equal(classifyDifferenceMagnitude(major), "major");
});

test("difference magnitude combines distance, persistence, concept novelty, and stable depth", () => {
  const minor = scoreStrategicDifferenceMagnitude({
    distance: 0.2,
    persistence: 0.2,
    new_concept_count: 0,
    stable_from_ply: null,
  });
  const major = scoreStrategicDifferenceMagnitude({
    distance: 0.9,
    persistence: 1,
    new_concept_count: 3,
    stable_from_ply: 6,
  });

  assert.equal(minor.magnitude, "minor");
  assert.equal(major.magnitude, "major");
  assert.deepEqual(major.components, {
    strategic_distance: 0.9,
    temporal_persistence: 1,
    concept_novelty: 0.75,
    stability_depth: 0.75,
  });
});

test("objective quality is absent from the strategic difference result", () => {
  const result = calculateStrategicDifference({
    distance: 0.8,
    persistence: 0.9,
    new_concept_count: 2,
    stable_from_ply: 12,
  });

  assert.deepEqual(Object.keys(result), [
    "analysis_version",
    "distance",
    "magnitude",
    "persistence",
    "new_concept_count",
    "stable_from_ply",
  ]);
  assert.equal(result.magnitude, "major");
  assert.equal("objective_quality" in result, false);
});

test("invalid confidence and magnitude evidence is rejected", () => {
  assert.throws(
    () => calculateFindingConfidence(completeConfidence({ classifier_confidence: 1.01 })),
    /strategic_fit_confidence_invalid_unit_value/,
  );
  assert.throws(
    () => calculateFindingConfidence(completeConfidence({ effective_sample_size: -1 })),
    /strategic_fit_confidence_invalid_effective_sample_size/,
  );
  assert.throws(
    () => calculateStrategicDifference({
      distance: 0.5,
      persistence: 0.5,
      new_concept_count: -1,
      stable_from_ply: 12,
    }),
    /strategic_fit_difference_invalid_concept_count/,
  );
});
