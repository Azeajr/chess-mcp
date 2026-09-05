import type {
  CloudEval,
  Color,
  EngineLine,
  ExplorerFilters,
  ExplorerPosition,
  GameMeta,
  GameTree,
  OpeningTable,
  Path,
  AnalyzeStrategicFitOptions,
  StrategicFitProgress,
  StrategicFitProfile,
  StrategicFitMetadataAnalysisInputs,
  StrategicFitDocumentMetadata,
  StrategicFitReport,
  StrategicTrainingMetricEvidence,
  ReplacementChangeSet,
  ReplacementSafetySimulationResult,
  TablebaseResult,
} from "@chess-mcp/chess-tools";

export const BROWSER_COMMAND_NAMES = [
  "validate_fen",
  "validate_pgn",
  "validate_line",
  "get_legal_moves",
  "get_position",
  "evaluate_position",
  "compare_moves",
  "cloud_eval",
  "tablebase_lookup",
  "position_popularity",
  "identify_opening",
  "find_repertoire_gaps",
  "suggest_gap_fills",
  "find_theory_depth",
  "get_transpositions",
  "find_pruning_transpositions",
  "get_repertoire_coverage",
  "get_structural_profile",
  "analyze_repertoire_congruence",
  "get_strategic_fit_report",
  "classify_illustrative_lines",
  "modify_repertoire_line",
  "suggest_complementary_lines",
  "suggest_replacement_line",
  "analyze_game",
  "get_game_summary",
  "export_annotated_pgn",
  "batch_review",
  "lichess_games",
  "chesscom_games",
  "repertoire_vs_history",
  "audit_repertoire_moves",
  "find_only_moves",
  "find_structures",
  "inspect_shortcut",
  "export_annotated_repertoire",
  "prep_vs_opponent",
  "propose_line",
  "get_selected_subtree",
  "get_document_pgn",
  "propose_strategic_fit_profile",
  "propose_strategic_fit_plan",
  "propose_strategic_fit_portfolio",
  "export_strategic_fit_metadata",
  "export_strategic_fit_intent_pgn",
] as const;

export type BrowserCommandName = (typeof BROWSER_COMMAND_NAMES)[number];

export const BROWSER_COMMAND_ERROR_CODES = [
  "invalid_arguments",
  "invalid_fen",
  "engine_unavailable",
  "cancelled",
  "explorer_auth_required",
  "fetch_failed",
  "missing_arg",
  "missing_criteria",
  "unknown_structure",
  "path_not_found",
  "strategic_fit_finding_not_found",
  "strategic_fit_report_unavailable",
  "strategic_fit_missing_report_identity",
  "strategic_fit_missing_finding_identity",
  "strategic_fit_stale_page_cursor",
  "strategic_fit_intent_empty_proposal",
  "strategic_fit_intent_invalid_mode",
  "strategic_fit_intent_unknown_field",
  "strategic_fit_intent_invalid_value",
  "strategic_fit_intent_invalid_concept_id",
  "strategic_fit_intent_conflicting_concepts",
  "strategic_fit_intent_no_change",
  "strategic_fit_intent_proposal_stale",
  "strategic_fit_intent_proposal_not_pending",
  "strategic_fit_plan_empty",
  "strategic_fit_plan_invalid_section",
  "strategic_fit_plan_invalid_value",
  "strategic_fit_plan_missing_support",
  "strategic_fit_plan_unsupported_concept",
  "strategic_fit_plan_unsupported_checkpoint",
  "strategic_fit_plan_unsupported_drill",
  "strategic_fit_plan_unsupported_move",
  "strategic_fit_plan_unsupported_model_game",
  "strategic_fit_plan_evidence_unavailable",
  "strategic_fit_plan_stale",
  "strategic_fit_plan_not_pending",
  "strategic_fit_portfolio_empty_constraints",
  "strategic_fit_portfolio_unknown_constraint",
  "strategic_fit_portfolio_invalid_value",
  "strategic_fit_portfolio_unconfirmed_constraints",
  "strategic_fit_portfolio_evidence_unavailable",
  "strategic_fit_portfolio_unknown_option",
  "strategic_fit_portfolio_stale",
  "strategic_fit_portfolio_not_pending",
  "strategic_fit_stale_report",
  "strategic_fit_stale_revision",
  "variation_not_found",
  "stale_revision",
] as const;
export type BrowserCommandArgs = Record<string, unknown>;
export type BrowserCommandHandler = (
  args: BrowserCommandArgs,
  context: BrowserCommandContext,
) => unknown;
export type BrowserCommandRegistry = Record<BrowserCommandName, BrowserCommandHandler>;

