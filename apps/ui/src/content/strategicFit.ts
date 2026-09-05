export const STRATEGIC_FIT_ENTRY = {
  question: "Is your repertoire asking you to learn too many different plans?",
  summary:
    "Strategic Fit compares the ideas behind your lines and flags the ones that stand apart from the rest.",
  reassurance: "Opening it does not analyze or change this repertoire.",
  action: "Open Strategic Fit",
} as const;

export const STRATEGIC_FIT_EVIDENCE = {
  noneTitle: "Not enough comparable evidence to analyze",
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
    "The evidence-check results above list every route and the specific issue found with each one. Nothing was changed.",
  limitedBanner:
    "Some routes did not reach the depth needed to compare, so these findings rest on part of the repertoire rather than all of it. The evidence-check results list which routes and why.",
  limitedBannerTitle: "Limited evidence",
} as const;

export { strategicFitPlanSectionLabel } from "@chess-mcp/chess-tools";
export { STRATEGIC_FIT_LIFECYCLE_LABELS } from "../components/strategic-fit/AnalysisLifecycle";
export { STRATEGIC_FIT_PROFILE_LABELS } from "../components/strategic-fit/ProfileSetup";

export const STRATEGIC_FIT_VOCABULARY = {
  evidenceCheck: {
    title: "Evidence check results",
    kicker: "Input and evidence check",
    hide: "Hide evidence-check details",
    routeCountsLabel: "Evidence-check route counts",
    findingsLabel: "Evidence-check findings",
    states: {
      blocked: {
        label: "Evidence check blocked",
        description:
          "Input validation stopped the analysis. Only move-order normalization ran; five dependent phases were not run.",
      },
      degraded: {
        label: "Evidence check limited",
        description:
          "Analysis completed with evidence limitations. These limits constrain what the report can support.",
      },
      ready: {
        label: "Evidence check passed",
        description:
          "The repertoire could proceed through deterministic analysis. This check confirms analyzability, not strategic quality.",
      },
    },
  },
  resolutionHelp: {
    kicker: "5. Did this help?",
    title: "Check what changed",
    statuses: {
      idle: "No accepted change to check",
      "awaiting-rescan": "Waiting to check the affected lines",
      rescanning: "Checking the affected lines",
      proven: "The new evidence is ready",
      superseded: "Another edit replaced this check",
      "rescan-failed": "The evidence check failed",
      "rescan-cancelled": "The evidence check was cancelled",
      undoing: "Undoing the accepted change",
      "undo-blocked": "The undo could not be applied",
      undone: "The undo was applied and checked",
    },
  },
  training: {
    kicker: "Keep and train this line",
    title: "Build a basic drill",
  },
  tradeoffs: {
    title: "Option tradeoffs",
    column: "Tradeoff status",
    detailTitle: "Evaluation and tradeoff evidence",
    caption:
      "Candidate comparison. Measures stay separate; a tradeoff status never means one aggregate best candidate.",
    chartTitle: "Tradeoff comparison",
    chartDescription:
      "Horizontal position shows repertoire-POV loss from engine best; vertical position shows familiarity. Point size shows coverage and the inner ring shows memory burden. Symbols: ◇ no better option on every measure, □ beaten on every measure, × unscored. No aggregate best is calculated or implied.",
    expert: "Expert term: Pareto frontier status.",
  },
  strategicDistanceDefinition:
    "Strategic distance is a normalized measure of how far a line's plans and structures differ from its comparison route.",
  advancedPreferences: {
    definition:
      "These four preferences control how strongly each source or tradeoff affects the review. Zero removes its influence; one gives it full influence.",
    effects: {
      opponentPopularity: "Common replies",
      personalHistory: "Your experience",
      manualWeight: "Saved priorities",
      memorization: "Study load",
    },
  },
} as const;

export function strategicFitTradeoffStatus(
  status: string,
  dominatedBy: readonly string[],
): { plain: string; expert: string } {
  if (status === "pareto-optimal") {
    return { plain: "No better option on every measure", expert: "Pareto-optimal" };
  }
  if (status === "dominated") {
    return {
      plain:
        dominatedBy.length > 0 ? `Beaten by ${dominatedBy.join(", ")}` : "Beaten on every measure",
      expert: "Pareto-dominated",
    };
  }
  return { plain: "Not enough evidence to compare", expert: "Pareto status unavailable" };
}

export const STRATEGIC_FIT_PROTECTED_STATEMENTS = {
  withheldEvidence: "Withheld evidence exists; it is not absent, and it cannot be cited in a plan",
  stagedSave: "Nothing is saved until you accept",
  unboundPreference: "Nothing is bound and no preference was saved",
  fabricatedPosition:
    "This route shares no supported comparable evidence with an anchor route, so a position would be fabricated rather than measured",
  analysisProgress: "Analysis in progress",
  reportCurrency: "Nothing is current until the report completes",
} as const;
