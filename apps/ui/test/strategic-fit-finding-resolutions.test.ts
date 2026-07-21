import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  buildRepertoireGraph,
  createDefaultStrategicFitDocumentMetadata,
  normalizeStrategicFitDocumentMetadata,
  type StrategicFinding,
  type StrategicFitAnalysisResult,
  type StrategicFitDocumentMetadata,
} from "@chess-mcp/chess-tools";
import {
  createStrategicFitFindingResolutionState,
  STRATEGIC_FIT_REVIEW_RESOLUTION_STATES,
  type StrategicFitFindingResolutionBoundary,
} from "../src/store/strategic-fit-finding-resolutions.ts";
import {
  createStrategicFitResolutionState,
  type StrategicFitResolutionStateBoundary,
} from "../src/store/strategic-fit-resolutions.ts";
import type {
  StrategicFitCompletedResult,
  StrategicFitRequestSnapshot,
} from "../src/store/strategic-fit.ts";

const PGN = "1. e4 e5 2. Nf3 Nc6 *";

function fixture() {
  const tree = GameTree.fromPgn(PGN);
  const graph = buildRepertoireGraph(tree, "white");
  const route = graph.routes[0]!;
  let metadata: StrategicFitDocumentMetadata = createDefaultStrategicFitDocumentMetadata();
  let clock = 0;
  let currentSnapshot: StrategicFitRequestSnapshot = {
    document_id: "document:resolution",
    repertoire_revision: 1,
    repertoire_pgn: tree.toPgn(),
    repertoire_color: "white",
    profile_identity: "profile:balanced",
    settings_identity: "settings:initial",
  };
  const surroundingState = {
    navigation: [0, 0],
    color: "white",
    dirty: false,
    fileName: "resolution.pgn",
    stagedActions: ["staged:one"],
    legacyCongruence: { acknowledged: ["legacy:one"] },
  };
  const finding = {
    schema_version: "1.0.0",
    analysis_version: "2.0.0",
    finding_id: "finding:resolution",
    semantic_finding_id: "semantic:finding:resolution",
    repertoire_revision: "browser:1",
    plain_language_category: "Different center plan",
    references: {
      position_ids: route.position_ids,
      decision_ids: route.decision_ids,
      route_ids: [route.route_id],
      source_san_paths: route.source_san_paths,
    },
    resolution_state: "unresolved",
  } as unknown as StrategicFinding;
  const report = {
    report_id: "report:resolution",
    repertoire_revision: "browser:1",
    findings: [finding],
    summary: { unresolved_finding_count: 1 },
  } as unknown as StrategicFitAnalysisResult;
  let completed: StrategicFitCompletedResult | null = {
    request_id: "request:resolution",
    report_id: report.report_id,
    request_snapshot: currentSnapshot,
    result: report,
    completed_at: "2026-07-21T12:00:00.000Z",
  };
  const lowBoundary: StrategicFitResolutionStateBoundary = {
    currentMetadata: () => metadata,
    currentGraph: () => graph,
    currentProfile: () => metadata.profile,
    currentRepertoireRevision: () => "browser:1",
    replaceMetadata: (input) => {
      const normalized = normalizeStrategicFitDocumentMetadata(input);
      metadata = normalized.metadata;
      currentSnapshot = {
        ...currentSnapshot,
        settings_identity: `settings:${JSON.stringify(metadata.resolutions)}`,
      };
      return normalized;
    },
    invalidateReports: () => undefined,
    now: () => `2026-07-21T12:00:${String(clock++).padStart(2, "0")}.000Z`,
  };
  const lowState = createStrategicFitResolutionState(lowBoundary);
  let currentFinding: StrategicFinding | null = finding;
  const boundary: StrategicFitFindingResolutionBoundary = {
    currentReport: () => completed,
    currentFinding: (reportId, findingId) =>
      completed?.report_id === reportId && currentFinding?.finding_id === findingId
        ? currentFinding
        : null,
    currentSnapshot: () => currentSnapshot,
    currentMetadata: () => metadata,
    currentGraph: () => graph,
    upsertResolution: (input) => lowState.upsertResolution(input),
    reopenResolution: (resolutionId) => lowState.reopenResolution(resolutionId),
    prepareReport: (reportId) => completed?.report_id === reportId,
    retainReport: (reportId) => {
      if (completed?.report_id !== reportId) return false;
      completed = { ...completed, request_snapshot: currentSnapshot };
      return true;
    },
  };
  const state = createStrategicFitFindingResolutionState(boundary);
  state.synchronize(report.report_id);
  return {
    state,
    finding,
    report,
    tree,
    metadata: () => metadata,
    surroundingState,
    patchSnapshot: (patch: Partial<StrategicFitRequestSnapshot>) => {
      currentSnapshot = { ...currentSnapshot, ...patch };
    },
    setCurrentFinding: (value: StrategicFinding | null) => { currentFinding = value; },
    clearReport: () => { completed = null; },
  };
}

