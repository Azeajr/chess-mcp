/**
 * Autosave + restore of the in-memory working repertoire (the GameTree), so a page reload resumes
 * exactly where you left off — even with no file open and unsaved edits. Serialised to IndexedDB
 * (PGN + color + current path + filename + dirty flag), debounced. Independent of the FileHandle
 * persistence in store/files (which re-opens an on-disk file on demand).
 */
import { createSignal, createEffect, onCleanup } from "solid-js";
import { idbGet, idbSet, idbMutateAtomically } from "./idb";
import { GameTree } from "@chess-mcp/chess-tools";
import { announce } from "./announce";
import {
  currentTree,
  path,
  color,
  fileName,
  dirty,
  changesSinceExport,
  documentId,
  version,
  actions,
  restoreDocument,
  type Color,
} from "./game";

/** A saved path is only trusted if the restored tree can actually resolve it. */
function probePath(p: unknown): number[] {
  if (!Array.isArray(p) || !p.every((i) => typeof i === "number")) return [];
  try {
    currentTree().fenAt(p);
    return p;
  } catch {
    return [];
  }
}

export const WORKING_REPERTOIRE_STORAGE_KEY = "workingRepertoire";

export interface SavedWorkingRepertoire {
  pgn: string;
  color: Color;
  path: number[];
  fileName: string | null;
  dirty: boolean;
  changesSinceExport?: number;
  documentId?: unknown;
  /** Monotonic browser document revision; absent only in pre-Phase-8 autosaves. */
  revision?: number;
}

const AUTOSAVE_DEBOUNCE_MS = 400;
let pendingAutosave: SavedWorkingRepertoire | null = null;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let autosaveTail: Promise<void> = Promise.resolve();
let autosavePauseDepth = 0;

const IDLE_SNAPSHOT_MS = 10 * 60 * 1000;
export const SNAPSHOT_INDEX_KEY = "workingRepertoire.snapshotIndex";
const SNAPSHOT_KEY_PREFIX = "workingRepertoire.snapshot.";
const MAX_SNAPSHOTS = 5;
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

let snapshotTail: Promise<void> = Promise.resolve();
let lastSnapshotAt = 0;
let lastCapturedPgn: string | null = null;

export type SnapshotReason = "before-replace" | "idle" | "manual";

function isSnapshotReason(value: unknown): value is SnapshotReason {
  return value === "before-replace" || value === "idle" || value === "manual";
}

export interface SnapshotRecord {
  readonly id: string;
  readonly savedAt: number;
  readonly reason: SnapshotReason;
  readonly pgn: string;
  readonly fileName: string | null;
}

interface SnapshotIndexEntry {
  readonly id: string;
  readonly savedAt: number;
  readonly reason: SnapshotReason;
  readonly fileName: string | null;
  readonly byteSize: number;
  readonly moveCount: number;
  readonly lineCount: number;
}

export interface SnapshotListEntry extends SnapshotIndexEntry {
  readonly readable: boolean;
}

const [snapshotsUnavailable, setSnapshotsUnavailable] = createSignal(false);
const [recoverDialogOpen, setRecoverDialogOpen] = createSignal(false);
// WP-018 AC-4: epoch millis of the last successful working-copy write, or null before the first.
const [lastAutosaveAt, setLastAutosaveAt] = createSignal<number | null>(null);
export { snapshotsUnavailable, recoverDialogOpen, setRecoverDialogOpen, lastAutosaveAt };

function snapshotKey(id: string) {
  return `${SNAPSHOT_KEY_PREFIX}${id}`;
}

function payloadBytes(payload: SnapshotRecord) {
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
}

function isQuotaExceeded(error: unknown) {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * The index is user-writable storage: another build, a partial write, or a hand-edited record can
 * leave an entry whose fields are missing or non-numeric. Summing an undefined `byteSize` yields
 * NaN, and `NaN > MAX_SNAPSHOT_BYTES` is false — the byte budget would silently switch itself off
 * and the malformed row would sit in the Recover list forever. Coerce every field, and drop rows
 * with no id: without one there is neither a payload to read nor a row to act on.
 */
function normalizeSnapshotIndex(raw: unknown): SnapshotIndexEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: SnapshotIndexEntry[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const candidate = item as Record<string, unknown>;
    const id = candidate.id;
    if (typeof id !== "string" || id === "") continue;
    entries.push({
      id,
      savedAt: Math.max(0, finiteNumber(candidate.savedAt, 0)),
      reason: isSnapshotReason(candidate.reason) ? candidate.reason : "manual",
      fileName: typeof candidate.fileName === "string" ? candidate.fileName : null,
      byteSize: Math.max(0, finiteNumber(candidate.byteSize, 0)),
      moveCount: Math.max(0, finiteNumber(candidate.moveCount, 0)),
      lineCount: Math.max(0, finiteNumber(candidate.lineCount, 0)),
    });
  }
  return entries;
}

async function readSnapshotIndex(): Promise<SnapshotIndexEntry[]> {
  return normalizeSnapshotIndex(await idbGet<unknown>(SNAPSHOT_INDEX_KEY));
}

