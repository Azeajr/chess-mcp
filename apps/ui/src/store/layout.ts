import { createSignal } from "solid-js";

const KEY_SIDE = "chess.layout.side";
const KEY_CHAT = "chess.layout.chat";
const KEY_BOARD = "chess.layout.board";
export const MIN_PX = 240;
export const MAX_PX = 800;
const SIDE_DEFAULT = 300;
const CHAT_DEFAULT = 360;
const BOARD_MIN = 300;
const GUTTER = 96;

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
export const effSideWidth = sideWidth;
export const effChatWidth = chatWidth;

const viewportW = () => (typeof window === "undefined" ? 1280 : window.innerWidth);
const budget = () => viewportW() - BOARD_MIN - GUTTER;

export function resizeSide(d: number) {
  const maxSide = Math.min(MAX_PX, budget() - chatWidth());
  setSideWidthRaw(Math.max(MIN_PX, Math.min(maxSide, sideWidth() + d)));
}

export function resizeSideChat(d: number) {
  const side = sideWidth();
  const chat = chatWidth();
  const maxRight = Math.min(MAX_PX - side, chat - MIN_PX);
  const maxLeft = Math.min(side - MIN_PX, MAX_PX - chat);
  const delta = Math.max(-maxLeft, Math.min(maxRight, d));
  setSideWidthRaw(side + delta);
  setChatWidthRaw(chat - delta);
}

export function resetLayout() {
  setSideWidthRaw(SIDE_DEFAULT);
  setChatWidthRaw(CHAT_DEFAULT);
}

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
  return Number.isFinite(v) && v > 0 ? v : 0;
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

export function persistLayout() {
  localStorage.setItem(KEY_SIDE, String(sideWidth()));
  localStorage.setItem(KEY_CHAT, String(chatWidth()));
}
