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
import {
  restoreSnapshotForHistory,
  version,
  path as gamePath,
  color,
  toPgn as gameToPgn,
} from "./game";
import { announce } from "./announce";
import { assertTestOnly } from "./test-seam";

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
  readonly deletedSubtreeInfo?: {
    firstMove: string;
    continuationCount: number;
  };
  /** False for a placeholder captured before the mutation ran; true once committed. */
  readonly committed?: boolean;
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
  const pgnBefore = gameToPgn();
  const pathBefore = [...gamePath()];
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
    // Enforce the byte budget by evicting oldest entries until under it. Sizes are computed once
    // per entry (never re-serialized per pass), then the head is trimmed in a single forward pass.
    const sizes = newStack.map((e) => JSON.stringify(e).length);
    let totalBytes = sizes.reduce((sum, n) => sum + n, 0);
    while (newStack.length > 1 && totalBytes > MAX_HISTORY_BYTES) {
      totalBytes -= sizes.shift() ?? 0;
      newStack.shift();
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
function commitAfterMutation(id: number, type: MutationType): void {
  const pgnAfter = gameToPgn();
  const pathAfter = [...gamePath()];
  const revisionAfter = version();
  const colorAfter = color();

  setUndoStack((stack) => {
    const idx = stack.findIndex((entry) => entry.id === id);
    if (idx === -1) return stack;
    const entry = stack[idx];
    if (!entry || entry.committed) return stack; // already committed (idempotent)
    const newStack = [...stack];
    newStack[idx] = {
      ...entry,
      pgnAfter,
      pathAfter,
      revisionAfter,
      colorAfter,
      type,
      committed: true,
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
  if (!entry?.committed) return; // never undo an uncommitted placeholder
  const pgnBefore = entry.pgnBefore;
  const pathBefore = entry.pathBefore;
  const revisionBefore = entry.revisionBefore;
  const colorBefore = entry.colorBefore;
  const type = entry.type;

  // The current state becomes the redo entry
  const pgnAfter = gameToPgn();
  const pathAfter = [...gamePath()];
  const revisionAfter = version();
  const colorAfter = color();

  // Restore through the history-only snapshot primitive: actions.loadPgn would rotate the
  // document identity and clearHistory() (WP-005 AC-5), destroying this very stack.
  restoreSnapshotForHistory(pgnBefore, pathBefore);

  // Move to redo stack. Every field keeps the entry's own orientation — `before` is the
  // pre-mutation state and `after` the post-mutation one — because redo() restores `pgnAfter`
  // with `pathAfter` and the two must describe the same position. Swapping only the path (and
  // revision and color) while leaving the PGN alone made redo restore the post-edit tree with the
  // pre-edit cursor. `committed` marks this a completed state change rather than a placeholder,
  // without which undo() refuses it and a second undo after a redo silently does nothing.
  setUndoStack((entries) => entries.slice(0, -1));
  setRedoStack((entries) => [
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
      committed: true,
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

  const pgnBefore = gameToPgn();
  const pathBefore = [...gamePath()];
  const revisionBefore = version();
  const colorBefore = color();

  restoreSnapshotForHistory(pgnAfter, pathAfter);

  // The undo entry this pushes describes a completed state change, so it carries `committed`.
  // Without it undo() treats the entry as an uncommitted placeholder and refuses to pop it,
  // which is what made undo a silent no-op once a redo had happened.
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
      committed: true,
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
 * Called by `actions.applyEdit` / etc. to record a mutation. Runs the mutation between capture
 * and commit and PROPAGATES its return value, so a rejected edit reports failure to the caller.
 * A failed mutation leaves no undo entry: the placeholder is removed instead of committed.
 */
export function recordMutation<R>(
  type: MutationType,
  mutationFn: () => R,
  deletedSubtreeInfo?: HistoryEntry["deletedSubtreeInfo"],
): R {
  const id = captureBeforeMutation(type, deletedSubtreeInfo);
  let result: R;
  try {
    result = mutationFn();
  } catch (error) {
    discardEntry(id);
    throw error;
  }
  // A mutation that reports failure (e.g. applyEdit returning { ok:false }) changed nothing:
  // drop the placeholder so undo cannot pop a phantom step.
  if (isFailedResult(result)) {
    discardEntry(id);
    return result;
  }
  commitAfterMutation(id, type);
  return result;
}

/** applyEdit's `{ ok: false }` shape — a failed result means no state change happened. */
function isFailedResult(result: unknown): boolean {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}

/** Remove an uncommitted placeholder entry (failed or thrown mutation). */
function discardEntry(id: number): void {
  setUndoStack((stack) => stack.filter((entry) => entry.id !== id));
}

/** Clear all history (newGame, loadPgn, restoreDocument). */
export function clearHistory(): void {
  setUndoStack([]);
  setRedoStack([]);
  nextId = 0;
}

/** Debug/test seam: get raw stacks. */
export function getStacksForTesting(): {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
} {
  assertTestOnly();
  return { undo: undoStack(), redo: redoStack() };
}
