import { batch, createSignal } from "solid-js";
import {
  GameTree,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
  applyReplacementChangeSet,
  type Path,
  type ReplacementArchivePayload,
  type ReplacementAtomicChangeSetSuccess,
  type ReplacementChangeSet,
  type ReplacementChangeSetPreviewSuccess,
  type ReplacementSafetySimulationResult,
  type StrategicFitDocumentMetadata,
  type StrategicFitSourceProvenance,
} from "@chess-mcp/chess-tools";
import { actions, color, currentPath, currentTree, dirty, documentId, fileName, version } from "./game";
import { idbGet, idbMutateAtomically } from "./idb";
import {
  STRATEGIC_FIT_METADATA_STORAGE_KEY_PREFIX,
  pauseStrategicFitMetadataPersistence,
  replaceStrategicFitMetadata,
  strategicFitMetadata,
} from "./strategic-fit-metadata";
import {
  WORKING_REPERTOIRE_STORAGE_KEY,
  pauseWorkingRepertoireAutosave,
  type SavedWorkingRepertoire,
} from "./persist";
import { browserDocumentMutationRegistry } from "../application/browser-commands/registry";

export const STRATEGIC_FIT_CHANGE_STORAGE_VERSION = "1.0.0";
export const STRATEGIC_FIT_CHANGE_STORAGE_KEY_PREFIX = "strategicFitChanges:";
export const STRATEGIC_FIT_PENDING_RELOAD_POLICY = "discard" as const;
export const STRATEGIC_FIT_CHANGE_UNDO_LIMIT = 10;

export const STRATEGIC_FIT_STAGED_CHANGE_STATUSES = [
  "staged", "accepted", "rejected", "stale", "undone", "failed",
] as const;
export type StrategicFitStagedChangeStatus = (typeof STRATEGIC_FIT_STAGED_CHANGE_STATUSES)[number];

export const STRATEGIC_FIT_CHANGE_RESULT_STATUSES = [
  "previewed", "accepted", "rejected", "stale", "failed", "undone",
] as const;
export type StrategicFitChangeResultStatus = (typeof STRATEGIC_FIT_CHANGE_RESULT_STATUSES)[number];

export const STRATEGIC_FIT_UNDO_STATUSES = ["available", "undone", "stale", "failed"] as const;
export type StrategicFitUndoStatus = (typeof STRATEGIC_FIT_UNDO_STATUSES)[number];

export const STRATEGIC_FIT_CHANGE_ERROR_CODES = [
  "invalid-document",
  "stale-revision",
  "stale-document",
  "stale-tree",
  "stale-metadata",
  "stale-change-set",
  "stale-result",
  "identity-mismatch",
  "version-mismatch",
  "provenance-mismatch",
  "archive-mismatch",
  "metadata-mismatch",
  "not-staged",
  "already-accepted",
  "already-finalized",
  "archive-collision",
  "persistence-failed",
  "apply-failed",
  "publish-failed",
  "undo-unavailable",
  "undo-stale",
  "undo-failed",
] as const;
export type StrategicFitChangeErrorCode = (typeof STRATEGIC_FIT_CHANGE_ERROR_CODES)[number];

export interface StrategicFitDocumentSnapshot {
  readonly document_id: string;
  readonly revision: number;
  readonly pgn: string;
  readonly metadata: StrategicFitDocumentMetadata;
  readonly navigation: readonly number[];
  readonly navigation_san_path: readonly string[];
  readonly color: "white" | "black";
  readonly file_name: string | null;
  readonly dirty: boolean;
}

export interface StrategicFitStoredArchive {
  readonly payload: ReplacementArchivePayload;
  readonly archived_by_stage_id: string;
  readonly status: "archived";
}

interface StrategicFitUndoSnapshot {
  readonly pgn: string;
  readonly metadata: StrategicFitDocumentMetadata;
  readonly navigation: readonly number[];
  readonly archives: readonly StrategicFitStoredArchive[];
}

