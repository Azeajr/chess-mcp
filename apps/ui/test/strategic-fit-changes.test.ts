import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";

import {
  GameTree,
  constructReplacementChangeSet,
  createDefaultStrategicFitDocumentMetadata,
  type StrategicFitDocumentMetadata,
} from "@chess-mcp/chess-tools";
import { replacementFixture } from "../../../packages/chess-tools/test/strategic-fit/replacement-change-set.fixtures.ts";
import { browserCommandImplementations, browserDocumentMutationRegistry } from "../src/application/browser-commands/registry.ts";
import { defaultBrowserCommandDependencies } from "../src/application/browser-commands/default-context.ts";
import {
  STRATEGIC_FIT_CHANGE_ERROR_CODES,
  STRATEGIC_FIT_CHANGE_RESULT_STATUSES,
  STRATEGIC_FIT_PENDING_RELOAD_POLICY,
  STRATEGIC_FIT_STAGED_CHANGE_STATUSES,
  STRATEGIC_FIT_UNDO_STATUSES,
  acceptConfirmedStrategicFitChangeSet,
  createStrategicFitChangeController,
  strategicFitChangeConfirmation,
  strategicFitChangeConfirmationMatches,
  type StrategicFitChangeStorage,
  type StrategicFitChangeStorageCommit,
  type StrategicFitDocumentSnapshot,
  type StrategicFitPersistedChangeState,
} from "../src/store/strategic-fit-changes.ts";

const DOCUMENT_ID = "123e4567-e89b-42d3-a456-426614174000";

function changeSetFixture(revision = 4) {
  const values = replacementFixture("archive exactly", `browser:${revision}`);
  const constructed = constructReplacementChangeSet({
    source_tree: values.tree,
    current_repertoire_revision: values.request.repertoire_revision,
    safety: values.safety,
    candidate_id: values.candidate.candidate_id,
  });
  assert.equal(constructed.status, "constructed", `${constructed.error_code}:${constructed.explanation}`);
  assert.ok(constructed.change_set);
  return { ...values, changeSet: constructed.change_set };
}

class MemoryStorage implements StrategicFitChangeStorage {
  value: StrategicFitPersistedChangeState | undefined;
  commits: StrategicFitChangeStorageCommit[] = [];
  fail = false;
  failAtCommit: number | null = null;

  async load(): Promise<StrategicFitPersistedChangeState | undefined> {
    return this.value ? structuredClone(this.value) : undefined;
  }

  async commit(value: StrategicFitChangeStorageCommit): Promise<void> {
    if (this.fail || this.failAtCommit === this.commits.length + 1) throw new Error("storage failure");
    this.value = structuredClone(value.state);
    this.commits.push(structuredClone(value));
  }
}

function harness(options: { undoLimit?: number; publishFails?: boolean } = {}) {
  const fixture = changeSetFixture();
  const storage = new MemoryStorage();
  let publishFails = options.publishFails === true;
  let publishes = 0;
  let snapshot: StrategicFitDocumentSnapshot = {
    document_id: DOCUMENT_ID,
    revision: 4,
    pgn: fixture.tree.toPgn(),
    metadata: createDefaultStrategicFitDocumentMetadata(),
    navigation: [0, 0],
    navigation_san_path: ["e4", "e5"],
    color: "white",
    file_name: "fixture.pgn",
    dirty: false,
  };
  const publish = (tree: GameTree, metadata: StrategicFitDocumentMetadata, navigation: readonly number[], expectedRevision: number) => {
      if (publishFails) return { ok: false as const, error: "injected" };
      if (expectedRevision !== snapshot.revision) return { ok: false as const, error: "stale_revision" };
      publishes++;
      snapshot = {
        ...snapshot,
        revision: snapshot.revision + 1,
        pgn: tree.toPgn(),
        metadata: structuredClone(metadata),
        navigation: [...navigation],
        navigation_san_path: tree.sanPathAt(navigation),
        dirty: true,
      };
      return { ok: true as const, revision: snapshot.revision };
  };
  const createController = () => createStrategicFitChangeController({
    storage,
    current: () => structuredClone(snapshot),
    now: () => "2026-07-29T12:00:00.000Z",
    undoLimit: options.undoLimit,
    publish,
    rollback: (prior) => { snapshot = structuredClone(prior); },
  });
  const controller = createController();
  return {
    fixture,
    storage,
    controller,
    freshController: createController,
    snapshot: () => structuredClone(snapshot),
    publishes: () => publishes,
    failStorage: () => { storage.fail = true; },
    allowStorage: () => { storage.fail = false; },
    failStorageAt: (commit: number) => { storage.failAtCommit = commit; },
    failPublish: () => { publishFails = true; },
    mutate: (change: Partial<StrategicFitDocumentSnapshot>) => { snapshot = { ...snapshot, ...change }; },
  };
}

