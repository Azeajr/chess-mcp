import { expect, test, type Page } from "playwright/test";
import { GameTree, buildRepertoireGraph } from "@chess-mcp/chess-tools";

type Metadata = {
  metadata_kind: string;
  metadata_version: string;
  profile: {
    schema_version: string;
    mode: string;
    source: string;
    provisional: boolean;
    preferences: Record<string, unknown>;
  };
  resolutions: any[];
  [key: string]: unknown;
};

type ChessHarness = {
  documentId(): string;
  version(): number;
  toPgn(): string;
  loadPgn(pgn: string, name?: string): void;
  newGame(): void;
  strategicFitMetadata(): Metadata;
  strategicFitMetadataStatus(): string;
  strategicFitMetadataIssues(): Array<{ code: string; path: string; message: string }>;
  strategicFitMetadataWarning(): { code: string; issues: Array<{ code: string }> } | null;
  replaceStrategicFitMetadata(value: unknown): { state: string };
  deleteStrategicFitMetadata(documentId: string): Promise<void>;
  flushStrategicFitMetadata(documentId?: string): Promise<void>;
  strategicFitProfile(): Metadata["profile"];
  selectStrategicFitProfile(mode: string, preferences?: Record<string, unknown>): { state: string };
  updateCustomStrategicFitProfile(preferences: Record<string, unknown>): { state: string };
  applyInferredStrategicFitProfile(mode: string, preferences?: Record<string, unknown>): { state: string };
  confirmInferredStrategicFitProfile(): { state: string };
  upsertStrategicFitResolution(input: unknown): { state: string };
  upsertStrategicFitCohortOverride(input: unknown): { state: string };
  upsertStrategicFitRouteWeight(input: unknown): { state: string };
  reconcileStrategicFitSettings(): { state: string };
  applyEdit(
    action: "prune" | "add" | "reorder",
    path: string[],
    options?: { addMoves?: string[]; promoteMove?: string },
  ): { ok: boolean };
};

const chess = <T>(page: Page, fn: (api: ChessHarness, arg: T) => unknown, arg?: T) => page.evaluate(
  ({ source, arg }) => Function("api", "arg", `return (${source})(api, arg)`)(
    (window as unknown as { __chess: ChessHarness }).__chess,
    arg,
  ),
  { source: fn.toString(), arg },
);

async function idbValue(page: Page, key: string): Promise<unknown> {
  return page.evaluate(async (requestedKey) => new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open("chess-repertoire", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("kv", "readonly").objectStore("kv").get(requestedKey);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db.close();
        resolve(request.result);
      };
    };
  }), key);
}

async function putIdbValue(page: Page, key: string, value: unknown): Promise<void> {
  await page.evaluate(async ({ key, value }) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("chess-repertoire", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  }), { key, value });
}

async function setDistinctMetadata(page: Page, label: string): Promise<void> {
  await chess(page, (api, value) => {
    const base = api.strategicFitMetadata();
    const resolution = {
      schema_version: base.profile.schema_version,
      resolution_id: `resolution:${value}`,
      finding_id: `finding:${value}`,
      semantic_finding_id: `semantic-finding:${value}`,
      repertoire_revision: "revision:e2e",
      state: "defer",
      intentional_reason: null,
      note: `Review ${value} later`,
      references: {
        position_ids: [`position:${value}`],
        decision_ids: [`decision:${value}`],
        route_ids: [`route:${value}`],
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
        version: base.profile.schema_version,
        snapshot: "revision:e2e",
        reason: "Test fixture.",
      }],
    };
    return api.replaceStrategicFitMetadata({
      ...base,
      profile: {
        ...base.profile,
        mode: "custom",
        source: "explicit",
        provisional: false,
        preferences: {
          ...base.profile.preferences,
          manual_weight_importance: 0.8,
          preferred_concept_ids: [`concept:${value}`],
        },
      },
      resolutions: [resolution],
    });
  }, label);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
});

