/**
 * WP-014 BoardKeyboardLayer — keyboard navigation over the chessboard (DV-1, two-step cursor).
 *
 * The board is one tab stop. Arrow keys move a cursor one square in the direction shown on screen
 * (orientation-aware), Enter/Space selects a piece and then confirms a destination, Escape clears
 * the selection. All state and every legality decision live in `store/board-cursor`; this
 * component is only the event surface, so pointer, click-to-move, and touch dragging in
 * Chessground are untouched.
 */
import { onCleanup, onMount } from "solid-js";
import {
  clearSelection,
  confirmMove,
  cursor,
  moveCursor,
  selectedSquare,
  selectPiece,
} from "../store/board-cursor";
import { backgroundSuspended } from "../store/shortcuts";

const isTextField = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
};

export default function BoardKeyboardLayer() {
  const onKeyDown = (event: KeyboardEvent) => {
    // AC-8: no board cursor while any overlay owns the screen; the shortcut scope stack is the
    // single place that answers "is a modal open".
    if (backgroundSuspended()) return;
    if (isTextField(event.target)) return;
    if (!cursor()) return;

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        moveCursor("up");
        break;
      case "ArrowDown":
        event.preventDefault();
        moveCursor("down");
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveCursor("left");
        break;
      case "ArrowRight":
        event.preventDefault();
        moveCursor("right");
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        // Two-step: the first activation picks the piece up, the second plays it.
        if (selectedSquare()) confirmMove();
        else selectPiece();
        break;
      case "Escape":
        event.preventDefault();
        clearSelection();
        break;
      default:
        break;
    }
  };

  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
  });
  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown);
  });

  // The layer contributes behaviour, not markup: the cursor renders through the board's own
  // highlight state so it cannot drift from Chessground's geometry.
  return null;
}
