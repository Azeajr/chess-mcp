import { createEffect, createSignal } from "solid-js";
import {
  createDefaultStrategicFitDocumentMetadata,
  normalizeStrategicFitDocumentMetadata,
  type StrategicFitDocumentMetadata,
  type StrategicFitMetadataIssue,
  type StrategicFitMetadataNormalizationResult,
  type StrategicFitMetadataNormalizationState,
} from "@chess-mcp/chess-tools";
import { documentId } from "./game";
import { normalizeBrowserDocumentId } from "./document-identity";
import { idbDel, idbGet, idbSet } from "./idb";

export {
  STRATEGIC_FIT_DOCUMENT_METADATA_KIND,
  STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
  createDefaultStrategicFitDocumentMetadata,
  normalizeStrategicFitDocumentMetadata,
} from "@chess-mcp/chess-tools";
export type {
  StrategicFitArchiveReference,
  StrategicFitDocumentMetadata,
  StrategicFitManualWeights,
  StrategicFitMetadataIssue,
  StrategicFitMetadataNormalizationResult,
  StrategicFitTrainingReference,
} from "@chess-mcp/chess-tools";

export const STRATEGIC_FIT_METADATA_STORAGE_KEY_PREFIX = "strategicFitMetadata:";

export interface StrategicFitMetadataStorage {
  get(documentId: string): Promise<unknown>;
  set(documentId: string, metadata: StrategicFitDocumentMetadata): Promise<void>;
  delete(documentId: string): Promise<void>;
}

export type StrategicFitMetadataPersistenceStatus = "idle" | "loading" | "ready";
type StrategicFitMetadataWarningCode =
  | "invalid-metadata"
  | "unsupported-metadata"
  | "storage-read-failed"
  | "storage-write-failed";

export interface StrategicFitMetadataWarning {
  readonly code: StrategicFitMetadataWarningCode;
  readonly document_id: string;
  readonly message: string;
  readonly issues: readonly StrategicFitMetadataIssue[];
}

interface StrategicFitMetadataPersistenceSnapshot {
  readonly document_id: string | null;
  readonly status: StrategicFitMetadataPersistenceStatus;
  readonly metadata: StrategicFitDocumentMetadata;
  readonly normalization_state: StrategicFitMetadataNormalizationState | null;
  readonly issues: readonly StrategicFitMetadataIssue[];
  readonly warning: StrategicFitMetadataWarning | null;
}

export interface StrategicFitMetadataPersistenceController {
  snapshot(): StrategicFitMetadataPersistenceSnapshot;
  activateDocument(documentId: string): Promise<void>;
  replaceDocumentMetadata(
    documentId: string,
    input: unknown,
  ): StrategicFitMetadataNormalizationResult;
  deleteDocumentMetadata(documentId: string): Promise<void>;
  flush(documentId?: string): Promise<void>;
  pause(documentId: string): Promise<() => void>;
  dispose(): void;
}

interface PendingWrite {
  readonly documentId: string;
  readonly epoch: number;
  readonly metadata: StrategicFitDocumentMetadata;
  timer: ReturnType<typeof setTimeout> | null;
}

interface ControllerOptions {
  readonly storage: StrategicFitMetadataStorage;
  readonly debounceMs?: number;
  readonly onChange?: (snapshot: StrategicFitMetadataPersistenceSnapshot) => void;
}

function cloneMetadata(metadata: StrategicFitDocumentMetadata): StrategicFitDocumentMetadata {
  return normalizeStrategicFitDocumentMetadata(structuredClone(metadata)).metadata;
}

function fallbackWarning(
  id: string,
  result: StrategicFitMetadataNormalizationResult,
): StrategicFitMetadataWarning {
  const unsupported = result.issues.some((entry) => entry.code === "unsupported-version");
  return {
    code: unsupported ? "unsupported-metadata" : "invalid-metadata",
    document_id: id,
    message: "Strategic Fit settings could not be restored. Defaults were loaded.",
    issues: result.issues,
  };
}

function durableMetadata(
  result: StrategicFitMetadataNormalizationResult,
): StrategicFitDocumentMetadata {
  return result.state === "fallback"
    ? createDefaultStrategicFitDocumentMetadata()
    : result.metadata;
}

