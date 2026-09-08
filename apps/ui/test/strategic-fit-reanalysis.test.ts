import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  buildRepertoireGraph,
  createDefaultStrategicFitDocumentMetadata,
  type StrategicFinding,
  type StrategicFitDocumentMetadata,
  type StrategicFitPersistedResolution,
  type StrategicFitReport,
} from "@chess-mcp/chess-tools";
import {
  affectedCohortReanalysisRequest,
  planStrategicFitReanalysis,
  reconcileStrategicFitReanalysis,
} from "../src/store/strategic-fit-reanalysis.ts";
import type { StrategicFitRequestSnapshot } from "../src/store/strategic-fit.ts";

const MULTI_ROUTE_PGN = "1. e4 e5 2. Nf3 Nc6 (2... Nf6) *";
const SINGLE_ROUTE_PGN = "1. e4 e5 2. Nf3 Nc6 *";

const snapshot = (
  pgn: string,
  patch: Partial<StrategicFitRequestSnapshot> = {},
): StrategicFitRequestSnapshot => ({
  document_id: "document:a",
  repertoire_revision: 1,
  repertoire_pgn: pgn,
  repertoire_color: "white",
  profile_identity: "profile:balanced",
  settings_identity: "settings:default",
  ...patch,
});

function scopedReport(pgn = MULTI_ROUTE_PGN): StrategicFitReport {
  const graph = buildRepertoireGraph(GameTree.fromPgn(pgn), "white");
  return {
    report_id: "report:before",
    repertoire_revision: "browser:1",
    cohorts: graph.routes.map((route, index) => ({
      cohort_id: `cohort:${index}`,
      route_ids: [route.route_id],
    })),
  } as unknown as StrategicFitReport;
}

function finding(
  semanticId: string,
  cohortId: string,
  explanation = `Evidence for ${semanticId}`,
  resolutionState: StrategicFinding["resolution_state"] = "unresolved",
): StrategicFinding {
  return {
    finding_id: `finding:${semanticId}`,
    semantic_finding_id: semanticId,
    classification: "potential-mismatch",
    plain_language_category: "Test finding",
    opening_scope: "Test opening",
    affected_line_summary: "Test line",
    explanation,
    references: {
      position_ids: [`position:${semanticId}`],
      decision_ids: [],
      route_ids: [`route:${semanticId}`],
      source_san_paths: [["e4"]],
    },
    resolution_state: resolutionState,
    evidence: { cohort_id: cohortId },
  } as unknown as StrategicFinding;
}

function resolution(
  semanticId: string,
  state: StrategicFitPersistedResolution["state"],
): StrategicFitPersistedResolution {
  return {
    resolution_id: `resolution:${semanticId}`,
    semantic_finding_id: semanticId,
    record_state: "active",
    state,
  } as StrategicFitPersistedResolution;
}

test("document scoping maps removed semantic routes, ignores notation-only edits, and falls back for new routes", () => {
  const report = scopedReport();
  const previous = snapshot(MULTI_ROUTE_PGN);
  const edited = snapshot(SINGLE_ROUTE_PGN, { repertoire_revision: 2 });
  const local = planStrategicFitReanalysis(report, previous, edited, "document-change");
  assert.equal(local.scope.kind, "affected-cohorts");
  assert.equal(local.scope.cohort_ids.length, 1);

  const notationOnly = planStrategicFitReanalysis(
    report,
    previous,
    snapshot(`${MULTI_ROUTE_PGN}\n{editor note}`, { repertoire_revision: 2 }),
    "document-change",
  );
  assert.deepEqual(notationOnly.scope.cohort_ids, []);

  const newRoute = planStrategicFitReanalysis(
    scopedReport(SINGLE_ROUTE_PGN),
    snapshot(SINGLE_ROUTE_PGN),
    snapshot(MULTI_ROUTE_PGN, { repertoire_revision: 2 }),
    "document-change",
  );
  assert.equal(newRoute.scope.kind, "full-scan");
});

test("profile and cohort-override triggers produce deterministic affected scopes", () => {
  const report = scopedReport();
  const profile = planStrategicFitReanalysis(
    report,
    snapshot(MULTI_ROUTE_PGN),
    snapshot(MULTI_ROUTE_PGN, { profile_identity: "profile:versatile" }),
    "profile-change",
  );
  assert.deepEqual(
    profile.scope.cohort_ids,
    report.cohorts.map((cohort) => cohort.cohort_id).sort(),
  );

  const override = affectedCohortReanalysisRequest(
    "cohort-override",
    ["cohort:b", "cohort:a", "cohort:b"],
    "Confirmed override.",
  );
  assert.deepEqual(override.scope.cohort_ids, ["cohort:a", "cohort:b"]);
  assert.equal(
    affectedCohortReanalysisRequest("cohort-override", [], "Unknown.").scope.kind,
    "full-scan",
  );
});

