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

/**
 * WP-031: copy for the two evidence-limited states.
 *
 * The zero-comparable-route case is terminal — the analysis ran, but no route reached the
 * comparable-ply threshold, so there is nothing to compare and every finding would be a statement
 * about missing data. The remedies are the two things that actually change that outcome.
 */
export const STRATEGIC_FIT_EVIDENCE = {
  noneTitle: "Not enough comparable evidence to analyze",
  /** `ply` is the threshold the run reported; the sentence adapts when it is unavailable. */
  noneBody: (routeCount: number, comparableCount: number, ply: number | null) =>
    ply === null
      ? `This repertoire has ${routeCount} ${routeCount === 1 ? "route" : "routes"}, and ${comparableCount} of them reach far enough to compare. Strategic Fit compares the ideas behind lines that run deep enough to have ideas, so there is nothing for it to weigh up yet.`
      : `This repertoire has ${routeCount} ${routeCount === 1 ? "route" : "routes"}, and ${comparableCount} of them reach ply ${ply}, where lines run deep enough to compare. Strategic Fit weighs the ideas behind comparable lines against each other, so there is nothing for it to compare yet.`,
  noneRemediesTitle: "What will change this",
  noneRemedies: [
    {
      id: "extend-lines",
      title: "Extend your lines past the opening moves",
      body: "Play the main continuations out further, so each route reaches the depth where the resulting plans are actually visible.",
    },
    {
      id: "add-routes",
      title: "Add more of the repertoire",
      body: "Strategic Fit compares routes against each other, so it needs several comparable lines rather than one deep one.",
    },
  ],
  noneFooter:
    "The preflight results above list every route and the specific issue found with each one. Nothing was changed.",
  limitedBanner:
    "Some routes did not reach the depth needed to compare, so these findings rest on part of the repertoire rather than all of it. The preflight results list which routes and why.",
  limitedBannerTitle: "Limited evidence",
} as const;

export { strategicFitPlanSectionLabel } from "@chess-mcp/chess-tools";
export { STRATEGIC_FIT_LIFECYCLE_LABELS } from "../components/strategic-fit/AnalysisLifecycle";
export { STRATEGIC_FIT_PROFILE_LABELS } from "../components/strategic-fit/ProfileSetup";
