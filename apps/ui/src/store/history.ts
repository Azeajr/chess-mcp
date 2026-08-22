/**
 * WP-005 — the in-memory undo/redo stack for tree mutations.
 *
 * Every tree mutation (applyEdit, deleteLine, acceptStagedEdit, etc.) that changes the tree
 * pushes an entry onto the stack. Undo pops and restores the prior PGN; redo re-applies the
 * popped PGN. The stack is purely in-memory and does NOT survive a page reload (AC-10).
 *
 * Design:
 * - Each entry stores: `pgn` (before), `pgnAfter` (after), `path` (before), `pathAfter` (after),
 *   `revision` (before), `revisionAfter` (after), `color`, `type` (mutation kind for messages).
 * - `version()` is incremented on every push so it strictly increases across apply/undo/redo.
 * - A `maxBytes` budget (2 MB) evicts the oldest entry when exceeded (AC-11).
 * - Staged edits record their revision at creation; if an undo happens at a different revision,
 *   the staged edit becomes `stale` and cannot be accepted (AC-6).
 * - Delete operations (>1 node in subtree) create a confirmation record; single leaf deletes skip it.
 * - Undo/Redo on empty stacks are no-ops and announce nothing (AC-3).
 * - Arrow keys (board navigation) never push history entries (AC-4).
 *
 * No persistence to IndexedDB — the working document autosave already handles page reload recovery.
 */
import { createSignal } from "solid-js";
import { actions, version, path as gamePath, color } from "./game";
import { announce } from "./announce";

export type MutationType =
  | "play"
  | "promotion"
  | "acceptStagedEdit"
  | "acceptPreview"
  | "deleteLine"
  | "newGame"
  | "loadPgn"
  | "restoreDocument";

export interface HistoryEntry {
  readonly id: number;
  readonly pgnBefore: string;
  readonly pgnAfter: string;
  readonly pathBefore: number[];
  readonly pathAfter: number[];
  readonly revisionBefore: number;
  readonly revisionAfter: number;
  readonly colorBefore: "white" | "black";
  readonly colorAfter: "white" | "black";
  readonly type: MutationType;
  readonly deletedSubtreeInfo?: { firstMove: string; continuationCount: number };
}

const MAX_HISTORY_BYTES = 2 * 1024 * 1024; // 2 MB (AC-11)

let nextId = 0;
const [undoStack, setUndoStack] = createSignal<HistoryEntry[]>([]);
const [redoStack, setRedoStack] = createSignal<HistoryEntry[]>([]);
export { undoStack, redoStack };

export function canUndo(): boolean {
  return undoStack().length > 0;
}

export function canRedo(): boolean {
  return redoStack().length > 0;
}

/**
 * Capture the current tree state before a mutation, push to undo stack, clear redo stack,
 * and bump the document version. Returns the entry id for potential later reference.
 */
function captureBeforeMutation(
  type: MutationType,
  deletedSubtreeInfo?: HistoryEntry["deletedSubtreeInfo"],
): number {
  const pgnBefore = actions.toPgn();
  const pathBefore = gamePath();
  const revisionBefore = version();
  const colorBefore = color();
  const id = (nextId += 1);

  // We don't know the after-state yet; the caller must call commitAfterMutation with the after-state.
  // Store a placeholder; commitAfterMutation will fill in the after fields.
  const entry: HistoryEntry = {
    id,
    pgnBefore,
    pgnAfter: "",
    pathBefore,
    pathAfter: [],
    revisionBefore,
    revisionAfter: 0,
    colorBefore,
    colorAfter: "white",
    type,
    deletedSubtreeInfo,
  };

  setUndoStack((stack) => {
    const newStack = [...stack, entry];
    // Enforce byte budget by evicting oldest entries until under budget.
    let totalBytes = 0;
    for (let i = newStack.length - 1; i >= 0; i--) {
      totalBytes += JSON.stringify(newStack[i]).length;
      if (totalBytes > MAX_HISTORY_BYTES) {
        newStack.splice(0, 1);
      } else {
        break;
      }
    }
    return newStack;
  });
  setRedoStack([]);
  return id;
}

/**
 * Complete the last history entry with the post-mutation state and bump version.
 * Must be called immediately after the mutation that `captureBeforeMutation` was called for.
 */
