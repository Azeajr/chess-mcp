import { createEffect, onCleanup, onMount } from "solid-js";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Key } from "chessground/types";
import { chessgroundDests } from "chessops/compat";
import { drillOrientation, drillPosition } from "../../application/drill-move";

export default function DrillBoard(props: {
  fen: string;
  onMove: (orig: string, dest: string) => void;
  locked: boolean;
  label: string;
}) {
  let element!: HTMLDivElement;
  let board: Api | undefined;
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
      turnColor: orientation(),
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
      turnColor: orientation(),
      draggable: { enabled: !props.locked },
      selectable: { enabled: !props.locked },
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