test("semantic resolutions and overrides persist, isolate, and stale after a referenced move edit", async ({ page }) => {
  const pgn = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 (3... Nf6) *";
  const graph = buildRepertoireGraph(GameTree.fromPgn(pgn), "white");
  const route = graph.routes[0]!;
  await chess(page, (api, source) => api.loadPgn(source, "resolution-state.pgn"), pgn);
  const document = await chess(page, (api) => api.documentId()) as string;
  const before = await chess(page, (api) => ({ pgn: api.toPgn(), version: api.version() }));

  const resolutionState = await chess(page, (api, input) => api.upsertStrategicFitResolution(input), {
    resolution_id: "resolution:e2e-semantic",
    finding_id: "finding:e2e-semantic",
    semantic_finding_id: "semantic-finding:e2e-semantic",
    state: "keep-intentionally",
    intentional_reason: "already-understood",
    reason: "Confirmed from repertoire review",
    references: {
      position_ids: route.position_ids,
      decision_ids: route.decision_ids,
      route_ids: [route.route_id],
      source_san_paths: route.source_san_paths,
    },
  }) as { state: string };
  expect(resolutionState.state).toBe("updated");
  expect((await chess(page, (api) => api.upsertStrategicFitCohortOverride({
    override_id: "override:e2e-split",
    kind: "split",
    route_ids: [api.strategicFitMetadata().resolutions[0].references.route_ids[0]],
    reason: "Separate strategic system",
  })) as { state: string }).state).toBe("updated");
  expect((await chess(page, (api) => api.upsertStrategicFitRouteWeight({
    target_id: api.strategicFitMetadata().resolutions[0].references.route_ids[0],
    weight: 4,
    reason: "Frequently reached",
  })) as { state: string }).state).toBe("updated");
  expect(await chess(page, (api) => ({ pgn: api.toPgn(), version: api.version() }))).toEqual(before);
  await chess(page, (api) => api.flushStrategicFitMetadata());
  await expect.poll(async () => {
    const saved = await idbValue(page, "workingRepertoire") as { documentId?: string } | undefined;
    return saved?.documentId;
  }).toBe(document);

  await page.reload();
  await expect.poll(() => chess(page, (api) => api.documentId())).toBe(document);
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  const restored = await chess(page, (api) => api.strategicFitMetadata()) as Record<string, any>;
  expect(restored.resolutions[0]).toMatchObject({
    resolution_id: "resolution:e2e-semantic",
    record_state: "active",
    reason: "Confirmed from repertoire review",
  });
  expect(restored.cohort_overrides[0]).toMatchObject({ record_state: "active" });
  expect(restored.manual_weights.route_weights[0]).toMatchObject({ weight: 4, record_state: "active" });

  const edit = await chess(page, (api, path) => api.applyEdit("prune", path), route.source_san_paths[0]) as {
    ok: boolean;
  };
  expect(edit.ok).toBe(true);
  expect((await chess(page, (api) => api.reconcileStrategicFitSettings()) as { state: string }).state).toBe("updated");
  const stale = await chess(page, (api) => api.strategicFitMetadata()) as Record<string, any>;
  expect(stale.resolutions[0].record_state).toBe("stale");
  expect(stale.resolutions[0].stale_reasons).toContain("referenced-decision-missing");
  expect(stale.cohort_overrides[0].record_state).toBe("stale");
  expect(stale.manual_weights.route_weights[0].record_state).toBe("stale");

  await chess(page, (api) => api.newGame());
  expect((await chess(page, (api) => api.strategicFitMetadata()) as Metadata).resolutions).toEqual([]);
});

test("profile and resolution metadata survive reload under the same stable document ID", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. e4 c5 2. Nf3 d6 *", "metadata.pgn"));
  const expectedId = await chess(page, (api) => api.documentId()) as string;
  await setDistinctMetadata(page, "reload");
  await chess(page, (api) => api.flushStrategicFitMetadata());

  await expect.poll(async () => {
    const saved = await idbValue(page, "workingRepertoire") as { documentId?: string } | undefined;
    return saved?.documentId;
  }).toBe(expectedId);
  await page.reload();
  await expect.poll(() => chess(page, (api) => api.documentId())).toBe(expectedId);
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  expect(await chess(page, (api) => api.strategicFitMetadata().profile.mode)).toBe("custom");
  expect(await chess(page, (api) => api.strategicFitMetadata().resolutions)).toMatchObject([
    { resolution_id: "resolution:reload", state: "defer" },
  ]);
});