/**
 * Every snapshot mutation runs in one queue. Reading the index, deciding what to evict, and
 * writing the result is a read-modify-write: two of them in flight together lose one another's
 * changes, which for a delete racing a capture means either a resurrected snapshot or an orphaned
 * payload the index no longer names.
 */
function enqueueSnapshotWork<T>(work: () => Promise<T>): Promise<T> {
  const result = snapshotTail.then(work, work);
  snapshotTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function trimSnapshotIndex(entries: SnapshotIndexEntry[]) {
  const retained = [...entries].sort((a, b) => a.savedAt - b.savedAt);
  while (
    retained.length > MAX_SNAPSHOTS ||
    retained.reduce((total, entry) => total + entry.byteSize, 0) > MAX_SNAPSHOT_BYTES
  ) {
    retained.shift();
  }
  return retained;
}

async function writeSnapshot(
  payload: SnapshotRecord,
  entry: SnapshotIndexEntry,
  evictOneMore: boolean,
) {
  const previous = await readSnapshotIndex();
  let retained = trimSnapshotIndex([...previous, entry]);
  if (evictOneMore && retained.length > 1) retained = retained.slice(1);
  if (!retained.some((item) => item.id === payload.id)) {
    throw new DOMException("Snapshot exceeds the history budget", "QuotaExceededError");
  }
  const retainedIds = new Set(retained.map((item) => item.id));
  await idbMutateAtomically([
    ...previous
      .filter((item) => !retainedIds.has(item.id))
      .map((item) => ({ key: snapshotKey(item.id), delete: true as const })),
    { key: snapshotKey(payload.id), value: payload },
    { key: SNAPSHOT_INDEX_KEY, value: retained },
  ]);
}

/** Capture the current document without allowing snapshot failures to affect the live autosave. */
export async function captureSnapshot(reason: SnapshotReason): Promise<string | null> {
  if (autosavePauseDepth > 0) return null;
  const tree = currentTree();
  const pgn = tree.toPgn();
  const stats = tree.stats();
  if (stats.nodes === 0) return null;
  // The idle capture is a timer, not an intent. Without change detection it spends all five ring
  // slots on identical copies of an untouched document and evicts the before-replace snapshot —
  // the one taken at the only moment that loses data — within an hour.
  if (reason === "idle" && pgn === lastCapturedPgn) return null;
  const payload: SnapshotRecord = {
    id: crypto.randomUUID(),
    savedAt: (lastSnapshotAt = Math.max(Date.now(), lastSnapshotAt + 1)),
    reason,
    pgn,
    fileName: fileName(),
  };
  const entry: SnapshotIndexEntry = {
    id: payload.id,
    savedAt: payload.savedAt,
    reason,
    fileName: payload.fileName,
    byteSize: payloadBytes(payload),
    moveCount: stats.nodes,
    lineCount: stats.leaves,
  };
  const captured = await enqueueSnapshotWork(async () => {
    if (autosavePauseDepth > 0) return false;
    try {
      await writeSnapshot(payload, entry, false);
    } catch (error) {
      if (!isQuotaExceeded(error)) {
        setSnapshotsUnavailable(true);
        return false;
      }
      try {
        await writeSnapshot(payload, entry, true);
      } catch {
        setSnapshotsUnavailable(true);
        return false;
      }
    }
    setSnapshotsUnavailable(false);
    lastCapturedPgn = payload.pgn;
    const environment = Reflect.get(import.meta, "env") as { DEV?: boolean } | undefined;
    if (environment?.DEV) {
      // eslint-disable-next-line no-console -- package rollout diagnostic, DEV-only by contract
      console.debug("snapshot write", { reason, id: payload.id, bytes: entry.byteSize });
    }
    return true;
  });
  return captured ? payload.id : null;
}

export async function readSnapshot(id: string): Promise<SnapshotRecord | undefined> {
  return idbGet<SnapshotRecord>(snapshotKey(id));
}

export async function listSnapshots(): Promise<SnapshotListEntry[]> {
  return enqueueSnapshotWork(async () => {
    const index = await readSnapshotIndex();
    return Promise.all(
      [...index]
        .sort((a, b) => b.savedAt - a.savedAt)
        .map(async (entry) => {
          try {
            const payload = await readSnapshot(entry.id);
            if (!payload) throw new Error("missing snapshot");
            GameTree.fromPgn(payload.pgn);
            return { ...entry, readable: true };
          } catch {
            return { ...entry, readable: false };
          }
        }),
    );
  });
}

export async function deleteSnapshot(id: string): Promise<void> {
  await enqueueSnapshotWork(async () => {
    const index = await readSnapshotIndex();
    await idbMutateAtomically([
      { key: snapshotKey(id), delete: true },
      { key: SNAPSHOT_INDEX_KEY, value: index.filter((entry) => entry.id !== id) },
    ]);
  });
}

/** Restore a historical PGN as a new browser document after preserving the current one. */
export async function restoreSnapshot(id: string): Promise<boolean> {
  const snapshot = await readSnapshot(id);
  if (!snapshot) return false;
  GameTree.fromPgn(snapshot.pgn);
  await captureSnapshot("manual");
  restoreDocument(snapshot.pgn, snapshot.fileName ?? undefined, undefined);
  return true;
}

function scheduleAutosave(saved: SavedWorkingRepertoire): ReturnType<typeof setTimeout> | null {
  pendingAutosave = saved;
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  if (autosavePauseDepth > 0) {
    autosaveTimer = null;
    return null;
  }
  const timer = setTimeout(() => {
    void executePendingAutosave();
  }, AUTOSAVE_DEBOUNCE_MS);
  autosaveTimer = timer;
  return timer;
}

function enqueueAutosaveWrite(saved: SavedWorkingRepertoire): Promise<void> {
  const next = autosaveTail
    .catch(() => undefined)
    .then(() => idbSet(WORKING_REPERTOIRE_STORAGE_KEY, saved))
    // WP-018 AC-4: the browser indicator reports when the working copy was last written, so the
    // timestamp is recorded where the write actually lands rather than when one was scheduled.
    .then(() => {
      setLastAutosaveAt(Date.now());
    });
  autosaveTail = next;
  return next;
}

function executePendingAutosave(forceWhilePaused = false): Promise<void> {
  if (!forceWhilePaused && autosavePauseDepth > 0) return autosaveTail;
  const saved = pendingAutosave;
  if (saved === null) return autosaveTail;
  pendingAutosave = null;
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  return enqueueAutosaveWrite(saved);
}

/** Hold reactive working-document autosaves behind an explicit document transaction. */
export async function pauseWorkingRepertoireAutosave(): Promise<() => void> {
  autosavePauseDepth += 1;
  const saved = pendingAutosave;
  pendingAutosave = null;
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  await autosaveTail;
  if (saved !== null) await enqueueAutosaveWrite(saved);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    autosavePauseDepth = Math.max(0, autosavePauseDepth - 1);
    if (autosavePauseDepth === 0 && pendingAutosave !== null) scheduleAutosave(pendingAutosave);
  };
}