test("stage previews exact Task 8.8 result without tree, metadata, navigation, revision, or disk mutation; reject is inert", async () => {
  const h = harness();
  const before = h.snapshot();
  const safetyBefore = structuredClone(h.fixture.safety);
  const changeSetBefore = structuredClone(h.fixture.changeSet);
  const staged = await h.controller.stageChangeSet({ safety: h.fixture.safety, change_set: h.fixture.changeSet });
  assert.equal(staged.ok, true);
  assert.equal(staged.stage?.status, "staged");
  assert.equal(staged.stage?.result_status, "previewed");
  assert.equal(isDeepStrictEqual(h.snapshot(), before), true, "stage mutated document snapshot");
  assert.equal(h.storage.commits.length, 0);
  assert.equal(isDeepStrictEqual(h.fixture.safety, safetyBefore), true, "stage mutated safety evidence");
  assert.equal(isDeepStrictEqual(h.fixture.changeSet, changeSetBefore), true, "stage mutated change set");
  const rejected = await h.controller.reject(staged.stage!.stage_id);
  assert.equal(rejected.ok, true);
  assert.equal(rejected.stage?.status, "rejected");
  assert.equal(isDeepStrictEqual(h.snapshot(), before), true, "reject mutated document snapshot");
  assert.equal(h.storage.commits.length, 0);
  const reopened = await h.controller.stageChangeSet({ safety: h.fixture.safety, change_set: h.fixture.changeSet });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.stage?.stage_id, staged.stage?.stage_id, "deterministic preview identity changed after reopen");
  assert.equal(reopened.stage?.status, "staged", "close then reopen reused a finalized preview");
  assert.equal(reopened.stage?.result_status, "previewed");
});

test("final acceptance confirmation binds current revision and unchanged evidence before one atomic path", async () => {
  const h = harness();
  const before = h.snapshot();
  const staged = await h.controller.stageChangeSet({ safety: h.fixture.safety, change_set: h.fixture.changeSet });
  assert.equal(staged.ok, true);
  const confirmation = strategicFitChangeConfirmation(staged.stage!);
  assert.equal(confirmation.base_revision, before.revision);
  assert.equal(confirmation.preview_identity, staged.stage!.preview_identity);

  const changedEvidence = {
    ...confirmation,
    preview_identity: `${confirmation.preview_identity}:changed`,
  };
  assert.equal(strategicFitChangeConfirmationMatches(staged.stage!, changedEvidence), false);
  assert.equal(strategicFitChangeConfirmationMatches(staged.stage!, confirmation), true);
  assert.deepEqual(h.snapshot(), before);

  const changed = await acceptConfirmedStrategicFitChangeSet(changedEvidence, h.controller);
  assert.equal(changed.ok, false);
  assert.equal(changed.error, "stale-result");
  assert.equal(h.publishes(), 0);
  assert.deepEqual(h.snapshot(), before);

  const accepted = await acceptConfirmedStrategicFitChangeSet(confirmation, h.controller);
  assert.equal(accepted.ok, true);
  assert.equal(h.publishes(), 1);
  assert.equal(h.snapshot().revision, before.revision + 1);

  const staleHarness = harness();
  const staleStage = await staleHarness.controller.stageChangeSet({
    safety: staleHarness.fixture.safety,
    change_set: staleHarness.fixture.changeSet,
  });
  assert.equal(staleStage.ok, true);
  const staleConfirmation = strategicFitChangeConfirmation(staleStage.stage!);
  staleHarness.mutate({ revision: staleHarness.snapshot().revision + 1 });
  const stale = await acceptConfirmedStrategicFitChangeSet(staleConfirmation, staleHarness.controller);
  assert.equal(stale.ok, false);
  assert.equal(stale.error, "stale-revision");
  assert.equal(staleHarness.publishes(), 0);
});

