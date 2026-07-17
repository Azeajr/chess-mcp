import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_CONGRUENCE_PROJECTION_MAX_LIMIT,
  STRATEGIC_FIT_CLASSIFICATIONS,
  analyzeStrategicFit,
  projectStrategicFitLegacyResult,
  type StrategicFinding,
  type StrategicFitAnalysisResult,
} from "../../src/index.ts";
import { BROAD_ECO_FIXTURE, parseStrategicFitFixture } from "./fixtures.ts";

function baseReport(): StrategicFitAnalysisResult {
  return analyzeStrategicFit(parseStrategicFitFixture(BROAD_ECO_FIXTURE), {
    repertoireColor: BROAD_ECO_FIXTURE.repertoireColor,
    repertoireRevision: "revision:legacy-projection",
  });
}

function findingsForEveryClassification(report: StrategicFitAnalysisResult): StrategicFinding[] {
  const seed = report.findings[0];
  assert.ok(seed, "broad fixture must produce a finding");
  return STRATEGIC_FIT_CLASSIFICATIONS.map((classification, index) => ({
    ...seed,
    finding_id: `finding:${index}`,
    classification,
    plain_language_category: `Category ${index}`,
    explanation: `Explanation ${index}`,
    opening_scope: `Opening ${index}`,
    references: {
      ...seed.references,
      source_san_paths: [["e4", `reply-${index}`]],
    },
    replacement_priority: {
      ...seed.replacement_priority,
      label: (["review-now", "review-later", "informational", "insufficient-evidence"] as const)[index % 4]!,
    },
  }));
}

test("legacy shape snapshot maps every V2 classification without replacing native fields", () => {
  const report = baseReport();
  const findings = findingsForEveryClassification(report);
  const input = { ...report, findings };
  const projected = projectStrategicFitLegacyResult(input);

  assert.equal(projected.analysis_version, report.analysis_version);
  assert.equal(projected.summary, report.summary);
  assert.equal(projected.preflight, report.preflight);
  assert.equal(projected.findings, findings);
  assert.deepEqual(projected.incongruencies, [
    ["genuine_inconsistency", "high"],
    ["forced_diversity", "medium"],
    ["intentional_diversity", "low"],
    ["productive_diversity", "low"],
    ["mixed_strategic_profile", "high"],
    ["uncertain", "medium"],
    ["data_quality_issue", "low"],
    ["transpositional_equivalence", "low"],
  ].map(([type, severity], index) => ({
    type,
    severity,
    description: `Category ${index}: Explanation ${index}`,
    paths: [["e4", `reply-${index}`]],
    cluster: `Opening ${index}`,
    source_finding_id: `finding:${index}`,
    multi_path: false,
    projection_note: null,
  })));
  assert.deepEqual(projected.legacy_projection, {
    projection: "congruence-v1-incongruencies",
    deprecated: true,
    removal_task: "12.5",
    requested_limit: 10,
    applied_limit: 10,
    projected_finding_count: 8,
    omitted_finding_count: 0,
    note: "Temporary compatibility projection only; native Strategic Fit fields are authoritative.",
  });
});

test("multi-path findings disclose that the first legacy path is not a standalone fix", () => {
  const report = baseReport();
  const seed = report.findings[0];
  assert.ok(seed);
  const finding = {
    ...seed,
    finding_id: "finding:multi-path",
    references: {
      ...seed.references,
      source_san_paths: [["d4", "d5"], ["Nf3", "d5", "d4"]],
    },
  };

  const projected = projectStrategicFitLegacyResult({ ...report, findings: [finding] });
  const legacy = projected.incongruencies[0];

  assert.equal(legacy?.multi_path, true);
  assert.match(legacy?.projection_note ?? "", /first path is for navigation only/i);
  assert.match(legacy?.description ?? "", /not a standalone fix recommendation/i);
  assert.deepEqual(legacy?.paths, [["d4", "d5"], ["Nf3", "d5", "d4"]]);
});

test("projection limits are bounded and pathless findings cannot crash the legacy panel", () => {
  const report = baseReport();
  const seed = report.findings[0];
  assert.ok(seed);
  const findings = Array.from({ length: LEGACY_CONGRUENCE_PROJECTION_MAX_LIMIT + 5 }, (_, index) => ({
    ...seed,
    finding_id: `finding:bounded:${index}`,
    references: {
      ...seed.references,
      source_san_paths: index === 0 ? [] : [["c4", `reply-${index}`]],
    },
  }));

  const small = projectStrategicFitLegacyResult({ ...report, findings }, { limit: 2 });
  assert.deepEqual(small.incongruencies.map((finding) => finding.source_finding_id), [
    "finding:bounded:1",
    "finding:bounded:2",
  ]);
  assert.equal(small.legacy_projection.omitted_finding_count, findings.length - 2);

  const capped = projectStrategicFitLegacyResult({ ...report, findings }, { limit: 500 });
  assert.equal(capped.incongruencies.length, LEGACY_CONGRUENCE_PROJECTION_MAX_LIMIT);
  assert.equal(capped.legacy_projection.requested_limit, 500);
  assert.equal(capped.legacy_projection.applied_limit, LEGACY_CONGRUENCE_PROJECTION_MAX_LIMIT);

  assert.throws(
    () => projectStrategicFitLegacyResult(report, { limit: 0 }),
    /strategic_fit_legacy_projection_invalid_limit/,
  );
});

test("projection does not mutate the V2 report or its navigation paths", () => {
  const report = baseReport();
  const before = structuredClone(report);
  const projected = projectStrategicFitLegacyResult(report);

  const firstProjectedPath = projected.incongruencies[0]?.paths[0] as string[] | undefined;
  if (firstProjectedPath) firstProjectedPath.push("mutated projection");

  assert.deepEqual(report, before);
  assert.notEqual(projected, report);
  assert.notEqual(projected.incongruencies[0]?.paths, report.findings[0]?.references.source_san_paths);
});