test("custom profile preferences persist across reload without changing repertoire content or revision", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. e4 c5 2. Nf3 d6 *", "profile.pgn"));
  const expectedId = await chess(page, (api) => api.documentId()) as string;
  const before = await chess(page, (api) => ({ pgn: api.toPgn(), version: api.version() })) as {
    pgn: string;
    version: number;
  };
  const selected = await chess(page, (api) => api.selectStrategicFitProfile("custom", {
    maximum_engine_loss_cp: 120.8,
    opponent_popularity_importance: 0.9,
    personal_game_frequency_importance: 0.7,
    manual_weight_importance: 0.4,
    additional_memorization_tolerance: 0.2,
    preferred_concept_ids: ["concept:iqp"],
    avoided_concept_ids: ["concept:opposite-castling"],
    preferred_tactical_character: ["forcing"],
    minimum_opponent_coverage: 0.96,
  })) as { state: string };
  expect(selected.state).toBe("updated");
  expect(await chess(page, (api) => ({ pgn: api.toPgn(), version: api.version() }))).toEqual(before);
  expect(await chess(page, (api) => api.strategicFitProfile())).toMatchObject({
    mode: "custom",
    source: "explicit",
    provisional: false,
    preferences: {
      maximum_engine_loss_cp: 121,
      opponent_popularity_importance: 0.9,
      personal_game_frequency_importance: 0.7,
      manual_weight_importance: 0.4,
      additional_memorization_tolerance: 0.2,
      preferred_concept_ids: ["concept:iqp"],
      avoided_concept_ids: ["concept:opposite-castling"],
      preferred_tactical_character: ["forcing"],
      minimum_opponent_coverage: 0.96,
    },
  });
  await chess(page, (api) => api.flushStrategicFitMetadata());
  await expect.poll(async () => {
    const saved = await idbValue(page, "workingRepertoire") as { documentId?: string } | undefined;
    return saved?.documentId;
  }).toBe(expectedId);

  await page.reload();
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  expect(await chess(page, (api) => api.strategicFitProfile())).toMatchObject({
    mode: "custom",
    source: "explicit",
    provisional: false,
    preferences: {
      maximum_engine_loss_cp: 121,
      minimum_opponent_coverage: 0.96,
      preferred_concept_ids: ["concept:iqp"],
    },
  });
  expect(await chess(page, (api) => api.toPgn())).toBe(before.pgn);
});

test("provisional inference is session-only and document-scoped until explicit confirmation", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. e4 e5 *", "inference-a.pgn"));
  const documentA = await chess(page, (api) => api.documentId()) as string;
  expect(await chess(page, (api) => api.applyInferredStrategicFitProfile("versatile", {
    preferred_concept_ids: ["concept:document-a"],
  }))).toMatchObject({ state: "updated" });
  expect(await chess(page, (api) => api.strategicFitProfile())).toMatchObject({
    mode: "versatile",
    source: "inferred",
    provisional: true,
    preferences: { preferred_concept_ids: ["concept:document-a"] },
  });
  expect(await chess(page, (api) => api.strategicFitMetadata().profile)).toMatchObject({
    mode: "balanced",
    source: "inferred",
    provisional: true,
  });
  await chess(page, (api) => api.flushStrategicFitMetadata());
  expect(await idbValue(page, `strategicFitMetadata:${documentA}`)).toBeUndefined();

  const documentB = await chess(page, (api) => {
    api.newGame();
    return api.documentId();
  }) as string;
  expect(documentB).not.toBe(documentA);
  expect(await chess(page, (api) => api.strategicFitProfile())).toMatchObject({
    mode: "balanced",
    preferences: { preferred_concept_ids: [] },
  });
  await chess(page, (api) => api.applyInferredStrategicFitProfile("custom", {
    preferred_concept_ids: ["concept:document-b"],
    minimum_opponent_coverage: 0.9,
  }));
  await chess(page, (api) => api.flushStrategicFitMetadata());
  await expect.poll(async () => {
    const saved = await idbValue(page, "workingRepertoire") as { documentId?: string } | undefined;
    return saved?.documentId;
  }).toBe(documentB);
  expect(await idbValue(page, `strategicFitMetadata:${documentB}`)).toBeUndefined();

  await page.reload();
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  expect(await chess(page, (api) => api.documentId())).toBe(documentB);
  expect(await chess(page, (api) => api.strategicFitProfile())).toMatchObject({
    mode: "balanced",
    source: "inferred",
    provisional: true,
    preferences: { preferred_concept_ids: [], minimum_opponent_coverage: null },
  });

  await chess(page, (api) => api.applyInferredStrategicFitProfile("familiar-plans", {
    preferred_concept_ids: ["concept:confirmed"],
  }));
  expect(await chess(page, (api) => api.confirmInferredStrategicFitProfile())).toMatchObject({
    state: "updated",
  });
  expect(await chess(page, (api) => api.strategicFitMetadata().profile)).toMatchObject({
    mode: "familiar-plans",
    source: "explicit",
    provisional: false,
    preferences: { preferred_concept_ids: ["concept:confirmed"] },
  });
  await chess(page, (api) => api.flushStrategicFitMetadata());
  await page.reload();
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  expect(await chess(page, (api) => api.strategicFitProfile())).toMatchObject({
    mode: "familiar-plans",
    source: "explicit",
    provisional: false,
    preferences: { preferred_concept_ids: ["concept:confirmed"] },
  });
});

