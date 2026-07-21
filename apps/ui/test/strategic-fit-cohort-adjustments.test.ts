import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultStrategicFitDocumentMetadata,
  normalizeStrategicFitDocumentMetadata,
  type RepertoireGraph,
  type StrategicCohort,
  type StrategicFinding,
  type StrategicFitAnalysisResult,
  type StrategicFitDocumentMetadata,
} from "@chess-mcp/chess-tools";
import {
  createStrategicFitCohortAdjustmentState,
  type StrategicFitCohortAdjustmentBoundary,
  type StrategicFitCohortAdjustmentDraft,
} from "../src/store/strategic-fit-cohort-adjustments.ts";
import type { StrategicFitRequestSnapshot } from "../src/store/strategic-fit.ts";

const cohort = (
  cohortId: string,
  routeIds: readonly string[],
  excludedRouteIds: readonly string[] = [],
): StrategicCohort => ({
  analysis_version: "2.0.0",
  cohort_id: cohortId,
  state: routeIds.length > 1 ? "actionable" : "insufficient-evidence",
  opening_scope_ids: [`opening:${cohortId}`],
  decision_scope_ids: [`decision:${cohortId}`],
  route_ids: routeIds,
  excluded_route_ids: excludedRouteIds,
  route_weights: routeIds.map((routeId) => ({ route_id: routeId, normalized_weight: 1 / routeIds.length })),
  effective_sample_size: routeIds.length,
  modes: routeIds.length === 0 ? [] : [{
    analysis_version: "2.0.0",
    mode_id: `mode:${cohortId}`,
    cohort_id: cohortId,
    representative_route_id: routeIds[0]!,
    supporting_route_ids: routeIds,
    concept_ids: [],
    normalized_weight: 1,
    effective_sample_size: routeIds.length,
    source: "inferred-medoid",
    provenance: [],
  }],
  override_ids: [],
  provenance: [],
});

const finding = (findingId: string, cohortId: string, routeId: string): StrategicFinding => ({
  finding_id: findingId,
  semantic_finding_id: `semantic:${findingId}`,
  repertoire_revision: "browser:1",
  evidence: { cohort_id: cohortId },
  references: {
    position_ids: [`position:${routeId}`],
    decision_ids: [`decision:${routeId}`],
    route_ids: [routeId],
    source_san_paths: [[routeId]],
  },
} as unknown as StrategicFinding);

function report(
  reportId: string,
  cohorts: readonly StrategicCohort[],
  findings: readonly StrategicFinding[],
): StrategicFitAnalysisResult {
  return {
    report_id: reportId,
    repertoire_revision: "browser:1",
    cohorts,
    findings,
    finding_page: {
      offset: 0,
      limit: 50,
      total_count: findings.length,
      returned_count: findings.length,
      has_more: false,
    },
  } as unknown as StrategicFitAnalysisResult;
}

