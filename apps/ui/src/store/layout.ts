/**
 * Workspace panel widths (side panel + chat), persisted to localStorage. The board panel is
 * flex:1 and takes whatever is left; these two are flex:0 0 auto with an explicit width the
 * dividers drag. Written once per drag gesture (pointerup) via persistLayout() to avoid
 * thrashing localStorage on every pointermove.
 *
 * Two layers: the *desired* width (sideWidth/chatWidth, divider-driven, persisted) and the
 * *effective* width (effSideWidth/effChatWidth, what App renders). On a narrow window the desired
 * widths can sum past the viewport and starve the board to nothing; the effective layer shrinks
 * chat-then-side so the board keeps a floor (BOARD_MIN), then restores the saved widths when the
 * window grows back. Only the wide flex regime reads these — the grid breakpoints (≤1100px)
 * neutralise the inline widths with `width:auto`.
 */
import { createSignal, createMemo } from "solid-js";

const KEY_SIDE = "chess.layout.side";
const KEY_CHAT = "chess.layout.chat";
const MIN_PX = 240;
const MAX_PX = 800;
const SIDE_DEFAULT = 300;
const CHAT_DEFAULT = 360;
const BOARD_MIN = 300; // px the board keeps before chat/side are clamped
const GUTTER = 96; // workspace padding + gaps + dividers, approx

const clamp = (px: number) => Math.max(MIN_PX, Math.min(MAX_PX, px));
const read = (k: string, fallback: number) => {
  const v = Number(localStorage.getItem(k));
  return Number.isFinite(v) && v > 0 ? clamp(v) : fallback;
};

const [sideWidth, setSideWidthRaw] = createSignal(read(KEY_SIDE, SIDE_DEFAULT));
const [chatWidth, setChatWidthRaw] = createSignal(read(KEY_CHAT, CHAT_DEFAULT));
export { sideWidth, chatWidth };

export const setSideWidth = (px: number) => setSideWidthRaw(clamp(px));
export const setChatWidth = (px: number) => setChatWidthRaw(clamp(px));

const [viewportW, setViewportW] = createSignal(typeof window === "undefined" ? 1280 : window.innerWidth);
if (typeof window !== "undefined") {
  window.addEventListener("resize", () => setViewportW(window.innerWidth));
}

/** Shrink chat first, then side, so the board keeps BOARD_MIN. Never below MIN_PX. */
function fit(side: number, chat: number, vw: number) {
  const budget = vw - BOARD_MIN - GUTTER; // px available to side + chat
  if (side + chat <= budget) return { side, chat };
  const c = Math.max(MIN_PX, budget - side);
  const s = side + c > budget ? Math.max(MIN_PX, budget - c) : side;
  return { side: s, chat: c };
}

const effective = createMemo(() => fit(sideWidth(), chatWidth(), viewportW()));
export const effSideWidth = () => effective().side;
export const effChatWidth = () => effective().chat;

/** Persist current widths — call on drag-end (pointerup), one write per gesture. */
export function persistLayout() {
  localStorage.setItem(KEY_SIDE, String(sideWidth()));
  localStorage.setItem(KEY_CHAT, String(chatWidth()));
}