export function createStrategicFitMetadataPersistence(
  options: ControllerOptions,
): StrategicFitMetadataPersistenceController {
  const debounceMs = options.debounceMs ?? 400;
  let activation = 0;
  let activeLoad: Promise<void> = Promise.resolve();
  let disposed = false;
  let state: StrategicFitMetadataPersistenceSnapshot = {
    document_id: null,
    status: "idle",
    metadata: createDefaultStrategicFitDocumentMetadata(),
    normalization_state: null,
    issues: [],
    warning: null,
  };
  const keyEpochs = new Map<string, number>();
  const pendingWrites = new Map<string, PendingWrite>();
  const operationTails = new Map<string, Promise<void>>();
  const pausedDocuments = new Set<string>();

  const epochFor = (id: string) => keyEpochs.get(id) ?? 0;
  const publish = (next: StrategicFitMetadataPersistenceSnapshot) => {
    if (disposed) return;
    state = next;
    options.onChange?.(state);
  };
  const publishStorageWarning = (
    id: string,
    code: "storage-read-failed" | "storage-write-failed",
  ) => {
    if (state.document_id !== id) return;
    publish({
      ...state,
      status: "ready",
      warning: {
        code,
        document_id: id,
        message:
          code === "storage-read-failed"
            ? "Strategic Fit settings could not be read. Defaults were loaded."
            : "Strategic Fit settings could not be saved.",
        issues: state.issues,
      },
    });
  };

  const enqueue = (
    id: string,
    epoch: number,
    operation: () => Promise<void>,
    warnOnFailure: boolean,
  ): Promise<void> => {
    const previous = operationTails.get(id) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        if (disposed || epochFor(id) !== epoch) return;
        await operation();
      })
      .catch(() => {
        if (warnOnFailure && epochFor(id) === epoch)
          publishStorageWarning(id, "storage-write-failed");
      });
    operationTails.set(id, next);
    return next;
  };

  const executePending = (id: string): Promise<void> => {
    if (pausedDocuments.has(id)) return operationTails.get(id) ?? Promise.resolve();
    const pending = pendingWrites.get(id);
    if (!pending) return operationTails.get(id) ?? Promise.resolve();
    if (pending.timer !== null) clearTimeout(pending.timer);
    pendingWrites.delete(id);
    return enqueue(
      id,
      pending.epoch,
      () => options.storage.set(id, cloneMetadata(pending.metadata)),
      true,
    );
  };

  const scheduleWrite = (
    id: string,
    metadata: StrategicFitDocumentMetadata,
    epoch: number,
    delay = debounceMs,
  ) => {
    const existing = pendingWrites.get(id);
    if (existing && existing.timer !== null) clearTimeout(existing.timer);
    const pending: PendingWrite = {
      documentId: id,
      epoch,
      metadata: cloneMetadata(metadata),
      timer: null,
    };
    if (!pausedDocuments.has(id)) {
      pending.timer = setTimeout(
        () => {
          void executePending(id);
        },
        Math.max(0, delay),
      );
    }
    pendingWrites.set(id, pending);
  };

  const controller: StrategicFitMetadataPersistenceController = {
    snapshot: () => state,

    activateDocument(id: string): Promise<void> {
      if (disposed) return Promise.resolve();
      if (state.document_id === id && state.status !== "idle") return activeLoad;
      const token = ++activation;
      const epoch = epochFor(id);
      publish({
        document_id: id,
        status: "loading",
        metadata: createDefaultStrategicFitDocumentMetadata(),
        normalization_state: null,
        issues: [],
        warning: null,
      });
      activeLoad = (async () => {
        let raw: unknown;
        try {
          raw = await options.storage.get(id);
        } catch {
          if (token !== activation || state.document_id !== id || epochFor(id) !== epoch) return;
          publishStorageWarning(id, "storage-read-failed");
          return;
        }
        if (token !== activation || state.document_id !== id || epochFor(id) !== epoch) return;
        if (raw === undefined) {
          publish({ ...state, status: "ready" });
          return;
        }
        const result = normalizeStrategicFitDocumentMetadata(raw);
        const metadata = durableMetadata(result);
        publish({
          document_id: id,
          status: "ready",
          metadata,
          normalization_state: result.state,
          issues: result.issues,
          warning: result.state === "fallback" ? fallbackWarning(id, result) : null,
        });
        if (result.state !== "valid" || result.issues.length > 0) {
          scheduleWrite(id, metadata, epoch, 0);
        }
      })();
      return activeLoad;
    },

    replaceDocumentMetadata(id: string, input: unknown): StrategicFitMetadataNormalizationResult {
      if (disposed) return normalizeStrategicFitDocumentMetadata(input);
      if (state.document_id !== id) {
        void controller.activateDocument(id);
      }
      activation += 1;
      activeLoad = Promise.resolve();
      const result = normalizeStrategicFitDocumentMetadata(input);
      const metadata = durableMetadata(result);
      publish({
        document_id: id,
        status: "ready",
        metadata,
        normalization_state: result.state,
        issues: result.issues,
        warning: result.state === "fallback" ? fallbackWarning(id, result) : null,
      });
      scheduleWrite(id, metadata, epochFor(id));
      return result;
    },

    async deleteDocumentMetadata(id: string): Promise<void> {
      if (disposed) return;
      const pending = pendingWrites.get(id);
      if (pending && pending.timer !== null) clearTimeout(pending.timer);
      pendingWrites.delete(id);
      const nextEpoch = epochFor(id) + 1;
      keyEpochs.set(id, nextEpoch);
      if (state.document_id === id) {
        activation += 1;
        activeLoad = Promise.resolve();
        publish({
          document_id: id,
          status: "ready",
          metadata: createDefaultStrategicFitDocumentMetadata(),
          normalization_state: null,
          issues: [],
          warning: null,
        });
      }
      await enqueue(id, nextEpoch, () => options.storage.delete(id), true);
    },

    async flush(id?: string): Promise<void> {
      if (id !== undefined) {
        await executePending(id);
        await (operationTails.get(id) ?? Promise.resolve());
        return;
      }
      for (const pendingId of [...pendingWrites.keys()]) await executePending(pendingId);
      await Promise.all([...operationTails.values()]);
    },

    async pause(id: string): Promise<() => void> {
      pausedDocuments.add(id);
      const pending = pendingWrites.get(id);
      if (pending) {
        if (pending.timer !== null) clearTimeout(pending.timer);
        pendingWrites.delete(id);
        await enqueue(
          id,
          pending.epoch,
          () => options.storage.set(id, cloneMetadata(pending.metadata)),
          true,
        );
      }
      await (operationTails.get(id) ?? Promise.resolve());
      let released = false;
      return () => {
        if (released) return;
        released = true;
        pausedDocuments.delete(id);
        const latest = pendingWrites.get(id);
        if (latest) scheduleWrite(id, latest.metadata, latest.epoch);
      };
    },

    dispose(): void {
      disposed = true;
      activation += 1;
      for (const pending of pendingWrites.values()) {
        if (pending.timer !== null) clearTimeout(pending.timer);
      }
      pendingWrites.clear();
    },
  };

  return controller;
}