function fixture(initialMetadata?: StrategicFitDocumentMetadata) {
  const auto = report("report:auto", [
    cohort("cohort:a", ["route:a1", "route:a2"]),
    cohort("cohort:b", ["route:b1"]),
  ], [
    finding("finding:a", "cohort:a", "route:a2"),
    finding("finding:b", "cohort:b", "route:b1"),
  ]);
  let currentReport = auto;
  let metadata = initialMetadata ?? createDefaultStrategicFitDocumentMetadata();
  let snapshot: StrategicFitRequestSnapshot = {
    document_id: "document:cohorts",
    repertoire_revision: 1,
    repertoire_pgn: "1. e4 e5 *",
    repertoire_color: "white",
    profile_identity: "profile:balanced",
    settings_identity: "settings:auto",
  };
  const completedSnapshot = snapshot;
  let analysisCount = 0;
  let executeCount = 0;
  const surrounding = {
    pgn: snapshot.repertoire_pgn,
    revision: snapshot.repertoire_revision,
    document: snapshot.document_id,
    navigation: [0, 1],
    color: snapshot.repertoire_color,
    dirty: false,
    file: "cohorts.pgn",
    staged: ["staged:one"],
    legacy: ["legacy:one"],
  };
  const graph = {
    routes: ["route:a1", "route:a2", "route:b1"].map((routeId) => ({
      route_id: routeId,
      position_ids: [`position:${routeId}`],
      decision_ids: [`decision:${routeId}`],
    })),
    decisions: ["decision:route:a1", "decision:route:a2", "decision:route:b1"].map((decisionId) => ({
      decision_id: decisionId,
    })),
  } as unknown as RepertoireGraph;

  const replace = (next: StrategicFitDocumentMetadata) => {
    metadata = normalizeStrategicFitDocumentMetadata(next).metadata;
    return { state: "updated" as const, metadata };
  };
  const boundary: StrategicFitCohortAdjustmentBoundary = {
    currentReport: () => ({
      request_id: "request:auto",
      report_id: currentReport.report_id,
      request_snapshot: completedSnapshot,
      result: currentReport,
      completed_at: "2026-07-21T12:00:00.000Z",
    }),
    currentFindings: (reportId) => ({
      ready: reportId === currentReport.report_id,
      findings: currentReport.findings,
      total_count: currentReport.finding_page.total_count,
    }),
    currentSnapshot: () => snapshot,
    currentMetadata: () => metadata,
    currentGraph: () => graph,
    execute: async (_command, args) => {
      executeCount++;
      const overrides = args.cohort_overrides as readonly { kind: string; route_ids?: readonly string[] }[];
      const selected = overrides.at(-1);
      if (overrides.filter((entry) => entry.route_ids?.includes("route:a1")).length > 1) {
        throw new Error("strategic_fit_cohorts_conflicting_override_route: route:conflict");
      }
      let proposed = auto;
      if (selected?.kind === "merge") {
        proposed = report("report:merge", [cohort("cohort:ab", ["route:a1", "route:a2", "route:b1"])], [
          finding("finding:merged", "cohort:ab", "route:a2"),
        ]);
      } else if (selected?.kind === "split") {
        proposed = report("report:split", [
          cohort("cohort:a1", ["route:a1"]),
          cohort("cohort:a2", ["route:a2"]),
          cohort("cohort:b", ["route:b1"]),
        ], [finding("finding:split", "cohort:a2", "route:a2"), auto.findings[1]!]);
      } else if (selected?.kind === "exclude") {
        proposed = report("report:exclude", [
          cohort("cohort:a", ["route:a1"], ["route:a2"]),
          cohort("cohort:b", ["route:b1"]),
        ], [finding("finding:excluded", "cohort:a", "route:a2"), auto.findings[1]!]);
      }
      const page = args.page as { offset: number; limit: number };
      return {
        ...proposed,
        findings: proposed.findings.slice(page.offset, page.offset + page.limit),
        finding_page: {
          offset: page.offset,
          limit: page.limit,
          total_count: proposed.findings.length,
          returned_count: Math.max(0, Math.min(page.limit, proposed.findings.length - page.offset)),
          has_more: page.offset + page.limit < proposed.findings.length,
        },
      };
    },
    upsertOverride: (input) => replace({
      ...metadata,
      cohort_overrides: input.kind === "exclude" ? metadata.cohort_overrides : [{
        override_id: input.override_id,
        kind: input.kind,
        route_ids: [...(input.route_ids ?? [])],
        record_state: "active",
        stale_reasons: [],
        reason: input.reason ?? null,
        updated_at: "2026-07-21T12:00:00.000Z",
        provenance: [{
          source_id: "test:user",
          kind: "user-profile",
          state: "available",
          version: "1",
          snapshot: null,
          reason: null,
        }],
      }],
      exclusions: input.kind === "exclude" ? [{
        override_id: input.override_id,
        kind: "exclude",
        route_ids: [...(input.route_ids ?? [])],
        decision_ids: [...(input.decision_ids ?? [])],
        record_state: "active",
        stale_reasons: [],
        reason: input.reason ?? null,
        updated_at: "2026-07-21T12:00:00.000Z",
        provenance: [{
          source_id: "test:user",
          kind: "user-profile",
          state: "available",
          version: "1",
          snapshot: null,
          reason: null,
        }],
      }] : metadata.exclusions,
    }),
    removeOverride: (overrideId) => replace({
      ...metadata,
      cohort_overrides: metadata.cohort_overrides.filter((entry) => entry.override_id !== overrideId),
      exclusions: metadata.exclusions.filter((entry) => entry.override_id !== overrideId),
    }),
    upsertLabel: (input) => replace({
      ...metadata,
      cohort_labels: [{
        label_id: input.label_id,
        cohort_id: input.cohort_id,
        display_name: input.display_name,
        record_state: "active",
        stale_reasons: [],
        reason: input.reason ?? null,
        updated_at: "2026-07-21T12:00:00.000Z",
        provenance: [{
          source_id: "test:user",
          kind: "user-profile",
          state: "available",
          version: "1",
          snapshot: null,
          reason: null,
        }],
      }],
    }),
    removeLabel: (labelId) => replace({
      ...metadata,
      cohort_labels: metadata.cohort_labels.filter((entry) => entry.label_id !== labelId),
    }),
    analyze: async () => { analysisCount++; },
  };
  const state = createStrategicFitCohortAdjustmentState(boundary);
  state.synchronize(auto.report_id);
  return {
    state,
    auto,
    metadata: () => metadata,
    analysisCount: () => analysisCount,
    executeCount: () => executeCount,
    surrounding,
    patchSnapshot: (patch: Partial<StrategicFitRequestSnapshot>) => {
      snapshot = { ...snapshot, ...patch };
    },
    setReport: (next: StrategicFitAnalysisResult) => { currentReport = next; },
  };
}

