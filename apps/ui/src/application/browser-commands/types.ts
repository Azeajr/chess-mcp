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
  StrategicFitReport,
  TablebaseResult,
} from "@chess-mcp/chess-tools";

export const BROWSER_COMMAND_NAMES = [
  "validate_fen", "validate_pgn", "validate_line", "get_legal_moves", "get_position",
  "evaluate_position", "compare_moves", "cloud_eval", "tablebase_lookup", "position_popularity",
  "identify_opening", "find_repertoire_gaps", "suggest_gap_fills", "find_theory_depth",
  "get_transpositions", "find_pruning_transpositions", "get_repertoire_coverage",
  "get_structural_profile", "analyze_repertoire_congruence", "classify_illustrative_lines",
  "modify_repertoire_line", "suggest_complementary_lines", "suggest_replacement_line",
  "analyze_game", "get_game_summary", "export_annotated_pgn", "batch_review", "lichess_games",
  "chesscom_games", "repertoire_vs_history", "audit_repertoire_moves", "find_only_moves",
  "find_structures", "inspect_shortcut", "export_annotated_repertoire", "prep_vs_opponent",
  "propose_line", "get_selected_subtree", "get_document_pgn",
] as const;

export type BrowserCommandName = (typeof BROWSER_COMMAND_NAMES)[number];
export type BrowserCommandArgs = Record<string, unknown>;
export type BrowserCommandHandler = (args: BrowserCommandArgs, context: BrowserCommandContext) => unknown | Promise<unknown>;
export type BrowserCommandRegistry = Record<BrowserCommandName, BrowserCommandHandler>;

export type BrowserCommandExecutionOptions = {
  signal?: AbortSignal;
  onProgress?: (done: number, total?: number, detail?: string) => void;
};

export type BrowserCommandDependencies = {
  currentTree: () => GameTree;
  currentFen: () => string;
  currentPgn: () => string;
  currentColor: () => Color;
  currentPath: () => Path;
  currentFileName: () => string | null;
  currentRevision: () => number;
  currentStrategicFitProfile: () => StrategicFitProfile;
  currentStrategicFitAnalysisSettings: () => {
    readonly identity: string;
    readonly inputs: StrategicFitMetadataAnalysisInputs;
  };
  /** Browser preference: depth 20 normally, or 30 when the user enables Deep analysis. */
  analysisDepth: () => number;
  analyse: (fen: string, multipv: number, depth: number, movetime?: number, signal?: AbortSignal) => Promise<EngineLine[] | null>;
  cloudEval: (fen: string, signal?: AbortSignal) => Promise<CloudEval | null>;
  tablebaseLookup: (fen: string, signal?: AbortSignal) => Promise<TablebaseResult | null>;
  explorerPosition: (fen: string, filters?: ExplorerFilters, signal?: AbortSignal) => Promise<ExplorerPosition | null>;
  hasExplorerToken: () => boolean;
  lichessGames: (username: string, maxGames: number, openingEco?: string, includePgn?: boolean, signal?: AbortSignal) => Promise<GameMeta[] | null>;
  chesscomGames: (username: string, year: number, month: number, openingEco?: string, includePgn?: boolean, signal?: AbortSignal) => Promise<GameMeta[] | null>;
  openings: () => Promise<OpeningTable>;
  strategicFitReport: (
    pgn: string,
    options: AnalyzeStrategicFitOptions,
    execution?: { signal?: AbortSignal; onProgress?: (progress: StrategicFitProgress) => void },
  ) => Promise<StrategicFitReport>;
  createArtifact: (format: "pgn" | "csv", content: string, name: string) => unknown;
  stageEdit: (action: "add" | "prune" | "reorder", path: string[], options?: { addMoves?: string[]; promoteMove?: string }) => unknown;
  proposeLine: (moves: string[], comment?: string) => unknown;
};

export type BrowserCommandContext = BrowserCommandDependencies & BrowserCommandExecutionOptions;

export const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
};

export const commandAnalyse = (context: BrowserCommandContext) =>
  (fen: string, multipv: number, depth: number) => context.analyse(fen, multipv, depth, undefined, context.signal);

export const requestedDepth = (args: BrowserCommandArgs, context: BrowserCommandContext) => {
  const preferred = context.analysisDepth();
  // Deep mode is a global browser promise: even an LLM-supplied shallower value cannot silently
  // downgrade one task while the UI says every engine operation is running at depth 30.
  return preferred === 30 ? 30 : (args.depth as number | undefined) ?? preferred;
};