test("reconciliation preserves unrelated decisions, resolves disappearance, and reopens changed or reappeared evidence", () => {
  const previous = [
    finding("gone", "cohort:a"),
    finding("preserved", "cohort:b", "Same evidence", "keep-intentionally"),
    finding("changed", "cohort:a", "Old evidence", "defer"),
  ];
  const next = [
    finding("preserved", "cohort:b", "Same evidence", "keep-intentionally"),
    finding("changed", "cohort:a", "New evidence", "defer"),
    finding("returned", "cohort:a", "Returned evidence", "automatically-resolved-by-another-edit"),
  ];
  const metadata: StrategicFitDocumentMetadata = {
    ...createDefaultStrategicFitDocumentMetadata(),
    resolutions: [
      resolution("preserved", "keep-intentionally"),
      resolution("changed", "defer"),
      resolution("returned", "automatically-resolved-by-another-edit"),
    ],
  };
  const request = affectedCohortReanalysisRequest(
    "resolution-change",
    ["cohort:a"],
    "Changed cohort A.",
  );
  const reconciled = reconcileStrategicFitReanalysis(
    "report:before",
    previous,
    { report_id: "report:after", repertoire_revision: "browser:2" } as StrategicFitReport,
    next,
    metadata,
    request,
  );

  assert.deepEqual(reconciled.summary.disappeared_semantic_finding_ids, ["gone"]);
  assert.deepEqual(reconciled.summary.auto_resolved_semantic_finding_ids, ["gone"]);
  assert.deepEqual(reconciled.summary.changed_evidence_semantic_finding_ids, ["changed"]);
  assert.deepEqual(reconciled.summary.reappeared_semantic_finding_ids, ["returned"]);
  assert.deepEqual(reconciled.actions.reopen_semantic_finding_ids, ["changed", "returned"]);
  assert.deepEqual(reconciled.summary.preserved_resolution_ids, ["resolution:preserved"]);
  assert.equal(reconciled.summary.resolving_revision, "browser:2");
  assert.deepEqual(
    reconciled.findings
      .filter((entry) => ["changed", "returned"].includes(entry.semantic_finding_id))
      .map((entry) => entry.resolution_state),
    ["unresolved", "unresolved"],
  );
});

test("the resolution that triggered a run keeps its decision; other changed evidence still reopens", () => {
  const previous = [
    finding("origin", "cohort:a", "Old evidence", "keep-intentionally"),
    finding("other", "cohort:a", "Old evidence", "defer"),
  ];
  const next = [
    finding("origin", "cohort:a", "New evidence", "keep-intentionally"),
    finding("other", "cohort:a", "New evidence", "defer"),
  ];
  const metadata: StrategicFitDocumentMetadata = {
    ...createDefaultStrategicFitDocumentMetadata(),
    resolutions: [resolution("origin", "keep-intentionally"), resolution("other", "defer")],
  };
  // Recording a resolution changes the analyzer projection for its cohort, so the finding just
  // resolved comes back with different evidence. Reopening it there cancels the decision that asked
  // for the run: the first resolution a reader recorded used to vanish, and only a second attempt
  // held.
  const request = affectedCohortReanalysisRequest(
    "resolution-change",
    ["cohort:a"],
    "A finding resolution changed the analyzer projection for this cohort.",
    ["origin"],
  );
  assert.deepEqual(request.originating_semantic_finding_ids, ["origin"]);

  const reconciled = reconcileStrategicFitReanalysis(
    "report:before",
    previous,
    { report_id: "report:after", repertoire_revision: "browser:2" } as StrategicFitReport,
    next,
    metadata,
    request,
  );

  assert.deepEqual(reconciled.summary.changed_evidence_semantic_finding_ids, ["origin", "other"]);
  assert.deepEqual(reconciled.actions.reopen_semantic_finding_ids, ["other"]);
  assert.deepEqual(reconciled.summary.reopened_semantic_finding_ids, ["other"]);
  assert.deepEqual(reconciled.summary.preserved_resolution_ids, ["resolution:origin"]);
  assert.equal(
    reconciled.findings.find((entry) => entry.semantic_finding_id === "origin")?.resolution_state,
    "keep-intentionally",
  );
  assert.equal(
    reconciled.findings.find((entry) => entry.semantic_finding_id === "other")?.resolution_state,
    "unresolved",
  );
});