test("accept persists archive outside metadata, publishes tree plus metadata once, rejects duplicate acceptance, and undo restores exact state", async () => {
  const h = harness();
  const before = h.snapshot();
  const staged = await h.controller.stageChangeSet({ safety: h.fixture.safety, change_set: h.fixture.changeSet });
  assert.equal(staged.ok, true);
  const accepted = await h.controller.accept(staged.stage!.stage_id);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.stage?.status, "accepted");
  assert.equal(h.snapshot().revision, 5);
  assert.equal(h.publishes(), 1);
  assert.equal(h.storage.commits.length, 2, "accept must prepare then finalize one recoverable transaction");
  assert.equal(h.storage.value?.archives.length, 1);
  const archive = h.storage.value!.archives[0]!;
  const previewArchive = accepted.stage!.preview.result.preview.archive_payloads[0]!;
  assert.equal(archive.payload.pgn, previewArchive.pgn, "archive bytes changed during persistence");
  assert.equal(h.snapshot().metadata.archive_references[0]?.archive_id, archive.payload.archive_id);
  assert.equal("pgn" in (h.snapshot().metadata.archive_references[0] as object), false, "archive payload leaked into metadata");
  const duplicate = await h.controller.accept(staged.stage!.stage_id);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error, "already-accepted");
  assert.equal(h.publishes(), 1);
  const undone = await h.controller.undo();
  assert.equal(undone.ok, true);
  assert.equal(undone.stage?.status, "undone");
  assert.equal(h.snapshot().revision, 6, "undo must allocate one monotonic revision");
  assert.equal(h.snapshot().pgn, before.pgn);
  assert.equal(isDeepStrictEqual(h.snapshot().metadata, before.metadata), true, "undo metadata mismatch");
  assert.deepEqual(h.snapshot().navigation, before.navigation);
  assert.deepEqual(h.storage.value?.archives, []);
  assert.equal(h.publishes(), 2);
});

test("accepted undo survives reload while pending stages remain discarded", async () => {
  const h = harness();
  const before = h.snapshot();
  const staged = await h.controller.stageChangeSet({ safety: h.fixture.safety, change_set: h.fixture.changeSet });
  await h.controller.accept(staged.stage!.stage_id);
  const reloaded = h.freshController();
  assert.deepEqual(reloaded.stages(), [], "pending and terminal session stages reloaded");
  const undone = await reloaded.undo();
  assert.equal(undone.ok, true);
  assert.equal(undone.stage?.status, "undone");
  assert.equal(h.snapshot().revision, 6);
  assert.equal(h.snapshot().pgn, before.pgn);
  assert.equal(isDeepStrictEqual(h.snapshot().metadata, before.metadata), true);
});

test("accept and reject finalization serialize so only one terminal outcome wins", async () => {
  const h = harness();
  const staged = await h.controller.stageChangeSet({ safety: h.fixture.safety, change_set: h.fixture.changeSet });
  const accepting = h.controller.accept(staged.stage!.stage_id);
  const rejecting = h.controller.reject(staged.stage!.stage_id);
  const [accepted, rejected] = await Promise.all([accepting, rejecting]);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.stage?.status, "accepted");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, "already-finalized");
  assert.equal(h.publishes(), 1);
});

test("document, revision, metadata, change-set, result, version, provenance, and archive boundaries fail closed", async () => {
  const cases: Array<{
    name: string;
    mutate(h: ReturnType<typeof harness>, stageId: string): void;
    expected: string;
  }> = [
    { name: "document", mutate: (h) => h.mutate({ document_id: `${DOCUMENT_ID}-other` }), expected: "stale-document" },
    { name: "revision", mutate: (h) => h.mutate({ revision: 5 }), expected: "stale-revision" },
    {
      name: "metadata",
      mutate: (h) => h.mutate({
        metadata: {
          ...h.snapshot().metadata,
          profile: { ...h.snapshot().metadata.profile, mode: "versatile", source: "explicit", provisional: false },
        },
      }),
      expected: "stale-metadata",
    },
  ];
  for (const entry of cases) {
    const h = harness();
    const staged = await h.controller.stageChangeSet({ safety: h.fixture.safety, change_set: h.fixture.changeSet });
    entry.mutate(h, staged.stage!.stage_id);
    const result = await h.controller.accept(staged.stage!.stage_id);
    assert.equal(result.ok, false, entry.name);
    assert.equal(result.error, entry.expected, entry.name);
    assert.equal(h.storage.commits.length, 0, entry.name);
    assert.equal(h.publishes(), 0, entry.name);
  }

  const h = harness();
  const staged = await h.controller.stageChangeSet({ safety: h.fixture.safety, change_set: h.fixture.changeSet });
  const internal = h.controller.stage(staged.stage!.stage_id)! as unknown as { change_set: { provenance: unknown[] } };
  internal.change_set.provenance = [];
  assert.notEqual(internal.change_set.provenance.length, h.controller.stage(staged.stage!.stage_id)!.change_set.provenance.length,
    "returned stages must be immutable copies");
});

