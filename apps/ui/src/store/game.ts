/**
 * Single-window reactive game store. Wraps the mutable GameTree from chess-tools and
 * exposes SolidJS signals. GameTree mutates in place; a `version` signal is bumped after
 * each mutation so derived reads (fen, dests, move list) recompute.
 */
import { batch, createSignal } from "solid-js";
import { GameTree, type Path } from "@chess-mcp/chess-tools";
import { isChildNode } from "chessops/pgn";
import {
  createBrowserDocumentId,
  normalizeBrowserDocumentId,
  type BrowserDocumentId,
} from "./document-identity";
import { recordMutation, clearHistory } from "./history";

export type Color = "white" | "black";

const [tree, setTree] = createSignal<GameTree>(new GameTree());
const [version, setVersion] = createSignal(0);
const [path, setPath] = createSignal<Path>([]);
const [color, setColor] = createSignal<Color>("white");
const [dirty, setDirty] = createSignal(false);
const [changesSinceExport, setChangesSinceExport] = createSignal(0);
const [fileName, setFileName] = createSignal<string | null>(null);
const [documentId, setDocumentId] = createSignal<BrowserDocumentId>(createBrowserDocumentId());

const bump = () => setVersion((v) => v + 1);

/** Record a repertoire mutation without counting navigation-only revision changes as exports. */
function recordDocumentChange() {
  setDirty(true);
  setChangesSinceExport((count) => count + 1);
  bump();
}

/**
 * WP-005: describe what a prune would remove, for the delete confirmation and the undo toast.
 * Returns undefined unless the target actually owns alternatives worth warning about.
 */
function describePrunedBranch(
  sanPath: readonly string[],
): { firstMove: string; continuationCount: number } | undefined {
  const indexPath = tree().indexPathOfSan(sanPath);
  if (!indexPath) return undefined;
  // nodeAt returns the root for [], and the root carries no move data — only a ChildNode does.
  const node = tree().nodeAt(indexPath);
  if (!isChildNode(node)) return undefined;
  if (node.children.length <= 1) return undefined;
  return { firstMove: node.data.san, continuationCount: node.children.length };
}

/** Current FEN — depends on version + path. */
export const fen = () => {
  version();
  return tree().fenAt(path());
};

/** Legal-move destinations for chessground. */
export const dests = () => {
  version();
  return tree().destsAt(path());
};

/** Side to move at the current node, from the FEN. */
export const turnColor = (): Color => (fen().split(" ")[1] === "b" ? "black" : "white");

/** Last move as [orig, dest] for chessground highlight. */
export const lastMove = () => {
  version();
  return tree().lastMoveAt(path());
};

export { color, path, dirty, changesSinceExport, fileName, version, documentId };

/** Read-only handle to the tree for rendering the move list (read version() to subscribe). */
export const currentTree = () => {
  version();
  return tree();
};
export const currentPath = path;

function replaceDocument(
  nextTree: GameTree,
  name: string | undefined,
  nextDocumentId: BrowserDocumentId,
  restoredRevision?: number,
) {
  // Consumers derive FEN from both tree and path, so publish the replacement atomically. A shorter
  // imported tree must never be observed with the previous document's deeper navigation path.
  batch(() => {
    setTree(nextTree);
    setPath([]);
    setColor("white");
    setDirty(false);
    setChangesSinceExport(0);
    setFileName(name ?? null);
    setDocumentId(nextDocumentId);
    if (
      restoredRevision !== undefined &&
      Number.isSafeInteger(restoredRevision) &&
      restoredRevision >= 0
    ) {
      setVersion(restoredRevision);
    } else bump();
  });
}

/** Restore is the sole path allowed to resume an existing document identity. */
export function restoreDocument(
  pgn: string,
  name: string | undefined,
  savedDocumentId: unknown,
  savedRevision?: number,
) {
  const nextTree = GameTree.fromPgn(pgn);
  replaceDocument(
    nextTree,
    name,
    normalizeBrowserDocumentId(savedDocumentId) ?? createBrowserDocumentId(),
    savedRevision,
  );
}

