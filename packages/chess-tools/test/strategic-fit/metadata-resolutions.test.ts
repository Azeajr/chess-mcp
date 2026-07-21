import assert from "node:assert/strict";
import test from "node:test";

import {
  STRATEGIC_FIT_SCHEMA_VERSION,
  analyzeStrategicFit,
  buildRepertoireGraph,
  createDefaultStrategicFitDocumentMetadata,
  normalizeStrategicFitDocumentMetadata,
  reconcileStrategicFitDocumentMetadata,
  strategicFitAnalysisInputsFromMetadata,
  strategicFitProfileSnapshot,
  type RepertoireGraph,
  type SemanticReferences,
  type StrategicFitDocumentMetadata,
  type StrategicFitPersistedResolution,
} from "../../src/index.ts";
import {
  BROAD_ECO_FIXTURE,
  WHITE_TRANSPOSITION_FIXTURE,
  parseStrategicFitFixture,
} from "./fixtures.ts";

const NOW = "2026-07-17T12:00:00.000Z";
const provenance = [{
  source_id: "test:user",
  kind: "user-profile" as const,
  state: "available" as const,
  version: STRATEGIC_FIT_SCHEMA_VERSION,
  snapshot: "revision:test",
  reason: "Test user decision.",
}];

function lifecycle(reason: string | null = null) {
  return {
    record_state: "active" as const,
    stale_reasons: [],
    reason,
    updated_at: NOW,
    provenance,
  };
}

function references(graph: RepertoireGraph, routeIndex = 0): SemanticReferences {
  const route = graph.routes[routeIndex]!;
  return {
    position_ids: [...route.position_ids],
    decision_ids: [...route.decision_ids],
    route_ids: [route.route_id],
    source_san_paths: route.source_san_paths.map((path) => [...path]),
  };
}

function resolution(
  graph: RepertoireGraph,
  overrides: Partial<StrategicFitPersistedResolution> = {},
): StrategicFitPersistedResolution {
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    resolution_id: "resolution:test",
    finding_id: "finding:test",
    semantic_finding_id: "semantic-finding:test",
    repertoire_revision: "revision:test",
    state: "keep-intentionally",
    intentional_reason: "strategically-desirable",
    note: null,
    references: references(graph),
    invalidation_rules: [
      "referenced-position-changed",
      "referenced-decision-changed",
      "referenced-route-changed",
    ],
    expires_at: null,
    linked_training_ids: [],
    linked_staged_edit_ids: [],
    created_at: NOW,
    profile_snapshot: null,
    ...lifecycle(),
    ...overrides,
  };
}

function withResolution(
  graph: RepertoireGraph,
  overrides: Partial<StrategicFitPersistedResolution> = {},
): StrategicFitDocumentMetadata {
  return {
    ...createDefaultStrategicFitDocumentMetadata(),
    resolutions: [resolution(graph, overrides)],
  };
}

test("semantic resolution identity survives SAN sibling reordering", () => {
  const tree = parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE);
  const graph = buildRepertoireGraph(tree, "white");
  tree.game.moves.children.reverse();
  const reordered = buildRepertoireGraph(tree, "white");
  const metadata = withResolution(graph);

  const result = reconcileStrategicFitDocumentMetadata(metadata, {
    graph: reordered,
    profile: metadata.profile,
    repertoire_revision: "revision:reordered",
    now: NOW,
  });

  assert.equal(result.changed, false);
  assert.equal(result.metadata.resolutions[0]!.record_state, "active");
  assert.deepEqual(
    graph.routes.map((route) => route.route_id),
    reordered.routes.map((route) => route.route_id),
  );
});

