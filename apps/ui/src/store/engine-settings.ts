import { createSignal } from "solid-js";

export const STANDARD_ANALYSIS_DEPTH = 20;
export const DEEP_ANALYSIS_DEPTH = 30;

export type AnalysisMode = "standard" | "deep";

const [analysisMode, setAnalysisMode] = createSignal<AnalysisMode>("standard");
const analysisDepth = () => analysisMode() === "deep" ? DEEP_ANALYSIS_DEPTH : STANDARD_ANALYSIS_DEPTH;

export { analysisMode, setAnalysisMode, analysisDepth };
