import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_FIT_SCHEMA_VERSION,
  buildRepertoireGraph,
  createDefaultStrategicFitDocumentMetadata,
  normalizeStrategicFitDocumentMetadata,
  type StrategicFitDocumentMetadata,
  type StrategicFinding,
  type StrategicFitPersistedResolutionState,
} from "@chess-mcp/chess-tools";
import {
  createStrategicFitResolutionState,
  type StrategicFitResolutionStateBoundary,
} from "../src/store/strategic-fit-resolutions.ts";

const PGN = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 (3... Nf6) *";
const EDITED_PGN = "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 *";

function fixture() {
  let metadata = createDefaultStrategicFitDocumentMetadata();
  let tree = GameTree.fromPgn(PGN);
  let revision = "browser:1";
  let invalidations = 0;
  let clock = 0;
  const boundary: StrategicFitResolutionStateBoundary = {
    currentMetadata: () => metadata,
    currentGraph: () => buildRepertoireGraph(tree, "white"),
    currentProfile: () => metadata.profile,
    currentRepertoireRevision: () => revision,
    replaceMetadata: (input) => {
      const result = normalizeStrategicFitDocumentMetadata(input);
      metadata = result.metadata;
      return result;
    },
    invalidateReports: () => { invalidations++; },
    now: () => `2026-07-17T12:00:${String(clock++).padStart(2, "0")}.000Z`,
  };
  return {
    state: createStrategicFitResolutionState(boundary),
    metadata: () => metadata,
    invalidations: () => invalidations,
    edit: () => {
      tree = GameTree.fromPgn(EDITED_PGN);
      revision = "browser:2";
    },
    graph: () => boundary.currentGraph(),
  };
}

function resolutionInput(f: ReturnType<typeof fixture>, state: StrategicFitPersistedResolutionState, id = state) {
  const route = f.graph().routes[0]!;
  return {
    resolution_id: `resolution:${id}`,
    finding_id: `finding:${id}`,
    semantic_finding_id: `semantic-finding:${id}`,
    state,
    intentional_reason: state === "keep-intentionally" ? "already-understood" as const : null,
    note: `Decision ${id}`,
    reason: `Reason ${id}`,
    references: {
      position_ids: [...route.position_ids],
      decision_ids: [...route.decision_ids],
      route_ids: [route.route_id],
      source_san_paths: route.source_san_paths,
    },
  };
}

test("every persisted resolution kind adds, updates, removes, and reopens through semantic records", () => {
  const f = fixture();
  const states: StrategicFitPersistedResolutionState[] = [
    "change-repertoire",
    "keep-intentionally",
    "train-as-exception",
    "reclassify-cohort",
    "exclude-from-analysis",
    "defer",
    "insufficient-evidence",
    "automatically-resolved-by-another-edit",
    "invalid-comparison",
  ];
  for (const state of states) assert.equal(f.state.upsertResolution(resolutionInput(f, state)).state, "updated");
  assert.deepEqual(f.metadata().resolutions.map((entry) => entry.state).sort(), [...states].sort());
  assert.ok(f.metadata().resolutions.every((entry) =>
    entry.record_state === "active" && entry.provenance.length > 0 && entry.reason !== null
  ));

  const beforeNoop = f.invalidations();
  assert.equal(f.state.upsertResolution(resolutionInput(f, "defer")).state, "unchanged");
  assert.equal(f.invalidations(), beforeNoop);
  assert.equal(f.state.upsertResolution({ ...resolutionInput(f, "defer"), note: "Updated" }).state, "updated");
  assert.equal(f.state.removeResolution("resolution:defer").state, "removed");
  assert.equal(f.state.removeResolution("resolution:missing").state, "missing");
  assert.equal(f.state.reopenResolution("resolution:keep-intentionally").state, "removed");
});

test("a semantic finding has one replaceable resolution and reopen cannot expose an older decision", () => {
  const f = fixture();
  const first = {
    ...resolutionInput(f, "defer", "a"),
    semantic_finding_id: "semantic-finding:shared",
  };
  const replacement = {
    ...resolutionInput(f, "train-as-exception", "b"),
    semantic_finding_id: "semantic-finding:shared",
  };

  assert.equal(f.state.upsertResolution(first).state, "updated");
  assert.equal(f.state.upsertResolution(replacement).state, "updated");
  assert.deepEqual(
    f.metadata().resolutions.map(({ resolution_id, state }) => ({ resolution_id, state })),
    [{ resolution_id: "resolution:b", state: "train-as-exception" }],
  );
  assert.equal(f.state.removeResolution("resolution:a").state, "missing");
  assert.equal(f.state.analysisSettings().inputs.route_assessments?.[0]?.resolution_state, "train-as-exception");

  assert.equal(f.state.upsertResolution({ ...replacement, note: "Updated replacement" }).state, "updated");
  assert.equal(f.metadata().resolutions.length, 1);
  assert.equal(f.metadata().resolutions[0]?.note, "Updated replacement");
  assert.equal(f.state.reopenResolution("resolution:b").state, "removed");
  assert.deepEqual(f.metadata().resolutions, []);
  assert.equal(f.state.analysisSettings().inputs.route_assessments, undefined);
});

