/**
 * Workspace panel widths (side panel + chat), persisted to localStorage. The board panel is
 * flex:1 and takes whatever is left; these two are flex:0 0 auto with an explicit width the
 * dividers drag. Written once per drag gesture (pointerup) via persistLayout() to avoid
 * thrashing localStorage on every pointermove.
 *
 * Single-layer model: the stored width IS the rendered width (WYSIWYG). Each drag caps the panel
 * it controls against the *other* panel's current width so the board keeps a floor (BOARD_MIN) —
 * the other panel never moves, so the dividers are independent. On window resize, reflow() shrinks
 * chat-then-side to keep the board floor. Only the wide flex regime reads these — the grid
 * breakpoints (≤1100px) neutralise the inline widths with `width:auto`.
 */
import { createSignal } from "solid-js";

const KEY_SIDE = "chess.layout.side";
const KEY_CHAT = "chess.layout.chat";
const KEY_BOARD = "chess.layout.board";
const MIN_PX = 240;
const MAX_PX = 800;
const SIDE_DEFAULT = 300;
const CHAT_DEFAULT = 360;
const BOARD_MIN = 300; // px the board keeps before chat/side are clamped
const GUTTER = 96; // workspace padding + gaps + dividers, approx

// Small-screen (phone) board square side, dragged by the horizontal divider. 0 = auto (let CSS
// use its responsive default); once dragged we store an explicit px the stylesheet caps to the
// container width via min(), so it can never overflow.
const BOARD_SM_MIN = 160;
const BOARD_SM_MAX = 900;

const clamp = (px: number) => Math.max(MIN_PX, Math.min(MAX_PX, px));
const read = (k: string, fallback: number) => {
  const v = Number(localStorage.getItem(k));
  return Number.isFinite(v) && v > 0 ? clamp(v) : fallback;
};

const [sideWidth, setSideWidthRaw] = createSignal(read(KEY_SIDE, SIDE_DEFAULT));
const [chatWidth, setChatWidthRaw] = createSignal(read(KEY_CHAT, CHAT_DEFAULT));
export { sideWidth, chatWidth };
// Back-compat aliases: with the single-layer model the stored width is the rendered width.
export const effSideWidth = sideWidth;
export const effChatWidth = chatWidth;

const viewportW = () => (typeof window === "undefined" ? 1280 : window.innerWidth);
// px available to side + chat before the board hits its floor.
const budget = () => viewportW() - BOARD_MIN - GUTTER;

/** Resize the side panel; capped so the board keeps its floor and chat is untouched. */
export function resizeSide(d: number) {
  const maxSide = Math.min(MAX_PX, budget() - chatWidth());
  setSideWidthRaw(Math.max(MIN_PX, Math.min(maxSide, sideWidth() + d)));
}

/**
 * Move the side│chat boundary right by `d`: the side panel grows, chat shrinks, the board is
 * unchanged — a true trade between the two adjacent panels. Clamps so both stay within
 * [MIN_PX, MAX_PX]; if either hits a bound the boundary stops (the board never moves).
 */
export function resizeSideChat(d: number) {
  const side = sideWidth();
  const chat = chatWidth();
  const maxRight = Math.min(MAX_PX - side, chat - MIN_PX); // boundary travel right (grow side)
  const maxLeft = Math.min(side - MIN_PX, MAX_PX - chat); // boundary travel left (grow chat)
  const delta = Math.max(-maxLeft, Math.min(maxRight, d));
  setSideWidthRaw(side + delta);
  setChatWidthRaw(chat - delta);
}

/** On window resize, shrink chat-then-side so the board keeps BOARD_MIN. */
function reflow() {
  const b = budget();
  let side = sideWidth();
  let chat = chatWidth();
  if (side + chat <= b) return;
  chat = Math.max(MIN_PX, b - side);
  if (side + chat > b) side = Math.max(MIN_PX, b - chat);
  setSideWidthRaw(side);
  setChatWidthRaw(chat);
}
if (typeof window !== "undefined") window.addEventListener("resize", reflow);

const readBoard = () => {
  const v = Number(localStorage.getItem(KEY_BOARD));
  return Number.isFinite(v) && v > 0 ? v : 0; // 0 = auto
};
const [boardSize, setBoardSizeRaw] = createSignal(readBoard());
export { boardSize };
export const setBoardSize = (px: number) =>
  setBoardSizeRaw(Math.max(BOARD_SM_MIN, Math.min(BOARD_SM_MAX, px)));
export function persistBoard() {
  if (boardSize() > 0) localStorage.setItem(KEY_BOARD, String(boardSize()));
}

/** Persist current widths — call on drag-end (pointerup), one write per gesture. */
export function persistLayout() {
  localStorage.setItem(KEY_SIDE, String(sideWidth()));
  localStorage.setItem(KEY_CHAT, String(chatWidth()));
}
