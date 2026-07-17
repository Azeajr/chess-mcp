import assert from "node:assert/strict";
import test from "node:test";

import {
  STRATEGIC_FINDINGS_VERSION,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  assessStrategicFinding,
  calculateFindingPriority,
  classifyStrategicDiversity,
  type CausalAttribution,
  type FindingConfidence,
  type ProductiveDiversityTradeoff,
  type StrategicDifference,
  type StrategicFindingAssessmentInput,
} from "../../src/index.ts";

const confidence: FindingConfidence = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  score: 90,
  label: "high",
  components: [],
  applied_caps: [],
  explanation: "Complete deterministic evidence.",
};

const difference: StrategicDifference = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  distance: 0.8,
  magnitude: "major",
  persistence: 1,
  new_concept_count: 2,
  stable_from_ply: 12,
};

function causality(
  label: CausalAttribution["label"],
  controllability: number | null,
): CausalAttribution {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    controllability,
    label,
    player_contribution: controllability,
    opponent_contribution: controllability === null ? null : 1 - controllability,
    likely_causal_decision_ids: [],
    timeline: [],
    explanation: label,
  };
}

function input(
  overrides: Partial<StrategicFindingAssessmentInput> = {},
): StrategicFindingAssessmentInput {
  return {
    confidence,
    difference,
    causality: causality("mostly-player-controlled", 0.8),
    mode_selection_state: "single-mode",
    conflicts_with_selected_profile: true,
    introduces_meaningful_additional_learning: true,
    alternative_state: "viable-more-congruent",
    intent: {
      matches_declared_objective: false,
      resolution_state: null,
    },
    productive_tradeoffs: [],
    blocking_data_quality_issue_ids: [],
    transpositionally_equivalent: false,
    priority: {
      difference: 0.8,
      expected_frequency: 0.6,
      learning_burden: 0.7,
      preference_mismatch: 0.9,
      training_actionability: 0.8,
    },
    ...overrides,
  };
}

function tradeoff(
  benefit: ProductiveDiversityTradeoff["benefit"],
  supported = true,
): ProductiveDiversityTradeoff {
  return {
    benefit,
    supported,
    explanation: `${benefit} is supported by injected metadata.`,
    provenance: [],
  };
}

test("classifies a supported actionable profile conflict as genuine inconsistency", () => {
  const result = classifyStrategicDiversity(input());

  assert.equal(result.analysis_version, STRATEGIC_FIT_ANALYSIS_VERSION);
  assert.equal(result.findings_version, STRATEGIC_FINDINGS_VERSION);
  assert.equal(result.classification, "genuine-inconsistency");
});

test("classifies opponent ownership and unavailable alternatives as forced diversity", () => {
  assert.equal(classifyStrategicDiversity(input({
    causality: causality("mostly-opponent-forced", 0.2),
    alternative_state: "not-assessed",
  })).classification, "forced-diversity");
  assert.equal(classifyStrategicDiversity(input({
    alternative_state: "no-acceptable-alternative",
  })).classification, "forced-diversity");
});

test("confirmed explicit intent wins over an inferred majority and prior keep resolution is honored", () => {
  const declared = classifyStrategicDiversity(input({
    mode_selection_state: "mixed-profile",
    intent: { matches_declared_objective: true, resolution_state: null },
  }));
  const resolved = classifyStrategicDiversity(input({
    intent: { matches_declared_objective: false, resolution_state: "keep-intentionally" },
  }));

  assert.equal(declared.classification, "intentional-diversity");
  assert.equal(resolved.classification, "intentional-diversity");
});

test("productive diversity requires and retains supported practical tradeoff metadata", () => {
  const result = classifyStrategicDiversity(input({
    productive_tradeoffs: [
      tradeoff("surprise-value", false),
      tradeoff("better-coverage"),
      tradeoff("stronger-evaluation"),
      tradeoff("better-coverage"),
    ],
  }));

  assert.equal(result.classification, "productive-diversity");
  assert.deepEqual(result.productive_tradeoffs.map((item) => item.benefit), [
    "better-coverage",
    "stronger-evaluation",
  ]);
});

