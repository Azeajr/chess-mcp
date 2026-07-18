import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFIDENCE_CAP_REASONS,
  CONFIDENCE_COMPONENTS,
  type ConfidenceLabel,
  type PreflightIssue,
  type StrategicFinding,
} from "@chess-mcp/chess-tools";
import {
  buildConceptComparisonPresentation,
} from "../src/components/strategic-fit/ConceptComparison.tsx";
import {
  buildConfidencePresentation,
} from "../src/components/strategic-fit/ConfidenceDetails.tsx";
import {
  buildEvidencePresentation,
  buildObjectivePresentation,
} from "../src/components/strategic-fit/EvidencePanel.tsx";

const source = (
  sourceId: string,
  kind: "deterministic-core" | "structure-classifier" | "opening-taxonomy" | "engine",
  state: "available" | "partial" | "unavailable" = "available",
  reason: string | null = null,
) => ({
  source_id: sourceId,
  kind,
  state,
  version: "2.1.0",
  snapshot: "fixture-snapshot",
  reason,
});

function finding(confidenceLabel: ConfidenceLabel = "high"): StrategicFinding {
  return {
    schema_version: "1.0.0",
    analysis_version: "2.0.0",
    finding_id: "finding:evidence",
    semantic_finding_id: "semantic-finding:evidence",
    repertoire_revision: "browser:9",
    classification: "genuine-inconsistency",
    plain_language_category: "Different center plan",
    opening_scope: "Sicilian · Alapin",
    affected_line_summary: "6...Nf6 branch",
    explanation: "The branch reaches a different stable center.",
    references: {
      position_ids: ["position:a", "position:b"],
      decision_ids: ["decision:a", "decision:b"],
      route_ids: ["route:a", "route:b"],
      source_san_paths: [
        ["e4", "c5", "c3", "Nf6"],
        ["e4", "c5", "Nf3", "e6", "c3"],
        [],
      ],
    },
    weighted_baseline_percentage: 72,
    expected_frequency: 0.2,
    learning_burden: 0.5,
    confidence: {
      analysis_version: "2.0.0",
      score: confidenceLabel === "high" ? 84 : confidenceLabel === "moderate" ? 62 : 31,
      label: confidenceLabel,
      components: CONFIDENCE_COMPONENTS.map((component, index) => ({
        component,
        score: 0.9 - index * 0.05,
        weight: 1,
        explanation: `Canonical explanation for ${component}.`,
      })),
      applied_caps: [],
      explanation: `${confidenceLabel} confidence from the canonical report.`,
    },
    difference: {
      analysis_version: "2.0.0",
      distance: 0.5,
      magnitude: "moderate",
      persistence: 0.7,
      new_concept_count: 2,
      stable_from_ply: 14,
    },
    objective_quality: {
      analysis_version: "2.0.0",
      state: "available",
      verdict: "sound",
      repertoire_pov_cp: 35,
      loss_from_best_cp: 12,
      engine_depth: 22,
      engine_lines: 3,
      database_performance: 0.54,
      theoretical_status: "Playable",
      reason: null,
      provenance: [source("engine:fixture", "engine")],
    },
    replacement_priority: {
      analysis_version: "2.0.0",
      kind: "replacement",
      score: 0.7,
      label: "review-now",
      confidence: 0.8,
      difference: 0.5,
      expected_frequency: 0.2,
      learning_burden: 0.5,
      preference_mismatch: 0.6,
      actionability: 0.8,
    },
    training_priority: {
      analysis_version: "2.0.0",
      kind: "training",
      score: 0.5,
      label: "review-later",
      confidence: 0.8,
      difference: 0.5,
      expected_frequency: 0.2,
      learning_burden: 0.5,
      preference_mismatch: 0.6,
      actionability: 0.8,
    },
    evidence: {
      analysis_version: "2.0.0",
      cohort_id: "cohort:evidence",
      baseline_mode_ids: ["mode:a"],
      representative_route_ids: ["route:b"],
      dimensions: [
        {
          dimension_id: "center-dynamics.center-state",
          typical_value: "open-iqp",
          affected_value: "closed",
          contribution: 0.3,
          explanation: "Center state contributes 30%.",
        },
        {
          dimension_id: "learning-concepts.unique-concepts",
          typical_value: null,
          affected_value: ["minority-attack", "e5-break"],
          contribution: 0.2,
          explanation: "Concept novelty contributes 20%.",
        },
      ],
      comparison_basis: {
        effective_branches: 14,
        weighted_reference_games: null,
        structural_classification_coverage: 0.91,
        analysis_window: [10, 24],
        taxonomy_version: "opening-taxonomy:3",
        profile_mode: "balanced",
      },
      causality: {
        analysis_version: "2.0.0",
        controllability: 0.8,
        label: "mostly-player-controlled",
        player_contribution: 0.8,
        opponent_contribution: 0.2,
        likely_causal_decision_ids: ["decision:a"],
        timeline: [],
        explanation: "The player decision owns most of the difference.",
      },
      data_quality_issue_ids: ["issue:opening"],
      provenance: [
        source(
          "structure:fixture",
          "structure-classifier",
          "partial",
          "One route has partial structural classification.",
        ),
      ],
    },
    resolution_state: "unresolved",
    provisional: false,
    provenance: {
      schema_version: "1.0.0",
      analysis_version: "2.0.0",
      repertoire_revision: "browser:9",
      generated_at: "2026-07-18T12:00:00.000Z",
      deterministic: true,
      sources: [source("core:fixture", "deterministic-core")],
    },
  } as StrategicFinding;
}