test("persistence and publish failures expose no partial tree, metadata, archive, navigation, or revision", async () => {
  for (const failure of ["persistence", "publish"] as const) {
    const h = harness({ publishFails: failure === "publish" });
    const before = h.snapshot();
    const staged = await h.controller.stageChangeSet({ safety: h.fixture.safety, change_set: h.fixture.changeSet });
    if (failure === "persistence") h.failStorage();
    const result = await h.controller.accept(staged.stage!.stage_id);
    assert.equal(result.ok, false);
    assert.equal(result.error, failure === "persistence" ? "persistence-failed" : "publish-failed");
    assert.equal(isDeepStrictEqual(h.snapshot(), before), true, `${failure} changed document`);
    assert.equal(h.publishes(), 0);
    if (failure === "persistence") assert.equal(h.storage.value, undefined);
    else assert.deepEqual(h.storage.value?.archives, [], "publish rollback retained archive");
  }
});

test("final accept and undo persistence failure rolls live state back while leaving only an inert recovery journal", async () => {
  const accept = harness();
  const beforeAccept = accept.snapshot();
  const staged = await accept.controller.stageChangeSet({ safety: accept.fixture.safety, change_set: accept.fixture.changeSet });
  accept.failStorageAt(2);
  const failedAccept = await accept.controller.accept(staged.stage!.stage_id);
  assert.equal(failedAccept.ok, false);
  assert.equal(failedAccept.error, "persistence-failed");
  assert.equal(isDeepStrictEqual(accept.snapshot(), beforeAccept), true, "failed final accept leaked live state");
  assert.deepEqual(accept.storage.value?.archives, [], "prepared archive became canonical");
  assert.equal(accept.storage.value?.recovery?.operation, "accept");

  const undo = harness();
  const acceptedStage = await undo.controller.stageChangeSet({ safety: undo.fixture.safety, change_set: undo.fixture.changeSet });
  await undo.controller.accept(acceptedStage.stage!.stage_id);
  const beforeUndo = undo.snapshot();
  undo.failStorageAt(4);
  const failedUndo = await undo.controller.undo();
  assert.equal(failedUndo.ok, false);
  assert.equal(failedUndo.error, "undo-failed");
  assert.equal(isDeepStrictEqual(undo.snapshot(), beforeUndo), true, "failed final undo leaked live state");
  assert.equal(undo.storage.value?.archives.length, 1, "prepared undo archive state became canonical");
  assert.equal(undo.storage.value?.recovery?.operation, "undo");
});

test("corrupt archive/version state rejects staging without overwriting durable evidence", async () => {
  const h = harness();
  h.storage.value = {
    storage_version: "1.0.0",
    document_id: DOCUMENT_ID,
    archives: [{
      status: "archived",
      archived_by_stage_id: "stage:old",
      payload: { archive_id: "archive:corrupt", analysis_version: "stale" },
    }],
    undo: [],
  } as unknown as StrategicFitPersistedChangeState;
  const before = h.snapshot();
  const result = await h.controller.stageChangeSet({ safety: h.fixture.safety, change_set: h.fixture.changeSet });
  assert.equal(result.ok, false);
  assert.equal(result.error, "archive-mismatch");
  assert.equal(isDeepStrictEqual(h.snapshot(), before), true);
  assert.equal(h.storage.commits.length, 0);
});