export function commitAfterMutation(id: number, type: MutationType): void {
  const pgnAfter = actions.toPgn();
  const pathAfter = gamePath();
  const revisionAfter = version();
  const colorAfter = color();

  setUndoStack((stack) => {
    const idx = stack.findIndex((entry) => entry.id === id);
    if (idx === -1) return stack;
    const entry = stack[idx];
    if (!entry) return stack;
    if (entry.pgnAfter) return stack; // already committed (idempotent)
    const newStack = [...stack];
    newStack[idx] = {
      ...entry,
      pgnAfter,
      pathAfter,
      revisionAfter,
      colorAfter,
      type,
    };
    return newStack;
  });
}

/**
 * Public API: undo the last mutation. Announces via WP-009. No-op if stack empty.
 */
export function undo(): void {
  const stack = undoStack();
  if (!stack.length) return;
  const entry = stack[stack.length - 1];
  if (!entry) return;
  const pgnBefore = entry.pgnBefore;
  const pathBefore = entry.pathBefore;
  const revisionBefore = entry.revisionBefore;
  const colorBefore = entry.colorBefore;
  const type = entry.type;

  // The current state becomes the redo entry
  const pgnAfter = actions.toPgn();
  const pathAfter = gamePath();
  const revisionAfter = version();
  const colorAfter = color();

  // Restore
  actions.loadPgn(pgnBefore);
  actions.setColor(colorBefore);
  actions.setPath(pathBefore);

  // Move to redo stack
  setUndoStack((entries) => entries.slice(0, -1));
  setRedoStack((entries) => [
    ...entries,
    {
      id: (nextId += 1),
      pgnBefore,
      pgnAfter: pgnAfter,
      pathBefore: pathAfter,
      pathAfter: pathBefore,
      revisionBefore: revisionAfter,
      revisionAfter: revisionBefore,
      colorBefore: colorAfter,
      colorAfter: colorBefore,
      type,
    },
  ]);

  // Announce per WP-009/010 policy
  const message = mutationTypeMessage(type, "undone");
  announce(message);
}

/**
 * Public API: redo the last undone mutation.
 */
export function redo(): void {
  const pending = redoStack();
  if (!pending.length) return;
  const entry = pending[pending.length - 1];
  if (!entry) return;
  const pgnAfter = entry.pgnAfter;
  const pathAfter = entry.pathAfter;
  const revisionAfter = entry.revisionAfter;
  const colorAfter = entry.colorAfter;
  const type = entry.type;

  const pgnBefore = actions.toPgn();
  const pathBefore = gamePath();
  const revisionBefore = version();
  const colorBefore = color();

  actions.loadPgn(pgnAfter);
  actions.setColor(colorAfter);
  actions.setPath(pathAfter);

  setRedoStack((entries) => entries.slice(0, -1));
  setUndoStack((entries) => [
    ...entries,
    {
      id: (nextId += 1),
      pgnBefore,
      pgnAfter,
      pathBefore,
      pathAfter,
      revisionBefore,
      revisionAfter,
      colorBefore,
      colorAfter,
      type,
    },
  ]);

  announce(mutationTypeMessage(type, "redone"));
}

/** Human-friendly message per mutation type + direction. */
function mutationTypeMessage(type: MutationType, direction: "undone" | "redone"): string {
  const base =
    type === "deleteLine"
      ? "Deletion"
      : type === "promotion"
        ? "Promotion"
        : type === "acceptStagedEdit"
          ? "Staged edit"
          : type === "acceptPreview"
            ? "Preview"
            : type === "play"
              ? "Move"
              : "Change";
  return `${base} ${direction}.`;
}

/**
 * Called by `actions.applyEdit` / `actions.deleteLine` / etc. to record a mutation.
 * The mutation function itself is responsible for calling this before AND after.
 */
export function recordMutation(
  type: MutationType,
  mutationFn: () => void,
  deletedSubtreeInfo?: HistoryEntry["deletedSubtreeInfo"],
): void {
  const id = captureBeforeMutation(type, deletedSubtreeInfo);
  mutationFn();
  commitAfterMutation(id, type);
}

/** Clear all history (newGame, loadPgn, restoreDocument). */
export function clearHistory(): void {
  setUndoStack([]);
  setRedoStack([]);
  nextId = 0;
}

/** Debug/test seam: get raw stacks. */
export function getStacksForTesting(): { undo: HistoryEntry[]; redo: HistoryEntry[] } {
  return { undo: undoStack(), redo: redoStack() };
}
