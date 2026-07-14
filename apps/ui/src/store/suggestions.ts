/**
 * Chat-proposed lines. The model proposes a line (SAN) for the current position; it is validated
 * (never grafted illegal), shown as a blue board arrow + an entry in the AnalysisPanel, and
 * inserted into the GameTree only on explicit Accept. Arrows render only while the board is at
 * the position the line was proposed for.
 */
import { createSignal } from "solid-js";
import type { Node, PgnNodeData } from "chessops/pgn";
import { validateLine, type Path } from "@chess-mcp/chess-tools";
import { fen, currentPath, currentTree, actions, version } from "./game";
import type { Arrow } from "./analysis";

export interface Suggestion {
  id: string;
  fromPath: Path;
  sans: string[];
  comment?: string;
  firstUci?: string;
}

/**
 * Feature 1: a user-staged preview promoted from a chat suggestion. At most one is active. It
 * paints a gold arrow on the board + highlights the part of the line already in the tree, until
 * the user Accepts (grafts it) or Rejects (clears it).
 */
export interface PreviewLine {
  id: string; // == the Suggestion id it was promoted from
  fromPath: Path;
  sans: string[];
  firstUci?: string;
}

export type EditAction = "add" | "prune" | "reorder";
export interface StagedEdit {
  id: string;
  kind: "repertoire_edit";
  action: EditAction;
  revision: number;
  path: string[];
  addMoves?: string[];
  promoteMove?: string;
  before: { nodes: number; leaves: number; maxDepth: number };
  after: { nodes: number; leaves: number; maxDepth: number };
  status: "pending" | "accepted" | "rejected" | "stale";
  previewPath?: Path;
  previewSans?: string[];
  firstUci?: string;
}

const pathEq = (a: Path, b: Path) => a.length === b.length && a.every((v, i) => v === b[i]);

const [suggestions, setSuggestions] = createSignal<Suggestion[]>([]);
export { suggestions };

let nextId = 1;
const [stagedEdits, setStagedEdits] = createSignal<StagedEdit[]>([]);
export { stagedEdits };

/** Validate and retain a non-mutating edit preview. The full preview tree never enters chat. */
export function stageEdit(
  action: EditAction,
  path: string[],
  opts: { addMoves?: string[]; promoteMove?: string } = {},
): { ok: true; action_id: string; kind: "staged_edit"; action: EditAction; revision: number; path: string[]; line?: string[]; before: StagedEdit["before"]; after: StagedEdit["after"] } | { ok: false; error: string } {
  const source = currentTree();
  const result = source.edit(action, path, opts);
  if (!result.tree) return { ok: false, error: result.error ?? "invalid_edit" };
  const beforeStats = source.stats();
  const afterStats = result.tree.stats();
  const before = { nodes: beforeStats.nodes, leaves: beforeStats.leaves, maxDepth: beforeStats.maxDepth };
  const after = { nodes: afterStats.nodes, leaves: afterStats.leaves, maxDepth: afterStats.maxDepth };
  const anchor = action === "add" ? (result.added?.from ?? path) : path;
  const previewPath = source.indexPathOfSan(action === "prune" ? path.slice(0, -1) : anchor) ?? undefined;
  let canonical = result.added?.moves ?? opts.addMoves;
  let firstUci: string | undefined;
  if (action === "add" && previewPath && canonical?.length) {
    const check = validateLine(source.fenAt(previewPath), canonical);
    if (check.ok) { canonical = check.canonical; firstUci = check.firstUci; }
  }
  const edit: StagedEdit = {
    id: `edit-${nextId++}`, kind: "repertoire_edit", action, revision: version(), path: [...path],
    addMoves: canonical, promoteMove: opts.promoteMove, before, after, status: "pending",
    previewPath, previewSans: action === "add" ? canonical : undefined, firstUci,
  };
  setStagedEdits((all) => [...all, edit]);
  return { ok: true, action_id: edit.id, kind: "staged_edit", action, revision: edit.revision, path: edit.path, ...(canonical ? { line: canonical } : {}), before, after };
}

export function acceptStagedEdit(id: string) {
  const edit = stagedEdits().find((item) => item.id === id);
  if (!edit || edit.status !== "pending") return { ok: false, error: "action_not_pending" };
  const result = actions.applyEdit(edit.action, edit.path, { addMoves: edit.addMoves, promoteMove: edit.promoteMove }, edit.revision);
  setStagedEdits((all) => all.map((item) => item.id === id ? { ...item, status: result.ok ? "accepted" : result.error === "stale_revision" ? "stale" : item.status } : item));
  if (preview()?.id === id) setPreview(null);
  return result;
}

export function rejectStagedEdit(id: string) {
  setStagedEdits((all) => all.map((item) => item.id === id && item.status === "pending" ? { ...item, status: "rejected" } : item));
  if (preview()?.id === id) setPreview(null);
}