test("merge, split, and subtree exclusion previews expose exact identities before metadata-only confirmation", async () => {
  const scenarios: readonly StrategicFitCohortAdjustmentDraft[] = [
    { kind: "merge", route_ids: ["route:a1", "route:b1"] },
    { kind: "split", route_ids: ["route:a1"] },
    { kind: "exclude", decision_ids: ["decision:route:a2"] },
  ];
  for (const draft of scenarios) {
    const subject = fixture();
    const before = structuredClone(subject.surrounding);
    const preview = await subject.state.preview(subject.auto.report_id, draft);
    assert.ok(preview, draft.kind);
    assert.equal(preview.current_cohorts.state, "available");
    assert.equal(preview.proposed_cohorts.state, "available");
    assert.equal(preview.affected_routes.count! > 0, true);
    assert.equal(preview.current_findings.count! > 0, true);
    assert.equal(preview.proposed_findings.count! > 0, true);
    assert.deepEqual(subject.metadata().cohort_overrides, []);
    assert.deepEqual(subject.metadata().exclusions, []);

    assert.equal(await subject.state.confirm(preview.preview_id), true);
    assert.equal(subject.analysisCount(), 1);
    assert.deepEqual(subject.surrounding, before);
    if (draft.kind === "exclude") assert.equal(subject.metadata().exclusions[0]?.kind, "exclude");
    else assert.equal(subject.metadata().cohort_overrides[0]?.kind, draft.kind);
  }
});