export interface StrategicFitUndoRecord {
  readonly undo_id: string;
  readonly stage_id: string;
  readonly document_id: string;
  readonly base_revision: number;
  readonly accepted_revision: number;
  readonly status: StrategicFitUndoStatus;
  readonly stage: StrategicFitStagedChange;
  readonly before: StrategicFitUndoSnapshot;
  readonly after: StrategicFitUndoSnapshot;
}

export interface StrategicFitPersistedChangeState {
  readonly storage_version: typeof STRATEGIC_FIT_CHANGE_STORAGE_VERSION;
  readonly document_id: string;
  readonly archives: readonly StrategicFitStoredArchive[];
  readonly undo: readonly StrategicFitUndoRecord[];
  /** Inert two-phase payload; canonical state remains the outer archive/undo snapshot until finalize. */
  readonly recovery: StrategicFitPreparedRecovery | null;
}

export interface StrategicFitPreparedRecovery {
  readonly operation: "accept" | "undo";
  readonly stage_id: string;
  readonly prepared_at: string;
  readonly after: {
    readonly archives: readonly StrategicFitStoredArchive[];
    readonly undo: readonly StrategicFitUndoRecord[];
    readonly working: SavedWorkingRepertoire;
    readonly metadata: StrategicFitDocumentMetadata;
  };
}

export interface StrategicFitStagedChange {
  readonly stage_id: string;
  readonly status: StrategicFitStagedChangeStatus;
  readonly result_status: StrategicFitChangeResultStatus;
  readonly document_id: string;
  readonly base_revision: number;
  readonly base_repertoire_revision: string;
  readonly tree_identity: string;
  readonly metadata_identity: string;
  readonly safety_identity: string;
  readonly change_set_identity: string;
  readonly preview_identity: string;
  readonly archive_identity: string;
  readonly provenance_identity: string;
  readonly safety: ReplacementSafetySimulationResult;
  readonly change_set: ReplacementChangeSet;
  readonly preview: ReplacementChangeSetPreviewSuccess;
  readonly navigation_san_path: readonly string[];
  readonly created_at: string;
  readonly accepted_revision: number | null;
  readonly error_code: StrategicFitChangeErrorCode | null;
}

export type StrategicFitChangeOperationResult =
  | { readonly ok: true; readonly stage: StrategicFitStagedChange }
  | { readonly ok: false; readonly error: StrategicFitChangeErrorCode; readonly stage: StrategicFitStagedChange | null };

export interface StrategicFitChangeStorageCommit {
  readonly state: StrategicFitPersistedChangeState;
  readonly working: SavedWorkingRepertoire;
  readonly metadata: StrategicFitDocumentMetadata;
}

export interface StrategicFitChangeStorage {
  load(documentId: string): Promise<StrategicFitPersistedChangeState | undefined>;
  commit(value: StrategicFitChangeStorageCommit): Promise<void>;
}

