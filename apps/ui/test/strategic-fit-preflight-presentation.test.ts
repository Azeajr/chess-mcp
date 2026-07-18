import assert from "node:assert/strict";
import test from "node:test";

import {
  PREFLIGHT_ISSUE_CODES,
  PREFLIGHT_ISSUE_KINDS,
  PREFLIGHT_ISSUE_SEVERITIES,
  type PreflightIssue,
  type StrategicFitPreflight,
} from "@chess-mcp/chess-tools";
import {
  PREFLIGHT_CODE_LABELS,
  PREFLIGHT_KIND_LABELS,
  PREFLIGHT_SEVERITY_LABELS,
  boundedPreflightEvidence,
  preflightCountsAreMeaningful,
} from "../src/components/strategic-fit/PreflightResults.tsx";

function issue(code: PreflightIssue["code"], paths = 0, details = 0): PreflightIssue {
  return {
    analysis_version: "2.0.0",
    issue_id: `preflight:${code}`,
    code,
    kind: code === "empty-repertoire" ? "error" : "evidence-limitation",
    severity: code === "empty-repertoire" ? "blocking" : "degraded",
    message: `Canonical ${code} message.`,
    affected_route_ids: [],
    affected_source_paths: Array.from({ length: paths }, (_, index) => [`route-${index}`, "e4"]),
    details: Object.fromEntries(Array.from({ length: details }, (_, index) => [`detail_${index}`, index])),
    provenance: [],
  };
}

function preflight(issues: readonly PreflightIssue[]): StrategicFitPreflight {
  return {
    analysis_version: "2.0.0",
    state: issues.some((entry) => entry.severity === "blocking") ? "blocked" : "degraded",
    issues,
    route_count: 2,
    comparable_route_count: 1,
    incomplete_route_count: 1,
  };
}

test("every canonical preflight code, kind, and severity has a plain distinct UI label", () => {
  assert.deepEqual(Object.keys(PREFLIGHT_CODE_LABELS), [...PREFLIGHT_ISSUE_CODES]);
  assert.deepEqual(Object.keys(PREFLIGHT_KIND_LABELS), [...PREFLIGHT_ISSUE_KINDS]);
  assert.deepEqual(Object.keys(PREFLIGHT_SEVERITY_LABELS), [...PREFLIGHT_ISSUE_SEVERITIES]);
  assert.equal(new Set(Object.values(PREFLIGHT_CODE_LABELS)).size, PREFLIGHT_ISSUE_CODES.length);
  assert.deepEqual(Object.values(PREFLIGHT_KIND_LABELS), ["Input error", "Input warning", "Evidence limitation"]);
  assert.deepEqual(Object.values(PREFLIGHT_SEVERITY_LABELS), ["Blocking", "Degraded evidence", "Informational"]);
});

test("affected paths and details remain bounded while omitted evidence stays explicitly counted", () => {
  const evidence = boundedPreflightEvidence(issue("shallow-route", 10, 12));
  assert.equal(evidence.paths.length, 6);
  assert.equal(evidence.hidden_path_count, 4);
  assert.equal(evidence.details.length, 8);
  assert.equal(evidence.hidden_detail_count, 4);
});

test("unsafe custom, malformed, and illegal inputs withhold misleading route counts", () => {
  for (const code of ["unsupported-custom-start", "malformed-data", "illegal-line"] as const) {
    assert.equal(preflightCountsAreMeaningful(preflight([issue(code)])), false, code);
  }
  assert.equal(preflightCountsAreMeaningful(preflight([issue("empty-repertoire")])), true);
  assert.equal(preflightCountsAreMeaningful(preflight([issue("single-route")])), true);
});
