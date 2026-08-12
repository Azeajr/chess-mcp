import type { AnalysisState } from "../store/analysis";
import type { Fit, Weight } from "@chess-mcp/chess-tools";
import { evaluationText, type EvaluationValue } from "./format";

export const CLOUD_EVALUATION_PRIVACY_NOTE =
  "Sends each browsed position (FEN only) to Lichess for a cloud second opinion. Turn off to keep prep lines fully on this machine — local Stockfish is unaffected.";

export const ANALYSIS_CONTENT = {
  title: "Engine",
  status: {
    off: "off",
    starting: "starting…",
    analysing: "analysing…",
    ready: "ready",
    offline: "offline",
  } satisfies Record<AnalysisState, string>,
  empty: {
    off: "Engine evaluation is off.",
    starting: "Starting engine analysis…",
    analysing: "Analysing this position…",
    ready: "No engine lines were returned.",
    offline: "Engine offline — arrows unavailable.",
  } satisfies Record<AnalysisState, string>,
  actions: {
    enable: "Turn on evaluation",
    reload: "Reload engine",
  },
  settings: {
    summary: "Engine settings",
    evaluation: "Engine evaluation",
    depth: "Analysis depth",
    depthSlider: "Analysis depth slider",
    cloudEvaluation: "Lichess cloud eval",
    deepAnalysisHelper: (depth: number) =>
      `Deep analysis is enabled. Every engine task will use depth ${depth} and may take several minutes.`,
  },
  progress: "Position analysis in progress",
  arrows: {
    summary: "Arrow legend",
    fitHeading: "Engine arrow colour — repertoire fit",
    weightHeading: "Engine arrow thickness — evaluation strength",
    sourceHeading: "Arrow source",
    fit: {
      "in-book": { plain: "In repertoire", expert: "book" },
      adjacent: { plain: "Related position", expert: "adj" },
      out: { plain: "Outside repertoire", expert: "out" },
    } satisfies Record<Fit, { plain: string; expert: string }>,
    weight: {
      thick: { plain: "Strong", expert: "thick" },
      medium: { plain: "Close", expert: "medium" },
      thin: { plain: "Weaker", expert: "thin" },
    } satisfies Record<Weight, { plain: string; expert: string }>,
    source: {
      repertoire: "Repertoire move — thin teal arrow",
      engine: "Engine move — fit colour with strength thickness",
    },
  },
} as const;

function evaluationSummary(value: EvaluationValue): string {
  if (value.mate !== null) {
    return `mate in ${Math.abs(value.mate)} for ${value.mate > 0 ? "white" : "black"}`;
  }
  const centipawns = value.cp ?? 0;
  if (centipawns > 20) return "white slightly better";
  if (centipawns < -20) return "black slightly better";
  return "even";
}

export function evaluationAriaLabel(state: AnalysisState, value: EvaluationValue | null): string {
  if (state === "off") return "Evaluation unavailable — engine off";
  if (state === "offline") return "Evaluation unavailable — engine offline";
  if (!value) {
    return `Evaluation unavailable — engine ${state === "starting" ? "starting" : "analysing"}`;
  }
  return `Evaluation: ${evaluationText(value)}, ${evaluationSummary(value)}`;
}
