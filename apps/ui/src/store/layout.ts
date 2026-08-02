/**
 * Workspace panel widths (side panel + chat), persisted to localStorage. The board panel is
 * flex:1 and takes whatever is left; these two are flex:0 0 auto with an explicit width the
 * dividers drag. Written once per drag gesture (pointerup) via persistLayout() to avoid
 * thrashing localStorage on every pointermove.
 *
 * Single-layer model: the stored width IS the rendered width (WYSIWYG). Each drag caps the panel
 * it controls against the *other* panel's current width so the board keeps a floor (BOARD_MIN) —
 * the other panel never moves, so the dividers are independent. On window resize, reflow() shrinks
 * chat-then-side to keep the board floor. Only the wide flex regime reads these — the compact and
 * grid tiers neutralise the inline widths with `width:auto`.
 */
import { createSignal } from "solid-js";

const KEY_SIDE = "chess.layout.side";
const KEY_CHAT = "chess.layout.chat";
const KEY_BOARD = "chess.layout.board";
export const MIN_PX = 240;
export const MAX_PX = 800;
const SIDE_DEFAULT = 300;
const CHAT_DEFAULT = 360;
const BOARD_MIN = 300; // px the board keeps before chat/side are clamped
const GUTTER = 96; // workspace padding + gaps + dividers, approx

// Small-screen (phone) board square side, dragged by the horizontal divider. 0 = auto (let CSS
// use its responsive default); once dragged we store an explicit px the stylesheet caps to the
// container width via min(), so it can never overflow.
const BOARD_SM_MIN = 160;
const BOARD_SM_MAX = 900;
const COMPACT_MAX = 720;
const GRID_MAX = 1100;

const clamp = (px: number) => Math.max(MIN_PX, Math.min(MAX_PX, px));
const read = (k: string, fallback: number) => {
  const v = Number(localStorage.getItem(k));
  return Number.isFinite(v) && v > 0 ? clamp(v) : fallback;
};

const hasPersistedLayout =
  typeof localStorage !== "undefined" &&
  [KEY_SIDE, KEY_CHAT].every((key) => {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0;
  });
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

/** Restore both desktop panel widths; persistence stays with the invoking interaction. */
export function resetLayout() {
  setSideWidthRaw(SIDE_DEFAULT);
  setChatWidthRaw(CHAT_DEFAULT);
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

interface GridLayout {
  board: number;
  chat: number;
  side: number;
}

let gridLayout: GridLayout | undefined;
let canSeedWideTransition = !hasPersistedLayout;
const isGridTier = () => window.innerWidth > COMPACT_MAX && window.innerWidth <= GRID_MAX;
let wasGridTier = typeof window !== "undefined" && isGridTier();

function measureGridLayout() {
  if (!isGridTier()) return;
  const board = document.querySelector<HTMLElement>(".board-panel");
  const side = document.querySelector<HTMLElement>(".side-panel");
  const chat = document.querySelector<HTMLElement>(".chat-wrap");
  if (!board || !side || !chat) return;
  gridLayout = {
    board: board.getBoundingClientRect().width,
    side: side.getBoundingClientRect().width,
    chat: chat.getBoundingClientRect().width,
  };
}

/**
 * A fresh profile has no meaningful desktop widths yet. On its first grid-to-flex crossing, use
 * the grid geometry to divide the width left after preserving the rendered board. Existing stored
 * values bypass this path, so layouts persisted by older builds remain exact.
 */
function seedWideLayout(measured: GridLayout) {
  const workspace = document.querySelector<HTMLElement>(".workspace");
  const dividers = workspace?.querySelectorAll<HTMLElement>(".divider:not(.divider-h)");
  if (!workspace || !dividers) return;
  const style = getComputedStyle(workspace);
  const horizontalChrome =
    Number.parseFloat(style.paddingLeft) +
    Number.parseFloat(style.paddingRight) +
    Number.parseFloat(style.columnGap) * 4 +
    [...dividers].reduce((total, divider) => total + divider.getBoundingClientRect().width, 0);
  const panelBudget = Math.max(
    MIN_PX * 2,
    workspace.getBoundingClientRect().width - horizontalChrome - measured.board,
  );
  const measuredTotal = measured.side + measured.chat;
  const sideShare =
    measuredTotal > 0 ? (panelBudget * measured.side) / measuredTotal : panelBudget / 2;
  const seededSide = clamp(Math.min(measured.side, Math.max(MIN_PX, sideShare)));
  const seededChat = clamp(Math.max(MIN_PX, panelBudget - seededSide));
  setSideWidthRaw(seededSide);
  setChatWidthRaw(seededChat);
  persistLayout();
}

function handleResize() {
  const gridTier = isGridTier();
  if (canSeedWideTransition && wasGridTier && window.innerWidth > GRID_MAX && gridLayout) {
    seedWideLayout(gridLayout);
    canSeedWideTransition = false;
  }
  reflow();
  wasGridTier = gridTier;
  if (gridTier) requestAnimationFrame(measureGridLayout);
}

if (typeof window !== "undefined") {
  window.addEventListener("resize", handleResize);
  if (wasGridTier) requestAnimationFrame(measureGridLayout);
}

const readBoard = () => {
  const v = Number(localStorage.getItem(KEY_BOARD));
  return Number.isFinite(v) && v > 0 ? v : 0; // 0 = auto
};
const [boardSize, setBoardSizeRaw] = createSignal(readBoard());
export { boardSize };
export const setBoardSize = (px: number) =>
  setBoardSizeRaw(Math.max(BOARD_SM_MIN, Math.min(BOARD_SM_MAX, px)));
export function resetBoard() {
  setBoardSizeRaw(0);
}
export function persistBoard() {
  if (boardSize() > 0) localStorage.setItem(KEY_BOARD, String(boardSize()));
  else localStorage.removeItem(KEY_BOARD);
}

/** Persist current widths — call on drag-end (pointerup), one write per gesture. */
export function persistLayout() {
  localStorage.setItem(KEY_SIDE, String(sideWidth()));
  localStorage.setItem(KEY_CHAT, String(chatWidth()));
}
