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
  documentId,
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

const KEY = "workingRepertoire";

interface Saved {
  pgn: string;
  color: Color;
  path: number[];
  fileName: string | null;
  dirty: boolean;
  documentId?: unknown;
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
    const id = documentId();
    const t = setTimeout(() => {
      void idbSet(KEY, {
        pgn: tree.toPgn(),
        color: c,
        path: p,
        fileName: fn,
        dirty: d,
        documentId: id,
      } satisfies Saved);
    }, 400);
    onCleanup(() => clearTimeout(t));
  });
}

/** Load the last working repertoire (if any), then enable autosave. */
export async function restoreWorking() {
  try {
    const saved = await idbGet<Saved>(KEY);
    if (saved?.pgn) {
      restoreDocument(saved.pgn, saved.fileName ?? undefined, saved.documentId);
      actions.setColor(saved.color);
      actions.goto(probePath(saved.path));
      if (saved.dirty) actions.markDirty();
    }
  } catch {
    /* corrupt/empty — start fresh */
  } finally {
    setReady(true);
  }
}
