/**
 * Chat-proposed lines. The model proposes a line (SAN) for the current position; it is validated
 * (never grafted illegal), shown as a blue board arrow + an entry in the AnalysisPanel, and
 * inserted into the GameTree only on explicit Accept. Arrows render only while the board is at
 * the position the line was proposed for.
 */
import { createSignal } from "solid-js";
import type { Node, PgnNodeData } from "chessops/pgn";
import { validateLine, type Path } from "@chess-mcp/chess-tools";
import { fen, currentPath, currentTree, actions } from "./game";
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

const pathEq = (a: Path, b: Path) => a.length === b.length && a.every((v, i) => v === b[i]);

const [suggestions, setSuggestions] = createSignal<Suggestion[]>([]);
export { suggestions };

let nextId = 1;

/** Validate against the current position and stage a proposal. Returns a tool-result payload. */
export function addSuggestion(sans: string[], comment?: string) {
  const check = validateLine(fen(), sans);
  if (!check.ok) {
    return { ok: false, reason: `illegal move at index ${check.badIndex} in proposed line` };
  }
  const s: Suggestion = {
    id: String(nextId++),
    fromPath: currentPath(),
    sans: check.canonical,
    comment,
    firstUci: check.firstUci,
  };
  setSuggestions((prev) => [...prev, s]);
  return { ok: true, canonical: check.canonical, id: s.id };
}

export function acceptSuggestion(id: string) {
  const s = suggestions().find((x) => x.id === id);
  if (!s) return;
  actions.appendLine(s.fromPath, s.sans);
  setSuggestions((prev) => prev.filter((x) => x.id !== id));
}

export function rejectSuggestion(id: string) {
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
  const s = suggestions().find((x) => x.id === id);
  if (!s) return;
  setPreview({ id: s.id, fromPath: s.fromPath, sans: s.sans, firstUci: s.firstUci });
}

export function clearPreview() {
  setPreview(null);
}

/** Accept the active preview: graft it into the tree (resolving fromPath afresh) and clear. */
export function acceptPreview() {
  const p = preview();
  if (!p) return;
  setPreview(null);
  acceptSuggestion(p.id); // appendLine(fromPath, sans) + removes the suggestion
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
