import {
  cloudEval,
  compareMoves,
  explorerPosition,
  groundPosition,
  hasExplorerToken,
  jsonSchemaForTool,
  moveSan,
  shapeEvaluation,
  tablebaseLookup,
  toolDefault,
  validateFen,
  validateLine,
  validatePgn,
  type ExplorerDb,
} from "@chess-mcp/chess-tools";
import { analyseMulti } from "../engine/stockfish";
import { actions, color, fen } from "../store/game";

export const POSITION_TOOL_NAMES = new Set([
  "get_position", "get_legal_moves", "evaluate_position", "compare_moves", "validate_fen",
  "validate_pgn", "validate_line", "cloud_eval", "tablebase_lookup", "position_popularity",
]);

const explorerAuthRequired = () => ({
  error: "explorer_auth_required",
  reason: "the Lichess opening explorer requires authentication; ask the user to add a personal API token (no scopes needed, lichess.org/account/oauth/token) in Settings",
});

export async function runBrowserPositionTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const atFen = (typeof args.fen === "string" && args.fen) || fen();
  const pgn = (typeof args.pgn === "string" && args.pgn) || actions.toPgn();
  const depth = typeof args.depth === "number" ? args.depth : undefined;
  switch (name) {
    case "get_position": {
      const grounded = groundPosition(atFen);
      return "error" in grounded ? grounded : { ...grounded, color: color() };
    }
    case "get_legal_moves": {
      const grounded = groundPosition(atFen);
      return "error" in grounded ? grounded : { fen: grounded.fen, moves: grounded.legal_moves };
    }
    case "evaluate_position": {
      const checked = validateFen(atFen);
      if (!checked.valid) return { error: "invalid_fen", reason: checked.reason };
      const lines = typeof args.lines === "number" ? args.lines : toolDefault("evaluate_position", "lines", 3);
      const result = await analyseMulti(checked.fen!, lines, depth ?? toolDefault("evaluate_position", "depth", 16));
      return result ? shapeEvaluation(checked.fen!, result, moveSan) : { error: "engine_unavailable" };
    }
    case "compare_moves": {
      const checked = validateFen(atFen);
      if (!checked.valid) return { error: "invalid_fen", reason: checked.reason };
      return compareMoves(checked.fen!, args.moves as string[], depth ?? toolDefault("compare_moves", "depth", 14), analyseMulti);
    }
    case "validate_fen":
      return validateFen(atFen);
    case "validate_pgn":
      return validatePgn(pgn);
    case "validate_line": {
      const checked = validateFen(atFen);
      return checked.valid ? validateLine(checked.fen!, args.moves as string[]) : { error: "invalid_fen", reason: checked.reason };
    }
    case "cloud_eval": {
      const result = await cloudEval(atFen);
      return result ? { fen: atFen, ...result } : { fen: atFen, available: false };
    }
    case "tablebase_lookup":
      return (await tablebaseLookup(atFen)) ?? { available: false };
    case "position_popularity": {
      const checked = validateFen(atFen);
      if (!checked.valid) return { error: "invalid_fen", reason: checked.reason };
      if (!hasExplorerToken()) return explorerAuthRequired();
      const db = (args.db as ExplorerDb | undefined) ?? toolDefault("position_popularity", "db", "lichess");
      const result = await explorerPosition(checked.fen!, { db, movesLimit: args.top_moves as number | undefined });
      return result ? { fen: checked.fen, db, ...result } : { fen: checked.fen, available: false };
    }
    default:
      return { error: `unknown position tool: ${name}`, schema: jsonSchemaForTool(name, "browser") };
  }
}
