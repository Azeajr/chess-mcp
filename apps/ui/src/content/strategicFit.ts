/**
 * Side-panel entry point. The card leads with the user's problem rather than the feature's name,
 * and keeps the no-side-effects sentence the audit identified as already correct.
 */
export const STRATEGIC_FIT_ENTRY = {
  question: "Is your repertoire asking you to learn too many different plans?",
  summary:
    "Strategic Fit compares the ideas behind your lines and flags the ones that stand apart from the rest.",
  reassurance: "Opening it does not analyze or change this repertoire.",
  action: "Open Strategic Fit",
} as const;

export { strategicFitPlanSectionLabel } from "@chess-mcp/chess-tools";
export { STRATEGIC_FIT_LIFECYCLE_LABELS } from "../components/strategic-fit/AnalysisLifecycle";
export { STRATEGIC_FIT_PROFILE_LABELS } from "../components/strategic-fit/ProfileSetup";
