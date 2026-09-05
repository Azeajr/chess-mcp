import type { BrowserCommandName } from "../application/browser-commands/types";

export interface ContentLabel {
  readonly plain: string;
  readonly result?: string;
  readonly task?: string;
  readonly expert?: string;
}

export const TOOL_LABELS = {
  validate_fen: { plain: "Validate Fen", result: "FEN validation" },
  validate_pgn: { plain: "Validate Pgn", result: "PGN validation" },
  validate_line: { plain: "Validate Line", result: "Line validation" },
  get_legal_moves: { plain: "Get Legal Moves", result: "Legal moves" },
  get_position: { plain: "Get Position", result: "Board position" },
  evaluate_position: { plain: "Evaluate Position", result: "Position evaluation" },
  compare_moves: { plain: "Compare Moves", result: "Move comparison" },
  cloud_eval: { plain: "Cloud Eval", result: "Cloud evaluation" },
  tablebase_lookup: { plain: "Tablebase Lookup", result: "Tablebase lookup" },
  position_popularity: { plain: "Position Popularity", result: "Position popularity" },
  identify_opening: { plain: "Identify Opening", result: "Opening identification" },
  find_repertoire_gaps: { plain: "Find Repertoire Gaps", result: "Repertoire gaps" },
  suggest_gap_fills: { plain: "Suggest Gap Fills", result: "Gap-fill suggestions" },
  find_theory_depth: { plain: "Find Theory Depth", result: "Theory depth" },
  get_transpositions: { plain: "Get Transpositions", result: "Transpositions" },
  find_pruning_transpositions: {
    plain: "Find Pruning Transpositions",
    result: "Pruning transpositions",
  },
  get_repertoire_coverage: {
    plain: "Get Repertoire Coverage",
    task: "Checking repertoire coverage",
    result: "Repertoire coverage",
  },
  get_structural_profile: { plain: "Get Structural Profile", result: "Structural profile" },
  analyze_repertoire_congruence: {
    plain: "Analyze Repertoire Congruence",
    result: "Strategic Fit analysis",
  },
  get_strategic_fit_report: { plain: "Get Strategic Fit Report", result: "Strategic Fit report" },
  classify_illustrative_lines: {
    plain: "Classify Illustrative Lines",
    result: "Illustrative line classifications",
  },
  modify_repertoire_line: { plain: "Modify Repertoire Line", result: "Repertoire line edit" },
  suggest_complementary_lines: {
    plain: "Suggest Complementary Lines",
    result: "Complementary line suggestions",
  },
  suggest_replacement_line: {
    plain: "Suggest Replacement Line",
    result: "Replacement line suggestion",
  },
  analyze_game: { plain: "Analyze Game", result: "Game analysis" },
  get_game_summary: { plain: "Get Game Summary", result: "Game summary" },
  export_annotated_pgn: { plain: "Export Annotated Pgn", result: "Annotated PGN" },
  batch_review: { plain: "Batch Review", result: "Batch review" },
  lichess_games: { plain: "Lichess Games", result: "Lichess games" },
  chesscom_games: { plain: "Chesscom Games", result: "Chess.com games" },
  repertoire_vs_history: { plain: "Repertoire Vs History", result: "Repertoire vs. history" },
  audit_repertoire_moves: { plain: "Audit Repertoire Moves", result: "Repertoire move audit" },
  find_only_moves: { plain: "Find Only Moves", result: "Only-move positions" },
  find_structures: { plain: "Find Structures", result: "Structure search" },
  inspect_shortcut: { plain: "Inspect Shortcut", result: "Shortcut inspection" },
  export_annotated_repertoire: {
    plain: "Export Annotated Repertoire",
    result: "Annotated repertoire",
  },
  prep_vs_opponent: { plain: "Prep Vs Opponent", result: "Opponent preparation" },
  propose_line: { plain: "Propose Line", result: "Line proposal" },
  get_selected_subtree: { plain: "Get Selected Subtree", result: "Selected repertoire line" },
  get_document_pgn: { plain: "Get Document Pgn", result: "Document PGN" },
  propose_strategic_fit_profile: {
    plain: "Propose Strategic Fit Profile",
    result: "Strategic Fit profile proposal",
  },
  propose_strategic_fit_plan: {
    plain: "Propose Strategic Fit Plan",
    result: "Strategic Fit plan proposal",
  },
  propose_strategic_fit_portfolio: {
    plain: "Propose Strategic Fit Portfolio",
    result: "Strategic Fit portfolio proposal",
  },
  export_strategic_fit_metadata: {
    plain: "Export Strategic Fit Metadata",
    result: "Strategic Fit metadata",
  },
  export_strategic_fit_intent_pgn: {
    plain: "Export Strategic Fit Intent Pgn",
    result: "Strategic Fit intent PGN",
  },
} as const satisfies Readonly<Record<BrowserCommandName, ContentLabel>>;

export function taskLabel(name: string): string {
  const label = TOOL_LABELS[name as BrowserCommandName] as ContentLabel | undefined;
  return label?.task ?? label?.plain ?? "Tool";
}

export function resultLabel(name: string): string {
  const label = TOOL_LABELS[name as BrowserCommandName] as ContentLabel | undefined;
  return label?.result ?? label?.plain ?? "Tool";
}

const NAVIGATION_LABELS: Readonly<Record<string, string>> = {
  result: "Line",
  path: "Line",
  san_path: "Line",
  variation_path: "Line",
  pivot_path: "Line",
  fen: "Position",
  ply: "Move",
  gaps: "Gap",
  findings: "Finding",
  lines: "Line",
  uncovered_opponent_moves: "Opponent move",
  only_moves: "Only move",
  positions: "Position",
  moves: "Move",
  choices: "Choice",
  variations: "Variation",
};

export function navigationLabel(key: string, index: number): string {
  const normalized = key
    .trim()
    .replace(/\s+\d+$/u, "")
    .replace(/\s+/gu, "_");
  const label = NAVIGATION_LABELS[key] ?? NAVIGATION_LABELS[normalized];
  return label === undefined ? `Result ${index}` : `${label} ${index}`;
}
