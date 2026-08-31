/**
 * Engine analysis of the current position, projected onto the board as arrows and into the
 * AnalysisPanel as a line list. Re-runs (debounced) whenever the position, path, or repertoire
 * color changes. Top-N engine moves are classified by repertoire fit (chess-tools) and weighted
 * by your-side eval — the two dimensions of the UI_DESIGN.md color system.
 */
import { createSignal, createEffect, onCleanup } from "solid-js";
import { classifyUciMove, weightFor, type Fit, type Weight } from "@chess-mcp/chess-tools";
import { ANALYSIS_ARROW_BRUSHES } from "../content/analysis";
import { fen, currentTree, currentPath, color } from "./game";
import { analyseLive } from "../engine/stockfish";
import { analysisDepth } from "./engine-settings";
import { announce } from "./announce";
import { registerOperation, updateOperationStatus } from "./operations";

/**
 * Settle an analysis-pass operation without the registry's announcement: live analysis completes
 * many times per minute while browsing, and announcing each would be exactly the speech flood
 * WP-009 exists to prevent. The registry entry still settles for activity views.
 */
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

/**
 * WP-009 test seam: exercise the offline announcement without a real dead engine. It runs the
 * same transition the search-failure path uses, including the sticky-banner guard.
 */
export function announceEngineOfflineForTesting() {
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
    // WP-010: the live analysis pass registers as an operation so the registry answers "what is
    // running right now?" uniformly. Settled silently — the analysis pass completes many times
    // per minute while browsing, and announcing each would be exactly the speech flood WP-009
    // exists to prevent. The registry entry still shows in any activity view.
    const operationId = registerOperation({
      kind: "live-analysis",
      label: "Live engine analysis",
      surface: "analysis",
    });
    // Dedicated live worker (P1): browsing positions never queues behind a scan burst.
    // The continuation runs after the search resolves, outside any tracked scope on purpose: it
    // reports a finished operation rather than deriving reactive state.
    void analyseLive(f, MULTIPV, depth).then(
      // eslint-disable-next-line solid/reactivity
      (res) => {
        // A superseded pass still owns a registry entry. Returning without settling it leaves the
        // operation running forever, which keeps runningOperations() permanently non-empty — that
        // strands the activity strip and, because pwa/updates.ts gates the update prompt on an
        // empty registry, suppresses the WP-019 prompt for the rest of the session.
        if (cancelled) {
          settleSilent(operationId, "completed");
          return;
        }
        setAnalysing(false);
        settleSilent(operationId, res ? "completed" : "failed");
        if (!res) {
          // Announce only on the offline transition, not per failed search — a dead engine would
          // otherwise re-announce on every position change. engineOffline() is read once, here,
          // as a plain value: this callback runs outside any tracked scope by design.
          const wasOffline = engineOffline();
          if (!wasOffline) announce("The chess engine went offline.", { assertive: true });
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
      },
      // A rejected search owns the same entry and must release it too.
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