test("New and import expose defaults immediately without deleting another document record", async ({ page }) => {
  await setDistinctMetadata(page, "original");
  const originalId = await chess(page, (api) => api.documentId()) as string;
  await chess(page, (api) => api.flushStrategicFitMetadata());

  const afterNew = await chess(page, (api) => {
    api.newGame();
    return { id: api.documentId(), metadata: api.strategicFitMetadata() };
  }) as { id: string; metadata: Metadata };
  expect(afterNew.id).not.toBe(originalId);
  expect(afterNew.metadata.profile.mode).toBe("balanced");
  expect(afterNew.metadata.resolutions).toEqual([]);

  await setDistinctMetadata(page, "new");
  const newId = afterNew.id;
  await chess(page, (api) => api.flushStrategicFitMetadata());
  const afterImport = await chess(page, (api) => {
    api.loadPgn("1. d4 d5 *", "imported.pgn");
    return { id: api.documentId(), metadata: api.strategicFitMetadata() };
  }) as { id: string; metadata: Metadata };
  expect(afterImport.id).not.toBe(newId);
  expect(afterImport.metadata.profile.mode).toBe("balanced");
  expect(afterImport.metadata.resolutions).toEqual([]);

  expect(await idbValue(page, `strategicFitMetadata:${originalId}`)).toMatchObject({
    resolutions: [{ resolution_id: "resolution:original" }],
  });
  expect(await idbValue(page, `strategicFitMetadata:${newId}`)).toMatchObject({
    resolutions: [{ resolution_id: "resolution:new" }],
  });
});

test("corrupt persisted metadata falls back visibly with structured issues and is repaired", async ({ page }) => {
  const id = await chess(page, (api) => api.documentId()) as string;
  await expect.poll(async () => {
    const saved = await idbValue(page, "workingRepertoire") as { documentId?: string } | undefined;
    return saved?.documentId;
  }).toBe(id);
  await putIdbValue(page, `strategicFitMetadata:${id}`, {
    metadata_kind: "wrong-kind",
    metadata_version: "1.3.0",
  });

  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Strategic Fit settings could not be restored");
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  expect(await chess(page, (api) => api.strategicFitMetadata().profile.mode)).toBe("balanced");
  const warning = await chess(page, (api) => api.strategicFitMetadataWarning()) as {
    code: string;
    issues: Array<{ code: string }>;
  };
  expect(warning.code).toBe("invalid-metadata");
  expect(warning.issues.some((issue) => issue.code === "invalid-field")).toBe(true);
  expect(await chess(page, (api) => api.strategicFitMetadataIssues())).not.toEqual([]);
  await chess(page, (api) => api.flushStrategicFitMetadata());
  expect(await idbValue(page, `strategicFitMetadata:${id}`)).toMatchObject({
    metadata_kind: "chess-mcp/strategic-fit-document-metadata",
    metadata_version: "1.3.0",
    resolutions: [],
  });
});