export interface BrowserCommandExecutionOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total?: number, detail?: string) => void;
}

export interface BrowserCommandDependencies {
  currentTree: () => GameTree;
  currentFen: () => string;
  currentPgn: () => string;
  currentColor: () => Color;
  currentPath: () => Path;
  currentFileName: () => string | null;
  currentRevision: () => number;
  currentDocumentId: () => string;
  currentStrategicFitMetadata: () => StrategicFitDocumentMetadata;
  currentStrategicFitProfile: () => StrategicFitProfile;
  currentStrategicFitAnalysisSettings: () => {
    readonly identity: string;
    readonly inputs: StrategicFitMetadataAnalysisInputs;
  };
  currentStrategicFitTrainingEvidence?: () => StrategicTrainingMetricEvidence | null;
  analysisDepth: () => number;
  analyse: (
    fen: string,
    multipv: number,
    depth: number,
    movetime?: number,
    signal?: AbortSignal,
  ) => Promise<EngineLine[] | null>;
  cloudEval: (fen: string, signal?: AbortSignal) => Promise<CloudEval | null>;
  tablebaseLookup: (fen: string, signal?: AbortSignal) => Promise<TablebaseResult | null>;
  explorerPosition: (
    fen: string,
    filters?: ExplorerFilters,
    signal?: AbortSignal,
  ) => Promise<ExplorerPosition | null>;
  hasExplorerToken: () => boolean;
  lichessGames: (
    username: string,
    maxGames: number,
    openingEco?: string,
    includePgn?: boolean,
    signal?: AbortSignal,
  ) => Promise<GameMeta[] | null>;
  chesscomGames: (
    username: string,
    year: number,
    month: number,
    openingEco?: string,
    includePgn?: boolean,
    signal?: AbortSignal,
  ) => Promise<GameMeta[] | null>;
  openings: () => Promise<OpeningTable>;
  strategicFitReport: (
    pgn: string,
    options: AnalyzeStrategicFitOptions,
    execution?: { signal?: AbortSignal; onProgress?: (progress: StrategicFitProgress) => void },
  ) => Promise<StrategicFitReport>;
  strategicFitReportById: (reportId: string) => StrategicFitReport | null;
  createArtifact: (format: "pgn" | "csv" | "json", content: string, name: string) => unknown;
  stageEdit: (
    action: "add" | "prune" | "reorder",
    path: string[],
    options?: { addMoves?: string[]; promoteMove?: string },
  ) => unknown;
  stageReplacementChangeSet: (input: {
    readonly safety: ReplacementSafetySimulationResult;
    readonly change_set: ReplacementChangeSet;
  }) => Promise<unknown>;
  discardReplacementChangeSet: (stageId: string) => Promise<unknown>;
  proposeLine: (moves: string[], comment?: string) => unknown;
  proposeStrategicFitProfile: (input: {
    readonly mode?: unknown;
    readonly preferences?: unknown;
    readonly rationale?: unknown;
  }) => unknown;
  proposeStrategicFitPlan: (input: {
    readonly report_id: string;
    readonly finding_id: string;
    readonly semantic_finding_id: string;
    readonly plan?: { readonly title?: unknown; readonly sections?: unknown };
  }) => unknown;
  proposeStrategicFitPortfolio: (input: {
    readonly constraints?: unknown;
    readonly rationale?: unknown;
    readonly constraint_set_id?: string;
    readonly option_id?: string;
  }) => unknown;
}

export type BrowserCommandContext = BrowserCommandDependencies & BrowserCommandExecutionOptions;

export const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
};

export const commandAnalyse =
  (context: BrowserCommandContext) => (fen: string, multipv: number, depth: number) =>
    context.analyse(fen, multipv, depth, undefined, context.signal);

export const requestedDepth = (args: BrowserCommandArgs, context: BrowserCommandContext) => {
  const preferred = context.analysisDepth();
  return preferred === 30 ? 30 : ((args.depth as number | undefined) ?? preferred);
};
