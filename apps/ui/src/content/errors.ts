export type ErrorRecoveryAction = "retry" | "open-settings" | "open-lichess-token" | "none";

export interface ErrorContent {
  readonly title: string;
  readonly cause: string;
  readonly action: ErrorRecoveryAction;
}

const NO_RECOVERY = {
  cause: "This request could not be completed.",
  action: "none",
} as const;

export const ERROR_CONTENT = {
  invalid_arguments: { ...NO_RECOVERY, title: "Invalid command arguments" },
  invalid_fen: { ...NO_RECOVERY, title: "invalid fen" },
  engine_unavailable: {
    title: "Local engine unavailable",
    cause: "The local analysis engine is not ready right now.",
    action: "retry",
  },
  cancelled: {
    title: "Cancelled",
    cause: "The request stopped before it completed.",
    action: "retry",
  },
  explorer_auth_required: {
    title: "Lichess token required",
    cause: "The Lichess opening explorer needs a personal token before it can run.",
    action: "open-lichess-token",
  },
  fetch_failed: {
    title: "Network request failed",
    cause: "The service could not be reached.",
    action: "retry",
  },
  missing_arg: { ...NO_RECOVERY, title: "missing arg" },
  missing_criteria: { ...NO_RECOVERY, title: "Search criteria required" },
  unknown_structure: { ...NO_RECOVERY, title: "unknown structure" },
  path_not_found: { ...NO_RECOVERY, title: "Repertoire path not found" },
  strategic_fit_finding_not_found: {
    ...NO_RECOVERY,
    title: "Strategic Fit finding is unavailable",
  },
  strategic_fit_report_unavailable: {
    ...NO_RECOVERY,
    title: "Strategic Fit report is no longer cached",
  },
  strategic_fit_missing_report_identity: {
    ...NO_RECOVERY,
    title: "Strategic Fit report identity required",
  },
  strategic_fit_missing_finding_identity: {
    ...NO_RECOVERY,
    title: "Strategic Fit finding identity required",
  },
  strategic_fit_stale_page_cursor: { ...NO_RECOVERY, title: "Strategic Fit page cursor is stale" },
  strategic_fit_intent_empty_proposal: { ...NO_RECOVERY, title: "Profile proposal was empty" },
  strategic_fit_intent_invalid_mode: { ...NO_RECOVERY, title: "Unknown profile mode" },
  strategic_fit_intent_unknown_field: { ...NO_RECOVERY, title: "Unknown profile preference" },
  strategic_fit_intent_invalid_value: { ...NO_RECOVERY, title: "Profile value is out of range" },
  strategic_fit_intent_invalid_concept_id: {
    ...NO_RECOVERY,
    title: "Unknown Strategic Fit concept",
  },
  strategic_fit_intent_conflicting_concepts: {
    ...NO_RECOVERY,
    title: "Concept is both preferred and avoided",
  },
  strategic_fit_intent_no_change: { ...NO_RECOVERY, title: "Profile already matches the proposal" },
  strategic_fit_intent_proposal_stale: { ...NO_RECOVERY, title: "Profile proposal is stale" },
  strategic_fit_intent_proposal_not_pending: {
    ...NO_RECOVERY,
    title: "Profile proposal is no longer pending",
  },
  strategic_fit_plan_empty: { ...NO_RECOVERY, title: "Plan card was empty" },
  strategic_fit_plan_invalid_section: { ...NO_RECOVERY, title: "Plan section is not valid" },
  strategic_fit_plan_invalid_value: { ...NO_RECOVERY, title: "Plan value is out of bounds" },
  strategic_fit_plan_missing_support: { ...NO_RECOVERY, title: "Plan section cites no evidence" },
  strategic_fit_plan_unsupported_concept: {
    ...NO_RECOVERY,
    title: "Concept is not part of this finding",
  },
  strategic_fit_plan_unsupported_checkpoint: {
    ...NO_RECOVERY,
    title: "Checkpoint is not part of this finding",
  },
  strategic_fit_plan_unsupported_drill: {
    ...NO_RECOVERY,
    title: "Drill is not part of this finding",
  },
  strategic_fit_plan_unsupported_move: {
    ...NO_RECOVERY,
    title: "Move is not on a validated path",
  },
  strategic_fit_plan_unsupported_model_game: {
    ...NO_RECOVERY,
    title: "Model game or position is unsupported",
  },
  strategic_fit_plan_evidence_unavailable: {
    ...NO_RECOVERY,
    title: "Plan evidence is unavailable",
  },
  strategic_fit_plan_stale: { ...NO_RECOVERY, title: "Plan card is stale" },
  strategic_fit_plan_not_pending: { ...NO_RECOVERY, title: "Plan card is no longer pending" },
  strategic_fit_portfolio_empty_constraints: {
    ...NO_RECOVERY,
    title: "Redesign bounds were empty",
  },
  strategic_fit_portfolio_unknown_constraint: { ...NO_RECOVERY, title: "Unknown redesign bound" },
  strategic_fit_portfolio_invalid_value: {
    ...NO_RECOVERY,
    title: "Redesign bound is out of range",
  },
  strategic_fit_portfolio_unconfirmed_constraints: {
    ...NO_RECOVERY,
    title: "Redesign bounds are not confirmed",
  },
  strategic_fit_portfolio_evidence_unavailable: {
    ...NO_RECOVERY,
    title: "No candidates to build a portfolio from",
  },
  strategic_fit_portfolio_unknown_option: {
    ...NO_RECOVERY,
    title: "Portfolio option does not exist",
  },
  strategic_fit_portfolio_stale: { ...NO_RECOVERY, title: "Redesign bounds are stale" },
  strategic_fit_portfolio_not_pending: {
    ...NO_RECOVERY,
    title: "Redesign bounds are no longer pending",
  },
  strategic_fit_stale_report: { ...NO_RECOVERY, title: "Strategic Fit report is stale" },
  strategic_fit_stale_revision: { ...NO_RECOVERY, title: "Strategic Fit report is stale" },
  variation_not_found: { ...NO_RECOVERY, title: "Repertoire path not found" },
  stale_revision: { ...NO_RECOVERY, title: "Document changed" },
} as const satisfies Readonly<Record<string, ErrorContent>>;

export type ContentErrorCode = keyof typeof ERROR_CONTENT;

export function errorContent(code: string): ErrorContent {
  return Object.prototype.hasOwnProperty.call(ERROR_CONTENT, code)
    ? ERROR_CONTENT[code as ContentErrorCode]
    : { ...NO_RECOVERY, title: code.replace(/_/g, " ") };
}