test("repertoire ownership is an exact staging and acceptance boundary", async () => {
  const h = harness();
  h.mutate({ color: "black" });
  const rejected = await h.controller.stageChangeSet({ safety: h.fixture.safety, change_set: h.fixture.changeSet });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, "identity-mismatch");
  assert.equal(h.storage.commits.length, 0);

  h.mutate({ color: "white" });
  const staged = await h.controller.stageChangeSet({ safety: h.fixture.safety, change_set: h.fixture.changeSet });
  assert.equal(staged.ok, true);
  h.mutate({ color: "black" });
  const stale = await h.controller.accept(staged.stage!.stage_id);
  assert.equal(stale.ok, false);
  assert.equal(stale.error, "identity-mismatch");
  assert.equal(h.storage.commits.length, 0);
});

test("undo failure is non-mutating; pending reload policy discards stages; enums and serialization are exhaustive and deterministic", async () => {
  const h = harness({ undoLimit: 1 });
  const staged = await h.controller.stageChangeSet({ safety: h.fixture.safety, change_set: h.fixture.changeSet });
  await h.controller.accept(staged.stage!.stage_id);
  const beforeUndo = h.snapshot();
  h.failStorage();
  const failedUndo = await h.controller.undo();
  assert.equal(failedUndo.ok, false);
  assert.equal(failedUndo.error, "undo-failed");
  assert.equal(isDeepStrictEqual(h.snapshot(), beforeUndo), true);
  assert.equal(STRATEGIC_FIT_PENDING_RELOAD_POLICY, "discard");
  const reloaded = createStrategicFitChangeController({
    storage: h.storage,
    current: h.snapshot,
    publish: () => ({ ok: false as const, error: "unused" }),
    rollback: () => undefined,
  });
  assert.deepEqual(reloaded.stages(), [], "pending/terminal session stages must not auto-reload or auto-accept");
  assert.deepEqual(STRATEGIC_FIT_STAGED_CHANGE_STATUSES, ["staged", "accepted", "rejected", "stale", "undone", "failed"]);
  assert.deepEqual(STRATEGIC_FIT_CHANGE_RESULT_STATUSES, ["previewed", "accepted", "rejected", "stale", "failed", "undone"]);
  assert.deepEqual(STRATEGIC_FIT_UNDO_STATUSES, ["available", "undone", "stale", "failed"]);
  assert.equal(new Set(STRATEGIC_FIT_CHANGE_ERROR_CODES).size, STRATEGIC_FIT_CHANGE_ERROR_CODES.length);
  const serialized = JSON.stringify(staged.stage);
  assert.equal(JSON.stringify(JSON.parse(serialized)), serialized);
  assert.equal(serialized.includes('"replacement_schema_version":"1.0.0"'), true, "missing replacement schema version");
  assert.equal(serialized.includes('"repertoire_color":"white"'), true, "missing repertoire ownership");
  assert.equal(serialized.includes('"white_pov_'), true, "missing separately labeled White-POV transport");
});

test("metadata archive references survive current migration normalization", () => {
  const base = createDefaultStrategicFitDocumentMetadata();
  const value: StrategicFitDocumentMetadata = { ...base, archive_references: [] };
  assert.equal(value.metadata_version, base.metadata_version);
});

