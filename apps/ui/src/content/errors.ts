export interface ErrorContent {
  readonly title: string;
  readonly cause?: string;
  /** Stable discriminator for the card's recovery action, if the failure has one the user can act on. */
  readonly actionKey?: "retry" | "add-token";
  /** Display label derived from the key at the call site; never matched against. */
  readonly action?: string;
}

export const ERROR_CONTENT = {
  invalid_arguments: { title: "Invalid command arguments" },
  invalid_fen: { title: "invalid fen" },
  // WP-026 AC-4: retryable and token-gated failures carry their recovery action.
  engine_unavailable: {
    title: "Local engine unavailable",
    actionKey: "retry",
    action: "Retry",
  },
  cancelled: { title: "Cancelled" },
  explorer_auth_required: {
    title: "Lichess token required",
    actionKey: "add-token",
    action: "Add Lichess token",
  },
  fetch_failed: { title: "Network request failed" },
  missing_arg: { title: "missing arg" },
  missing_criteria: { title: "Search criteria required" },
  unknown_structure: { title: "unknown structure" },
  path_not_found: { title: "Repertoire path not found" },
  strategic_fit_finding_not_found: {
    title: "Strategic Fit finding is unavailable",
  },
  strategic_fit_report_unavailable: {
    title: "Strategic Fit report is no longer cached",
  },
  strategic_fit_missing_report_identity: {
    title: "Strategic Fit report identity required",
  },
  strategic_fit_missing_finding_identity: {
    title: "Strategic Fit finding identity required",
  },
  strategic_fit_stale_page_cursor: {
    title: "Strategic Fit page cursor is stale",
  },
  strategic_fit_intent_empty_proposal: { title: "Profile proposal was empty" },
  strategic_fit_intent_invalid_mode: { title: "Unknown profile mode" },
  strategic_fit_intent_unknown_field: { title: "Unknown profile preference" },
  strategic_fit_intent_invalid_value: {
    title: "Profile value is out of range",
  },
  strategic_fit_intent_invalid_concept_id: {
    title: "Unknown Strategic Fit concept",
  },
  strategic_fit_intent_conflicting_concepts: {
    title: "Concept is both preferred and avoided",
  },
  strategic_fit_intent_no_change: {
    title: "Profile already matches the proposal",
  },
  strategic_fit_intent_proposal_stale: { title: "Profile proposal is stale" },
  strategic_fit_intent_proposal_not_pending: {
    title: "Profile proposal is no longer pending",
  },
  strategic_fit_plan_empty: { title: "Plan card was empty" },
  strategic_fit_plan_invalid_section: { title: "Plan section is not valid" },
  strategic_fit_plan_invalid_value: { title: "Plan value is out of bounds" },
  strategic_fit_plan_missing_support: {
    title: "Plan section cites no evidence",
  },
  strategic_fit_plan_unsupported_concept: {
    title: "Concept is not part of this finding",
  },
  strategic_fit_plan_unsupported_checkpoint: {
    title: "Checkpoint is not part of this finding",
  },
  strategic_fit_plan_unsupported_drill: {
    title: "Drill is not part of this finding",
  },
  strategic_fit_plan_unsupported_move: {
    title: "Move is not on a validated path",
  },
  strategic_fit_plan_unsupported_model_game: {
    title: "Model game or position is unsupported",
  },
  strategic_fit_plan_evidence_unavailable: {
    title: "Plan evidence is unavailable",
  },
  strategic_fit_plan_stale: { title: "Plan card is stale" },
  strategic_fit_plan_not_pending: { title: "Plan card is no longer pending" },
  strategic_fit_portfolio_empty_constraints: {
    title: "Redesign bounds were empty",
  },
  strategic_fit_portfolio_unknown_constraint: {
    title: "Unknown redesign bound",
  },
  strategic_fit_portfolio_invalid_value: {
    title: "Redesign bound is out of range",
  },
  strategic_fit_portfolio_unconfirmed_constraints: {
    title: "Redesign bounds are not confirmed",
  },
  strategic_fit_portfolio_evidence_unavailable: {
    title: "No candidates to build a portfolio from",
  },
  strategic_fit_portfolio_unknown_option: {
    title: "Portfolio option does not exist",
  },
  strategic_fit_portfolio_stale: { title: "Redesign bounds are stale" },
  strategic_fit_portfolio_not_pending: {
    title: "Redesign bounds are no longer pending",
  },
  strategic_fit_stale_report: { title: "Strategic Fit report is stale" },
  strategic_fit_stale_revision: { title: "Strategic Fit report is stale" },
  variation_not_found: { title: "Repertoire path not found" },
  stale_revision: { title: "Document changed" },
} as const satisfies Readonly<Record<string, ErrorContent>>;

type ContentErrorCode = keyof typeof ERROR_CONTENT;

export function errorContent(code: string): ErrorContent {
  return Object.prototype.hasOwnProperty.call(ERROR_CONTENT, code)
    ? ERROR_CONTENT[code as ContentErrorCode]
    : { title: code.replace(/_/g, " ") };
}