test("merge, split, exclusion, manual weights, provenance, reasons, and removals round-trip", () => {
  const f = fixture();
  const graph = f.graph();
  const routeIds = graph.routes.map((route) => route.route_id);
  const decisionId = graph.decisions[0]!.decision_id;
  const before = f.invalidations();

  assert.equal(f.state.upsertCohortOverride({
    override_id: "override:merge",
    kind: "merge",
    route_ids: routeIds,
    reason: "Same practical system",
  }).state, "updated");
  assert.equal(f.state.upsertCohortOverride({
    override_id: "override:split",
    kind: "split",
    route_ids: [routeIds[0]!],
  }).state, "updated");
  assert.equal(f.state.upsertCohortOverride({
    override_id: "override:exclude",
    kind: "exclude",
    decision_ids: [decisionId],
    reason: "Invalid comparison",
  }).state, "updated");
  assert.equal(f.state.upsertRouteWeight({ target_id: routeIds[0]!, weight: 4, reason: "Frequent" }).state, "updated");
  assert.equal(f.state.upsertDecisionWeight({ target_id: decisionId, weight: 2 }).state, "updated");
  assert.equal(f.invalidations(), before + 5);
  assert.equal(f.state.upsertCohortOverride({
    override_id: "override:merge",
    kind: "merge",
    route_ids: routeIds,
    reason: "Same practical system",
  }).state, "unchanged");
  assert.equal(f.state.upsertRouteWeight({
    target_id: routeIds[0]!,
    weight: 4,
    reason: "Frequent",
  }).state, "unchanged");
  assert.equal(f.state.upsertDecisionWeight({ target_id: decisionId, weight: 2 }).state, "unchanged");
  assert.equal(f.invalidations(), before + 5, "semantic no-ops do not invalidate reports");

  const metadata = f.metadata();
  assert.deepEqual(metadata.cohort_overrides.map((entry) => entry.kind), ["merge", "split"]);
  assert.equal(metadata.exclusions[0]!.reason, "Invalid comparison");
  assert.equal(metadata.manual_weights.route_weights[0]!.reason, "Frequent");
  assert.ok([
    ...metadata.cohort_overrides,
    ...metadata.exclusions,
    ...metadata.manual_weights.route_weights,
    ...metadata.manual_weights.decision_weights,
  ].every((entry) => entry.provenance[0]?.source_id === "strategic-fit:browser-user-metadata"));

  assert.equal(f.state.removeCohortOverride("override:merge").state, "removed");
  assert.equal(f.state.removeRouteWeight(routeIds[0]!).state, "removed");
  assert.equal(f.state.removeDecisionWeight(decisionId).state, "removed");
});

test("user-facing cohort labels persist without changing analyzer inputs and reset independently", () => {
  const f = fixture();
  const beforeInputs = f.state.analysisSettings().inputs;

  assert.equal(f.state.upsertCohortLabel({
    label_id: "cohort-label:semantic",
    cohort_id: "cohort:semantic",
    display_name: "  Quiet anti-Sicilian  ",
    reason: "Useful repertoire label",
  }).state, "updated");
  assert.deepEqual(f.metadata().cohort_labels.map((entry) => ({
    label_id: entry.label_id,
    cohort_id: entry.cohort_id,
    display_name: entry.display_name,
    reason: entry.reason,
  })), [{
    label_id: "cohort-label:semantic",
    cohort_id: "cohort:semantic",
    display_name: "Quiet anti-Sicilian",
    reason: "Useful repertoire label",
  }]);
  assert.deepEqual(f.state.analysisSettings().inputs, beforeInputs);
  assert.equal(f.state.upsertCohortLabel({
    label_id: "cohort-label:semantic",
    cohort_id: "cohort:semantic",
    display_name: "Quiet anti-Sicilian",
    reason: "Useful repertoire label",
  }).state, "unchanged");
  assert.equal(f.state.upsertCohortLabel({
    label_id: "cohort-label:replacement",
    cohort_id: "cohort:semantic",
    display_name: "Rossolimo structures",
  }).state, "updated");
  assert.deepEqual(f.metadata().cohort_labels.map((entry) => entry.label_id), [
    "cohort-label:replacement",
  ]);
  assert.equal(f.state.removeCohortLabel("cohort-label:semantic").state, "missing");
  assert.equal(f.state.removeCohortLabel("cohort-label:replacement").state, "removed");
  assert.deepEqual(f.metadata().cohort_labels, []);
});

