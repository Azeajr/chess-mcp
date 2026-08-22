/**
 * WP-014 BoardCursor store — keyboard cursor state for the chessboard.
 *
 * Separated from Board.tsx to keep the keyboard layer pure and testable.
 */
import { createSignal, createEffect } from "solid-js";
import { actions, color, dests } from "./game";

const FILES = "abcdefgh";
const RANKS = "12345678";

/** Board coordinates are always produced from clamped 0..7 indices, so the lookup is total. */
function squareKey(file: number, rank: number): string {
  return `${FILES.charAt(file)}${RANKS.charAt(rank)}`;
}

export const [cursor, setCursor] = createSignal<{ file: number; rank: number } | null>(null);
export const [cursorState, setCursorState] = createSignal<"idle" | "selecting" | "moving">("idle");
export const [selectedSquare, setSelectedSquare] = createSignal<{
  file: number;
  rank: number;
} | null>(null);
export const [highlightedDests, setHighlightedDests] = createSignal<Set<string>>(new Set<string>());

// Reset cursor on position change
createEffect(() => {
  const col = color();
  setCursor({ file: 3, rank: col === "white" ? 0 : 7 }); // e-file, back rank
  setCursorState("idle");
  setSelectedSquare(null);
  setHighlightedDests(new Set<string>());
});

// Helper functions for keyboard actions
export function moveCursor(direction: "up" | "down" | "left" | "right"): void {
  const c = cursor();
  if (!c) return;

  let { file, rank } = c;
  switch (direction) {
    case "up":
      rank = Math.min(rank + 1, 7);
      break;
    case "down":
      rank = Math.max(rank - 1, 0);
      break;
    case "left":
      file = Math.max(file - 1, 0);
      break;
    case "right":
      file = Math.min(file + 1, 7);
      break;
  }
  setCursor({ file, rank });
}

export function selectPiece(): void {
  const c = cursor();
  if (!c) return;
  const sq = squareKey(c.file, c.rank);
  // Check if piece has legal moves
  const d = dests();
  const moves = d.get(sq);
  if (moves && moves.length > 0) {
    setSelectedSquare({ file: c.file, rank: c.rank });
    setHighlightedDests(new Set<string>(moves));
  }
}

export function confirmMove(): void {
  const sel = selectedSquare();
  const cur = cursor();
  if (!sel || !cur) return;

  const from = squareKey(sel.file, sel.rank);
  const to = squareKey(cur.file, cur.rank);

  const d = dests();
  const legalDests = new Set<string>(Array.from(d.values()).flat());

  if (legalDests.has(to)) {
    actions.play(from, to);
    setSelectedSquare(null);
    setHighlightedDests(new Set<string>());
  }
}

export function clearSelection(): void {
  setSelectedSquare(null);
  setHighlightedDests(new Set<string>());
}

export function resetCursor(): void {
  const col = color();
  setCursor({ file: 3, rank: col === "white" ? 0 : 7 });
  setCursorState("idle");
  setSelectedSquare(null);
  setHighlightedDests(new Set<string>());
}
