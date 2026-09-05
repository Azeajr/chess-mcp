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
import BoardKeyboardLayer from "./BoardKeyboardLayer";

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
    const brushes = cg.state.drawable.brushes as Record<string, DrawBrush>;
    brushes.gold = {
      key: "gold",
      color: "#e3b341",
      opacity: 0.95,
      lineWidth: 10,
    };
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

  createEffect(() => {
    if (!cg) return;
    const book = repertoireArrows();
    const preview = previewArrow();
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
      {/* WP-014: additive overlay only — see BoardKeyboardLayer's own header for why this never
          touches the chessground `Api` above, which is what keeps this safe to add here. */}
      <BoardKeyboardLayer />
    </div>
  );
}
