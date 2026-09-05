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
  readonly committed?: boolean;
}

const MAX_HISTORY_BYTES = 2 * 1024 * 1024;

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

function captureBeforeMutation(
  type: MutationType,
  deletedSubtreeInfo?: HistoryEntry["deletedSubtreeInfo"],
): number {
  const pgnBefore = gameToPgn();
  const pathBefore = [...gamePath()];
  const revisionBefore = version();
  const colorBefore = color();
  const id = (nextId += 1);

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

function commitAfterMutation(id: number, type: MutationType): void {
  const pgnAfter = gameToPgn();
  const pathAfter = [...gamePath()];
  const revisionAfter = version();
  const colorAfter = color();

  setUndoStack((stack) => {
    const idx = stack.findIndex((entry) => entry.id === id);
    if (idx === -1) return stack;
    const entry = stack[idx];
    if (!entry || entry.committed) return stack;
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

export function undo(): void {
  const stack = undoStack();
  if (!stack.length) return;
  const entry = stack[stack.length - 1];
  if (!entry?.committed) return;
  const pgnBefore = entry.pgnBefore;
  const pathBefore = entry.pathBefore;
  const revisionBefore = entry.revisionBefore;
  const colorBefore = entry.colorBefore;
  const type = entry.type;

  const pgnAfter = gameToPgn();
  const pathAfter = [...gamePath()];
  const revisionAfter = version();
  const colorAfter = color();

  restoreSnapshotForHistory(pgnBefore, pathBefore);

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

  const message = mutationTypeMessage(type, "undone");
  announce(message);
}

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
  if (isFailedResult(result)) {
    discardEntry(id);
    return result;
  }
  commitAfterMutation(id, type);
  return result;
}

function isFailedResult(result: unknown): boolean {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}

function discardEntry(id: number): void {
  setUndoStack((stack) => stack.filter((entry) => entry.id !== id));
}

export function clearHistory(): void {
  setUndoStack([]);
  setRedoStack([]);
  nextId = 0;
}

export function getStacksForTesting(): {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
} {
  assertTestOnly();
  return { undo: undoStack(), redo: redoStack() };
}
