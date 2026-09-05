import { createSignal } from "solid-js";
import type { Node, PgnNodeData } from "chessops/pgn";
import { validateLine, type Path } from "@chess-mcp/chess-tools";
import { fen, currentPath, currentTree, actions, version } from "./game";
import type { Arrow } from "./analysis";
import { assertTestOnly } from "./test-seam";

interface Suggestion {
  id: string;
  fromPath: Path;
  sans: string[];
  comment?: string;
  firstUci?: string;
  sourceMessageIndex?: number;
}

interface PreviewLine {
  id: string;
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
export function setStagedEditsForTesting(edits: StagedEdit[]) {
  assertTestOnly();
  setStagedEdits(edits);
}

export function stageEdit(
  action: EditAction,
  path: string[],
  opts: { addMoves?: string[]; promoteMove?: string } = {},
):
  | {
      ok: true;
      action_id: string;
      kind: "staged_edit";
      action: EditAction;
      revision: number;
      path: string[];
      line?: string[];
      before: StagedEdit["before"];
      after: StagedEdit["after"];
    }
  | { ok: false; error: string } {
  const source = currentTree();
  const result = source.edit(action, path, opts);
  if (!result.tree) return { ok: false, error: result.error ?? "invalid_edit" };
  const beforeStats = source.stats();
  const afterStats = result.tree.stats();
  const before = {
    nodes: beforeStats.nodes,
    leaves: beforeStats.leaves,
    maxDepth: beforeStats.maxDepth,
  };
  const after = {
    nodes: afterStats.nodes,
    leaves: afterStats.leaves,
    maxDepth: afterStats.maxDepth,
  };
  const anchor = action === "add" ? (result.added?.from ?? path) : path;
  const previewPath =
    source.indexPathOfSan(action === "prune" ? path.slice(0, -1) : anchor) ?? undefined;
  let canonical = result.added?.moves ?? opts.addMoves;
  let firstUci: string | undefined;
  if (action === "add" && previewPath && canonical?.length) {
    const check = validateLine(source.fenAt(previewPath), canonical);
    if (check.ok) {
      canonical = check.canonical;
      firstUci = check.firstUci;
    }
  }
  const edit: StagedEdit = {
    id: `edit-${nextId++}`,
    kind: "repertoire_edit",
    action,
    revision: version(),
    path: [...path],
    addMoves: canonical,
    promoteMove: opts.promoteMove,
    before,
    after,
    status: "pending",
    previewPath,
    previewSans: action === "add" ? canonical : undefined,
    firstUci,
  };
  setStagedEdits((all) => [...all, edit]);
  return {
    ok: true,
    action_id: edit.id,
    kind: "staged_edit",
    action,
    revision: edit.revision,
    path: edit.path,
    ...(canonical ? { line: canonical } : {}),
    before,
    after,
  };
}

export function acceptStagedEdit(id: string) {
  const edit = stagedEdits().find((item) => item.id === id);
  if (edit?.status !== "pending") return { ok: false, error: "action_not_pending" };
  const result = actions.applyEdit(
    edit.action,
    edit.path,
    { addMoves: edit.addMoves, promoteMove: edit.promoteMove },
    edit.revision,
  );
  setStagedEdits((all) =>
    all.map((item) =>
      item.id === id
        ? {
            ...item,
            status: result.ok
              ? "accepted"
              : result.error === "stale_revision"
                ? "stale"
                : item.status,
          }
        : item,
    ),
  );
  if (preview()?.id === id) setPreview(null);
  return result;
}

export function rejectStagedEdit(id: string) {
  setStagedEdits((all) =>
    all.map((item) =>
      item.id === id && item.status === "pending" ? { ...item, status: "rejected" } : item,
    ),
  );
  if (preview()?.id === id) setPreview(null);
}

export const stagedEdit = (id: string) => stagedEdits().find((item) => item.id === id);

export function addSuggestion(sans: string[], comment?: string, sourceMessageIndex?: number) {
  const check = validateLine(fen(), sans);
  if (!check.ok) {
    return { ok: false, reason: `illegal move at index ${check.badIndex} in proposed line` };
  }
  const staged = stageEdit("add", currentTree().sanPathAt(currentPath()), {
    addMoves: check.canonical,
  });
  if (!staged.ok) return { ok: false, reason: staged.error };
  const s: Suggestion = {
    id: staged.action_id,
    fromPath: currentPath(),
    sans: check.canonical,
    comment,
    firstUci: check.firstUci,
    sourceMessageIndex,
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
  for (const suggestion of suggestions()) rejectStagedEdit(suggestion.id);
  setSuggestions([]);
}

const [preview, setPreview] = createSignal<PreviewLine | null>(null);
export { preview };

export function stagePreview(id: string) {
  if (preview()?.id === id) {
    setPreview(null);
    return;
  }
  const edit = stagedEdit(id);
  const s = suggestions().find((x) => x.id === id);
  if (edit?.previewPath && edit.previewSans)
    setPreview({ id, fromPath: edit.previewPath, sans: edit.previewSans, firstUci: edit.firstUci });
  else if (s) setPreview({ id: s.id, fromPath: s.fromPath, sans: s.sans, firstUci: s.firstUci });
}

export function clearPreview() {
  setPreview(null);
}

export function stagePreviewLine(fromPath: Path, sans: string[]) {
  const startFen = currentTree().fenAt(fromPath);
  const chk = validateLine(startFen, sans);
  if (!chk.ok) return { ok: false as const };
  setPreview({ id: `t${nextId++}`, fromPath, sans: chk.canonical, firstUci: chk.firstUci });
  return { ok: true as const };
}

export function acceptPreview() {
  const p = preview();
  if (!p) return;
  setPreview(null);
  const staged = stagedEdit(p.id);
  if (staged) acceptStagedEdit(p.id);
  else actions.appendLine(p.fromPath, p.sans);
  setSuggestions((prev) => prev.filter((x) => x.id !== p.id));
}

export const previewArrow = (): Arrow[] => {
  const p = preview();
  if (!p?.firstUci || !pathEq(p.fromPath, currentPath())) return [];
  return [
    {
      orig: p.firstUci.slice(0, 2),
      dest: p.firstUci.slice(2, 4),
      brush: "gold",
      modifiers: { lineWidth: 10 },
    },
  ];
};

export const previewedKeys = (): Set<string> => {
  const out = new Set<string>();
  const p = preview();
  if (!p) return out;
  const tree = currentTree();
  let node: Node<PgnNodeData>;
  try {
    node = tree.nodeAt(p.fromPath);
  } catch {
    return out;
  }
  let idx = [...p.fromPath];
  for (const san of p.sans) {
    const ci = node.children.findIndex((c) => c.data.san === san);
    if (ci < 0) break;
    idx = [...idx, ci];
    const child = node.children[ci];
    if (child === undefined) break;
    node = child;
    out.add(idx.join(","));
  }
  return out;
};

export const suggestionArrows = (): Arrow[] =>
  suggestions().flatMap((suggestion) => {
    const firstUci = suggestion.firstUci;
    if (!firstUci || !pathEq(suggestion.fromPath, currentPath())) return [];
    return [
      {
        orig: firstUci.slice(0, 2),
        dest: firstUci.slice(2, 4),
        brush: "blue" as const,
        modifiers: { lineWidth: 8 },
      },
    ];
  });
