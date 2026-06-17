/**
 * Engine analysis of the current position, projected onto the board as arrows and into the
 * AnalysisPanel as a line list. Re-runs (debounced) whenever the position, path, or repertoire
 * color changes. Top-N engine moves are classified by repertoire fit (chess-tools) and weighted
 * by your-side eval — the two dimensions of the UI_DESIGN.md color system.
 */
import { createSignal, createEffect, onCleanup } from "solid-js";
import { classifyUciMove, weightFor, type Fit, type Weight } from "@chess-mcp/chess-tools";
import { fen, currentTree, currentPath, color } from "./game";
import { analyseMulti } from "../engine/stockfish";

export interface EngineLine {
  uci: string;
  san: string;
  fit: Fit;
  weight: Weight;
  cp: number | null;
  mate: number | null;
  depth: number;
}

/** chessground DrawShape (typed loosely here; Board casts to the chessground type). */
export interface Arrow {
  orig: string;
  dest: string;
  brush: string;
  modifiers?: { lineWidth?: number };
}

const MULTIPV = 3;
const FIT_BRUSH: Record<Fit, string> = { "in-book": "green", adjacent: "yellow", out: "red" };
const WEIGHT_PX: Record<Weight, number> = { thick: 14, medium: 10, thin: 6 };

const [engineLines, setLines] = createSignal<EngineLine[]>([]);
const [engineArrows, setArrows] = createSignal<Arrow[]>([]);
const [analysing, setAnalysing] = createSignal(false);
const [engineOffline, setEngineOffline] = createSignal(false);
const [evalEnabled, setEvalEnabled] = createSignal(false);

export { engineLines, engineArrows, analysing, engineOffline, evalEnabled, setEvalEnabled };

function toArrow(l: EngineLine): Arrow {
  return {
    orig: l.uci.slice(0, 2),
    dest: l.uci.slice(2, 4),
    brush: FIT_BRUSH[l.fit],
    modifiers: { lineWidth: WEIGHT_PX[l.weight] },
  };
}

createEffect(() => {
  // Capture reactive reads synchronously, before any await.
  const f = fen();
  const tree = currentTree();
  const path = currentPath();
  const col = color();
  const enabled = evalEnabled();

  if (!enabled) {
    setAnalysing(false);
    setLines([]);
    setArrows([]);
    return;
  }

  let cancelled = false;
  const t = setTimeout(() => {
    setAnalysing(true);
    void analyseMulti(f, MULTIPV).then((res) => {
      if (cancelled) return;
      setAnalysing(false);
      if (!res) {
        setEngineOffline(true);
        setLines([]);
        setArrows([]);
        return;
      }
      const childSans = tree.childSansAt(path);
      const keys = tree.allPositionKeys();
      const lines: EngineLine[] = res.map((l) => {
        const { san, fit } = classifyUciMove(f, l.uci, childSans, keys);
        return { uci: l.uci, san, fit, weight: weightFor(l.cp, l.mate, col), cp: l.cp, mate: l.mate, depth: l.depth };
      });
      setLines(lines);
      setArrows(lines.map(toArrow));
    });
  }, 180);

  onCleanup(() => {
    cancelled = true;
    clearTimeout(t);
  });
});
