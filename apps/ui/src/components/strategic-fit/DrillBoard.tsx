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
import { chessgroundDests } from "chessops/compat";
import { drillOrientation, drillPosition } from "../../application/drill-move";

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
  // The FEN chessground was last told to paint. Locking the board after a move re-runs the effect
  // below, and chessground's `configure` does `if (config.fen) state.pieces = fenRead(config.fen)`
  // — so passing the drill's FEN again would rub out the move the user just played and leave the
  // `lastMove` highlight pointing at squares whose pieces had snapped back. The FEN is sent only
  // when it actually changes, which is when a different drill is shown.
  let painted: string | undefined;

  const orientation = () => drillOrientation(props.fen);

  const movable = () => {
    const position = drillPosition(props.fen);
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
    painted = props.fen;
  });

  createEffect(() => {
    const fen = props.fen;
    const config = {
      orientation: orientation(),
      draggable: { enabled: !props.locked },
      selectable: { enabled: !props.locked },
      // The whole `movable` object is replaced on each set, so the `after` handler has to be
      // included every time — passing only the destinations would drop it and the board would
      // accept a move that reaches nobody.
      movable: movableConfig(),
    };
    board?.set(fen === painted ? config : { ...config, fen });
    painted = fen;
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
