/**
 * @chess-mcp/chess-tools — shared chess logic for the UI and the Node MCP server.
 *
 * Phase 1: the variation-aware PGN GameTree. Later phases add the engine providers,
 * congruence/structure analysis, eval cache, and the rate-limited HTTP client — the
 * TypeScript port of the Python servers (see docs/design/UI_DESIGN.md).
 */
export { GameTree } from "./pgn.js";
export type { Path, PlayResult } from "./pgn.js";
