import { createSignal } from "solid-js";

export const MIN_ANALYSIS_DEPTH = 1;
export const MAX_ANALYSIS_DEPTH = 30;
export const STANDARD_ANALYSIS_DEPTH = 20;

const clampDepth = (depth: number) => Math.max(MIN_ANALYSIS_DEPTH, Math.min(MAX_ANALYSIS_DEPTH, Math.round(depth)));

const [analysisDepth, setDepth] = createSignal(STANDARD_ANALYSIS_DEPTH);
const setAnalysisDepth = (depth: number) => {
  if (Number.isFinite(depth)) setDepth(clampDepth(depth));
};

export { analysisDepth, setAnalysisDepth };