// Autosaving begins only after the restore attempt completes, so the initial empty tree never
// clobbers a saved repertoire.
const [ready, setReady] = createSignal(false);

/** Create the debounced autosave effect (call from a component body so it has a reactive owner). */
export function startAutosave() {
  const idleTimer = setInterval(() => {
    if (ready() && dirty()) void captureSnapshot("idle");
  }, IDLE_SNAPSHOT_MS);
  onCleanup(() => {
    clearInterval(idleTimer);
  });
  createEffect(() => {
    if (!ready()) return;
    const tree = currentTree();
    const c = color();
    const p = path();
    const fn = fileName();
    const d = dirty();
    const exportChanges = changesSinceExport();
    const id = documentId();
    const documentRevision = version();
    const timer = scheduleAutosave({
      pgn: tree.toPgn(),
      color: c,
      path: p,
      fileName: fn,
      dirty: d,
      changesSinceExport: exportChanges,
      documentId: id,
      revision: documentRevision,
    });
    onCleanup(() => {
      if (timer === null || autosaveTimer !== timer) return;
      clearTimeout(timer);
      autosaveTimer = null;
    });
  });
}

/**
 * Flush the latest pending working-document snapshot before a document-bound durable action.
 *
 * A reactive pause blocks debounce-driven writes so a multi-store transaction can publish
 * atomically, but an explicit flush is itself a durability boundary and must write through that
 * pause. Calling the pause-respecting executor here used to leave `pendingAutosave` untouched; the
 * while-loop then awaited an already-settled promise forever while its condition stayed true.
 */
export async function flushWorkingRepertoire(): Promise<void> {
  while (pendingAutosave !== null) await executePendingAutosave(true);
  await autosaveTail;
}

/**
 * Test seam for the state that caused F6: one pending reactive autosave while a transaction holds
 * the pause. Plain node:test cannot drive startAutosave()'s Solid browser effect, so the seam queues
 * the same payload through the production scheduler rather than duplicating its state changes.
 */
export function queueWorkingRepertoireAutosaveForTesting(saved: SavedWorkingRepertoire): void {
  const environment = Reflect.get(import.meta, "env") as { DEV?: boolean } | undefined;
  if (environment && environment.DEV !== true) throw new Error("Test-only function");
  scheduleAutosave(saved);
}

/** Load the last working repertoire (if any), then enable autosave. */
export async function restoreWorking() {
  try {
    const saved = await idbGet<SavedWorkingRepertoire>(WORKING_REPERTOIRE_STORAGE_KEY);
    if (saved?.pgn) {
      restoreDocument(saved.pgn, saved.fileName ?? undefined, saved.documentId, saved.revision);
      actions.setColor(saved.color);
      actions.goto(probePath(saved.path));
      if (saved.dirty) actions.markDirty(saved.changesSinceExport);
      announce(
        saved.fileName
          ? `Restored your working document ${saved.fileName} from autosave.`
          : "Restored your working document from autosave.",
      );
    }
  } catch {
    /* corrupt/empty — start fresh */
  } finally {
    setReady(true);
  }
}
