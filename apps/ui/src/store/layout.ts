/**
 * Workspace panel widths (side panel + chat), persisted to localStorage. The board panel is
 * flex:1 and takes whatever is left; these two are flex:0 0 auto with an explicit width the
 * dividers drag. Written once per drag gesture (pointerup) via persistLayout() to avoid
 * thrashing localStorage on every pointermove.
 */
import { createSignal } from "solid-js";

const KEY_SIDE = "chess.layout.side";
const KEY_CHAT = "chess.layout.chat";
const MIN_PX = 240;
const MAX_PX = 800;
const SIDE_DEFAULT = 300;
const CHAT_DEFAULT = 360;

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

/** Persist current widths — call on drag-end (pointerup), one write per gesture. */
export function persistLayout() {
  localStorage.setItem(KEY_SIDE, String(sideWidth()));
  localStorage.setItem(KEY_CHAT, String(chatWidth()));
}
