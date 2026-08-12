/**
 * Chessground wrapper for SolidJS. No maintained solidjs-chessground exists, so this is the
 * one-time custom bridge (UI_DESIGN.md tech-stack note): init the vanilla board on mount,
 * push store state through a reactive effect, tear down on cleanup.
 */
import { onMount, onCleanup, createEffect } from "solid-js";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Key } from "chessground/types";
import type { DrawShape, DrawBrush } from "chessground/draw";
import { actions, fen, dests, turnColor, lastMove, color } from "../store/game";
import { isPromotion } from "@chess-mcp/chess-tools";
import { ANALYSIS_ARROW_BRUSHES } from "../content/analysis";
import { engineArrows, repertoireArrows, type Arrow } from "../store/analysis";
import { suggestionArrows, previewArrow } from "../store/suggestions";
import { pendingPromo, setPendingPromo } from "../store/promotion";

export default function Board() {
  let el!: HTMLDivElement;
  let cg: Api | undefined;
  let motionPreference: MediaQueryList | undefined;
  const syncAnimationPreference = () =>
    cg?.set({ animation: { enabled: !motionPreference?.matches } });

  onMount(() => {
    motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
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
      animation: { enabled: !motionPreference.matches, duration: 120 },
      highlight: { lastMove: true, check: true },
    });
    motionPreference.addEventListener("change", syncAnimationPreference);
    // "gold" is the Feature 1 preview brush — added to the default set (green/red/blue/yellow)
    // after init so we don't have to re-declare the built-ins the Config type demands.
    const brushes = cg.state.drawable.brushes as Record<string, DrawBrush>;
    brushes.gold = {
      key: "gold",
      color: "#e3b341",
      opacity: 0.95,
      lineWidth: 10,
    };
    // Register the analysis palette explicitly so Chessground and the legend share one source.
    for (const brush of [
      ...Object.values(ANALYSIS_ARROW_BRUSHES.fit),
      ANALYSIS_ARROW_BRUSHES.repertoire,
    ]) {
      brushes[brush.brush] = {
        key: brush.key,
        color: brush.color,
        opacity: brush.opacity,
        lineWidth: brush.lineWidth,
      };
    }
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
    const preview = previewArrow();
    // Gold preview wins its square: drop any book/engine arrow sharing the same orig→dest.
    const taken = new Set([...book, ...preview].map(arrowKey));
    const shapes = [
      ...book.filter((a) => !preview.some((p) => arrowKey(p) === arrowKey(a))),
      ...engineArrows().filter((a) => !taken.has(arrowKey(a))),
      ...suggestionArrows(),
      ...preview,
    ];
    cg.setShapes(shapes as unknown as DrawShape[]);
  });

  onCleanup(() => {
    motionPreference?.removeEventListener("change", syncAnimationPreference);
    cg?.destroy();
  });

  return (
    <div class="board-wrap">
      <div ref={el} class="cg-wrap" />
    </div>
  );
}
