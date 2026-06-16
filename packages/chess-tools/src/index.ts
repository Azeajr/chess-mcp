/**
 * @chess-mcp/chess-tools — shared chess logic for the UI and the Node MCP server.
 *
 * Phase 1: the variation-aware PGN GameTree. Later phases add the engine providers,
 * congruence/structure analysis, eval cache, and the rate-limited HTTP client — the
 * TypeScript port of the Python servers (see docs/design/UI_DESIGN.md).
 */
export { GameTree } from "./pgn.js";
export type { Path, PlayResult } from "./pgn.js";
export { positionKey, classifyUciMove, weightFor } from "./congruence.js";
export type { Fit, Weight, Color, MoveFit } from "./congruence.js";
export { decisionNodes, gapSeverity, moveSan, SEVERITY_RANK } from "./gaps.js";
export type { DecisionNode, Severity } from "./gaps.js";
export { fetchJson } from "./apiclient.js";
export { cloudEval } from "./cloudeval.js";
export type { CloudEval } from "./cloudeval.js";
export { validateLine, legalMoves, validateFen, validatePgn } from "./validate.js";
export type { LineCheck } from "./validate.js";
export { tablebaseLookup } from "./tablebase.js";
export type { TablebaseResult } from "./tablebase.js";
export { mainline, classifyCpLoss, moveAccuracy } from "./game.js";
export type { MainlineMove, MoveClass } from "./game.js";
export { parseOpeningsTsv, identifyAt, identifyDeepest } from "./openings.js";
export type { OpeningTable } from "./openings.js";
