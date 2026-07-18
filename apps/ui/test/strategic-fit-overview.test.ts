import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStrategicOverviewPresentation,
  type StrategicOverviewReport,
} from "../src/components/strategic-fit/StrategicOverview.tsx";

const metric = (
  metricId: string,
  unit: string,
  state: "available" | "partial" | "unavailable",
  value: unknown,
  reason: string | null = null,
) => ({
  analysis_version: "2.0.0",
  metric_id: metricId,
  unit,
  state,
  value,
  reason,
  provenance: [],
});

function report(): StrategicOverviewReport {
  return {
    report_id: "report:overview",
    preflight: {
      analysis_version: "2.0.0",
      state: "ready",
      issues: [],
      route_count: 9,
      comparable_route_count: 7,
      incomplete_route_count: 2,
    },
    summary: {
      analysis_version: "2.0.0",
      workload: "moderate",
      strategic_family_count: 7,
      expected_concept_burden: 2.25,
      intentional_exception_count: 3,
      unresolved_finding_count: 5,
      insufficient_evidence_branch_count: 2,
      metrics: {
        analysis_version: "2.0.0",
        strategic_entropy: metric("strategic-entropy", "entropy", "available", 1.5),
        concept_reuse: metric(
          "concept-reuse",
          "fraction",
          "partial",
          0.625,
          "Concept reuse uses 80% of expected route weight; missing evidence is not counted as zero.",
        ),
        exception_burden: metric("exception-burden", "composite", "partial", {
          expected_frequency: 0.25,
          training_cost: null,
        }),
        forced_diversity_floor: metric(
          "forced-diversity-floor",
          "fraction",
          "partial",
          0.2,
          "This is a provisional engine-free floor.",
        ),
        homogenization_cost: metric("homogenization-cost", "composite", "unavailable", null),
        familiarity_adjusted_coverage: metric(
          "familiarity-adjusted-coverage",
          "fraction",
          "unavailable",
          null,
          "Familiarity-adjusted coverage requires calibrated concept-mastery evidence.",
        ),
        training_adjusted_workload: metric("training-adjusted-workload", "score", "unavailable", null),
        repertoire_regret: metric("repertoire-regret", "score", "unavailable", null),
        move_order_resilience: metric("move-order-resilience", "fraction", "available", 0.7),
        concept_centrality: metric("concept-centrality", "composite", "available", []),
      },
    },
  } as unknown as StrategicOverviewReport;
}

const byId = (presentation: ReturnType<typeof buildStrategicOverviewPresentation>, id: string) => {
  const item = presentation.items.find((candidate) => candidate.id === id);
  assert.ok(item, `missing ${id}`);
  return item;
};

test("overview presentation uses canonical summary values, metric states, and unavailable reasons", () => {
  const presentation = buildStrategicOverviewPresentation(report());

  assert.deepEqual(
    presentation.items.map((item) => [item.id, item.value, item.report_value]),
    [
      ["strategic-workload", "Moderate", "moderate"],
      ["strategic-families", "7", "7"],
      ["concept-reuse", "62.5%", "0.625"],
      ["forced-diversity-floor", "20%", "0.2"],
      ["intentional-exceptions", "3", "3"],
      ["unresolved-findings", "5", "5"],
      ["incomplete-branches", "2", "2"],
      ["familiar-plan-coverage", "Unavailable", ""],
    ],
  );
  assert.equal(byId(presentation, "concept-reuse").state, "partial");
  assert.match(byId(presentation, "concept-reuse").reason ?? "", /missing evidence is not counted as zero/i);
  assert.deepEqual(byId(presentation, "forced-diversity-floor").review_filter, {
    kind: "classification",
    classification: "forced-diversity",
  });
  assert.equal(byId(presentation, "familiar-plan-coverage").state, "unavailable");
  assert.match(byId(presentation, "familiar-plan-coverage").reason ?? "", /requires calibrated/i);
  assert.deepEqual(presentation.expected_concept_burden, {
    value: "2.25",
    report_value: "2.25",
    reason: null,
  });
  assert.deepEqual(presentation.entropy, {
    value: "1.5 bits",
    report_value: "1.5",
    state: "available",
    reason: null,
  });
  assert.match(presentation.screen_reader_summary, /Strategic families: 7/);
  assert.match(presentation.screen_reader_summary, /Familiar-plan coverage: Unavailable/);
  assert.match(presentation.screen_reader_summary, /Lower entropy is not universally better/);
});

test("blocked reports do not present unavailable overview sentinels as zero", () => {
  const blocked = structuredClone(report()) as StrategicOverviewReport;
  Object.assign(blocked.preflight, { state: "blocked", route_count: 0, comparable_route_count: 0 });
  Object.assign(blocked.summary, {
    workload: "unavailable",
    strategic_family_count: 0,
    expected_concept_burden: null,
    intentional_exception_count: 0,
    unresolved_finding_count: 0,
    insufficient_evidence_branch_count: 0,
  });
  for (const value of Object.values(blocked.summary.metrics)) {
    if (typeof value !== "object" || value === null || !("metric_id" in value)) continue;
    Object.assign(value, {
      state: "unavailable",
      value: null,
      reason: "Strategic Fit metrics are unavailable because preflight blocked position analysis.",
    });
  }

  const presentation = buildStrategicOverviewPresentation(blocked);
  for (const id of [
    "strategic-workload",
    "strategic-families",
    "intentional-exceptions",
    "unresolved-findings",
    "concept-reuse",
    "forced-diversity-floor",
    "familiar-plan-coverage",
  ]) {
    const item = byId(presentation, id);
    assert.equal(item.value, "Unavailable", id);
    assert.equal(item.report_value, "", id);
    assert.equal(item.state, "unavailable", id);
  }
  assert.equal(byId(presentation, "incomplete-branches").value, "0");
  assert.equal(byId(presentation, "incomplete-branches").state, "available");
  assert.doesNotMatch(presentation.screen_reader_summary, /Unavailable[^.]*: 0/);
});

test("calibrated familiar-plan coverage is rendered as report percentage rather than availability copy", () => {
  const personalized = report();
  Object.assign(personalized.summary.metrics.familiarity_adjusted_coverage, {
    state: "partial",
    value: 0.74,
    reason: "Familiarity-adjusted coverage uses 85% of expected route weight.",
  });

  const presentation = buildStrategicOverviewPresentation(personalized);
  const familiarity = byId(presentation, "familiar-plan-coverage");
  assert.deepEqual(
    {
      value: familiarity.value,
      report_value: familiarity.report_value,
      state: familiarity.state,
      reason: familiarity.reason,
      review_filter: familiarity.review_filter,
    },
    {
      value: "74%",
      report_value: "0.74",
      state: "partial",
      reason: "Familiarity-adjusted coverage uses 85% of expected route weight.",
      review_filter: { kind: "all" },
    },
  );
});
