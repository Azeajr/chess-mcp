import { createEffect, createSignal } from "solid-js";
import { isPromotion } from "@chess-mcp/chess-tools";
import { actions, color, dests, fen, lastMove, turnColor } from "./game";
import { setPendingPromo } from "./promotion";
import { announce } from "./announce";
import { assertTestOnly } from "./test-seam";

const FILES = "abcdefgh";
const RANKS = "12345678";

export interface Square {
  readonly file: number;
  readonly rank: number;
}

export const squareKey = (s: Square): string => `${FILES.charAt(s.file)}${RANKS.charAt(s.rank)}`;

export function parseSquareKey(key: string): Square {
  return { file: FILES.indexOf(key.charAt(0)), rank: RANKS.indexOf(key.charAt(1)) };
}

const [cursorOverride, setCursorOverride] = createSignal<Square | null>(null);
export const [selectedSquare, setSelectedSquare] = createSignal<Square | null>(null);
export const [highlightedDests, setHighlightedDests] = createSignal<ReadonlySet<string>>(
  new Set<string>(),
);

function defaultSquare(): Square {
  const lm = lastMove();
  if (lm) return parseSquareKey(lm[1]);
  return parseSquareKey(color() === "white" ? "e1" : "e8");
}

export const cursor = (): Square => cursorOverride() ?? defaultSquare();
export const cursorKey = (): string => squareKey(cursor());

export function setCursor(square: Square): void {
  setCursorOverride(square);
}

function resetCursorState(): void {
  setCursorOverride(null);
  setSelectedSquare(null);
  setHighlightedDests(new Set<string>());
}

export function resetCursorForTesting(): void {
  assertTestOnly();
  resetCursorState();
}

createEffect(() => {
  fen();
  resetCursorState();
});

const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" } as const;

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

export function selectPiece(): void {
  const sq = cursorKey();
  const moves = dests().get(sq);
  if (!moves || moves.length === 0) return;
  setSelectedSquare(cursor());
  setHighlightedDests(new Set(moves));
  announce(`${moves.length} legal destination${moves.length === 1 ? "" : "s"}.`);
}

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
    setSelectedSquare(null);
    setHighlightedDests(new Set<string>());
    setPendingPromo({ orig: from, dest: to, color: moveColor });
    return;
  }
  actions.play(from, to);
  resetCursorState();
}

export function clearSelection(): void {
  setSelectedSquare(null);
  setHighlightedDests(new Set<string>());
}