test("changing a referenced move makes only dependent records stale and staleness is monotonic", () => {
  const graph = buildRepertoireGraph(parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE), "white");
  const editedTree = parseStrategicFitFixture(BROAD_ECO_FIXTURE);
  const edited = buildRepertoireGraph(editedTree, BROAD_ECO_FIXTURE.repertoireColor);
  const selected = references(graph);
  const metadata: StrategicFitDocumentMetadata = {
    ...withResolution(graph),
    manual_weights: {
      route_weights: [{ route_id: selected.route_ids[0]!, weight: 2, ...lifecycle("Rare branch") }],
      decision_weights: [{ decision_id: selected.decision_ids.at(-1)!, weight: 3, ...lifecycle() }],
    },
    cohort_overrides: [{
      override_id: "override:split",
      kind: "split",
      route_ids: selected.route_ids,
      ...lifecycle("Separate this system"),
    }],
    exclusions: [{
      override_id: "override:exclude",
      kind: "exclude",
      decision_ids: [selected.decision_ids.at(-1)!],
      route_ids: [],
      ...lifecycle("Invalid comparison"),
    }],
  };

  const stale = reconcileStrategicFitDocumentMetadata(metadata, {
    graph: edited,
    profile: metadata.profile,
    repertoire_revision: "revision:edited",
    now: NOW,
  });
  assert.equal(stale.changed, true);
  assert.deepEqual(stale.metadata.resolutions[0]!.stale_reasons, [
    "referenced-decision-missing",
    "referenced-position-missing",
    "referenced-route-missing",
  ]);
  assert.equal(stale.metadata.manual_weights.route_weights[0]!.record_state, "stale");
  assert.equal(stale.metadata.manual_weights.decision_weights[0]!.record_state, "stale");
  assert.equal(stale.metadata.cohort_overrides[0]!.record_state, "stale");
  assert.equal(stale.metadata.exclusions[0]!.record_state, "stale");

  const restored = reconcileStrategicFitDocumentMetadata(stale.metadata, {
    graph,
    profile: metadata.profile,
    repertoire_revision: "revision:test",
    now: NOW,
  });
  assert.equal(restored.changed, false, "restoring a move must not silently reactivate intent");
  assert.equal(restored.metadata.resolutions[0]!.record_state, "stale");
});

test("transposition position references resolve to every current navigation route", () => {
  const graph = buildRepertoireGraph(parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE), "white");
  const transposition = graph.transposition_links.at(-1)!;
  const metadata = withResolution(graph, {
    references: {
      position_ids: [transposition.position_id],
      decision_ids: [],
      route_ids: [],
      source_san_paths: transposition.source_san_paths,
    },
    invalidation_rules: ["referenced-position-changed"],
  });
  const inputs = strategicFitAnalysisInputsFromMetadata(metadata, graph);

  assert.deepEqual(
    inputs.route_assessments?.map((entry) => entry.route_id),
    transposition.route_ids,
  );
  assert.ok(inputs.route_assessments?.every((entry) =>
    entry.resolution_state === "keep-intentionally" && entry.matches_declared_objective
  ));
});

test("every persisted terminal decision projects to a terminal analyzer assessment", () => {
  const graph = buildRepertoireGraph(parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE), "white");
  const states = [
    "change-repertoire",
    "keep-intentionally",
    "train-as-exception",
    "reclassify-cohort",
    "exclude-from-analysis",
    "defer",
    "insufficient-evidence",
    "automatically-resolved-by-another-edit",
    "invalid-comparison",
  ] as const;
  for (const state of states) {
    const metadata = withResolution(graph, {
      state,
      intentional_reason: state === "keep-intentionally" ? "already-understood" : null,
    });
    const assessment = strategicFitAnalysisInputsFromMetadata(metadata, graph).route_assessments?.[0];
    assert.equal(
      assessment?.resolution_state,
      state === "invalid-comparison" ? "insufficient-evidence" : state,
    );
    assert.equal(assessment?.matches_declared_objective, state === "keep-intentionally");
  }
});

test("active persisted decisions remain in reports but leave the unresolved queue", () => {
  const tree = parseStrategicFitFixture(BROAD_ECO_FIXTURE);
  const options = {
    repertoireColor: BROAD_ECO_FIXTURE.repertoireColor,
    repertoireRevision: "revision:queue",
  };
  const first = analyzeStrategicFit(tree, options);
  const finding = first.findings[0]!;
  const graph = buildRepertoireGraph(tree, BROAD_ECO_FIXTURE.repertoireColor);
  const metadata = withResolution(graph, {
    resolution_id: "resolution:queue",
    finding_id: finding.finding_id,
    semantic_finding_id: finding.semantic_finding_id,
    repertoire_revision: options.repertoireRevision,
    state: "defer",
    intentional_reason: null,
    references: finding.references,
  });
  const inputs = strategicFitAnalysisInputsFromMetadata(metadata, graph);
  const second = analyzeStrategicFit(tree, {
    ...options,
    routeAssessments: inputs.route_assessments,
  });
  const retained = second.findings.find((entry) => entry.finding_id === finding.finding_id)!;

  assert.ok(retained, "resolved finding remains available to map/report projections");
  assert.equal(retained.resolution_state, "defer");
  assert.ok(second.summary.unresolved_finding_count < first.summary.unresolved_finding_count);
});