export const stagedEdit = (id: string) => stagedEdits().find((item) => item.id === id);

/** Validate against the current position and stage a proposal. Returns a tool-result payload. */
export function addSuggestion(sans: string[], comment?: string) {
  const check = validateLine(fen(), sans);
  if (!check.ok) {
    return { ok: false, reason: `illegal move at index ${check.badIndex} in proposed line` };
  }
  const staged = stageEdit("add", currentTree().sanPathAt(currentPath()), { addMoves: check.canonical });
  if (!staged.ok) return { ok: false, reason: staged.error };
  const s: Suggestion = {
    id: staged.action_id,
    fromPath: currentPath(),
    sans: check.canonical,
    comment,
    firstUci: check.firstUci,
  };
  setSuggestions((prev) => [...prev, s]);
  return { ...staged, canonical: check.canonical, id: s.id };
}

export function acceptSuggestion(id: string) {
  const s = suggestions().find((x) => x.id === id);
  if (!s) return;
  acceptStagedEdit(id);
  setSuggestions((prev) => prev.filter((x) => x.id !== id));
}

export function rejectSuggestion(id: string) {
  rejectStagedEdit(id);
  setSuggestions((prev) => prev.filter((x) => x.id !== id));
}

export function clearSuggestions() {
  setSuggestions([]);
}

// --- Feature 1: preview staging (one active at a time) ---

const [preview, setPreview] = createSignal<PreviewLine | null>(null);
export { preview };

/** Promote a staged suggestion to the active preview. Clicking the active one again clears it. */
export function stagePreview(id: string) {
  if (preview()?.id === id) {
    setPreview(null);
    return;
  }
  const edit = stagedEdit(id);
  const s = suggestions().find((x) => x.id === id);
  if (edit?.previewPath && edit.previewSans) setPreview({ id, fromPath: edit.previewPath, sans: edit.previewSans, firstUci: edit.firstUci });
  else if (s) setPreview({ id: s.id, fromPath: s.fromPath, sans: s.sans, firstUci: s.firstUci });
}

export function clearPreview() {
  setPreview(null);
}

/**
 * Stage a preview directly from a path + SAN line (no chat Suggestion needed). Used by the
 * repertoire panel's Tier B actions (extend / fix). Validates against the position at fromPath;
 * returns {ok:false} if the line is illegal there.
 */
export function stagePreviewLine(fromPath: Path, sans: string[]) {
  const startFen = currentTree().fenAt(fromPath);
  const chk = validateLine(startFen, sans);
  if (!chk.ok) return { ok: false as const };
  setPreview({ id: `t${nextId++}`, fromPath, sans: chk.canonical, firstUci: chk.firstUci });
  return { ok: true as const };
}

/** Accept the active preview: graft it into the tree and clear (also drops a matching suggestion). */
export function acceptPreview() {
  const p = preview();
  if (!p) return;
  setPreview(null);
  const staged = stagedEdit(p.id);
  if (staged) acceptStagedEdit(p.id);
  else actions.appendLine(p.fromPath, p.sans);
  setSuggestions((prev) => prev.filter((x) => x.id !== p.id));
}

/** Gold arrow for the active preview's first move, only while the board is at its fromPath. */
export const previewArrow = (): Arrow[] => {
  const p = preview();
  if (!p || !p.firstUci || !pathEq(p.fromPath, currentPath())) return [];
  return [
    {
      orig: p.firstUci.slice(0, 2),
      dest: p.firstUci.slice(2, 4),
      brush: "gold",
      modifiers: { lineWidth: 10 },
    },
  ];
};

/**
 * Index-path keys (joined) of the preview line's moves that already exist in the tree — the
 * shared prefix before the line diverges into new territory. MoveTree glows these. A brand-new
 * line shares no nodes, so the gold arrow is the only cue; that's expected.
 */
export const previewedKeys = (): Set<string> => {
  const out = new Set<string>();
  const p = preview();
  if (!p) return out;
  const tree = currentTree();
  let node: Node<PgnNodeData>;
  try {
    node = tree.nodeAt(p.fromPath);
  } catch {
    return out; // stale fromPath
  }
  let idx = [...p.fromPath];
  for (const san of p.sans) {
    const ci = node.children.findIndex((c) => c.data.san === san);
    if (ci < 0) break; // line diverges from the existing tree here
    idx = [...idx, ci];
    node = node.children[ci]!;
    out.add(idx.join(","));
  }
  return out;
};

/** Blue arrows for proposals at the current position (distinct from engine green/yellow/red). */
export const suggestionArrows = (): Arrow[] =>
  suggestions()
    .filter((s) => s.firstUci && pathEq(s.fromPath, currentPath()))
    .map((s) => ({
      orig: s.firstUci!.slice(0, 2),
      dest: s.firstUci!.slice(2, 4),
      brush: "blue",
      modifiers: { lineWidth: 8 },
    }));