test("reconciliation stales changed semantic references, invalidates cache, and never mutates a repertoire", () => {
  const f = fixture();
  const originalPgn = PGN;
  f.state.upsertResolution(resolutionInput(f, "train-as-exception"));
  const invalidations = f.invalidations();
  f.edit();

  assert.equal(typeof f.state.analysisSettingsIdentity(), "string");
  assert.equal(
    f.metadata().resolutions[0]!.record_state,
    "active",
    "read-only lifecycle identity checks must not consume explicit reconciliation",
  );
  assert.equal(f.invalidations(), invalidations);
  assert.equal(f.state.reconcile().state, "updated");
  assert.equal(f.metadata().resolutions[0]!.record_state, "stale");
  assert.ok(f.metadata().resolutions[0]!.stale_reasons.includes("referenced-decision-missing"));
  assert.equal(f.invalidations(), invalidations + 1);
  assert.equal(GameTree.fromPgn(originalPgn).toPgn(), GameTree.fromPgn(PGN).toPgn());
  assert.equal(f.state.reconcile().state, "unchanged");
});

test("active settings project into analyzer inputs while stale records stay durable but inactive", () => {
  const f = fixture();
  const route = f.graph().routes[0]!;
  f.state.upsertResolution(resolutionInput(f, "invalid-comparison"));
  f.state.upsertRouteWeight({ target_id: route.route_id, weight: 5 });
  f.state.upsertCohortOverride({
    override_id: "override:exclude",
    kind: "exclude",
    route_ids: [route.route_id],
  });
  const first = f.state.analysisSettings();
  assert.equal(first.inputs.weighting?.mode, "manual");
  assert.equal(first.inputs.cohort_overrides?.[0]?.kind, "exclude");
  assert.equal(first.inputs.route_assessments?.[0]?.resolution_state, "insufficient-evidence");

  f.edit();
  const second = f.state.analysisSettings();
  assert.notEqual(second.identity, first.identity);
  assert.equal(second.inputs.weighting, undefined);
  assert.equal(second.inputs.cohort_overrides, undefined);
  assert.equal(second.inputs.route_assessments, undefined);
  assert.equal(f.metadata().resolutions[0]!.record_state, "stale");
});

test("report reconciliation records exact automatic resolutions and removes them on reappearance", () => {
  const f = fixture();
  const route = f.graph().routes[0]!;
  const disappeared = {
    finding_id: "finding:gone",
    semantic_finding_id: "semantic-finding:gone",
    references: {
      position_ids: [...route.position_ids],
      decision_ids: [...route.decision_ids],
      route_ids: [route.route_id],
      source_san_paths: route.source_san_paths,
    },
  } as unknown as StrategicFinding;

  assert.equal(f.state.reconcileReportFindings({
    automatically_resolve: [disappeared],
    reopen_semantic_finding_ids: [],
  }).state, "updated");
  assert.equal(f.metadata().resolutions[0]!.state, "automatically-resolved-by-another-edit");
  assert.equal(f.metadata().resolutions[0]!.repertoire_revision, "browser:1");
  assert.deepEqual(f.state.analysisSettings().inputs.route_assessments, undefined);

  assert.equal(f.state.reconcileReportFindings({
    automatically_resolve: [],
    reopen_semantic_finding_ids: ["semantic-finding:gone"],
  }).state, "updated");
  assert.deepEqual(f.metadata().resolutions, []);
});

test("normalized records remain JSON-safe with explicit schema provenance", () => {
  const f = fixture();
  f.state.upsertResolution({
    ...resolutionInput(f, "keep-intentionally"),
    invalidation_rules: ["profile-changed"],
  });
  const record = f.metadata().resolutions[0]!;
  assert.equal(record.schema_version, STRATEGIC_FIT_SCHEMA_VERSION);
  assert.ok(record.profile_snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
});
