import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultStrategicFitDocumentMetadata,
  createStrategicFitMetadataPersistence,
  type StrategicFitDocumentMetadata,
  type StrategicFitMetadataStorage,
} from "../src/store/strategic-fit-metadata.ts";

const DOCUMENT_A = "550e8400-e29b-41d4-a716-446655440000";
const DOCUMENT_B = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

function populatedMetadata(label: string): StrategicFitDocumentMetadata {
  const defaults = createDefaultStrategicFitDocumentMetadata();
  return {
    ...defaults,
    profile: {
      ...defaults.profile,
      mode: "custom",
      source: "explicit",
      provisional: false,
      preferences: {
        ...defaults.profile.preferences,
        manual_weight_importance: 0.75,
        preferred_concept_ids: [`concept:${label}`],
      },
    },
    resolutions: [{
      schema_version: defaults.profile.schema_version,
      resolution_id: `resolution:${label}`,
      finding_id: `finding:${label}`,
      semantic_finding_id: `semantic-finding:${label}`,
      repertoire_revision: "revision:7",
      state: "defer",
      intentional_reason: null,
      note: `Review ${label} later`,
      references: {
        position_ids: [`position:${label}`],
        decision_ids: [`decision:${label}`],
        route_ids: [`route:${label}`],
        source_san_paths: [["e4", "c5"]],
      },
      invalidation_rules: ["referenced-position-changed"],
      expires_at: null,
      linked_training_ids: [],
      linked_staged_edit_ids: [],
      created_at: "2026-07-17T12:00:00.000Z",
      profile_snapshot: null,
      record_state: "active",
      stale_reasons: [],
      reason: null,
      updated_at: "2026-07-17T12:00:00.000Z",
      provenance: [{
        source_id: "fixture:user",
        kind: "user-profile",
        state: "available",
        version: defaults.profile.schema_version,
        snapshot: "revision:7",
        reason: "Test fixture.",
      }],
    }],
  };
}

class MemoryStorage implements StrategicFitMetadataStorage {
  readonly values = new Map<string, unknown>();
  readonly writes: Array<{ documentId: string; metadata: StrategicFitDocumentMetadata }> = [];
  readonly deletes: string[] = [];

  async get(documentId: string): Promise<unknown> {
    const value = this.values.get(documentId);
    return value === undefined ? undefined : structuredClone(value);
  }

  async set(documentId: string, metadata: StrategicFitDocumentMetadata): Promise<void> {
    const cloned = structuredClone(metadata);
    this.writes.push({ documentId, metadata: cloned });
    this.values.set(documentId, cloned);
  }