export interface StrategicFitChangeControllerDependencies {
  readonly storage: StrategicFitChangeStorage;
  readonly current: () => StrategicFitDocumentSnapshot;
  readonly publish: (
    tree: GameTree,
    metadata: StrategicFitDocumentMetadata,
    navigation: readonly number[],
    expectedRevision: number,
  ) => { readonly ok: true; readonly revision: number } | { readonly ok: false; readonly error: string };
  /** Synchronous, non-failing restoration used only if final durable commit fails after publication. */
  readonly rollback: (snapshot: StrategicFitDocumentSnapshot) => void;
  readonly beforePersist?: (documentId: string) => Promise<void>;
  readonly afterPersist?: () => Promise<void> | void;
  readonly now?: () => string;
  readonly undoLimit?: number;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function identity(value: unknown): string {
  return stableHash(stableJson(value));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function emptyState(documentIdValue: string): StrategicFitPersistedChangeState {
  return {
    storage_version: STRATEGIC_FIT_CHANGE_STORAGE_VERSION,
    document_id: documentIdValue,
    archives: [],
    undo: [],
    recovery: null,
  };
}

function validState(value: StrategicFitPersistedChangeState | undefined, documentIdValue: string): StrategicFitPersistedChangeState {
  if (!value) return emptyState(documentIdValue);
  const archivesValid = Array.isArray(value.archives) && value.archives.every((entry) =>
    entry?.status === "archived" && typeof entry.archived_by_stage_id === "string" &&
    typeof entry.payload?.archive_id === "string" && typeof entry.payload?.operation_id === "string" &&
    typeof entry.payload?.pgn === "string" && entry.payload.analysis_version === STRATEGIC_FIT_ANALYSIS_VERSION &&
    Array.isArray(entry.payload.provenance));
  const undoValid = Array.isArray(value.undo) && value.undo.every((entry) =>
    entry?.document_id === documentIdValue && typeof entry.undo_id === "string" && typeof entry.stage_id === "string" &&
    entry.stage?.stage_id === entry.stage_id && entry.stage?.document_id === documentIdValue &&
    STRATEGIC_FIT_UNDO_STATUSES.includes(entry.status) &&
    typeof entry.before?.pgn === "string" && typeof entry.after?.pgn === "string" &&
    entry.before?.metadata?.metadata_version === STRATEGIC_FIT_DOCUMENT_METADATA_VERSION &&
    entry.after?.metadata?.metadata_version === STRATEGIC_FIT_DOCUMENT_METADATA_VERSION &&
    Array.isArray(entry.before.navigation) && Array.isArray(entry.after.navigation) &&
    Array.isArray(entry.before.archives) && Array.isArray(entry.after.archives));
  const recoveryValid = value.recovery == null || (
    ["accept", "undo"].includes(value.recovery.operation) && typeof value.recovery.stage_id === "string" &&
    typeof value.recovery.prepared_at === "string" && Array.isArray(value.recovery.after?.archives) &&
    Array.isArray(value.recovery.after?.undo) && typeof value.recovery.after?.working?.pgn === "string" &&
    value.recovery.after?.metadata?.metadata_version === STRATEGIC_FIT_DOCUMENT_METADATA_VERSION
  );
  if (value.storage_version !== STRATEGIC_FIT_CHANGE_STORAGE_VERSION || value.document_id !== documentIdValue ||
    !archivesValid || !undoValid || !recoveryValid) throw new Error("archive-mismatch");
  return { ...clone(value), recovery: null };
}

function repertoireRevision(revision: number): string {
  return `browser:${revision}`;
}

function currentPathFor(tree: GameTree, sanPath: readonly string[]): Path {
  for (let length = sanPath.length; length >= 0; length--) {
    const found = tree.indexPathOfSan(sanPath.slice(0, length));
    if (found) return found;
  }
  return [];
}

function stageProvenance(stage: StrategicFitStagedChange): readonly StrategicFitSourceProvenance[] {
  return stage.preview.provenance;
}

function metadataWithAcceptance(
  metadata: StrategicFitDocumentMetadata,
  stage: StrategicFitStagedChange,
  acceptedRevision: number,
): StrategicFitDocumentMetadata {
  const timestamp = stage.created_at;
  const additions = stage.preview.result.preview.archive_payloads.map((payload) => ({
    archive_id: payload.archive_id,
    repertoire_revision: repertoireRevision(acceptedRevision),
    references: clone(payload.references),
    linked_staged_edit_id: stage.stage_id,
    created_at: timestamp,
    provenance: clone(payload.provenance),
  }));
  const archiveById = new Map(metadata.archive_references.map((entry) => [entry.archive_id, clone(entry)]));
  for (const addition of additions) archiveById.set(addition.archive_id, addition);
  return {
    ...clone(metadata),
    metadata_version: STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
    resolutions: metadata.resolutions.map((resolution) =>
      resolution.semantic_finding_id === stage.safety.semantic_finding_id
        ? {
            ...clone(resolution),
            linked_staged_edit_ids: [...new Set([...resolution.linked_staged_edit_ids, stage.stage_id])].sort(),
            updated_at: timestamp,
          }
        : clone(resolution)),
    archive_references: [...archiveById.values()].sort((left, right) => left.archive_id.localeCompare(right.archive_id)),
  };
}

function withStage(
  stage: StrategicFitStagedChange,
  status: StrategicFitStagedChangeStatus,
  resultStatus: StrategicFitChangeResultStatus,
  errorCode: StrategicFitChangeErrorCode | null,
  acceptedRevision = stage.accepted_revision,
): StrategicFitStagedChange {
  return { ...stage, status, result_status: resultStatus, error_code: errorCode, accepted_revision: acceptedRevision };
}

function snapshotMatches(current: StrategicFitDocumentSnapshot, stage: StrategicFitStagedChange): StrategicFitChangeErrorCode | null {
  if (current.document_id !== stage.document_id) return "stale-document";
  if (current.revision !== stage.base_revision || repertoireRevision(current.revision) !== stage.base_repertoire_revision) return "stale-revision";
  if (current.color !== stage.safety.repertoire_color) return "identity-mismatch";
  if (identity(current.pgn) !== stage.tree_identity) return "stale-tree";
  if (identity(current.metadata) !== stage.metadata_identity) return "stale-metadata";
  if (identity(stage.safety) !== stage.safety_identity || identity(stage.change_set) !== stage.change_set_identity) return "stale-change-set";
  if (identity(stage.preview) !== stage.preview_identity) return "stale-result";
  if (identity(stage.preview.result.preview.archive_payloads) !== stage.archive_identity) return "archive-mismatch";
  if (identity(stageProvenance(stage)) !== stage.provenance_identity) return "provenance-mismatch";
  if (stage.change_set.change_set_id !== stage.preview.change_set_id || stage.change_set.base_repertoire_revision !== stage.base_repertoire_revision) return "identity-mismatch";
  if (stage.change_set.replacement_schema_version !== STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION ||
    stage.change_set.schema_version !== STRATEGIC_FIT_SCHEMA_VERSION ||
    stage.change_set.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    current.metadata.metadata_version !== STRATEGIC_FIT_DOCUMENT_METADATA_VERSION) return "version-mismatch";
  return null;
}

function working(
  snapshot: StrategicFitDocumentSnapshot,
  pgn: string,
  navigation: readonly number[],
  revision: number,
): SavedWorkingRepertoire {
  return {
    pgn,
    color: snapshot.color,
    path: [...navigation],
    fileName: snapshot.file_name,
    dirty: true,
    documentId: snapshot.document_id,
    revision,
  };
}

export function createStrategicFitChangeController(dependencies: StrategicFitChangeControllerDependencies) {
  const stages = new Map<string, StrategicFitStagedChange>();
  const states = new Map<string, StrategicFitPersistedChangeState>();
  const loads = new Map<string, Promise<StrategicFitPersistedChangeState>>();
  const now = dependencies.now ?? (() => new Date().toISOString());
  const undoLimit = Math.max(1, dependencies.undoLimit ?? STRATEGIC_FIT_CHANGE_UNDO_LIMIT);
  let mutationTail: Promise<void> = Promise.resolve();

  const exclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationTail.then(operation, operation);
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  };

  const stateFor = async (documentIdValue: string) => {
    const cached = states.get(documentIdValue);
    if (cached) return cached;
    let load = loads.get(documentIdValue);
    if (!load) {
      load = dependencies.storage.load(documentIdValue)
        .then((value) => validState(value, documentIdValue));
      loads.set(documentIdValue, load);
    }
    const state = await load;
    states.set(documentIdValue, state);
    return state;
  };

  const persist = async (
    snapshot: StrategicFitDocumentSnapshot,
    state: StrategicFitPersistedChangeState,
    pgn: string,
    metadata: StrategicFitDocumentMetadata,
    navigation: readonly number[],
    revision: number,
    flush = true,
  ) => {
    if (flush) await dependencies.beforePersist?.(snapshot.document_id);
    await dependencies.storage.commit({ state, working: working(snapshot, pgn, navigation, revision), metadata });
  };
  const finishPersistence = async () => { await dependencies.afterPersist?.(); };

  return {
    reload_policy: STRATEGIC_FIT_PENDING_RELOAD_POLICY,
    stages: () => [...stages.values()].map(clone),
    stage: (stageId: string) => {
      const value = stages.get(stageId);
      return value ? clone(value) : null;
    },
    async archives(): Promise<readonly StrategicFitStoredArchive[]> {
      try { return clone((await stateFor(dependencies.current().document_id)).archives); }
      catch { return []; }
    },
    async archivePayload(archiveId: string): Promise<ReplacementArchivePayload | null> {
      let state: StrategicFitPersistedChangeState;
      try { state = await stateFor(dependencies.current().document_id); } catch { return null; }
      const archive = state.archives.find((entry) => entry.payload.archive_id === archiveId);
      return archive ? clone(archive.payload) : null;
    },
    async stageChangeSet(input: {
      readonly safety: ReplacementSafetySimulationResult;
      readonly change_set: ReplacementChangeSet;
    }): Promise<StrategicFitChangeOperationResult> {
      const current = dependencies.current();
      if (!current.document_id) return { ok: false, error: "invalid-document", stage: null };
      if (current.color !== input.safety.repertoire_color) {
        return { ok: false, error: "identity-mismatch", stage: null };
      }
      try { await stateFor(current.document_id); }
      catch { return { ok: false, error: "archive-mismatch", stage: null }; }
      const applied = applyReplacementChangeSet({
        source_tree: currentTreeClone(current.pgn),
        current_repertoire_revision: repertoireRevision(current.revision),
        safety: input.safety,
        change_set: input.change_set,
      });
      if (applied.status !== "success") {
        const code: StrategicFitChangeErrorCode = applied.output.status === "stale" ? "stale-revision" : "apply-failed";
        return { ok: false, error: code, stage: null };
      }
      const stageId = `strategic-fit-stage:${stableHash([
        current.document_id,
        String(current.revision),
        input.change_set.change_set_id,
        identity(applied.output),
      ].join("\u001f"))}`;
      const duplicate = stages.get(stageId);
      if (duplicate && duplicate.status !== "rejected" && duplicate.status !== "stale" && duplicate.status !== "failed") {
        return { ok: true, stage: clone(duplicate) };
      }
      const stage: StrategicFitStagedChange = {
        stage_id: stageId,
        status: "staged",
        result_status: "previewed",
        document_id: current.document_id,
        base_revision: current.revision,
        base_repertoire_revision: repertoireRevision(current.revision),
        tree_identity: identity(current.pgn),
        metadata_identity: identity(current.metadata),
        safety_identity: identity(input.safety),
        change_set_identity: identity(input.change_set),
        preview_identity: identity(applied.output),
        archive_identity: identity(applied.output.result.preview.archive_payloads),
        provenance_identity: identity(applied.output.provenance),
        safety: clone(input.safety),
        change_set: clone(input.change_set),
        preview: clone(applied.output),
        navigation_san_path: clone(current.navigation_san_path),
        created_at: now(),
        accepted_revision: null,
        error_code: null,
      };
      stages.set(stageId, stage);
      return { ok: true, stage: clone(stage) };
    },
    reject(stageId: string): Promise<StrategicFitChangeOperationResult> {
      return exclusive(async () => {
      const stage = stages.get(stageId);
      if (!stage) return { ok: false, error: "not-staged", stage: null };
      if (stage.status !== "staged") return { ok: false, error: "already-finalized", stage: clone(stage) };
      const rejected = withStage(stage, "rejected", "rejected", null);
      stages.set(stageId, rejected);
      return { ok: true, stage: clone(rejected) };
      });
    },
    accept(stageId: string): Promise<StrategicFitChangeOperationResult> {
      return exclusive(async () => {
      const stage = stages.get(stageId);
      if (!stage) return { ok: false, error: "not-staged", stage: null };
      if (stage.status === "accepted") return { ok: false, error: "already-accepted", stage: clone(stage) };
      if (stage.status !== "staged") return { ok: false, error: "already-finalized", stage: clone(stage) };
      const current = dependencies.current();
      const mismatch = snapshotMatches(current, stage);
      if (mismatch) {
        const stale = withStage(stage, "stale", "stale", mismatch);
        stages.set(stageId, stale);
        return { ok: false, error: mismatch, stage: clone(stale) };
      }
      const applied = applyReplacementChangeSet({
        source_tree: currentTreeClone(current.pgn),
        current_repertoire_revision: stage.base_repertoire_revision,
        safety: stage.safety,
        change_set: stage.change_set,
      });
      if (applied.status !== "success" || identity(applied.output) !== stage.preview_identity) {
        const failed = withStage(stage, "failed", "failed", applied.status === "success" ? "stale-result" : "apply-failed");
        stages.set(stageId, failed);
        return { ok: false, error: failed.error_code!, stage: clone(failed) };
      }
      const priorState = clone(await stateFor(current.document_id));
      const acceptedRevision = current.revision + 1;
      const acceptedStage = withStage(stage, "accepted", "accepted", null, acceptedRevision);
      const metadata = metadataWithAcceptance(current.metadata, stage, acceptedRevision);
      const archiveById = new Map(priorState.archives.map((entry) => [entry.payload.archive_id, clone(entry)]));
      for (const payload of applied.output.result.preview.archive_payloads) {
        const existing = archiveById.get(payload.archive_id);
        if (existing && identity(existing.payload) !== identity(payload)) {
          const failed = withStage(stage, "failed", "failed", "archive-collision");
          stages.set(stageId, failed);
          return { ok: false, error: "archive-collision", stage: clone(failed) };
        }
        archiveById.set(payload.archive_id, { payload: clone(payload), archived_by_stage_id: stageId, status: "archived" });
      }
      const navigation = currentPathFor(applied.tree, stage.navigation_san_path);
      const archives = [...archiveById.values()].sort((left, right) => left.payload.archive_id.localeCompare(right.payload.archive_id));
      const undo: StrategicFitUndoRecord = {
        undo_id: `strategic-fit-undo:${stableHash(`${stageId}\u001f${acceptedRevision}`)}`,
        stage_id: stageId,
        document_id: current.document_id,
        base_revision: current.revision,
        accepted_revision: acceptedRevision,
        status: "available",
        stage: clone(acceptedStage),
        before: { pgn: current.pgn, metadata: clone(current.metadata), navigation: clone(current.navigation), archives: clone(priorState.archives) },
        after: { pgn: applied.output.result.pgn, metadata: clone(metadata), navigation: clone(navigation), archives: clone(archives) },
      };
      const nextState: StrategicFitPersistedChangeState = {
        ...priorState,
        archives,
        undo: [...priorState.undo, undo].slice(-undoLimit),
        recovery: null,
      };
      const preparedState: StrategicFitPersistedChangeState = {
        ...priorState,
        recovery: {
          operation: "accept",
          stage_id: stageId,
          prepared_at: now(),
          after: {
            archives: clone(nextState.archives),
            undo: clone(nextState.undo),
            working: working(current, applied.output.result.pgn, navigation, acceptedRevision),
            metadata: clone(metadata),
          },
        },
      };
      try {
        await persist(current, preparedState, current.pgn, current.metadata, current.navigation, current.revision);
      } catch {
        await finishPersistence();
        const failed = withStage(stage, "failed", "failed", "persistence-failed");
        stages.set(stageId, failed);
        return { ok: false, error: "persistence-failed", stage: clone(failed) };
      }
      const published = dependencies.publish(applied.tree, metadata, navigation, current.revision);
      if (!published.ok || published.revision !== acceptedRevision) {
        await finishPersistence();
        const failed = withStage(stage, "failed", "failed", "publish-failed");
        stages.set(stageId, failed);
        return { ok: false, error: "publish-failed", stage: clone(failed) };
      }
      try {
        await persist(current, nextState, applied.output.result.pgn, metadata, navigation, acceptedRevision, false);
      } catch {
        dependencies.rollback(current);
        await Promise.resolve();
        await finishPersistence();
        const failed = withStage(stage, "failed", "failed", "persistence-failed");
        stages.set(stageId, failed);
        return { ok: false, error: "persistence-failed", stage: clone(failed) };
      }
      await finishPersistence();
      states.set(current.document_id, nextState);
      stages.set(stageId, acceptedStage);
      return { ok: true, stage: clone(acceptedStage) };
      });
    },
    undo(undoId?: string): Promise<StrategicFitChangeOperationResult> {
      return exclusive(async () => {
      const current = dependencies.current();
      let priorState: StrategicFitPersistedChangeState;
      try { priorState = clone(await stateFor(current.document_id)); }
      catch { return { ok: false, error: "archive-mismatch", stage: null }; }
      const record = undoId
        ? priorState.undo.find((entry) => entry.undo_id === undoId)
        : [...priorState.undo].reverse().find((entry) => entry.status === "available");
      if (!record || record.status !== "available") return { ok: false, error: "undo-unavailable", stage: null };
      const stage = stages.get(record.stage_id) ?? clone(record.stage);
      stages.set(stage.stage_id, stage);
      const currentArchives = identity(priorState.archives);
      if (current.revision !== record.accepted_revision || current.pgn !== record.after.pgn ||
        identity(current.metadata) !== identity(record.after.metadata) || currentArchives !== identity(record.after.archives)) {
        const undo = priorState.undo.map((entry) => entry.undo_id === record.undo_id ? { ...entry, status: "stale" as const } : entry);
        states.set(current.document_id, { ...priorState, undo });
        stages.set(stage.stage_id, withStage(stage, "stale", "stale", "undo-stale"));
        return { ok: false, error: "undo-stale", stage: clone(stages.get(stage.stage_id)!) };
      }
      const nextRevision = current.revision + 1;
      const nextUndo = priorState.undo.map((entry) => {
        if (entry.undo_id === record.undo_id) return { ...entry, status: "undone" as const };
        const rebasesToRestoredSnapshot = entry.status === "available" &&
          entry.after.pgn === record.before.pgn &&
          identity(entry.after.metadata) === identity(record.before.metadata) &&
          identity(entry.after.archives) === identity(record.before.archives);
        return rebasesToRestoredSnapshot ? { ...entry, accepted_revision: nextRevision } : entry;
      });
      const nextState: StrategicFitPersistedChangeState = {
        ...priorState,
        archives: clone(record.before.archives),
        undo: nextUndo,
        recovery: null,
      };
      const tree = currentTreeClone(record.before.pgn);
      const preparedState: StrategicFitPersistedChangeState = {
        ...priorState,
        recovery: {
          operation: "undo",
          stage_id: stage.stage_id,
          prepared_at: now(),
          after: {
            archives: clone(nextState.archives),
            undo: clone(nextState.undo),
            working: working(current, record.before.pgn, record.before.navigation, nextRevision),
            metadata: clone(record.before.metadata),
          },
        },
      };
      try {
        await persist(current, preparedState, current.pgn, current.metadata, current.navigation, current.revision);
      } catch {
        await finishPersistence();
        stages.set(stage.stage_id, withStage(stage, "failed", "failed", "undo-failed"));
        return { ok: false, error: "undo-failed", stage: clone(stages.get(stage.stage_id)!) };
      }
      const published = dependencies.publish(tree, record.before.metadata, record.before.navigation, current.revision);
      if (!published.ok || published.revision !== nextRevision) {
        await finishPersistence();
        stages.set(stage.stage_id, withStage(stage, "failed", "failed", "publish-failed"));
        return { ok: false, error: "publish-failed", stage: clone(stages.get(stage.stage_id)!) };
      }
      try {
        await persist(current, nextState, record.before.pgn, record.before.metadata, record.before.navigation, nextRevision, false);
      } catch {
        dependencies.rollback(current);
        await Promise.resolve();
        await finishPersistence();
        stages.set(stage.stage_id, withStage(stage, "failed", "failed", "undo-failed"));
        return { ok: false, error: "undo-failed", stage: clone(stages.get(stage.stage_id)!) };
      }
      await finishPersistence();
      states.set(current.document_id, nextState);
      const undone = withStage(stage, "undone", "undone", null, nextRevision);
      stages.set(stage.stage_id, undone);
      return { ok: true, stage: clone(undone) };
      });
    },
  };
}

function currentTreeClone(pgn: string): GameTree {
  return GameTree.fromPgn(pgn);
}

function changeStorageKey(documentIdValue: string): string {
  return `${STRATEGIC_FIT_CHANGE_STORAGE_KEY_PREFIX}${documentIdValue}`;
}

export function createIndexedDbStrategicFitChangeStorage(): StrategicFitChangeStorage {
  return {
    load: (id) => idbGet<StrategicFitPersistedChangeState>(changeStorageKey(id)),
    commit: ({ state, working: saved, metadata }) => idbMutateAtomically([
      { key: changeStorageKey(state.document_id), value: clone(state) },
      { key: WORKING_REPERTOIRE_STORAGE_KEY, value: clone(saved) },
      { key: `${STRATEGIC_FIT_METADATA_STORAGE_KEY_PREFIX}${state.document_id}`, value: clone(metadata) },
    ]),
  };
}

function browserSnapshot(): StrategicFitDocumentSnapshot {
  const tree = currentTree();
  const navigation = currentPath();
  return {
    document_id: documentId(),
    revision: version(),
    pgn: tree.toPgn(),
    metadata: clone(strategicFitMetadata()),
    navigation: clone(navigation),
    navigation_san_path: tree.sanPathAt(navigation),
    color: color(),
    file_name: fileName(),
    dirty: dirty(),
  };
}

let releaseBrowserPersistence: (() => void) | null = null;
const browserController = createStrategicFitChangeController({
  storage: createIndexedDbStrategicFitChangeStorage(),
  current: browserSnapshot,
  beforePersist: async (id) => {
    const releaseWorking = await pauseWorkingRepertoireAutosave();
    try {
      const releaseMetadata = await pauseStrategicFitMetadataPersistence(id);
      releaseBrowserPersistence = () => {
        releaseMetadata();
        releaseWorking();
      };
    } catch (error) {
      releaseWorking();
      throw error;
    }
  },
  afterPersist: () => {
    const release = releaseBrowserPersistence;
    releaseBrowserPersistence = null;
    release?.();
  },
  publish: (tree, metadata, navigation, expectedRevision) => {
    let result: { ok: true; revision: number } | { ok: false; error: string } = { ok: false, error: "stale_revision" };
    batch(() => {
      result = browserDocumentMutationRegistry.strategic_fit_change_set.publish({
        tree,
        metadata,
        navigation: [...navigation],
        expected_revision: expectedRevision,
      }, (input) => actions.applyStrategicFitSnapshot(input.tree, input.navigation, input.expected_revision));
      if (result.ok) replaceStrategicFitMetadata(metadata);
    });
    return result;
  },
  rollback: (snapshot) => {
    const tree = currentTreeClone(snapshot.pgn);
    batch(() => {
      browserDocumentMutationRegistry.strategic_fit_change_set.rollback({
        tree,
        metadata: snapshot.metadata,
        navigation: [...snapshot.navigation],
        revision: snapshot.revision,
        dirty: snapshot.dirty,
      }, (input) => {
        actions.restoreStrategicFitSnapshot(input.tree, input.navigation, input.revision, input.dirty);
        replaceStrategicFitMetadata(input.metadata);
      });
    });
  },
});

const [browserStagesVersion, setBrowserStagesVersion] = createSignal(0);

export const strategicFitStagedChanges = () => {
  browserStagesVersion();
  return browserController.stages();
};

export async function stageStrategicFitChangeSet(input: {
  readonly safety: ReplacementSafetySimulationResult;
  readonly change_set: ReplacementChangeSet;
}) {
  const result = await browserController.stageChangeSet(input);
  setBrowserStagesVersion((value) => value + 1);
  return result;
}

export async function acceptStrategicFitChangeSet(stageId: string) {
  const result = await browserController.accept(stageId);
  setBrowserStagesVersion((value) => value + 1);
  return result;
}

export async function rejectStrategicFitChangeSet(stageId: string) {
  const result = await browserController.reject(stageId);
  setBrowserStagesVersion((value) => value + 1);
  return result;
}

export async function undoStrategicFitChange(undoId?: string) {
  const result = await browserController.undo(undoId);
  setBrowserStagesVersion((value) => value + 1);
  return result;
}

export const strategicFitArchivePayload = (archiveId: string) => browserController.archivePayload(archiveId);

export type StrategicFitChangeController = ReturnType<typeof createStrategicFitChangeController>;
export type StrategicFitChangeSetStageSuccess = ReplacementAtomicChangeSetSuccess;