test("multiple supported cohort modes classify as a mixed strategic profile", () => {
  assert.equal(classifyStrategicDiversity(input({
    mode_selection_state: "mixed-profile",
  })).classification, "mixed-strategic-profile");
});

test("low or incomplete evidence remains uncertain and makes no replacement recommendation", () => {
  const lowConfidence: FindingConfidence = {
    ...confidence,
    score: 39,
    label: "low",
  };
  const low = assessStrategicFinding(input({ confidence: lowConfidence }));
  const incomplete = assessStrategicFinding(input({
    mode_selection_state: "insufficient-evidence",
  }));

  assert.equal(low.classification, "uncertain");
  assert.equal(low.replacement_priority.label, "insufficient-evidence");
  assert.notEqual(low.replacement_priority.label, "review-now");
  assert.equal(incomplete.classification, "uncertain");
  assert.equal(incomplete.replacement_priority.label, "insufficient-evidence");
});

test("blocking comparison evidence classifies as a data-quality issue", () => {
  assert.equal(classifyStrategicDiversity(input({
    blocking_data_quality_issue_ids: ["issue:unsupported-start"],
  })).classification, "data-quality-issue");
});

test("canonical convergence classifies as transpositional equivalence before diversity", () => {
  assert.equal(classifyStrategicDiversity(input({
    transpositionally_equivalent: true,
  })).classification, "transpositional-equivalence");
});

test("different evidence alone never becomes genuine inconsistency", () => {
  const noProfileConflict = classifyStrategicDiversity(input({
    conflicts_with_selected_profile: false,
  }));
  const unknownAlternative = classifyStrategicDiversity(input({
    alternative_state: "not-assessed",
  }));
  const sharedOwnership = classifyStrategicDiversity(input({
    causality: causality("shared-or-uncertain", 0.5),
  }));

  assert.equal(noProfileConflict.classification, "uncertain");
  assert.equal(unknownAlternative.classification, "uncertain");
  assert.equal(sharedOwnership.classification, "uncertain");
});

test("the frozen priority formula keeps all normalized expert components", () => {
  const result = calculateFindingPriority({
    kind: "replacement",
    classification: "genuine-inconsistency",
    confidence: { ...confidence, score: 80 },
    difference: 0.9,
    expected_frequency: 0.6,
    learning_burden: 0.7,
    preference_mismatch: 0.5,
    actionability: 0.8,
  });

  assert.equal(result.score, 0.572);
  assert.equal(result.label, "review-later");
  assert.deepEqual(result, {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    kind: "replacement",
    score: 0.572,
    label: "review-later",
    confidence: 0.8,
    difference: 0.9,
    expected_frequency: 0.6,
    learning_burden: 0.7,
    preference_mismatch: 0.5,
    actionability: 0.8,
  });
});

test("forced diversity can rank training highly while replacement remains informational", () => {
  const result = assessStrategicFinding(input({
    confidence: { ...confidence, score: 100 },
    causality: causality("mostly-opponent-forced", 0),
    alternative_state: "no-acceptable-alternative",
    priority: {
      difference: 1,
      expected_frequency: 1,
      learning_burden: 1,
      preference_mismatch: 1,
      training_actionability: 1,
    },
  }));

  assert.equal(result.classification, "forced-diversity");
  assert.equal(result.replacement_priority.actionability, 0);
  assert.equal(result.replacement_priority.label, "informational");
  assert.equal(result.training_priority.score, 1);
  assert.equal(result.training_priority.label, "review-now");
});

test("invalid normalized priority evidence is rejected", () => {
  assert.throws(() => calculateFindingPriority({
    kind: "training",
    classification: "forced-diversity",
    confidence,
    difference: 0.5,
    expected_frequency: 1.1,
    learning_burden: 0.5,
    preference_mismatch: 0.5,
    actionability: 0.5,
  }), /strategic_fit_findings_invalid_unit_value/);
});