const issue = {
  analysis_version: "2.0.0",
  issue_id: "issue:opening",
  code: "missing-opening-classification",
  kind: "evidence-limitation",
  severity: "degraded",
  message: "Opening classification is incomplete for one affected route.",
  affected_route_ids: ["route:a"],
  affected_source_paths: [["e4", "c5"]],
  details: {},
  provenance: [],
} as PreflightIssue;

test("typical-versus-branch dimensions retain null evidence and reconcile contributions honestly", () => {
  const presentation = buildConceptComparisonPresentation(finding());
  assert.deepEqual(presentation.dimensions.map((dimension) => ({
    id: dimension.dimension_id,
    label: dimension.label,
    typical: dimension.typical,
    affected: dimension.affected,
    contribution: dimension.contribution_label,
  })), [
    {
      id: "center-dynamics.center-state",
      label: "Center state",
      typical: "Open iqp",
      affected: "Closed",
      contribution: "30% of normalized strategic distance",
    },
    {
      id: "learning-concepts.unique-concepts",
      label: "Unique concepts",
      typical: "Unavailable",
      affected: "Minority attack, e5-break",
      contribution: "20% of normalized strategic distance",
    },
  ]);
  assert.deepEqual(presentation.reconciliation, {
    state: "reconciled",
    listed_total: 0.5,
    report_distance: 0.5,
    unlisted_difference: 0,
    summary: "Listed dimensions reconcile to the report's 50% strategic distance.",
  });

  const partial = structuredClone(finding());
  Object.assign(partial.difference, { distance: 0.65 });
  const mismatch = buildConceptComparisonPresentation(partial).reconciliation;
  assert.equal(mismatch.state, "partial");
  assert.ok(Math.abs((mismatch.unlisted_difference ?? 0) - 0.15) < 0.000001);
  assert.match(mismatch.summary, /gap is not assigned/i);

  const absent = structuredClone(finding());
  Object.assign(absent.evidence, { dimensions: [] });
  assert.deepEqual(buildConceptComparisonPresentation(absent).reconciliation, {
    state: "unavailable",
    listed_total: null,
    report_distance: 0.5,
    unlisted_difference: null,
    summary: "Contribution breakdown is unavailable because this finding has no comparable dimensions.",
  });
});