export const actions = {
  loadPgn(pgn: string, name?: string) {
    // Parse before rotating identity: a failed explicit load leaves the current document intact.
    const nextTree = GameTree.fromPgn(pgn);
    replaceDocument(nextTree, name, createBrowserDocumentId());
    // WP-005 AC-5: undo never crosses a document boundary. The previous document's entries
    // describe a tree that no longer exists, so replacing the document discards them.
    clearHistory();
  },

  newGame() {
    replaceDocument(new GameTree(), undefined, createBrowserDocumentId());
    clearHistory();
  },

  play(orig: string, dest: string, promotion?: string) {
    const r = tree().playMove(path(), orig, dest, promotion);
    setPath(r.path);
    if (r.appended) recordDocumentChange();
    else bump();
  },

  goto(p: Path) {
    setPath(p);
  },

  /** Direct access to setPath for history undo/redo. */
  setPath(p: Path) {
    setPath(p);
  },

  /** Apply the canonical clone-on-write repertoire command. Chat and direct UI edits share this. */
  applyEdit(
    action: "prune" | "add" | "reorder",
    sanPath: readonly string[],
    opts: { addMoves?: string[]; promoteMove?: string } = {},
    expectedRevision?: number,
  ): { ok: true; revision: number } | { ok: false; error: string } {
    if (expectedRevision != null && expectedRevision !== version())
      return { ok: false, error: "stale_revision" };
    // WP-005: describe the branch before it is pruned — afterwards the nodes are gone. The
    // delete confirmation and the undo toast both read this record.
    const prunedBranch = action === "prune" ? describePrunedBranch(sanPath) : undefined;
    const applyEditToTree = () => {
      const result = tree().edit(action, sanPath, opts);
      if (!result.tree) return { ok: false, error: result.error ?? "invalid_edit" };
      setTree(result.tree);
      const destination =
        action === "add"
          ? result.tree.indexPathOfSan([
              ...(result.added?.from ?? sanPath),
              ...(result.added?.moves ?? []),
            ])
          : result.tree.indexPathOfSan(action === "prune" ? sanPath.slice(0, -1) : sanPath);
      if (destination) setPath(destination);
      recordDocumentChange();
      return { ok: true, revision: version() };
    };
    recordMutation(action === "prune" ? "deleteLine" : "play", applyEditToTree, prunedBranch);
    return { ok: true, revision: version() };
  },

  /** Publish one already-validated clone as exactly one document revision. */
  applyStrategicFitSnapshot(
    nextTree: GameTree,
    nextPath: Path,
    expectedRevision: number,
  ):
    | { ok: true; revision: number }
    | { ok: false; error: "stale_revision" | "invalid_navigation" } {
    if (expectedRevision !== version()) return { ok: false, error: "stale_revision" };
    try {
      nextTree.fenAt(nextPath);
    } catch {
      return { ok: false, error: "invalid_navigation" };
    }
    batch(() => {
      setTree(nextTree);
      setPath([...nextPath]);
      recordDocumentChange();
    });
    return { ok: true, revision: version() };
  },

  /** Roll back a failed prepared Strategic Fit transaction without allocating a visible revision. */
  restoreStrategicFitSnapshot(
    priorTree: GameTree,
    priorPath: Path,
    priorRevision: number,
    priorDirty: boolean,
  ): void {
    batch(() => {
      setTree(priorTree);
      setPath([...priorPath]);
      setDirty(priorDirty);
      setVersion(priorRevision);
    });
  },

  /** Append a line through the same application command used by accepted chat edits. */
  appendLine(from: Path, sans: string[]) {
    const sanPath = tree().sanPathAt(from);
    return this.applyEdit("add", sanPath, { addMoves: sans });
  },

  back() {
    const p = path();
    if (p.length) setPath(p.slice(0, -1));
  },

  /** Undo the current move: if at a leaf, remove that node and navigate to its parent. */
  undo() {
    const p = path();
    if (!p.length) return;
    const node = tree().nodeAt(p);
    if (node.children.length) {
      setPath(p.slice(0, -1)); // not a leaf — just step back rather than delete a subtree
      return;
    }
    const parent = tree().nodeAt(p.slice(0, -1));
    const childIndex = p.at(-1);
    if (childIndex === undefined) return;
    parent.children.splice(childIndex, 1);
    setPath(p.slice(0, -1));
    recordDocumentChange();
  },

  forward() {
    const p = path();
    const node = tree().nodeAt(p);
    if (node.children.length) setPath([...p, 0]);
  },

  setColor(c: Color) {
    setColor(c);
  },

  toPgn() {
    return tree().toPgn();
  },

  markSaved() {
    batch(() => {
      setDirty(false);
      setChangesSinceExport(0);
    });
  },

  markDirty(restoredChanges = 1) {
    setDirty(true);
    setChangesSinceExport((count) =>
      Math.max(
        count,
        Number.isSafeInteger(restoredChanges) && restoredChanges > 0 ? restoredChanges : 1,
      ),
    );
  },
};