function storageKey(id: string): string {
  return `${STRATEGIC_FIT_METADATA_STORAGE_KEY_PREFIX}${id}`;
}

function createIndexedDbStrategicFitMetadataStorage(): StrategicFitMetadataStorage {
  return {
    get: (id) => idbGet(storageKey(id)),
    set: (id, metadata) => idbSet(storageKey(id), metadata),
    delete: (id) => idbDel(storageKey(id)),
  };
}

const [browserSnapshot, setBrowserSnapshot] = createSignal<StrategicFitMetadataPersistenceSnapshot>(
  {
    document_id: null,
    status: "idle",
    metadata: createDefaultStrategicFitDocumentMetadata(),
    normalization_state: null,
    issues: [],
    warning: null,
  },
);
const [workingRestoreSettled, setWorkingRestoreSettled] = createSignal(false);
const browserPersistence = createStrategicFitMetadataPersistence({
  storage: createIndexedDbStrategicFitMetadataStorage(),
  onChange: setBrowserSnapshot,
});
let persistenceEffectStarted = false;

export function startStrategicFitMetadataPersistence(): void {
  if (persistenceEffectStarted) return;
  persistenceEffectStarted = true;
  createEffect(() => {
    const ready = workingRestoreSettled();
    const id = documentId();
    if (ready) void browserPersistence.activateDocument(id);
  });
}

export async function restoreStrategicFitMetadata(): Promise<void> {
  setWorkingRestoreSettled(true);
  await browserPersistence.activateDocument(documentId());
}

export function strategicFitMetadata(): StrategicFitDocumentMetadata {
  const id = documentId();
  const snapshot = browserSnapshot();
  return snapshot.document_id === id
    ? snapshot.metadata
    : createDefaultStrategicFitDocumentMetadata();
}

export function strategicFitMetadataStatus(): StrategicFitMetadataPersistenceStatus {
  const id = documentId();
  const snapshot = browserSnapshot();
  return snapshot.document_id === id ? snapshot.status : "loading";
}

export function strategicFitMetadataIssues(): readonly StrategicFitMetadataIssue[] {
  const id = documentId();
  const snapshot = browserSnapshot();
  return snapshot.document_id === id ? snapshot.issues : [];
}

export function strategicFitMetadataWarning(): StrategicFitMetadataWarning | null {
  const id = documentId();
  const snapshot = browserSnapshot();
  return snapshot.document_id === id ? snapshot.warning : null;
}

export function replaceStrategicFitMetadata(
  input: unknown,
): StrategicFitMetadataNormalizationResult {
  return browserPersistence.replaceDocumentMetadata(documentId(), input);
}

export async function deleteStrategicFitMetadata(targetDocumentId: string): Promise<void> {
  const normalized = normalizeBrowserDocumentId(targetDocumentId);
  if (!normalized) throw new Error("Invalid Strategic Fit metadata document ID");
  await browserPersistence.deleteDocumentMetadata(normalized);
}

export function flushStrategicFitMetadata(targetDocumentId?: string): Promise<void> {
  return browserPersistence.flush(targetDocumentId);
}

export function pauseStrategicFitMetadataPersistence(
  targetDocumentId: string,
): Promise<() => void> {
  return browserPersistence.pause(targetDocumentId);
}
