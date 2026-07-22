import type { StrategicFitAnalysisManifest } from "./types.js";

export const STRATEGIC_FIT_SCHEMA_VERSION = "2.0.0";
export const STRATEGIC_FIT_ANALYSIS_VERSION = "2.0.0";

/**
 * Frozen component manifest for reproducible Strategic Fit result and cache identities.
 * Component versions advance independently when their deterministic behavior changes.
 */
export const STRATEGIC_FIT_ANALYSIS_MANIFEST: StrategicFitAnalysisManifest = Object.freeze({
  schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  components: Object.freeze({
    graph: "1.0.0",
    taxonomy: "1.0.0",
    checkpoints: "1.0.0",
    "pawn-signals": "1.0.0",
    "position-signals": "1.0.0",
    trajectory: "1.0.0",
    concepts: "1.0.0",
    weights: "1.0.0",
    popularity: "1.0.0",
    "personal-history": "1.0.0",
    cohorts: "1.0.0",
    modes: "1.0.0",
    distance: "1.0.0",
    confidence: "1.0.0",
    causality: "1.0.0",
    findings: "1.0.0",
    metrics: "1.0.0",
  }),
});
