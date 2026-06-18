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
import { isPromotion } from "@chess-mcp/chess-tools";
import { engineArrows, repertoireArrows, type Arrow } from "../store/analysis";
import { suggestionArrows } from "../store/suggestions";
import { pendingPromo, setPendingPromo } from "../store/promotion";

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
            if (isPromotion(fen(), orig, dest)) setPendingPromo({ orig, dest, color: turnColor() });
            else actions.play(orig, dest);
          },
        },
      },
      animation: { enabled: true, duration: 120 },
      highlight: { lastMove: true, check: true },
    });
  });

  // Re-sync the board whenever the store position changes. Also depends on the pending-promotion
  // signal so that opening/closing the promotion modal reverts chessground's optimistic piece move.
  createEffect(() => {
    if (!cg) return;
    pendingPromo();
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

  const arrowKey = (a: Arrow) => `${a.orig}${a.dest}`;

  // Repertoire, engine, and suggestion arrows: redraw whenever their stores update. setShapes replaces the
  // overlay, so it co-exists with the lastMove highlight (a board feature, not a shape).
  createEffect(() => {
    if (!cg) return;
    const book = repertoireArrows();
    const bookKeys = new Set(book.map(arrowKey));
    const shapes = [...book, ...engineArrows().filter((a) => !bookKeys.has(arrowKey(a))), ...suggestionArrows()];
    cg.setShapes(shapes as unknown as DrawShape[]);
  });

  onCleanup(() => cg?.destroy());

  return (
    <div class="board-wrap">
      <div ref={el} class="cg-wrap" />
    </div>
  );
}
