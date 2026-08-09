import type { BrowserCommandName } from "../application/browser-commands/types";

export interface ContentLabel {
  readonly plain: string;
  readonly expert?: string;
}

export const TOOL_LABELS = {
  validate_fen: { plain: "Validate Fen" },
  validate_pgn: { plain: "Validate Pgn" },
  validate_line: { plain: "Validate Line" },
  get_legal_moves: { plain: "Get Legal Moves" },
  get_position: { plain: "Get Position" },
  evaluate_position: { plain: "Evaluate Position" },
  compare_moves: { plain: "Compare Moves" },
  cloud_eval: { plain: "Cloud Eval" },
  tablebase_lookup: { plain: "Tablebase Lookup" },
  position_popularity: { plain: "Position Popularity" },
  identify_opening: { plain: "Identify Opening" },
  find_repertoire_gaps: { plain: "Find Repertoire Gaps" },
  suggest_gap_fills: { plain: "Suggest Gap Fills" },
  find_theory_depth: { plain: "Find Theory Depth" },
  get_transpositions: { plain: "Get Transpositions" },
  find_pruning_transpositions: { plain: "Find Pruning Transpositions" },
  get_repertoire_coverage: { plain: "Get Repertoire Coverage" },
  get_structural_profile: { plain: "Get Structural Profile" },
  analyze_repertoire_congruence: { plain: "Analyze Repertoire Congruence" },
  get_strategic_fit_report: { plain: "Get Strategic Fit Report" },
  classify_illustrative_lines: { plain: "Classify Illustrative Lines" },
  modify_repertoire_line: { plain: "Modify Repertoire Line" },
  suggest_complementary_lines: { plain: "Suggest Complementary Lines" },
  suggest_replacement_line: { plain: "Suggest Replacement Line" },
  analyze_game: { plain: "Analyze Game" },
  get_game_summary: { plain: "Get Game Summary" },
  export_annotated_pgn: { plain: "Export Annotated Pgn" },
  batch_review: { plain: "Batch Review" },
  lichess_games: { plain: "Lichess Games" },
  chesscom_games: { plain: "Chesscom Games" },
  repertoire_vs_history: { plain: "Repertoire Vs History" },
  audit_repertoire_moves: { plain: "Audit Repertoire Moves" },
  find_only_moves: { plain: "Find Only Moves" },
  find_structures: { plain: "Find Structures" },
  inspect_shortcut: { plain: "Inspect Shortcut" },
  export_annotated_repertoire: { plain: "Export Annotated Repertoire" },
  prep_vs_opponent: { plain: "Prep Vs Opponent" },
  propose_line: { plain: "Propose Line" },
  get_selected_subtree: { plain: "Get Selected Subtree" },
  get_document_pgn: { plain: "Get Document Pgn" },
  propose_strategic_fit_profile: { plain: "Propose Strategic Fit Profile" },
  propose_strategic_fit_plan: { plain: "Propose Strategic Fit Plan" },
  propose_strategic_fit_portfolio: { plain: "Propose Strategic Fit Portfolio" },
  export_strategic_fit_metadata: { plain: "Export Strategic Fit Metadata" },
  export_strategic_fit_intent_pgn: { plain: "Export Strategic Fit Intent Pgn" },
} as const satisfies Readonly<Record<BrowserCommandName, ContentLabel>>;

export function taskLabel(name: BrowserCommandName): string {
  return TOOL_LABELS[name].plain;
}
