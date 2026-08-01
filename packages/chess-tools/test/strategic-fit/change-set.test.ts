import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";

import {
  GameTree,
  REPLACEMENT_CHANGE_SET_ERROR_CODES,
  REPLACEMENT_CHANGE_SET_RESULT_STATUSES,
  REPLACEMENT_CHANGE_OPERATION_KINDS,
  REPLACEMENT_OPERATION_RESULT_STATUSES,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  TASK_8_8_CHANGE_OPERATION_KINDS,
  applyReplacementChangeSet,
  buildRepertoireGraph,
  constructAndApplyReplacementChangeSet,
  constructReplacementChangeSet,
  simulateReplacementSafety,
  type ReplacementChangeOperation,
  type ReplacementChangeSet,
  type ReplacementChangeSetErrorCode,
  type ReplacementChangeSetResult,
  type ReplacementOperationResultStatus,
  type Task88ChangeOperationKind,
} from "../../src/index.ts";
import {
  addOnlyFixture,
  replacementFixture,
  scoredFixture,
} from "./replacement-change-set.fixtures.ts";
import {
  PGN,
  completeCandidate,
  completeFixture,
  contextFixture,
} from "./replacement-score.fixtures.ts";

function constructed(
  values: ReturnType<typeof addOnlyFixture> | ReturnType<typeof replacementFixture>,
  promote = false,
): ReplacementChangeSet {
  const result = constructReplacementChangeSet({
    source_tree: values.tree,
    current_repertoire_revision: values.request.repertoire_revision,
    safety: values.safety,
    candidate_id: values.candidate.candidate_id,
    promote_candidate_to_mainline: promote,
  });
  assert.equal(result.status, "constructed", `${result.error_code}:${result.explanation}`);
  assert.ok(result.change_set);
  return result.change_set;
}

