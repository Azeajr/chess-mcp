/**
 * @chess-mcp/chess-tools — shared chess logic for the UI and the Node MCP server.
 *
 * Phase 1: the variation-aware PGN GameTree. Later phases add the engine providers,
 * congruence/structure analysis, eval cache, and the rate-limited HTTP client — the
 * Shared domain layer for the Node MCP host and SolidJS PWA (see docs/ARCHITECTURE.md).
 */
export { GameTree, isPrefix, buildKeyIndex, landsInCrossBranchPrep, enumerateLegal, iterateLegal, someLegal, pruneTailPath } from "./pgn.js";
export type { Path, PlayResult, KeyIndex, ExtendedBridge, PruneSuggestion, PruneScanResult, PruneEngineLine } from "./pgn.js";
export { positionKey, classifyUciMove, weightFor } from "./congruence.js";
export type { Fit, Weight, Color, MoveFit } from "./congruence.js";
export { decisionNodes, turnNodes, gapSeverity, moveSan, medianLineLength, SEVERITY_RANK } from "./gaps.js";
export type { DecisionNode, Severity } from "./gaps.js";
export {
  positionProfile,
  aggregateProfile,
  themes,
  centerState,
  classifyStructure,
  classifyStructureFromFen,
  profileStructureShares,
  buildFitProfile,
  fitScore,
  isolatedPawns,
  doubledPawns,
  passedPawns,
  searchStructures,
  STRUCTURE_NAMES,
  THEME_NAMES,
} from "./structure.js";
export type { Themes, FitProfile, StructureQuery, StructureMatch, ThemeName } from "./structure.js";
export { fetchJson, fetchText } from "./apiclient.js";
export { lichessGames, chesscomGames } from "./games.js";
export type { GameMeta } from "./games.js";
export { cloudEval } from "./cloudeval.js";
export type { CloudEval } from "./cloudeval.js";
export { validateLine, legalMoves, validateFen, validatePgn, isPromotion } from "./validate.js";
export type { LineCheck } from "./validate.js";
export { tablebaseLookup } from "./tablebase.js";
export type { TablebaseResult } from "./tablebase.js";
export { explorerPosition, theoryDepth, setExplorerToken, hasExplorerToken } from "./explorer.js";
export type { ExplorerDb, ExplorerFilters, ExplorerMove, ExplorerPosition, ExplorerLookup, TheoryDepthOptions, TheoryLine, TheoryDepthResult } from "./explorer.js";
export { mainline, classifyCpLoss, moveAccuracy, aggregateGames, walkGameVsRepertoire } from "./game.js";
export type { MainlineMove, MoveClass, GameRecord, GameWalk, PlayerDeviation, UncoveredOpponent, RepertoireMoveMap } from "./game.js";
export { parseOpeningsTsv, identifyAt, identifyDeepest, identifyDeepestFromMoves } from "./openings.js";
export type { OpeningEntry, OpeningTable } from "./openings.js";
export { analyzeCongruence, replacementPivot } from "./repcongruence.js";
export type { CongruenceOptions, PivotResult, PivotError } from "./repcongruence.js";
export {
  analyzeMainline,
  findRepertoireGaps,
  auditRepertoireMoves,
  findOnlyMoves,
  onlyMoveDeckCsv,
  resolveDanglingStubs,
  compareMoves,
  suggestComplementaryLines,
  suggestGapFills,
  suggestReplacementLine,
  compareShortcutLines,
  checkShortcutCoverage,
  annotateRepertoire,
} from "./enginetools.js";
export type {
  Analyse,
  EngineLine,
  OperationControl,
  GapFillOption,
  SuggestGapFillsOptions,
  MoveRecord,
  GapsOptions,
  Gap,
  GapsResult,
  CoveredGap,
  AuditOptions,
  AuditFinding,
  AuditResult,
  OnlyMoveOptions,
  OnlyMoveFinding,
  OnlyMoveLine,
  OnlyMoveResult,
  StubResolution,
  CoverageResolution,
  SuggestComplementaryOptions,
  SuggestReplacementOptions,
  ShortcutComparison,
  ShortcutCoverage,
  AnnotateSource,
  AnnotateOptions,
  AnnotateResult,
  StrategicFitAnnotationReport,
} from "./enginetools.js";
export * from "./strategic-fit/types.js";
export * from "./strategic-fit/version.js";
export * from "./strategic-fit/preflight.js";
export * from "./strategic-fit/graph.js";
export * from "./strategic-fit/taxonomy.js";
export * from "./strategic-fit/checkpoints.js";
export * from "./strategic-fit/pawn-signals.js";
export * from "./strategic-fit/position-signals.js";
export * from "./strategic-fit/trajectory.js";
export * from "./strategic-fit/concepts.js";
export * from "./strategic-fit/weights.js";
export * from "./strategic-fit/cohorts.js";
export * from "./strategic-fit/modes.js";
export * from "./strategic-fit/distance.js";
export * from "./strategic-fit/confidence.js";
export * from "./strategic-fit/causality.js";
export * from "./strategic-fit/findings.js";
export * from "./strategic-fit/metrics.js";
export * from "./strategic-fit/analyze.js";
export * from "./strategic-fit/report-projection.js";
export * from "./strategic-fit/legacy-projection.js";
export * from "./strategic-fit/annotation.js";
export * from "./strategic-fit/tool-adapter.js";
export * from "./strategic-fit/metadata.js";
export * from "./tool-contract.js";
export * from "./tool-operations.js";
export * from "./workflow-contract.js";