test("a persisted resolution targets one semantic finding when sibling findings share every route", () => {
  const tree = parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE);
  const graph = buildRepertoireGraph(tree, "white");
  const first = analyzeStrategicFit(tree, {
    repertoireColor: "white",
    repertoireRevision: "revision:shared-routes",
  });
  const target = first.findings.find((finding) =>
    finding.classification === "transpositional-equivalence"
  );
  const sibling = first.findings.find((finding) => finding.classification === "uncertain");
  assert.ok(target);
  assert.ok(sibling);
  assert.deepEqual(target.references.route_ids, sibling.references.route_ids);
  assert.deepEqual(target.references.position_ids, sibling.references.position_ids);
  assert.deepEqual(target.references.decision_ids, sibling.references.decision_ids);
  assert.notEqual(target.semantic_finding_id, sibling.semantic_finding_id);

  const metadata = withResolution(graph, {
    resolution_id: "resolution:shared-routes",
    finding_id: target.finding_id,
    semantic_finding_id: target.semantic_finding_id,
    repertoire_revision: target.repertoire_revision,
    state: "defer",
    intentional_reason: null,
    references: target.references,
  });
  const inputs = strategicFitAnalysisInputsFromMetadata(metadata, graph);
  const second = analyzeStrategicFit(tree, {
    repertoireColor: "white",
    repertoireRevision: "revision:shared-routes",
    routeAssessments: inputs.route_assessments,
  });

  assert.equal(
    second.findings.find((finding) => finding.semantic_finding_id === target.semantic_finding_id)?.resolution_state,
    "defer",
  );
  assert.equal(
    second.findings.find((finding) => finding.semantic_finding_id === sibling.semantic_finding_id)?.resolution_state,
    "unresolved",
  );
  assert.equal(first.summary.unresolved_finding_count, 2);
  assert.equal(second.summary.unresolved_finding_count, 1);

  const siblingResolution = resolution(graph, {
    resolution_id: "resolution:shared-routes-sibling",
    finding_id: sibling.finding_id,
    semantic_finding_id: sibling.semantic_finding_id,
    repertoire_revision: sibling.repertoire_revision,
    state: "train-as-exception",
    intentional_reason: null,
    references: sibling.references,
  });
  const bothInputs = strategicFitAnalysisInputsFromMetadata({
    ...metadata,
    resolutions: [...metadata.resolutions, siblingResolution],
  }, graph);
  assert.equal(
    bothInputs.route_assessments?.length,
    target.references.route_ids.length + sibling.references.route_ids.length,
  );
  const both = analyzeStrategicFit(tree, {
    repertoireColor: "white",
    repertoireRevision: "revision:shared-routes",
    routeAssessments: bothInputs.route_assessments,
  });
  assert.equal(
    both.findings.find((finding) => finding.semantic_finding_id === target.semantic_finding_id)?.resolution_state,
    "defer",
  );
  assert.equal(
    both.findings.find((finding) => finding.semantic_finding_id === sibling.semantic_finding_id)?.resolution_state,
    "train-as-exception",
  );

  tree.game.moves.children.reverse();
  const reorderedGraph = buildRepertoireGraph(tree, "white");
  const reordered = analyzeStrategicFit(tree, {
    repertoireColor: "white",
    repertoireRevision: "revision:reordered",
    routeAssessments: strategicFitAnalysisInputsFromMetadata(metadata, reorderedGraph).route_assessments,
  });
  const reorderedTarget = reordered.findings.find((finding) =>
    finding.semantic_finding_id === target.semantic_finding_id
  );
  const reorderedSibling = reordered.findings.find((finding) =>
    finding.semantic_finding_id === sibling.semantic_finding_id
  );
  assert.ok(reorderedTarget);
  assert.ok(reorderedSibling);
  assert.notEqual(reorderedTarget.finding_id, target.finding_id);
  assert.notEqual(reorderedSibling.finding_id, sibling.finding_id);
  assert.equal(reorderedTarget.resolution_state, "defer");
  assert.equal(reorderedSibling.resolution_state, "unresolved");
});