test("rename is display-only, persists canonically, previews unavailable baselines honestly, and resets", async () => {
  const subject = fixture();
  const preview = await subject.state.preview(subject.auto.report_id, {
    kind: "rename",
    cohort_id: "cohort:b",
    display_name: "Quiet anti-Sicilian",
  });
  assert.ok(preview);
  assert.equal(subject.executeCount(), 0);
  assert.equal(preview.current_cohorts.ids[0], "cohort:b");
  assert.equal(preview.affected_routes.ids[0], "route:b1");
  assert.equal(await subject.state.confirm(preview.preview_id), true);
  assert.equal(subject.metadata().cohort_labels[0]?.display_name, "Quiet anti-Sicilian");
  assert.equal(subject.analysisCount(), 1);

  const roundTrip = normalizeStrategicFitDocumentMetadata(
    JSON.parse(JSON.stringify(subject.metadata())),
  );
  assert.equal(roundTrip.state, "valid");
  assert.equal(roundTrip.metadata.cohort_labels[0]?.cohort_id, "cohort:b");

  subject.state.synchronize(subject.auto.report_id);
  const reset = await subject.state.preview(subject.auto.report_id, {
    kind: "reset",
    target: "rename",
    target_id: subject.metadata().cohort_labels[0]!.label_id,
  });
  assert.ok(reset);
  assert.equal(await subject.state.confirm(reset.preview_id), true);
  assert.deepEqual(subject.metadata().cohort_labels, []);
  assert.equal(subject.analysisCount(), 2);
});

test("reset removes a structural override and restores the automatic preview before reanalysis", async () => {
  const source = fixture();
  const added = await source.state.preview(source.auto.report_id, {
    kind: "merge",
    route_ids: ["route:a1", "route:b1"],
  });
  assert.ok(added);
  await source.state.confirm(added.preview_id);
  const subject = fixture(source.metadata());
  subject.setReport(report("report:merge", [
    cohort("cohort:ab", ["route:a1", "route:a2", "route:b1"]),
  ], [finding("finding:merged", "cohort:ab", "route:a2")]));
  subject.state.synchronize("report:merge");
  const overrideId = subject.metadata().cohort_overrides[0]!.override_id;
  const preview = await subject.state.preview("report:merge", {
    kind: "reset",
    target: "override",
    target_id: overrideId,
  });
  assert.ok(preview);
  assert.equal(preview.proposed_cohorts.ids.includes("cohort:a"), true);
  assert.equal(await subject.state.confirm(preview.preview_id), true);
  assert.deepEqual(subject.metadata().cohort_overrides, []);
  assert.equal(subject.analysisCount(), 1);
});

test("empty, duplicate, conflicting, and stale semantic changes fail closed without partial persistence", async () => {
  const invalids: readonly StrategicFitCohortAdjustmentDraft[] = [
    { kind: "merge", route_ids: [] },
    { kind: "split", route_ids: ["route:a1", "route:a1"] },
    { kind: "exclude", decision_ids: ["decision:missing"] },
    { kind: "rename", cohort_id: "cohort:missing", display_name: "Missing" },
  ];
  for (const draft of invalids) {
    const subject = fixture();
    assert.equal(await subject.state.preview(subject.auto.report_id, draft), null);
    assert.equal(subject.state.snapshot().status, "blocked");
    assert.deepEqual(subject.metadata().cohort_overrides, []);
    assert.deepEqual(subject.metadata().exclusions, []);
    assert.deepEqual(subject.metadata().cohort_labels, []);
  }

  const conflictSource = fixture();
  const existing = await conflictSource.state.preview(conflictSource.auto.report_id, {
    kind: "split",
    route_ids: ["route:a1"],
  });
  assert.ok(existing);
  await conflictSource.state.confirm(existing.preview_id);
  const conflict = fixture(conflictSource.metadata());
  assert.equal(await conflict.state.preview(conflict.auto.report_id, {
    kind: "merge",
    route_ids: ["route:a1", "route:b1"],
  }), null);
  assert.equal(conflict.state.snapshot().status, "blocked");

  const stale = fixture();
  const preview = await stale.state.preview(stale.auto.report_id, {
    kind: "split",
    route_ids: ["route:a1"],
  });
  assert.ok(preview);
  stale.patchSnapshot({ profile_identity: "profile:versatile" });
  assert.equal(await stale.state.confirm(preview.preview_id), false);
  assert.equal(stale.state.snapshot().code, "strategic_fit_cohort_adjustment_stale_context");
  assert.deepEqual(stale.metadata().cohort_overrides, []);
  assert.equal(stale.analysisCount(), 0);
});
