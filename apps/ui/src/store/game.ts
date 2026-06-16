/**
 * Single-window reactive game store. Wraps the mutable GameTree from chess-tools and
 * exposes SolidJS signals. GameTree mutates in place; a `version` signal is bumped after
 * each mutation so derived reads (fen, dests, move list) recompute.
 */
import { createSignal } from "solid-js";
import { GameTree, type Path } from "@chess-mcp/chess-tools";

export type Color = "white" | "black";

const [tree, setTree] = createSignal<GameTree>(new GameTree());
const [version, setVersion] = createSignal(0);
const [path, setPath] = createSignal<Path>([]);
const [color, setColor] = createSignal<Color>("white");
const [dirty, setDirty] = createSignal(false);
const [fileName, setFileName] = createSignal<string | null>(null);

const bump = () => setVersion((v) => v + 1);

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

export { color, path, dirty, fileName };

/** Read-only handle to the tree for rendering the move list (read version() to subscribe). */
export const currentTree = () => {
  version();
  return tree();
};
export const currentPath = path;

export const actions = {
  loadPgn(pgn: string, name?: string) {
    setTree(GameTree.fromPgn(pgn));
    setPath([]);
    setColor("white");
    setDirty(false);
    setFileName(name ?? null);
    bump();
  },

  newGame() {
    setTree(new GameTree());
    setPath([]);
    setDirty(false);
    setFileName(null);
    bump();
  },

  play(orig: string, dest: string, promotion?: string) {
    const r = tree().playMove(path(), orig, dest, promotion);
    setPath(r.path);
    if (r.appended) setDirty(true);
    bump();
  },

  goto(p: Path) {
    setPath(p);
  },

  /** Append a sequence of canonical SANs from `from`, navigate to the end, mark dirty. */
  appendLine(from: Path, sans: string[]) {
    let p = from;
    let created = false;
    for (const san of sans) {
      const r = tree().appendSan(p, san);
      created = created || r.appended;
      p = r.path;
    }
    setPath(p);
    if (created) setDirty(true);
    bump();
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
    parent.children.splice(p[p.length - 1]!, 1);
    setPath(p.slice(0, -1));
    setDirty(true);
    bump();
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
    setDirty(false);
  },
};