test("browser V2 adapter stages every selected preview and never directly applies it", async () => {
  const h = harness();
  const request = h.fixture.request;
  let stageCalls = 0;
  const source = h.fixture.tree.toPgn();
  const result = await browserCommandImplementations.suggest_replacement_line({
    contract: "strategic-fit-replacement-v2",
    replacement_request: request,
    finding: {
      report_id: request.report_id,
      finding_id: request.finding_id,
      semantic_finding_id: request.semantic_finding_id,
      cohort_id: request.cohort_id,
      repertoire_revision: request.repertoire_revision,
    },
    pivot: request.pivot_selection,
    profile: request.profile,
    sources: request.candidate_sources,
    budget: request.budget,
    engine: { depth: request.budget.engine_depth, multipv: request.budget.engine_multipv, allow_unavailable_evidence: true },
    coverage: {
      minimum_expected_opponent_coverage: request.minimum_expected_opponent_coverage,
      require_all_forcing_replies: request.budget.include_all_forcing_replies,
    },
    retention: [{ candidate_id: h.fixture.candidate.candidate_id, action: "replace", prune_explicitly_confirmed: true }],
    candidate_ids: [h.fixture.candidate.candidate_id],
    safety: h.fixture.safety,
  }, {
    ...defaultBrowserCommandDependencies,
    currentTree: () => h.fixture.tree,
    currentRevision: () => 4,
    currentDocumentId: () => DOCUMENT_ID,
    stageReplacementChangeSet: async ({ safety, change_set }) => {
      stageCalls++;
      assert.equal(safety.request_id, request.request_id);
      assert.equal(change_set.base_repertoire_revision, request.repertoire_revision);
      return { ok: true, stage: { stage_id: "stage:test" } };
    },
  }) as { status: string; items: Array<{ status: string; stage: unknown }>; host: { preview_policy: string } };
  assert.equal(result.status, "complete");
  assert.equal(result.items[0]?.status, "previewed");
  assert.deepEqual(result.items[0]?.stage, { ok: true, stage: { stage_id: "stage:test" } });
  assert.equal(result.host.preview_policy, "stage-only");
  assert.equal(stageCalls, 1);
  assert.equal(h.fixture.tree.toPgn(), source, "browser adapter directly mutated source tree");
  assert.deepEqual(Object.keys(browserDocumentMutationRegistry), ["strategic_fit_change_set"]);

  const stale = await browserCommandImplementations.suggest_replacement_line({
    contract: "strategic-fit-replacement-v2",
    replacement_request: request,
    finding: {
      report_id: request.report_id,
      finding_id: request.finding_id,
      semantic_finding_id: request.semantic_finding_id,
      cohort_id: request.cohort_id,
      repertoire_revision: request.repertoire_revision,
    },
    pivot: request.pivot_selection,
    profile: request.profile,
    sources: request.candidate_sources,
    budget: request.budget,
    engine: { depth: request.budget.engine_depth, multipv: request.budget.engine_multipv, allow_unavailable_evidence: true },
    coverage: {
      minimum_expected_opponent_coverage: request.minimum_expected_opponent_coverage,
      require_all_forcing_replies: request.budget.include_all_forcing_replies,
    },
    retention: [{ candidate_id: h.fixture.candidate.candidate_id, action: "replace", prune_explicitly_confirmed: true }],
    candidate_ids: [h.fixture.candidate.candidate_id],
    safety: h.fixture.safety,
  }, {
    ...defaultBrowserCommandDependencies,
    currentTree: () => h.fixture.tree,
    currentRevision: () => 4,
    currentDocumentId: () => DOCUMENT_ID,
    stageReplacementChangeSet: async () => ({ ok: false, error: "stale-revision", stage: null }),
  }) as { status: string; items: Array<{ status: string; error_code: string }> };
  assert.equal(stale.status, "stale");
  assert.equal(stale.items[0]?.status, "stale");
  assert.equal(stale.items[0]?.error_code, "stale-revision");

  const controller = new AbortController();
  const discarded: string[] = [];
  await assert.rejects(
    browserCommandImplementations.suggest_replacement_line({
      contract: "strategic-fit-replacement-v2",
      replacement_request: request,
      finding: {
        report_id: request.report_id,
        finding_id: request.finding_id,
        semantic_finding_id: request.semantic_finding_id,
        cohort_id: request.cohort_id,
        repertoire_revision: request.repertoire_revision,
      },
      pivot: request.pivot_selection,
      profile: request.profile,
      sources: request.candidate_sources,
      budget: request.budget,
      engine: { depth: request.budget.engine_depth, multipv: request.budget.engine_multipv, allow_unavailable_evidence: true },
      coverage: {
        minimum_expected_opponent_coverage: request.minimum_expected_opponent_coverage,
        require_all_forcing_replies: request.budget.include_all_forcing_replies,
      },
      retention: [{ candidate_id: h.fixture.candidate.candidate_id, action: "replace", prune_explicitly_confirmed: true }],
      candidate_ids: [h.fixture.candidate.candidate_id],
      safety: h.fixture.safety,
    }, {
      ...defaultBrowserCommandDependencies,
      currentTree: () => h.fixture.tree,
      currentRevision: () => 4,
      currentDocumentId: () => DOCUMENT_ID,
      signal: controller.signal,
      stageReplacementChangeSet: async () => {
        controller.abort();
        return { ok: true, stage: { stage_id: "stage:cancelled-mid-staging" } };
      },
      discardReplacementChangeSet: async (stageId) => { discarded.push(stageId); },
    }),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(discarded.length, 1);
  assert.equal(discarded[0], "stage:cancelled-mid-staging");
});