function apply(
  values: ReturnType<typeof addOnlyFixture> | ReturnType<typeof replacementFixture>,
  changeSet = constructed(values),
) {
  return applyReplacementChangeSet({
    source_tree: values.tree,
    current_repertoire_revision: values.request.repertoire_revision,
    safety: values.safety,
    change_set: changeSet,
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function subtreePaths(tree: GameTree, rootPath: readonly string[]): string[][] {
  const rootIndex = tree.indexPathOfSan(rootPath);
  assert.notEqual(rootIndex, null);
  const paths: string[][] = [];
  const pending = [{ indexPath: rootIndex!, sanPath: [...rootPath] }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    paths.push(current.sanPath);
    const node = tree.nodeAt(current.indexPath);
    node.children.forEach((child, index) =>
      pending.push({
        indexPath: [...current.indexPath, index],
        sanPath: [...current.sanPath, child.data.san],
      }),
    );
  }
  return paths.sort((left, right) => left.join("\u001f").localeCompare(right.join("\u001f")));
}

test("safe add-only change set applies to one clone with exact preview and no revision allocation", () => {
  const values = addOnlyFixture();
  const sourcePgn = values.tree.toPgn();
  const result = constructAndApplyReplacementChangeSet({
    source_tree: values.tree,
    current_repertoire_revision: values.request.repertoire_revision,
    safety: values.safety,
    candidate_id: values.candidate.candidate_id,
  });
  assert.equal(result.status, "success");
  assert.ok(result.tree);
  assert.equal(result.output.status, "previewed");
  assert.equal(result.output.result.repertoire_revision, null);
  assert.equal(result.output.result.pgn, result.tree.toPgn());
  assert.equal(values.tree.toPgn(), sourcePgn);
  const before = buildRepertoireGraph(values.tree, values.request.repertoire_color);
  const after = buildRepertoireGraph(result.tree, values.request.repertoire_color);
  assert.deepEqual(result.output.result.preview.before, {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    position_count: before.positions.length,
    decision_count: before.decisions.length,
    route_count: before.routes.length,
    source_route_count: before.source_route_count,
    transposition_count: before.transposition_links.length,
  });
  assert.deepEqual(result.output.result.preview.after, {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    position_count: after.positions.length,
    decision_count: after.decisions.length,
    route_count: after.routes.length,
    source_route_count: after.source_route_count,
    transposition_count: after.transposition_links.length,
  });
  assert.equal(result.output.result.preview.objective_quality_before.state, "unavailable");
  assert.equal(result.output.result.preview.strategic_score_before.state, "unavailable");
  assert.equal(result.output.result.preview.finding_changes_state, "not-reanalyzed");
  assert.deepEqual(result.output.result.preview.changed_finding_ids, []);
});

test("safe replacement archives before pruning and returns exact archive evidence", () => {
  const values = replacementFixture("old branch only");
  const changeSet = constructed(values, true);
  const archive = changeSet.operations.find((operation) => operation.kind === "archive-subtree")!;
  const prune = changeSet.operations.find((operation) => operation.kind === "prune-subtree")!;
  assert.ok(archive.sequence < prune.sequence);
  if (prune.kind !== "prune-subtree" || archive.kind !== "archive-subtree") return;
  assert.equal(prune.archive_operation_id, archive.operation_id);
  assert.match(archive.archive_pgn, /old branch only/);
  const result = apply(values, changeSet);
  assert.equal(result.status, "success");
  assert.ok(result.tree);
  assert.equal(result.tree.indexPathOfSan(["e4", "e5", "Nf3", "Nc6", "Bb5"]), null);
  assert.equal(result.output.result.preview.archive_payloads.length, 1);
  assert.equal(result.output.result.preview.archive_payloads[0]!.pgn, archive.archive_pgn);
  assert.match(result.output.result.preview.archive_payloads[0]!.pgn, /old branch only/);
  assert.deepEqual(result.output.result.preview.archive_ids, [archive.archive_id]);
  const pruneDiff = result.output.result.preview.operation_diffs.find(
    (diff) => diff.operation_id === prune.operation_id,
  )!;
  assert.deepEqual(
    pruneDiff.removed_paths,
    subtreePaths(values.tree, prune.target.source_san_path),
  );
});

test("all six Task 8.8 operation kinds execute, including annotation, link, and reorder", () => {
  const base = completeFixture();
  const annotated = {
    ...base.candidates[0]!,
    subtree: {
      ...base.candidates[0]!.subtree,
      edges: base.candidates[0]!.subtree.edges.map((edge, index) =>
        index === 0 ? { ...edge, annotation_text: ["Candidate annotation"] } : edge,
      ),
    },
  };
  const scoring = scoredFixture(base.fixture, [annotated]);
  const tree = GameTree.fromPgn(PGN);
  const safety = simulateReplacementSafety({
    source_tree: tree,
    request: base.fixture.request,
    scoring,
  });
  const values = { tree, request: base.fixture.request, scoring, safety, candidate: annotated };
  const addChangeSet = constructed(values, true);
  const kinds = new Set(addChangeSet.operations.map((operation) => operation.kind));
  assert.ok(kinds.has("add-subtree"));
  assert.ok(kinds.has("link-transposition"));
  assert.ok(kinds.has("preserve-annotation"));
  assert.ok(kinds.has("reorder-variations"));
  const addResult = apply(values, addChangeSet);
  assert.equal(addResult.status, "success");
  assert.match(addResult.output.result.pgn, /Candidate annotation/);

  const replacement = replacementFixture();
  const replacementKinds = new Set(
    constructed(replacement).operations.map((operation) => operation.kind),
  );
  assert.ok(replacementKinds.has("archive-subtree"));
  assert.ok(replacementKinds.has("prune-subtree"));
  assert.deepEqual(
    new Set([...kinds, ...replacementKinds]),
    new Set(TASK_8_8_CHANGE_OPERATION_KINDS),
  );
});

test("middle-operation failure rolls back and exposes no result tree or partial operation result", () => {
  const values = addOnlyFixture();
  const valid = constructed(values);
  const operations = clone(valid.operations) as ReplacementChangeOperation[];
  operations.splice(1, 0, {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    operation_id: "operation:test:bad-link",
    sequence: 1,
    kind: "link-transposition",
    source: {
      position_id: "position:wrong",
      decision_id: null,
      source_san_path: ["e4"],
    },
    target_position_id: "position:wrong",
    provenance: valid.provenance,
  });
  const changed = {
    ...valid,
    operations: operations.map((operation, sequence) => ({ ...operation, sequence })),
  };
  const sourcePgn = values.tree.toPgn();
  const result = apply(values, changed);
  assert.equal(result.status, "failure");
  assert.equal(result.tree, null);
  assert.equal(result.output.result, null);
  assert.equal(result.output.failure?.code, "transposition-link-mismatch");
  assert.equal(result.output.operation_results[0]!.status, "skipped");
  assert.equal(result.output.operation_results[1]!.status, "failed");
  assert.equal(values.tree.toPgn(), sourcePgn);
});

test("affected paths equal exact union of operation diffs", () => {
  const values = replacementFixture();
  const result = apply(values, constructed(values, true));
  assert.equal(result.status, "success");
  const preview = result.output.result.preview;
  const paths = preview.operation_diffs
    .flatMap((diff) => [
      ...diff.added_paths,
      ...diff.removed_paths,
      ...diff.annotated_paths,
      ...diff.linked_paths,
      ...diff.archived_paths,
      ...diff.reordered_parent_paths,
    ])
    .map((path) => path.join("\u001f"));
  assert.deepEqual(
    preview.affected_paths.map((path) => path.join("\u001f")),
    [...new Set(paths)].sort(),
  );
});

test("compatible comments move only across semantic equivalence; incompatible comments remain archived", () => {
  const values = addOnlyFixture("transposition");
  const graph = buildRepertoireGraph(values.tree, values.request.repertoire_color);
  const simulated = values.safety.candidates.find(
    (candidate) => candidate.candidate_id === values.candidate.candidate_id,
  )!;
  const expansion = simulated.scored_candidate.expansion;
  assert.equal(expansion.status, "complete");
  if (expansion.status !== "complete") return;
  const nodes = new Map(expansion.subtree.nodes.map((node) => [node.node_id, node]));
  const compatible = expansion.subtree.edges
    .map((edge) => {
      const node = nodes.get(edge.to_node_id);
      const position = graph.positions.find((item) => item.position_id === node?.position_id);
      return position && position.source_san_paths.length > 0 ? { edge, position } : null;
    })
    .find((value) => value !== null);
  assert.ok(compatible);
  const sourcePath = compatible.position.source_san_paths[0]!;
  const sourceIndex = values.tree.indexPathOfSan(sourcePath);
  assert.notEqual(sourceIndex, null);
  (values.tree.nodeAt(sourceIndex!) as unknown as { data: { comments?: string[] } }).data.comments =
    ["Compatible note"];
  const base = constructed(values);
  const annotation = base.operations.find(
    (operation) =>
      operation.kind === "preserve-annotation" && operation.comments.includes("Compatible note"),
  );
  assert.ok(annotation);
  if (!annotation || annotation.kind !== "preserve-annotation") return;
  const result = apply(values, base);
  assert.equal(result.status, "success");
  const targetIndex = result.tree.indexPathOfSan(annotation.target.source_san_path);
  assert.notEqual(targetIndex, null);
  assert.ok(
    (
      result.tree.nodeAt(targetIndex!) as unknown as { data: { comments?: string[] } }
    ).data.comments?.includes("Compatible note"),
  );

  const injected = clone(base);
  const injectedAnnotation = injected.operations.find(
    (operation) => operation.operation_id === annotation.operation_id,
  )!;
  if (injectedAnnotation.kind === "preserve-annotation")
    injectedAnnotation.comments = ["Injected note"] as never;
  assert.equal(apply(values, injected).output.failure?.code, "annotation-not-equivalent");

  const malformed = clone(base);
  const malformedAnnotation = malformed.operations.find(
    (operation) => operation.operation_id === annotation.operation_id,
  )!;
  if (malformedAnnotation.kind === "preserve-annotation")
    malformedAnnotation.comments = [null] as never;
  const malformedResult = apply(values, malformed);
  assert.equal(malformedResult.status, "failure");
  assert.equal(malformedResult.tree, null);
  assert.equal(malformedResult.output.result, null);
  assert.equal(malformedResult.output.failure?.code, "annotation-not-equivalent");

  const incompatible = replacementFixture("Do not copy across structure");
  const replaced = apply(incompatible);
  assert.equal(replaced.status, "success");
  assert.match(
    replaced.output.result.preview.archive_payloads[0]!.pgn,
    /Do not copy across structure/,
  );
  assert.equal(replaced.output.result.pgn.includes("Do not copy across structure"), false);
});

test("semantic duplicates merge and canonical transposition links do not multiply editorial routes", () => {
  const values = addOnlyFixture("transposition");
  const before = buildRepertoireGraph(values.tree, values.request.repertoire_color);
  const changeSet = constructed(values);
  assert.ok(changeSet.operations.some((operation) => operation.kind === "link-transposition"));
  const result = apply(values, changeSet);
  assert.equal(result.status, "success");
  const after = buildRepertoireGraph(result.tree, values.request.repertoire_color);
  assert.equal(after.source_route_count, before.source_route_count);
  assert.equal(after.route_count, before.route_count);
  assert.equal(
    result.output.result.preview.operation_diffs
      .filter((diff) => diff.kind === "add-subtree")
      .flatMap((diff) => diff.added_paths).length,
    0,
  );
});

test("stale revision, semantic path, Task 8.7 result, identity, version, and provenance are rejected", () => {
  const values = addOnlyFixture();
  const valid = constructed(values);
  const staleRevision = applyReplacementChangeSet({
    source_tree: values.tree,
    current_repertoire_revision: "revision:stale",
    safety: values.safety,
    change_set: valid,
  });
  assert.equal(staleRevision.status, "failure");
  assert.equal(staleRevision.output.failure?.code, "stale-revision");

  const stalePath = clone(valid);
  const add = stalePath.operations.find((operation) => operation.kind === "add-subtree")!;
  if (add.kind === "add-subtree") add.parent.source_san_path = ["d4"] as never;
  assert.equal(apply(values, stalePath).output.failure?.code, "stale-semantic-path");

  const staleSafety = clone(values.safety);
  staleSafety.candidates[0]!.provenance = [
    ...staleSafety.candidates[0]!.provenance,
    {
      source_id: "forged",
      kind: "deterministic-core",
      state: "available",
      version: "forged",
      snapshot: null,
      reason: null,
    },
  ] as never;
  const stale = applyReplacementChangeSet({
    source_tree: values.tree,
    current_repertoire_revision: values.request.repertoire_revision,
    safety: staleSafety,
    change_set: valid,
  });
  assert.equal(stale.output.failure?.code, "safety-not-current");

  assert.equal(
    apply(values, { ...valid, request_id: "request:wrong" }).output.failure?.code,
    "change-set-identity-mismatch",
  );
  assert.equal(
    apply(values, { ...valid, replacement_schema_version: "0.0.0" } as never).output.failure?.code,
    "change-set-version-mismatch",
  );
});

test("illegal operation, invalid ordering, and pruning without confirmation are rejected", () => {
  const values = addOnlyFixture();
  const valid = constructed(values);
  const unsupported = {
    ...valid,
    operations: [
      {
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        operation_id: "operation:test:training",
        sequence: 0,
        kind: "create-training-item",
        training_id: "training:test",
        references: { position_ids: [], decision_ids: [], route_ids: [], source_san_paths: [] },
        concept_ids: [],
        provenance: valid.provenance,
      },
    ],
  } as ReplacementChangeSet;
  assert.equal(apply(values, unsupported).output.failure?.code, "unsupported-operation");

  const linked = addOnlyFixture("transposition");
  const wrongOrder = clone(constructed(linked));
  wrongOrder.operations = [...wrongOrder.operations]
    .reverse()
    .map((operation, sequence) => ({ ...operation, sequence })) as never;
  assert.equal(apply(linked, wrongOrder).output.failure?.code, "invalid-operation-order");

  const replacement = replacementFixture();
  const noConfirm = clone(constructed(replacement));
  const prune = noConfirm.operations.find((operation) => operation.kind === "prune-subtree")!;
  if (prune.kind === "prune-subtree") prune.explicitly_confirmed = false as never;
  assert.equal(apply(replacement, noConfirm).output.failure?.code, "prune-not-confirmed");

  const wrongArchiveTarget = clone(constructed(replacement));
  const wrongArchivePrune = wrongArchiveTarget.operations.find(
    (operation) => operation.kind === "prune-subtree",
  )!;
  const wrongArchiveAdd = wrongArchiveTarget.operations.find(
    (operation) => operation.kind === "add-subtree",
  )!;
  if (wrongArchivePrune.kind === "prune-subtree" && wrongArchiveAdd.kind === "add-subtree") {
    wrongArchivePrune.target = wrongArchiveAdd.parent as never;
  }
  assert.equal(apply(replacement, wrongArchiveTarget).output.failure?.code, "archive-required");
});

test("Black ownership and White-POV transport survive complete change-set serialization", () => {
  const fixture = contextFixture(undefined, "black");
  const base = completeCandidate(fixture, "Nf6", "candidate:black-change-set", 20, 0.8);
  const candidate = base;
  const scoring = scoredFixture(fixture, [candidate]);
  const tree = GameTree.fromPgn(PGN);
  const safety = simulateReplacementSafety({
    source_tree: tree,
    request: fixture.request,
    scoring,
  });
  const result = constructAndApplyReplacementChangeSet({
    source_tree: tree,
    current_repertoire_revision: fixture.request.repertoire_revision,
    safety,
    candidate_id: candidate.candidate_id,
  });
  assert.equal(result.status, "success");
  const serialized = JSON.stringify(result.output);
  assert.equal(
    result.output.result.preview.objective_quality_after.white_pov_evaluation_cp !== null,
    true,
  );
  assert.equal(
    result.output.result.preview.objective_quality_after.repertoire_pov_evaluation_cp !== null,
    true,
  );
  assert.equal(
    result.output.result.preview.objective_quality_after.repertoire_pov_loss_from_best_cp,
    20,
  );
  assert.match(serialized, /"schema_version":"2\.0\.0"/);
  assert.match(serialized, /"analysis_version":"2\.0\.0"/);
  assert.match(serialized, /"replacement_schema_version":"1\.0\.0"/);
});

test("full inputs and Task 8.3-8.7 evidence remain immutable; outputs are deterministic", () => {
  const values = addOnlyFixture();
  const treeBefore = values.tree.toPgn();
  const safetyBefore = JSON.stringify(values.safety);
  const firstChangeSet = constructed(values, true);
  assert.notEqual(firstChangeSet.change_set_id, constructed(values, false).change_set_id);
  const changeSetBefore = JSON.stringify(firstChangeSet);
  const first = apply(values, firstChangeSet);
  const reorderedSafety = {
    ...values.safety,
    candidates: [...values.safety.candidates].reverse(),
    provenance: [...values.safety.provenance].reverse(),
  };
  const secondConstructed = constructReplacementChangeSet({
    source_tree: values.tree,
    current_repertoire_revision: values.request.repertoire_revision,
    safety: reorderedSafety,
    candidate_id: values.candidate.candidate_id,
    promote_candidate_to_mainline: true,
  });
  assert.equal(secondConstructed.status, "constructed");
  assert.ok(secondConstructed.change_set);
  const shuffled = {
    ...secondConstructed.change_set,
    operations: [...secondConstructed.change_set.operations].reverse(),
  };
  const second = applyReplacementChangeSet({
    source_tree: values.tree,
    current_repertoire_revision: values.request.repertoire_revision,
    safety: reorderedSafety,
    change_set: shuffled,
  });
  assert.equal(first.status, "success");
  assert.equal(second.status, "success");
  assert.equal(first.output.result.pgn, second.output.result.pgn);
  assert.equal(
    isDeepStrictEqual(first.output.result.preview, second.output.result.preview),
    true,
    "deterministic preview mismatch",
  );
  assert.equal(values.tree.toPgn(), treeBefore);
  assert.equal(JSON.stringify(values.safety), safetyBefore);
  assert.equal(JSON.stringify(firstChangeSet), changeSetBefore);
  assert.equal(first.source_tree_unchanged, true);
  assert.equal(first.safety_unchanged, true);
  assert.equal(first.change_set_unchanged, true);
  assert.equal(first.evidence_unchanged, true);
  assert.equal(first.inputs_unchanged, true);
  assert.equal(
    isDeepStrictEqual(JSON.parse(JSON.stringify(first.output)), first.output),
    true,
    "serialized output mismatch",
  );
});

test("operation, result, and error enums are exhaustive and duplicate-free", () => {
  assert.deepEqual(TASK_8_8_CHANGE_OPERATION_KINDS, [
    "add-subtree",
    "link-transposition",
    "preserve-annotation",
    "archive-subtree",
    "prune-subtree",
    "reorder-variations",
  ]);
  assert.ok(REPLACEMENT_CHANGE_OPERATION_KINDS.includes("create-training-item"));
  assert.deepEqual(REPLACEMENT_CHANGE_SET_RESULT_STATUSES, [
    "previewed",
    "applied",
    "rejected",
    "failed",
    "stale",
  ]);
  assert.deepEqual(REPLACEMENT_OPERATION_RESULT_STATUSES, ["applied", "skipped", "failed"]);
  for (const values of [
    TASK_8_8_CHANGE_OPERATION_KINDS,
    REPLACEMENT_CHANGE_SET_ERROR_CODES,
    REPLACEMENT_CHANGE_SET_RESULT_STATUSES,
    REPLACEMENT_OPERATION_RESULT_STATUSES,
  ]) {
    assert.equal(new Set(values).size, values.length);
  }
  const operationKinds: Record<Task88ChangeOperationKind, true> = {
    "add-subtree": true,
    "link-transposition": true,
    "preserve-annotation": true,
    "archive-subtree": true,
    "prune-subtree": true,
    "reorder-variations": true,
  };
  const errors: Record<ReplacementChangeSetErrorCode, true> = Object.fromEntries(
    REPLACEMENT_CHANGE_SET_ERROR_CODES.map((code) => [code, true]),
  ) as Record<ReplacementChangeSetErrorCode, true>;
  const operationStatuses: Record<ReplacementOperationResultStatus, true> = {
    applied: true,
    skipped: true,
    failed: true,
  };
  const resultStatuses: Record<ReplacementChangeSetResult["status"], true> = {
    previewed: true,
    applied: true,
    rejected: true,
    failed: true,
    stale: true,
  };
  assert.equal(Object.keys(operationKinds).length, TASK_8_8_CHANGE_OPERATION_KINDS.length);
  assert.equal(Object.keys(errors).length, REPLACEMENT_CHANGE_SET_ERROR_CODES.length);
  assert.equal(Object.keys(operationStatuses).length, REPLACEMENT_OPERATION_RESULT_STATUSES.length);
  assert.equal(Object.keys(resultStatuses).length, REPLACEMENT_CHANGE_SET_RESULT_STATUSES.length);
});
