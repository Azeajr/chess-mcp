/**
 * WP-014 BoardKeyboardLayer — an 8×8 grid of real, individually-focusable `role="gridcell"`
 * elements laid over `.cg-wrap`, one roving tab stop (mirrors MoveTree's `role="tree"` /
 * `role="treeitem"` pattern from AG-3: real DOM focus per cell, not a global keydown listener or
 * an `aria-activedescendant` virtual cursor). A real screen reader announces each cell's own
 * accessible name automatically as focus moves between them — no announce() call per cursor move,
 * per WP-009's flood policy. `role="row"`/`role="gridcell"` need a `grid`/`treegrid` ancestor to be
 * ARIA-valid (axe: aria-required-parent), which is why the container is `role="grid"` rather than
 * the bare `role="application"` WP-014.md's narrative section names — AC-1 only requires "one tab
 * stop, an accessible name, entry announcement, visible cursor", all of which `grid` satisfies
 * without the aria-required-parent conflict `application` + bare `gridcell` children would create.
 *
 * Positioned via `pointer-events: none` (auto only on `:focus-within`, in styles.css) so it can
 * never intercept a pointer/touch interaction with Chessground underneath while unfocused — the
 * mechanism AC-7 depends on. It never touches Chessground's `Api`; moves dispatch through the same
 * `actions.play` / `setPendingPromo` path Board.tsx's own pointer handler uses (see board-cursor.ts).
 */
import { For } from "solid-js";
import {
  clearSelection,
  confirmMove,
  cursorKey,
  highlightedDests,
  moveCursor,
  parseSquareKey,
  selectedSquare,
  selectPiece,
  setCursor,
  squareKey,
} from "../store/board-cursor";
import { color, fen, turnColor } from "../store/game";
import { boardPositionSummary, describeSquare } from "../content/analysis";
import { announce } from "../store/announce";
import { backgroundSuspended } from "../store/shortcuts";

const FILES = "abcdefgh";
const RANKS = "12345678";

/** Fixed DOM order (rank 8 → rank 1, a → h) — never regenerated, so cell identity (and any real
 *  DOM focus it holds) survives an orientation flip; only each cell's inline position changes. */
const ROWS: readonly (readonly string[])[] = RANKS.split("")
  .reverse()
  .map((rank) => FILES.split("").map((file) => `${file}${rank}`));

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

export default function BoardKeyboardLayer() {
  let containerEl: HTMLDivElement | undefined;

  // Synchronous, not queued: unlike MoveTree's roving-tabindex list (which can insert/remove real
  // nodes on navigation, needing a tick for reconciliation before the target exists), this grid's
  // 64 cells are a fixed, always-mounted set — only their `tabIndex`/attributes change reactively,
  // and Solid applies a signal write's dependent DOM updates before this function returns, so the
  // target cell's `tabIndex="0"` is already correct by the time `.focus()` runs here.
  const focusSquare = (key: string) => {
    containerEl?.querySelector<HTMLElement>(`[data-square="${key}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // AC-8: no board cursor while any overlay owns the screen.
    if (backgroundSuspended()) return;
    if (isTextField(event.target)) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.getAttribute("role") !== "gridcell") return;

    // Every case below is a key the board itself owns while it has focus. ArrowLeft/ArrowRight in
    // particular are ALSO registered page-level shortcuts (App.tsx: position.back/position.forward,
    // step the tree path) — without stopPropagation every arrow press here would also bubble to
    // that global listener and step the position underneath the cursor mid-navigation. MoveTree's
    // own onTreeKeyDown stops propagation for the identical reason; this mirrors it.
    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        focusSquare(moveCursor("up"));
        break;
      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        focusSquare(moveCursor("down"));
        break;
      case "ArrowLeft":
        event.preventDefault();
        event.stopPropagation();
        focusSquare(moveCursor("left"));
        break;
      case "ArrowRight":
        event.preventDefault();
        event.stopPropagation();
        focusSquare(moveCursor("right"));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        event.stopPropagation();
        if (selectedSquare()) confirmMove();
        else selectPiece();
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        clearSelection();
        break;
      default:
        break;
    }
  };

  // AC-1: entering the widget (focus arriving from outside it) announces the position summary.
  // Moving the roving-tabindex cursor around inside it must not re-trigger this.
  const onFocusIn = (event: FocusEvent) => {
    const previous = event.relatedTarget;
    const enteredFromOutside =
      !(previous instanceof globalThis.Node) || !containerEl?.contains(previous);
    if (enteredFromOutside) announce(boardPositionSummary(fen(), turnColor()));
  };

  return (
    <div
      ref={containerEl}
      class="board-keyboard-layer"
      role="grid"
      aria-label={boardPositionSummary(fen(), turnColor())}
      onKeyDown={onKeyDown}
      onFocusIn={onFocusIn}
    >
      <For each={ROWS}>
        {(row) => (
          <div class="bkl-row" role="row">
            <For each={row}>
              {(sq) => {
                const file = FILES.indexOf(sq.charAt(0));
                const rank = RANKS.indexOf(sq.charAt(1));
                const isSelected = () => {
                  const sel = selectedSquare();
                  return sel !== null && squareKey(sel) === sq;
                };
                const isLegalDest = () => highlightedDests().has(sq);
                const isCursor = () => cursorKey() === sq;
                // Orientation-aware placement: DOM order is fixed (see ROWS above), only each
                // cell's on-screen position moves when the board flips, tracking Chessground's own
                // `orientation` (store/game's `color()`) so the overlay never drifts off the real
                // squares underneath it.
                const position = () => {
                  const flipped = color() === "black";
                  const col = flipped ? 7 - file : file;
                  const rowFromTop = flipped ? rank : 7 - rank;
                  return { left: `${col * 12.5}%`, top: `${rowFromTop * 12.5}%` };
                };
                return (
                  <div
                    data-square={sq}
                    role="gridcell"
                    aria-label={describeSquare(fen(), sq, { legalDestination: isLegalDest() })}
                    tabIndex={isCursor() ? 0 : -1}
                    class={`bkl-cell${isSelected() ? " selected" : ""}${isLegalDest() ? " legal-dest" : ""}`}
                    style={position()}
                    onFocus={() => {
                      setCursor(parseSquareKey(sq));
                    }}
                  />
                );
              }}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