test("normalization deterministically replaces duplicate active resolutions for one semantic finding", () => {
  const graph = buildRepertoireGraph(parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE), "white");
  const original = resolution(graph, {
    resolution_id: "resolution:a",
    semantic_finding_id: "semantic-finding:shared",
    state: "defer",
  });
  const replacement = resolution(graph, {
    resolution_id: "resolution:b",
    semantic_finding_id: "semantic-finding:shared",
    state: "train-as-exception",
    intentional_reason: null,
    updated_at: "2026-07-17T12:01:00.000Z",
  });
  const input = {
    ...createDefaultStrategicFitDocumentMetadata(),
    resolutions: [replacement, original],
  };
  const first = normalizeStrategicFitDocumentMetadata(input);
  const reordered = normalizeStrategicFitDocumentMetadata({
    ...input,
    resolutions: [original, replacement],
  });

  assert.equal(first.state, "valid");
  assert.deepEqual(first.metadata, reordered.metadata);
  assert.deepEqual(first.metadata.resolutions.map((record) => record.resolution_id), ["resolution:b"]);
  assert.equal(first.issues.some((entry) => entry.code === "duplicate-id"), true);
  assert.deepEqual(
    strategicFitAnalysisInputsFromMetadata(first.metadata, graph).route_assessments?.map((assessment) =>
      assessment.resolution_state
    ),
    ["train-as-exception"],
  );
});

test("profile/revision/expiry rules use stored snapshots and exact timestamps", () => {
  const graph = buildRepertoireGraph(parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE), "white");
  const defaults = createDefaultStrategicFitDocumentMetadata();
  const metadata = withResolution(graph, {
    invalidation_rules: ["profile-changed", "repertoire-revision-changed"],
    profile_snapshot: strategicFitProfileSnapshot(defaults.profile),
    expires_at: "2026-07-18T00:00:00.000Z",
  });
  const current = reconcileStrategicFitDocumentMetadata(metadata, {
    graph,
    profile: defaults.profile,
    repertoire_revision: "revision:test",
    now: NOW,
  });
  assert.equal(current.changed, false);

  const changedProfile = { ...defaults.profile, mode: "versatile" as const };
  const stale = reconcileStrategicFitDocumentMetadata(metadata, {
    graph,
    profile: changedProfile,
    repertoire_revision: "revision:next",
    now: "2026-07-18T00:00:00.000Z",
  });
  assert.deepEqual(stale.metadata.resolutions[0]!.stale_reasons, [
    "expired",
    "profile-changed",
    "repertoire-revision-changed",
  ]);
});

test("legacy records without semantic finding identity migrate deterministically but remain inactive", () => {
  const graph = buildRepertoireGraph(parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE), "white");
  const current = withResolution(graph);
  const oldResolution = { ...current.resolutions[0] } as Record<string, unknown>;
  for (const field of [
    "semantic_finding_id",
    "profile_snapshot",
    "record_state",
    "stale_reasons",
    "reason",
    "updated_at",
  ]) {
    delete oldResolution[field];
  }
  for (const metadataVersion of ["1.0.0", "1.1.0", "1.2.0"]) {
    const old = {
      ...current,
      metadata_version: metadataVersion,
      resolutions: [oldResolution],
    };
    const first = normalizeStrategicFitDocumentMetadata(old);
    const second = normalizeStrategicFitDocumentMetadata(structuredClone(old));

    assert.equal(first.state, "migrated");
    assert.deepEqual(first, second);
    assert.equal(first.metadata.resolutions[0]!.semantic_finding_id, null);
    assert.equal(first.metadata.resolutions[0]!.record_state, "stale");
    assert.deepEqual(first.metadata.resolutions[0]!.stale_reasons, ["finding-identity-missing"]);
    assert.equal(first.metadata.resolutions[0]!.updated_at, NOW);
    assert.equal(strategicFitAnalysisInputsFromMetadata(first.metadata, graph).route_assessments, undefined);
  }
});