test("every Task 6.1 resolution transition is metadata-only and reversible", () => {
  const subject = fixture();
  const before = {
    pgn: subject.tree.toPgn(),
    surrounding: structuredClone(subject.surroundingState),
  };

  for (const state of STRATEGIC_FIT_REVIEW_RESOLUTION_STATES) {
    const result = subject.state.transition({
      report_id: subject.report.report_id,
      finding_id: subject.finding.finding_id,
      semantic_finding_id: subject.finding.semantic_finding_id,
      state,
      intentional_reason: state === "keep-intentionally" ? "objectively-strongest" : null,
      note: state === "keep-intentionally" ? "Best practical choice" : `Note for ${state}`,
    });
    assert.equal(result.state, "updated", state);
    assert.equal(subject.metadata().resolutions.length, 1);
    assert.equal(subject.metadata().resolutions[0]!.state, state);
    assert.equal(subject.metadata().resolutions[0]!.semantic_finding_id, subject.finding.semantic_finding_id);
    assert.equal(subject.metadata().resolutions[0]!.finding_id, subject.finding.finding_id);
    assert.deepEqual(
      subject.metadata().resolutions[0]!.references,
      {
        position_ids: [...subject.finding.references.position_ids].sort(),
        decision_ids: [...subject.finding.references.decision_ids].sort(),
        route_ids: [...subject.finding.references.route_ids].sort(),
        source_san_paths: subject.finding.references.source_san_paths,
      },
    );
    assert.equal(subject.state.displayState(subject.finding), state);
    assert.equal(subject.state.unresolvedCount(subject.report), 0);

    const reopened = subject.state.reopen({
      report_id: subject.report.report_id,
      finding_id: subject.finding.finding_id,
      semantic_finding_id: subject.finding.semantic_finding_id,
    });
    assert.equal(reopened.state, "reopened", state);
    assert.deepEqual(subject.metadata().resolutions, []);
    assert.equal(subject.state.displayState(subject.finding), "unresolved");
    assert.equal(subject.state.unresolvedCount(subject.report), 1);
  }

  assert.equal(subject.tree.toPgn(), before.pgn);
  assert.deepEqual(subject.surroundingState, before.surrounding);
});

test("resolved-to-resolved changes replace one semantic decision and custom intent requires a note", () => {
  const subject = fixture();
  const customWithoutNote = subject.state.transition({
    report_id: subject.report.report_id,
    finding_id: subject.finding.finding_id,
    semantic_finding_id: subject.finding.semantic_finding_id,
    state: "keep-intentionally",
    intentional_reason: "custom",
  });
  assert.equal(customWithoutNote.state, "blocked");
  assert.equal(customWithoutNote.code, "strategic_fit_resolution_custom_reason_requires_note");
  assert.deepEqual(subject.metadata().resolutions, []);

  subject.state.transition({
    report_id: subject.report.report_id,
    finding_id: subject.finding.finding_id,
    semantic_finding_id: subject.finding.semantic_finding_id,
    state: "keep-intentionally",
    intentional_reason: "custom",
    note: "Prepared for a specific opponent",
  });
  const resolutionId = subject.metadata().resolutions[0]!.resolution_id;
  subject.state.transition({
    report_id: subject.report.report_id,
    finding_id: subject.finding.finding_id,
    semantic_finding_id: subject.finding.semantic_finding_id,
    state: "defer",
    note: "Review next month",
  });
  assert.equal(subject.metadata().resolutions.length, 1);
  assert.equal(subject.metadata().resolutions[0]!.resolution_id, resolutionId);
  assert.equal(subject.metadata().resolutions[0]!.state, "defer");
  assert.equal(subject.metadata().resolutions[0]!.intentional_reason, null);
  assert.equal(subject.metadata().resolutions[0]!.note, "Review next month");
  assert.equal(subject.state.unresolvedCount(subject.report), 0);
});

test("stale report, context, finding, and semantic references visibly block without persistence", () => {
  const staleContext = fixture();
  staleContext.patchSnapshot({ profile_identity: "profile:versatile" });
  const contextResult = staleContext.state.transition({
    report_id: staleContext.report.report_id,
    finding_id: staleContext.finding.finding_id,
    semantic_finding_id: staleContext.finding.semantic_finding_id,
    state: "defer",
  });
  assert.equal(contextResult.state, "blocked");
  assert.equal(contextResult.code, "strategic_fit_resolution_stale_context");
  assert.match(staleContext.state.snapshot().message ?? "", /blocked/i);
  assert.deepEqual(staleContext.metadata().resolutions, []);

  const staleFinding = fixture();
  const rawIdOnly = staleFinding.state.transition({
    report_id: staleFinding.report.report_id,
    finding_id: staleFinding.finding.finding_id,
    semantic_finding_id: "semantic:wrong",
    state: "exclude-from-analysis",
  });
  assert.equal(rawIdOnly.code, "strategic_fit_resolution_stale_finding");
  assert.deepEqual(staleFinding.metadata().resolutions, []);

  const staleSemantic = fixture();
  staleSemantic.setCurrentFinding({
    ...staleSemantic.finding,
    references: {
      ...staleSemantic.finding.references,
      route_ids: ["route:deleted"],
    },
  });
  const semanticResult = staleSemantic.state.transition({
    report_id: staleSemantic.report.report_id,
    finding_id: staleSemantic.finding.finding_id,
    semantic_finding_id: staleSemantic.finding.semantic_finding_id,
    state: "invalid-comparison",
  });
  assert.equal(semanticResult.code, "strategic_fit_resolution_stale_semantic_reference");
  assert.match(semanticResult.message, /semantic route/i);
  assert.deepEqual(staleSemantic.metadata().resolutions, []);

  const staleReport = fixture();
  staleReport.clearReport();
  const reportResult = staleReport.state.transition({
    report_id: staleReport.report.report_id,
    finding_id: staleReport.finding.finding_id,
    semantic_finding_id: staleReport.finding.semantic_finding_id,
    state: "defer",
  });
  assert.equal(reportResult.code, "strategic_fit_resolution_stale_report");
  assert.deepEqual(staleReport.metadata().resolutions, []);
});