test("high, moderate, and low confidence stay distinct while all active caps explain themselves", () => {
  assert.deepEqual(["high", "moderate", "low"].map((label) => {
    const presentation = buildConfidencePresentation(finding(label as ConfidenceLabel).confidence);
    return [presentation.label, presentation.score, presentation.missing_component_count];
  }), [
    ["High confidence", 84, 0],
    ["Moderate confidence", 62, 0],
    ["Low confidence", 31, 0],
  ]);

  const capped = structuredClone(finding());
  Object.assign(capped.confidence, {
    applied_caps: CONFIDENCE_CAP_REASONS.map((reason, index) => ({
      reason,
      maximum_score: 39 + index * 10,
      explanation: `Plain explanation for ${reason}.`,
    })),
    components: capped.confidence.components.slice(0, 5),
  });
  const presentation = buildConfidencePresentation(capped.confidence);
  assert.deepEqual(presentation.caps.map((cap) => cap.reason), CONFIDENCE_CAP_REASONS);
  assert.ok(presentation.caps.every((cap) => cap.label !== cap.reason));
  assert.ok(presentation.caps.every((cap) => cap.explanation.startsWith("Plain explanation")));
  assert.equal(presentation.missing_component_count, 2);
  assert.equal(presentation.components.at(-1)?.score_label, "Unavailable");
});

test("comparison basis, provenance, source paths, and every missing-data limitation remain explicit", () => {
  const presentation = buildEvidencePresentation(finding(), [issue], "white");
  assert.deepEqual({
    effective_branches: presentation.effective_branches,
    weighted_reference_games: presentation.weighted_reference_games,
    structural_coverage: presentation.structural_coverage,
    analysis_window: presentation.analysis_window,
    taxonomy_version: presentation.taxonomy_version,
    profile: presentation.profile,
  }, {
    effective_branches: "14",
    weighted_reference_games: "Unavailable",
    structural_coverage: "91%",
    analysis_window: "Plies 10–24",
    taxonomy_version: "opening-taxonomy:3",
    profile: "Balanced",
  });
  assert.deepEqual(presentation.paths, [
    "e4 c5 c3 Nf6",
    "e4 c5 Nf3 e6 c3",
    "Start position",
  ]);
  assert.ok(presentation.limitations.some((limitation) => /not shown as zero/i.test(limitation)));
  assert.ok(presentation.limitations.includes("Weighted reference-game evidence is unavailable."));
  assert.ok(presentation.limitations.includes(issue.message));
  assert.ok(presentation.limitations.includes("One route has partial structural classification."));
  assert.deepEqual(presentation.sources.map((entry) => [
    entry.group, entry.source.source_id, entry.source.state,
  ]), [
    ["Finding report", "core:fixture", "available"],
    ["Comparison evidence", "structure:fixture", "partial"],
    ["Objective quality", "engine:fixture", "available"],
  ]);
});

test("objective verdicts and engine values use explicit Black repertoire POV without invented zeroes", () => {
  const black = buildObjectivePresentation(finding(), "black");
  assert.equal(black.verdict, "The line is objectively sound for the Black repertoire.");
  assert.equal(black.repertoire_pov_label, "Black repertoire POV evaluation");
  assert.equal(black.repertoire_pov_value, "+35 cp");
  assert.match(black.repertoire_pov_explanation, /favor the Black repertoire/);
  assert.doesNotMatch(JSON.stringify(black), /White-POV/);

  const unavailable = structuredClone(finding());
  Object.assign(unavailable.objective_quality, {
    state: "unavailable",
    verdict: "unknown",
    repertoire_pov_cp: null,
    loss_from_best_cp: null,
    engine_depth: null,
    engine_lines: null,
    database_performance: null,
    theoretical_status: null,
    reason: "No engine evidence was requested.",
  });
  const missing = buildObjectivePresentation(unavailable, "black");
  assert.equal(missing.repertoire_pov_value, "Unavailable");
  assert.equal(missing.loss_from_best, "Unavailable");
  assert.doesNotMatch(JSON.stringify(missing), /0 cp/);
});
