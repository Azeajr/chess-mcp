/**
 * Autosave + restore of the in-memory working repertoire (the GameTree), so a page reload resumes
 * exactly where you left off — even with no file open and unsaved edits. Serialised to IndexedDB
 * (PGN + color + current path + filename + dirty flag), debounced. Independent of the FileHandle
 * persistence in store/files (which re-opens an on-disk file on demand).
 */
import { createSignal, createEffect, onCleanup } from "solid-js";
import { idbGet, idbSet } from "./idb";
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

function executePendingAutosave(): Promise<void> {
  if (autosavePauseDepth > 0) return autosaveTail;
  const saved = pendingAutosave;
  if (saved === null) return autosaveTail;
  pendingAutosave = null;
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  const next = autosaveTail
    .catch(() => undefined)
    .then(() => idbSet(WORKING_REPERTOIRE_STORAGE_KEY, saved));
  autosaveTail = next;
  return next;
}

/** Hold reactive working-document autosaves behind an explicit document transaction. */
export async function pauseWorkingRepertoireAutosave(): Promise<() => void> {
  autosavePauseDepth += 1;
  const saved = pendingAutosave;
  pendingAutosave = null;
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  await autosaveTail;
  if (saved !== null) {
    autosaveTail = autosaveTail.then(() => idbSet(WORKING_REPERTOIRE_STORAGE_KEY, saved));
    await autosaveTail;
  }
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

/** Flush the current pending working-document snapshot before a document-bound durable action. */
export async function flushWorkingRepertoire(): Promise<void> {
  while (pendingAutosave !== null) await executePendingAutosave();
  await autosaveTail;
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
    }
  } catch {
    /* corrupt/empty — start fresh */
  } finally {
    setReady(true);
  }
}
