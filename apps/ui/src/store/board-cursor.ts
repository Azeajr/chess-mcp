/**
 * WP-014 BoardCursor store — keyboard cursor state for the chessboard (DV-1, two-step model).
 *
 * Real DOM focus on a gridcell is the source of truth for "where is the cursor" — this store only
 * derives the *default* square (where focus should land next) and holds the transient
 * select/confirm state. `BoardKeyboardLayer` is the only reader of the cursor-movement functions;
 * it drives real `.focus()` calls on real gridcells (mirroring MoveTree's roving-tabindex pattern),
 * so a screen reader's native focus tracking announces each square automatically — no per-move
 * announce() call, per WP-009's flood policy.
 *
 * Dispatch mirrors Board.tsx's own pointer path exactly (`isPromotion` → `setPendingPromo` /
 * `actions.play`) rather than reaching into Chessground's `Api`: `Api.selectSquare` looked like a
 * safe "just sets visual selection" helper, but reading chessground's own `board.ts` shows it also
 * *plays the move* via `userMove` when a square is already selected — reusing it here would have
 * made every cursor step double as a click. Calling `actions.play` directly keeps this layer from
 * touching Chessground state at all, which is the actual guarantee behind AC-7.
 */
import { createEffect, createSignal } from "solid-js";
import { isPromotion } from "@chess-mcp/chess-tools";
import { actions, color, dests, fen, lastMove, turnColor } from "./game";
import { setPendingPromo } from "./promotion";
import { announce } from "./announce";
import { assertTestOnly } from "./test-seam";

const FILES = "abcdefgh";
const RANKS = "12345678";

export interface Square {
  readonly file: number; // 0..7, a..h
  readonly rank: number; // 0..7, "1".."8"
}

export const squareKey = (s: Square): string => `${FILES.charAt(s.file)}${RANKS.charAt(s.rank)}`;

export function parseSquareKey(key: string): Square {
  return { file: FILES.indexOf(key.charAt(0)), rank: RANKS.indexOf(key.charAt(1)) };
}

/** Explicit cursor position, set by keyboard navigation or real focus. Null = "use the default". */
const [cursorOverride, setCursorOverride] = createSignal<Square | null>(null);
export const [selectedSquare, setSelectedSquare] = createSignal<Square | null>(null);
export const [highlightedDests, setHighlightedDests] = createSignal<ReadonlySet<string>>(
  new Set<string>(),
);

/** Where the cursor lands with no explicit override: the last move's destination, or the home
 *  square for the current orientation at the start position. */
function defaultSquare(): Square {
  const lm = lastMove();
  if (lm) return parseSquareKey(lm[1]);
  return parseSquareKey(color() === "white" ? "e1" : "e8");
}

export const cursor = (): Square => cursorOverride() ?? defaultSquare();
export const cursorKey = (): string => squareKey(cursor());

/** Any real DOM focus change (including the layer's own onFocus) reports the square it landed
 *  on — the layer calls this so the cursor never drifts from real focus. */
export function setCursor(square: Square): void {
  setCursorOverride(square);
}

/** Clears the transient cursor override and selection so the next read re-derives from the
 *  current position. Called directly (synchronously) everywhere *this store* changes the
 *  position, rather than solely through the createEffect below — `createEffect`'s first run is
 *  deferred by Solid itself, and under plain `node:test` (no `render()`/browser build; `solid-js`
 *  resolves to its Node/server condition there) it never runs at all, confirmed empirically. The
 *  effect stays for changes this store does not control (an external pointer drag, tree
 *  navigation, undo/redo) — those still need eventual-consistency in the real (browser-built) app,
 *  they are just not the path a synchronous caller here should depend on. */
function resetCursorState(): void {
  setCursorOverride(null);
  setSelectedSquare(null);
  setHighlightedDests(new Set<string>());
}

/** Test seam: establish a clean cursor/selection state without waiting on the createEffect below,
 *  which — see resetCursorState's comment — never runs under plain `node:test`. */
export function resetCursorForTesting(): void {
  assertTestOnly();
  resetCursorState();
}

createEffect(() => {
  fen();
  resetCursorState();
});

const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" } as const;

/** Moves the cursor one square in the direction shown on screen (AC-2), accounting for a flipped
 *  board — `ArrowUp` means "up the screen", not "toward rank 8". Returns the new square's key so
 *  the caller can move real DOM focus there. */
export function moveCursor(direction: "up" | "down" | "left" | "right"): string {
  const flipped = color() === "black";
  const effective = flipped ? OPPOSITE[direction] : direction;
  let { file, rank } = cursor();
  if (effective === "up") rank = Math.min(rank + 1, 7);
  else if (effective === "down") rank = Math.max(rank - 1, 0);
  else if (effective === "left") file = Math.max(file - 1, 0);
  else file = Math.min(file + 1, 7);
  const next = { file, rank };
  setCursorOverride(next);
  return squareKey(next);
}

/** Enter/Space with nothing selected (AC-3): pick up the piece on the cursor square and announce
 *  its legal destination count. A square with no legal moves (empty, opponent piece, pinned piece,
 *  ...) is silently not selectable — there is nothing to announce a count for. */
export function selectPiece(): void {
  const sq = cursorKey();
  const moves = dests().get(sq);
  if (!moves || moves.length === 0) return;
  setSelectedSquare(cursor());
  setHighlightedDests(new Set(moves));
  announce(`${moves.length} legal destination${moves.length === 1 ? "" : "s"}.`);
}

/** Enter/Space with a piece already selected (AC-3/AC-4/AC-5): play the move on a legal
 *  destination (through the exact same isPromotion/play/setPendingPromo path Board.tsx's pointer
 *  handler uses), refuse an illegal one with an announcement and no state change, or — pressing
 *  confirm on the origin square again — cancel the pick silently. */
export function confirmMove(): void {
  const sel = selectedSquare();
  if (!sel) return;
  const from = squareKey(sel);
  const to = cursorKey();
  if (from === to) {
    clearSelection();
    return;
  }
  if (!highlightedDests().has(to)) {
    announce(`${to} is not a legal destination.`);
    return;
  }
  const currentFen = fen();
  const moveColor = turnColor();
  if (isPromotion(currentFen, from, to)) {
    // Only the selection clears here — the cursor stays on the destination square (already true,
    // since it's not touched) so it's still there, correctly, once resetCursorState() re-derives
    // it from the new lastMove() after the promotion dialog plays the move.
    setSelectedSquare(null);
    setHighlightedDests(new Set<string>());
    setPendingPromo({ orig: from, dest: to, color: moveColor });
    return;
  }
  actions.play(from, to);
  resetCursorState();
}

/** Escape (AC-6): clears the selection without changing the position or moving the cursor. */
export function clearSelection(): void {
  setSelectedSquare(null);
  setHighlightedDests(new Set<string>());
}
