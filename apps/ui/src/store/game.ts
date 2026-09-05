import { batch, createSignal } from "solid-js";
import { GameTree, type Path } from "@chess-mcp/chess-tools";
import { isChildNode } from "chessops/pgn";
import {
  createBrowserDocumentId,
  normalizeBrowserDocumentId,
  type BrowserDocumentId,
} from "./document-identity";
import { recordMutation, clearHistory } from "./history";
import { setLastNavigationSource } from "./ui";

export type Color = "white" | "black";

const [tree, setTree] = createSignal<GameTree>(new GameTree());
const [version, setVersion] = createSignal(0);
const [path, setPathSignal] = createSignal<Path>([]);
const setPath = (value: Parameters<typeof setPathSignal>[0]) => {
  setLastNavigationSource(null);
  return setPathSignal(value);
};
const [color, setColor] = createSignal<Color>("white");
const [dirty, setDirty] = createSignal(false);
const [changesSinceExport, setChangesSinceExport] = createSignal(0);
const [fileName, setFileName] = createSignal<string | null>(null);
const [documentId, setDocumentId] = createSignal<BrowserDocumentId>(createBrowserDocumentId());

const bump = () => setVersion((v) => v + 1);

function recordDocumentChange() {
  setDirty(true);
  setChangesSinceExport((count) => count + 1);
  bump();
}

function describePrunedBranch(
  sanPath: readonly string[],
): { firstMove: string; continuationCount: number } | undefined {
  const indexPath = tree().indexPathOfSan(sanPath);
  if (!indexPath) return undefined;
  const node = tree().nodeAt(indexPath);
  if (!isChildNode(node)) return undefined;
  if (node.children.length <= 1) return undefined;
  return { firstMove: node.data.san, continuationCount: node.children.length };
}

export const fen = () => {
  version();
  return tree().fenAt(path());
};

export const dests = () => {
  version();
  return tree().destsAt(path());
};

export const turnColor = (): Color => (fen().split(" ")[1] === "b" ? "black" : "white");

export const lastMove = () => {
  version();
  return tree().lastMoveAt(path());
};

export { color, path, dirty, changesSinceExport, fileName, version, documentId };

export function restoreSnapshotForHistory(pgn: string, nextPath: Path): void {
  batch(() => {
    setTree(GameTree.fromPgn(pgn));
    setPath([...nextPath]);
    bump();
  });
}

export const toPgn = () => tree().toPgn();

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
    const nextTree = GameTree.fromPgn(pgn);
    replaceDocument(nextTree, name, createBrowserDocumentId());
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

  setPath(p: Path) {
    setPath(p);
  },

  applyEdit(
    action: "prune" | "add" | "reorder",
    sanPath: readonly string[],
    opts: { addMoves?: string[]; promoteMove?: string } = {},
    expectedRevision?: number,
  ): { ok: true; revision: number } | { ok: false; error: string } {
    if (expectedRevision != null && expectedRevision !== version())
      return { ok: false, error: "stale_revision" };
    const prunedBranch = action === "prune" ? describePrunedBranch(sanPath) : undefined;
    const applyEditToTree = (): { ok: true; revision: number } | { ok: false; error: string } => {
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
    return recordMutation(
      action === "prune" ? "deleteLine" : "play",
      applyEditToTree,
      prunedBranch,
    );
  },

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

  appendLine(from: Path, sans: string[]) {
    const sanPath = tree().sanPathAt(from);
    return this.applyEdit("add", sanPath, { addMoves: sans });
  },

  back() {
    const p = path();
    if (p.length) setPath(p.slice(0, -1));
  },

  undo() {
    const p = path();
    if (!p.length) return;
    const node = tree().nodeAt(p);
    if (node.children.length) {
      setPath(p.slice(0, -1));
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
