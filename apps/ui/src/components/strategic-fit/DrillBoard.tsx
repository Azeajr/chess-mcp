/**
 * A board that accepts exactly one move, for the training drill surface.
 *
 * Deliberately not `Board.tsx`: that one is bound to the app's game store, and attempting a drill
 * must not touch the working document or the current position. Deliberately not `ReadOnlyBoard`
 * either, which is `viewOnly` throughout. This is the same chessground bridge shape as
 * `ReadOnlyBoard`, with movement enabled for the side to move and disabled again the moment a move
 * is played — a drill records first-attempt recall, so a second move must not be possible.
 */
import { createEffect, onCleanup, onMount } from "solid-js";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Key } from "chessground/types";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { makeSanAndPlay } from "chessops/san";
import { parseSquare } from "chessops/util";
import { chessgroundDests } from "chessops/compat";
import type { NormalMove } from "chessops/types";

/** The side to move at `fen`, which is also the orientation the drill is shown from. */
export function drillOrientation(fen: string): "white" | "black" {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

function positionAt(fen: string): Chess | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const position = Chess.fromSetup(setup.value);
  return position.isErr ? null : position.value;
}

/**
 * SAN for a board move at `fen`, or null when it is not legal there. A pawn reaching the last rank
 * is auto-queened, matching `GameTree.playMove`; the drill surface has no promotion picker, and a
 * drill whose expected move is an under-promotion would simply read as not recalled.
 */
export function sanForDrillMove(fen: string, orig: string, dest: string): string | null {
  const position = positionAt(fen);
  if (!position) return null;
  const from = parseSquare(orig);
  const to = parseSquare(dest);
  if (from === undefined || to === undefined) return null;
  const move: NormalMove = { from, to };
  const piece = position.board.get(from);
  const toRank = to >> 3;
  if (piece?.role === "pawn" && (toRank === 0 || toRank === 7)) move.promotion = "queen";
  if (!position.isLegal(move)) return null;
  return makeSanAndPlay(position, move);
}

export default function DrillBoard(props: {
  fen: string;
  /** Called once, with the squares of the single move played. */
  onMove: (orig: string, dest: string) => void;
  /** When true the board stops accepting input — the attempt is already recorded. */
  locked: boolean;
  label: string;
}) {
  let element!: HTMLDivElement;
  let board: Api | undefined;

  const orientation = () => drillOrientation(props.fen);

  const movable = () => {
    const position = positionAt(props.fen);
    if (!position || props.locked) {
      return { free: false, color: undefined, dests: new Map<Key, Key[]>(), showDests: false };
    }
    return {
      free: false,
      color: orientation(),
      dests: chessgroundDests(position) as Map<Key, Key[]>,
      showDests: true,
    };
  };

  const movableConfig = () => ({
    ...movable(),
    events: {
      after: (orig: Key, dest: Key) => {
        props.onMove(orig, dest);
      },
    },
  });

  onMount(() => {
    board = Chessground(element, {
      fen: props.fen,
      orientation: orientation(),
      animation: { enabled: false },
      draggable: { enabled: !props.locked },
      selectable: { enabled: !props.locked },
      drawable: { enabled: false, visible: false },
      highlight: { lastMove: true, check: true },
      movable: movableConfig(),
    });
  });

  createEffect(() => {
    board?.set({
      fen: props.fen,
      orientation: orientation(),
      draggable: { enabled: !props.locked },
      selectable: { enabled: !props.locked },
      // The whole `movable` object is replaced on each set, so the `after` handler has to be
      // included every time — passing only the destinations would drop it and the board would
      // accept a move that reaches nobody.
      movable: movableConfig(),
    });
  });

  onCleanup(() => board?.destroy());

  return (
    <div
      class="strategic-fit-drill-board"
      data-board-orientation={orientation()}
      data-drill-locked={props.locked ? "true" : "false"}
    >
      <div
        ref={element}
        class="cg-wrap"
        aria-label={`${props.label}. ${orientation()} to move.`}
        role="group"
      />
    </div>
  );
}
