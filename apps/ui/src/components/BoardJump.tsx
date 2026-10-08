import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { currentPath } from "../store/game";

/*
  On a short phone (≤640px tall) or the tablet grid the workspace itself scrolls, so the board
  scrolls away with the panels. Opening a finding then moved a board the reader could not see:
  the row lit up and nothing else changed. When the position changes while the board is mostly
  off-screen, offer a jump to it, and once there a jump back to where the reader was. Nothing
  appears where the board stays in view, which is every other layout.
*/

const VISIBLE_SHARE = 0.25;
const EDGE_GAP = 8;

type Mode = "show" | "back";
type Placement = { left: number; top?: number; bottom?: number };

const stage = () => document.querySelector<HTMLElement>(".board-stage");

function visibleShare(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  if (rect.height <= 0) return 0;
  let top = Math.max(rect.top, 0);
  let bottom = Math.min(rect.bottom, window.innerHeight);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent.scrollHeight <= parent.clientHeight) continue;
    const clip = parent.getBoundingClientRect();
    top = Math.max(top, clip.top);
    bottom = Math.min(bottom, clip.bottom);
  }
  return Math.max(0, bottom - top) / rect.height;
}

// Every ancestor that is scrolled, so "Back to list" restores the exact place.
function scrollOffsets(element: HTMLElement): [HTMLElement, number][] {
  const offsets: [HTMLElement, number][] = [];
  for (let parent = element.parentElement; parent; parent = parent.parentElement)
    if (parent.scrollTop > 0) offsets.push([parent, parent.scrollTop]);
  const root = document.scrollingElement as HTMLElement | null;
  if (root && root.scrollTop > 0 && !offsets.some(([el]) => el === root))
    offsets.push([root, root.scrollTop]);
  return offsets;
}

export default function BoardJump() {
  const [mode, setMode] = createSignal<Mode | null>(null);
  const [placement, setPlacement] = createSignal<Placement>({ left: 0 });
  let origin: HTMLElement | null = null;
  let saved: [HTMLElement, number][] = [];

  const boardOnScreen = () => {
    const board = stage();
    return !board || visibleShare(board) >= VISIBLE_SHARE;
  };

  // Above the panels while the board is above them; below the board once it is shown, so the
  // control never covers the position it points at.
  const place = (next: Mode) => {
    const scroller = stage()?.closest<HTMLElement>(".workspace");
    const rect = scroller?.getBoundingClientRect();
    if (!rect) return;
    const left = rect.left + rect.width / 2;
    setPlacement(
      next === "show"
        ? { left, top: Math.max(rect.top, 0) + EDGE_GAP }
        : {
            left,
            bottom: window.innerHeight - Math.min(rect.bottom, window.innerHeight) + EDGE_GAP,
          },
    );
  };

  createEffect(
    on(
      () => currentPath().join(","),
      () => {
        if (mode() === "back" || boardOnScreen()) return;
        const active = document.activeElement;
        origin = active instanceof HTMLElement && active !== document.body ? active : null;
        place("show");
        setMode("show");
      },
      { defer: true },
    ),
  );

  onMount(() => {
    const settle = () => {
      const current = mode();
      if (current === "show" && boardOnScreen()) setMode(null);
      else if (current === "back" && !boardOnScreen()) setMode(null);
      else if (current) place(current);
    };
    document.addEventListener("scroll", settle, { capture: true, passive: true });
    window.addEventListener("resize", settle);
    onCleanup(() => {
      document.removeEventListener("scroll", settle, { capture: true });
      window.removeEventListener("resize", settle);
    });
  });

  const showBoard = () => {
    const board = stage();
    if (!board) return;
    saved = scrollOffsets(board);
    board.scrollIntoView({ block: "nearest" });
    place("back");
    setMode("back");
  };

  const backToList = () => {
    for (const [element, top] of saved) element.scrollTop = top;
    saved = [];
    setMode(null);
    if (origin?.isConnected) origin.focus({ preventScroll: true });
    origin = null;
  };

  return (
    <Show when={mode()}>
      {(current) => (
        <button
          type="button"
          class="board-jump"
          data-board-jump={current()}
          style={{
            left: `${placement().left}px`,
            top: placement().top === undefined ? undefined : `${placement().top}px`,
            bottom: placement().bottom === undefined ? undefined : `${placement().bottom}px`,
          }}
          onClick={() => {
            if (current() === "show") showBoard();
            else backToList();
          }}
        >
          <span aria-hidden="true">{current() === "show" ? "↑" : "↓"}</span>
          {current() === "show" ? "Show board" : "Back to list"}
        </button>
      )}
    </Show>
  );
}
