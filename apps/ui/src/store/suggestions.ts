/**
 * Chat-proposed lines. The model proposes a line (SAN) for the current position; it is validated
 * (never grafted illegal), shown as a blue board arrow + an entry in the AnalysisPanel, and
 * inserted into the GameTree only on explicit Accept. Arrows render only while the board is at
 * the position the line was proposed for.
 */
import { createSignal } from "solid-js";
import { validateLine, type Path } from "@chess-mcp/chess-tools";
import { fen, currentPath, actions } from "./game";
import type { Arrow } from "./analysis";

export interface Suggestion {
  id: string;
  fromPath: Path;
  sans: string[];
  comment?: string;
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