  async delete(documentId: string): Promise<void> {
    this.deletes.push(documentId);
    this.values.delete(documentId);
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("mocked storage round-trips non-default profile and resolution metadata", async () => {
  const storage = new MemoryStorage();
  const first = createStrategicFitMetadataPersistence({ storage, debounceMs: 5 });
  await first.activateDocument(DOCUMENT_A);
  const expected = populatedMetadata("round-trip");
  const normalized = first.replaceDocumentMetadata(DOCUMENT_A, expected);
  assert.equal(normalized.state, "valid");
  await first.flush();
  first.dispose();

  const restored = createStrategicFitMetadataPersistence({ storage, debounceMs: 5 });
  await restored.activateDocument(DOCUMENT_A);
  assert.equal(restored.snapshot().status, "ready");
  assert.equal(restored.snapshot().normalization_state, "valid");
  assert.deepEqual(restored.snapshot().metadata, expected);
  restored.dispose();
});

test("restore canonicalizes duplicate active resolution IDs for one semantic finding", async () => {
  const storage = new MemoryStorage();
  const input = populatedMetadata("duplicate-resolution");
  const original = input.resolutions[0]!;
  const replacement = {
    ...original,
    resolution_id: "resolution:replacement",
    state: "train-as-exception" as const,
    intentional_reason: null,
    updated_at: "2026-07-17T12:01:00.000Z",
  };
  storage.values.set(DOCUMENT_A, { ...input, resolutions: [replacement, original] });

  const controller = createStrategicFitMetadataPersistence({ storage, debounceMs: 5 });
  await controller.activateDocument(DOCUMENT_A);
  assert.equal(controller.snapshot().normalization_state, "valid");
  assert.equal(controller.snapshot().issues.some((entry) => entry.code === "duplicate-id"), true);
  assert.deepEqual(
    controller.snapshot().metadata.resolutions.map((entry) => entry.resolution_id),
    ["resolution:replacement"],
  );
  await controller.flush();
  assert.deepEqual(
    (storage.values.get(DOCUMENT_A) as StrategicFitDocumentMetadata).resolutions.map((entry) => entry.resolution_id),
    ["resolution:replacement"],
  );
  controller.dispose();
});

test("the explicit 0.1.0 format migrates and is rewritten as canonical current metadata", async () => {
  const storage = new MemoryStorage();
  const expected = populatedMetadata("migration");
  storage.values.set(DOCUMENT_A, {
    metadata_version: "0.1.0",
    profile: expected.profile,
    route_weights: [],
    decision_weights: [],
    cohort_overrides: [],
    exclusions: [],
    resolutions: expected.resolutions,
    archives: [],
    training: [],
    provenance: [],
  });
  const controller = createStrategicFitMetadataPersistence({ storage, debounceMs: 5 });
  await controller.activateDocument(DOCUMENT_A);
  assert.equal(controller.snapshot().normalization_state, "migrated");
  assert.deepEqual(controller.snapshot().metadata, expected);
  await controller.flush();
  assert.deepEqual(storage.values.get(DOCUMENT_A), expected);
  assert.equal(storage.writes.length, 1);
  controller.dispose();
});

test("initial defaults cannot write before restore and a late previous-document read is discarded", async () => {
  const reads = new Map<string, Deferred<unknown>>([
    [DOCUMENT_A, deferred<unknown>()],
    [DOCUMENT_B, deferred<unknown>()],
  ]);
  const storage = new MemoryStorage();
  storage.get = (id) => reads.get(id)!.promise;
  const controller = createStrategicFitMetadataPersistence({ storage, debounceMs: 5 });

  const loadA = controller.activateDocument(DOCUMENT_A);
  assert.equal(controller.snapshot().status, "loading");
  assert.deepEqual(controller.snapshot().metadata, createDefaultStrategicFitDocumentMetadata());
  await controller.flush();
  assert.equal(storage.writes.length, 0, "initial defaults must not be treated as a mutation");

  const loadB = controller.activateDocument(DOCUMENT_B);
  reads.get(DOCUMENT_A)!.resolve(populatedMetadata("late-a"));
  await loadA;
  assert.equal(controller.snapshot().document_id, DOCUMENT_B);
  assert.deepEqual(controller.snapshot().metadata, createDefaultStrategicFitDocumentMetadata());

  reads.get(DOCUMENT_B)!.resolve(undefined);
  await loadB;
  assert.equal(controller.snapshot().status, "ready");
  assert.deepEqual(controller.snapshot().metadata, createDefaultStrategicFitDocumentMetadata());
  assert.equal(storage.writes.length, 0);
  controller.dispose();
});

test("two documents isolate immediate reads and every debounced write by captured key", async () => {
  const storage = new MemoryStorage();
  const controller = createStrategicFitMetadataPersistence({ storage, debounceMs: 50 });
  await controller.activateDocument(DOCUMENT_A);
  const metadataA = populatedMetadata("a");
  controller.replaceDocumentMetadata(DOCUMENT_A, metadataA);

  await controller.activateDocument(DOCUMENT_B);
  assert.deepEqual(controller.snapshot().metadata, createDefaultStrategicFitDocumentMetadata());
  const metadataB = populatedMetadata("b");
  controller.replaceDocumentMetadata(DOCUMENT_B, metadataB);
  await controller.flush();

  assert.deepEqual(storage.values.get(DOCUMENT_A), metadataA);
  assert.deepEqual(storage.values.get(DOCUMENT_B), metadataB);
  assert.deepEqual(storage.writes.map((entry) => entry.documentId).sort(), [DOCUMENT_A, DOCUMENT_B].sort());
  await controller.activateDocument(DOCUMENT_A);
  assert.deepEqual(controller.snapshot().metadata, metadataA);
  controller.dispose();
});

test("corrupt and unsupported records publish defaults, structured warnings, then repair their key", async () => {
  for (const [label, input, warningCode, issueCode] of [
    ["corrupt", { metadata_version: "1.3.0", metadata_kind: "wrong" }, "invalid-metadata", "invalid-field"],
    ["unsupported", { metadata_version: "99.0.0" }, "unsupported-metadata", "unsupported-version"],
  ] as const) {
    const storage = new MemoryStorage();
    storage.values.set(DOCUMENT_A, input);
    const controller = createStrategicFitMetadataPersistence({ storage, debounceMs: 5 });
    await controller.activateDocument(DOCUMENT_A);
    const snapshot = controller.snapshot();
    assert.equal(snapshot.normalization_state, "fallback", label);
    assert.deepEqual(snapshot.metadata, createDefaultStrategicFitDocumentMetadata(), label);
    assert.equal(snapshot.warning?.code, warningCode, label);
    assert.equal(snapshot.warning?.issues.some((entry) => entry.code === issueCode), true, label);
    await controller.flush();
    assert.deepEqual(storage.values.get(DOCUMENT_A), createDefaultStrategicFitDocumentMetadata(), label);
    controller.dispose();
  }
});

test("targeted cleanup removes only the requested key and safely resets the active document", async () => {
  const storage = new MemoryStorage();
  storage.values.set(DOCUMENT_A, populatedMetadata("a"));
  storage.values.set(DOCUMENT_B, populatedMetadata("b"));
  const controller = createStrategicFitMetadataPersistence({ storage, debounceMs: 50 });
  await controller.activateDocument(DOCUMENT_A);

  controller.replaceDocumentMetadata(DOCUMENT_A, populatedMetadata("pending-a"));
  await controller.deleteDocumentMetadata(DOCUMENT_B);
  assert.equal(storage.values.has(DOCUMENT_B), false);
  assert.deepEqual(controller.snapshot().metadata, populatedMetadata("pending-a"));

  await controller.deleteDocumentMetadata(DOCUMENT_A);
  await controller.flush();
  assert.equal(storage.values.has(DOCUMENT_A), false, "a pending write must not resurrect a deleted record");
  assert.deepEqual(controller.snapshot().metadata, createDefaultStrategicFitDocumentMetadata());
  assert.equal(controller.snapshot().status, "ready");
  assert.deepEqual(storage.deletes, [DOCUMENT_B, DOCUMENT_A]);
  controller.dispose();
});
