import {
  compareMoves,
  groundPosition,
  moveSan,
  shapeEvaluation,
  toolDefault,
  validateFen,
  validateLine,
  validatePgn,
  type ExplorerDb,
} from "@chess-mcp/chess-tools";
import type { BrowserCommandHandler } from "./types";
import { commandAnalyse, throwIfAborted } from "./types";

const explorerAuthRequired = () => ({
  error: "explorer_auth_required",
  reason: "the Lichess opening explorer requires authentication; ask the user to add a personal API token (no scopes needed, lichess.org/account/oauth/token) in Settings",
});

const validateFenCommand: BrowserCommandHandler = (args) => validateFen(args.fen as string);
const validatePgnCommand: BrowserCommandHandler = (args) => validatePgn(args.pgn as string);

export const positionCommands = {
  validate_fen: validateFenCommand,
  validate_pgn: validatePgnCommand,
  validate_line: (args, context) => {
    const atFen = (args.fen as string | undefined) || context.currentFen();
    const checked = validateFen(atFen);
    return checked.valid ? validateLine(checked.fen!, args.moves as string[]) : { error: "invalid_fen", reason: checked.reason };
  },
  get_legal_moves: (args, context) => {
    const grounded = groundPosition((args.fen as string | undefined) || context.currentFen());
    return "error" in grounded ? grounded : { fen: grounded.fen, moves: grounded.legal_moves };
  },
  get_position: (args, context) => {
    const grounded = groundPosition((args.fen as string | undefined) || context.currentFen());
    return "error" in grounded ? grounded : { ...grounded, color: context.currentColor() };
  },
  evaluate_position: async (args, context) => {
    const atFen = (args.fen as string | undefined) || context.currentFen();
    const checked = validateFen(atFen);
    if (!checked.valid) return { error: "invalid_fen", reason: checked.reason };
    const lines = (args.lines as number | undefined) ?? toolDefault("evaluate_position", "lines", 3);
    const depth = (args.depth as number | undefined) ?? toolDefault("evaluate_position", "depth", 16);
    const result = await context.analyse(checked.fen!, lines, depth, undefined, context.signal);
    throwIfAborted(context.signal);
    return result ? shapeEvaluation(checked.fen!, result, moveSan) : { error: "engine_unavailable" };
  },
  compare_moves: async (args, context) => {
    const atFen = (args.fen as string | undefined) || context.currentFen();
    const checked = validateFen(atFen);
    if (!checked.valid) return { error: "invalid_fen", reason: checked.reason };
    const result = await compareMoves(
      checked.fen!,
      args.moves as string[],
      (args.depth as number | undefined) ?? toolDefault("compare_moves", "depth", 14),
      commandAnalyse(context),
      {
        shouldCancel: () => context.signal?.aborted ?? false,
        onProgress: (done, total) => context.onProgress?.(done, total, "comparing candidate moves"),
      },
    );
    throwIfAborted(context.signal);
    return result;
  },
  cloud_eval: async (args, context) => {
    const atFen = (args.fen as string | undefined) || context.currentFen();
    const result = await context.cloudEval(atFen, context.signal);
    throwIfAborted(context.signal);
    return result ? { fen: atFen, ...result } : { fen: atFen, available: false };
  },
  tablebase_lookup: async (args, context) => {
    const result = await context.tablebaseLookup((args.fen as string | undefined) || context.currentFen(), context.signal);
    throwIfAborted(context.signal);
    return result ?? { available: false };
  },
  position_popularity: async (args, context) => {
    const atFen = (args.fen as string | undefined) || context.currentFen();
    const checked = validateFen(atFen);
    if (!checked.valid) return { error: "invalid_fen", reason: checked.reason };
    if (!context.hasExplorerToken()) return explorerAuthRequired();
    const db = (args.db as ExplorerDb | undefined) ?? toolDefault("position_popularity", "db", "lichess");
    const result = await context.explorerPosition(checked.fen!, { db, movesLimit: args.top_moves as number | undefined }, context.signal);
    throwIfAborted(context.signal);
    return result ? { fen: checked.fen, db, ...result } : { fen: checked.fen, available: false };
  },
} satisfies Record<string, BrowserCommandHandler>;
