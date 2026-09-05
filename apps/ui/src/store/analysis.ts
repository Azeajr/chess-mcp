import { createSignal, createEffect, onCleanup } from "solid-js";
import { classifyUciMove, weightFor, type Fit, type Weight } from "@chess-mcp/chess-tools";
import { ANALYSIS_ARROW_BRUSHES } from "../content/analysis";
import { fen, currentTree, currentPath, color } from "./game";
import { analyseLive } from "../engine/stockfish";
import { analysisDepth } from "./engine-settings";
import { announce } from "./announce";
import { registerOperation, updateOperationStatus } from "./operations";
import { assertTestOnly } from "./test-seam";

function settleSilent(id: string, status: "completed" | "failed") {
  updateOperationStatus(id, status);
}

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

export function deriveAnalysisState(input: AnalysisStateInput): AnalysisState {
  if (!input.evalEnabled) return "off";
  if (input.engineOffline) return "offline";
  if (!input.hasLines) return "starting";
  return input.analysing ? "analysing" : "ready";
}

export interface Arrow {
  orig: string;
  dest: string;
  brush: string;
  modifiers?: { lineWidth?: number };
}

const MULTIPV = 3;
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

const reloadAnalysis = () => setAnalysisReload((version) => version + 1);

export function announceEngineOfflineForTesting() {
  assertTestOnly();
  if (!engineOffline()) announce("The chess engine went offline.", { assertive: true });
  setEngineOffline(true);
}

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
      brush: ANALYSIS_ARROW_BRUSHES.repertoire.brush,
      modifiers: { lineWidth: ANALYSIS_ARROW_BRUSHES.repertoire.lineWidth },
    }));

function toArrow(l: EngineLine): Arrow {
  return {
    orig: l.uci.slice(0, 2),
    dest: l.uci.slice(2, 4),
    brush: ANALYSIS_ARROW_BRUSHES.fit[l.fit].brush,
    modifiers: { lineWidth: WEIGHT_PX[l.weight] },
  };
}

createEffect(() => {
  const f = fen();
  const tree = currentTree();
  const path = currentPath();
  const col = color();
  const enabled = evalEnabled();
  const depth = analysisDepth();
  analysisReload();

  if (!enabled) {
    setAnalysing(false);
    setLines([]);
    setArrows([]);
    return;
  }

  let cancelled = false;
  const t = setTimeout(() => {
    setAnalysing(true);
    const operationId = registerOperation({
      kind: "live-analysis",
      label: "Live engine analysis",
      surface: "analysis",
    });
    void analyseLive(f, MULTIPV, depth).then(
      // eslint-disable-next-line solid/reactivity
      (res) => {
        if (cancelled) {
          settleSilent(operationId, "completed");
          return;
        }
        setAnalysing(false);
        settleSilent(operationId, res ? "completed" : "failed");
        if (!res) {
          const wasOffline = engineOffline();
          if (!wasOffline) announce("The chess engine went offline.", { assertive: true });
          setEngineOffline(true);
          setLines([]);
          setArrows([]);
          return;
        }
        setEngineOffline(false);
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
      },
      () => {
        settleSilent(operationId, "failed");
        if (cancelled) return;
        setAnalysing(false);
      },
    );
  }, 180);

  onCleanup(() => {
    cancelled = true;
    clearTimeout(t);
  });
});
