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

  const focusSquare = (key: string) => {
    containerEl?.querySelector<HTMLElement>(`[data-square="${key}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (backgroundSuspended()) return;
    if (isTextField(event.target)) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.getAttribute("role") !== "gridcell") return;

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
