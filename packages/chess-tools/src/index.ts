/**
 * @chess-mcp/chess-tools — shared chess logic for the UI and the Node MCP server.
 *
 * Phase 1: the variation-aware PGN GameTree. Later phases add the engine providers,
 * congruence/structure analysis, eval cache, and the rate-limited HTTP client — the
 * TypeScript port of the Python servers (see docs/design/UI_DESIGN.md).
 */
export { GameTree, isPrefix, buildKeyIndex, landsInCrossBranchPrep, enumerateLegal, pruneTailPath } from "./pgn.js";
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
} from "./structure.js";
export type { Themes, FitProfile } from "./structure.js";
export { fetchJson, fetchText } from "./apiclient.js";
export { lichessGames, chesscomGames } from "./games.js";
export type { GameMeta } from "./games.js";
export { cloudEval } from "./cloudeval.js";
export type { CloudEval } from "./cloudeval.js";
export { validateLine, legalMoves, validateFen, validatePgn, isPromotion } from "./validate.js";
export type { LineCheck } from "./validate.js";
export { tablebaseLookup } from "./tablebase.js";
export type { TablebaseResult } from "./tablebase.js";
export { mainline, classifyCpLoss, moveAccuracy, aggregateGames, walkGameVsRepertoire } from "./game.js";
export type { MainlineMove, MoveClass, GameRecord, GameWalk, RepertoireMoveMap } from "./game.js";
export { parseOpeningsTsv, identifyAt, identifyDeepest, identifyDeepestFromMoves } from "./openings.js";
export type { OpeningTable } from "./openings.js";
export { analyzeCongruence, replacementPivot } from "./repcongruence.js";
export type { CongruenceOptions, PivotResult, PivotError } from "./repcongruence.js";
export {
  analyzeMainline,
  findRepertoireGaps,
  auditRepertoireMoves,
  resolveDanglingStubs,
  compareMoves,
  suggestComplementaryLines,
  suggestReplacementLine,
  compareShortcutLines,
  checkShortcutCoverage,
} from "./enginetools.js";
export type {
  Analyse,
  EngineLine,
  MoveRecord,
  GapsOptions,
  Gap,
  GapsResult,
  CoveredGap,
  AuditOptions,
  AuditFinding,
  AuditResult,
  StubResolution,
  CoverageResolution,
  SuggestComplementaryOptions,
  SuggestReplacementOptions,
  ShortcutComparison,
  ShortcutCoverage,
} from "./enginetools.js";
