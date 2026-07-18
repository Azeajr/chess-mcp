import { createEffect, onCleanup, onMount } from "solid-js";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Color } from "@chess-mcp/chess-tools";

export default function ReadOnlyBoard(props: {
  fen: string;
  orientation: Color;
  label: string;
}) {
  let element!: HTMLDivElement;
  let board: Api | undefined;

  onMount(() => {
    board = Chessground(element, {
      fen: props.fen,
      orientation: props.orientation,
      viewOnly: true,
      animation: { enabled: false },
      draggable: { enabled: false },
      selectable: { enabled: false },
      movable: {
        free: false,
        color: undefined,
        showDests: false,
      },
      highlight: { lastMove: false, check: true },
    });
  });

  createEffect(() => {
    board?.set({
      fen: props.fen,
      orientation: props.orientation,
      viewOnly: true,
      movable: { color: undefined, showDests: false },
    });
  });

  onCleanup(() => board?.destroy());

  return (
    <div
      class="strategic-fit-read-only-board"
      role="img"
      aria-label={`${props.label}. Read-only board oriented for ${props.orientation}.`}
      data-board-orientation={props.orientation}
      data-board-read-only="true"
    >
      <div ref={element} class="cg-wrap" aria-hidden="true" />
    </div>
  );
}
