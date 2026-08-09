/**
 * Engine analysis of the current position, projected onto the board as arrows and into the
 * AnalysisPanel as a line list. Re-runs (debounced) whenever the position, path, or repertoire
 * color changes. Top-N engine moves are classified by repertoire fit (chess-tools) and weighted
 * by your-side eval — the two dimensions of the UI_DESIGN.md color system.
 */
import { createSignal, createEffect, onCleanup } from "solid-js";
import { classifyUciMove, weightFor, type Fit, type Weight } from "@chess-mcp/chess-tools";
import { fen, currentTree, currentPath, color } from "./game";
import { analyseLive } from "../engine/stockfish";
import { analysisDepth } from "./engine-settings";

export interface EngineLine {
  uci: string;
  san: string;
  fit: Fit;
  weight: Weight;
  cp: number | null;
  mate: number | null;
  depth: number;
}

export type AnalysisState = "off" | "starting" | "analysing" | "ready" | "offline";

export interface AnalysisStateInput {
  readonly evalEnabled: boolean;
  readonly analysing: boolean;
  readonly engineOffline: boolean;
  readonly hasLines: boolean;
}

/**
 * The visible engine lifecycle is intentionally derived from the same signals that drive the
 * worker. In particular, an enabled engine with no line yet is "starting" during the debounce
 * as well as during its first search, rather than being mistaken for an engine that is off.
 */
export function deriveAnalysisState(input: AnalysisStateInput): AnalysisState {
  if (!input.evalEnabled) return "off";
  if (input.engineOffline) return "offline";
  if (!input.hasLines) return "starting";
  return input.analysing ? "analysing" : "ready";
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
const [analysisReload, setAnalysisReload] = createSignal(0);

const analysisState = (): AnalysisState =>
  deriveAnalysisState({
    evalEnabled: evalEnabled(),
    analysing: analysing(),
    engineOffline: engineOffline(),
    hasLines: engineLines().length > 0,
  });

/** Re-run the live-worker request without changing any analysis preferences. */
const reloadAnalysis = () => setAnalysisReload((version) => version + 1);

export {
  engineLines,
  engineArrows,
  analysing,
  engineOffline,
  evalEnabled,
  setEvalEnabled,
  analysisState,
  reloadAnalysis,
};

export const repertoireArrows = (): Arrow[] =>
  currentTree()
    .childMovesAt(currentPath())
    .map((m) => ({
      orig: m.orig,
      dest: m.dest,
      brush: "green",
      modifiers: { lineWidth: 7 },
    }));

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
  const depth = analysisDepth();
  analysisReload(); // dependency for the explicit offline recovery action

  if (!enabled) {
    setAnalysing(false);
    setLines([]);
    setArrows([]);
    return;
  }

  let cancelled = false;
  const t = setTimeout(() => {
    setAnalysing(true);
    // Dedicated live worker (P1): browsing positions never queues behind a scan burst.
    void analyseLive(f, MULTIPV, depth).then((res) => {
      if (cancelled) return;
      setAnalysing(false);
      if (!res) {
        setEngineOffline(true);
        setLines([]);
        setArrows([]);
        return;
      }
      setEngineOffline(false); // a later search succeeded — clear the sticky offline banner
      const childSans = tree.childSansAt(path);
      const keys = tree.allPositionKeys();
      const lines: EngineLine[] = res.map((l) => {
        const { san, fit } = classifyUciMove(f, l.uci, childSans, keys);
        return {
          uci: l.uci,
          san,
          fit,
          weight: weightFor(l.cp, l.mate, col),
          cp: l.cp,
          mate: l.mate,
          depth: l.depth,
        };
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
