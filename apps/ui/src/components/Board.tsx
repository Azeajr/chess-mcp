/**
 * Chessground wrapper for SolidJS. No maintained solidjs-chessground exists, so this is the
 * one-time custom bridge (UI_DESIGN.md tech-stack note): init the vanilla board on mount,
 * push store state through a reactive effect, tear down on cleanup.
 */
import { onMount, onCleanup, createEffect } from "solid-js";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type { Key } from "chessground/types";
import type { DrawShape } from "chessground/draw";
import { actions, fen, dests, turnColor, lastMove, color } from "../store/game";
import { engineArrows } from "../store/analysis";

export default function Board() {
  let el!: HTMLDivElement;
  let cg: Api | undefined;

  onMount(() => {
    cg = Chessground(el, {
      fen: fen(),
      orientation: color(),
      turnColor: turnColor(),
      movable: {
        free: false,
        color: turnColor(),
        dests: dests() as Map<Key, Key[]>,
        showDests: true,
        events: {
          after: (orig: Key, dest: Key) => {
            // Promotion defaults to queen in the GameTree; modal deferred past Phase 1.
            actions.play(orig, dest);
          },
        },
      },
      animation: { enabled: true, duration: 120 },
      highlight: { lastMove: true, check: true },
    });
  });

  // Re-sync the board whenever the store position changes.
  createEffect(() => {
    if (!cg) return;
    const lm = lastMove();
    cg.set({
      fen: fen(),
      orientation: color(),
      turnColor: turnColor(),
      lastMove: lm ? (lm as [Key, Key]) : undefined,
      movable: {
        color: turnColor(),
        dests: dests() as Map<Key, Key[]>,
      },
    });
  });

  // Engine arrows: redraw whenever the analysis store updates. setShapes replaces the
  // overlay, so it co-exists with the lastMove highlight (a board feature, not a shape).
  createEffect(() => {
    if (!cg) return;
    cg.setShapes(engineArrows() as unknown as DrawShape[]);
  });

  onCleanup(() => cg?.destroy());

  return (
    <div class="board-wrap">
      <div ref={el} class="cg-wrap" />
    </div>
  );
}
