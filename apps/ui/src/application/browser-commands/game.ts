import {
  analyzeMainline,
  annotatedGameResult,
  batchReviewOperation,
  gameAnalysisResult,
  gameSummaryResult,
  repertoireHistoryResult,
  toolDefault,
} from "@chess-mcp/chess-tools";
import type { BrowserCommandHandler } from "./types";
import { commandAnalyse, throwIfAborted } from "./types";

const pgnFor = (args: Record<string, unknown>, current: () => string) => (args.pgn as string | undefined) || current();

export const gameCommands = {
  analyze_game: async (args, context) => {
    const records = await analyzeMainline(pgnFor(args, context.currentPgn), (args.depth as number | undefined) ?? toolDefault("analyze_game", "depth", 14), commandAnalyse(context), {
      shouldCancel: () => context.signal?.aborted ?? false,
      onProgress: (done, total) => context.onProgress?.(done, total, "reviewing game"),
    });
    throwIfAborted(context.signal);
    return records === null ? { error: "engine_unavailable" } : gameAnalysisResult(records);
  },
  get_game_summary: async (args, context) => {
    const records = await analyzeMainline(pgnFor(args, context.currentPgn), (args.depth as number | undefined) ?? toolDefault("get_game_summary", "depth", 14), commandAnalyse(context), {
      shouldCancel: () => context.signal?.aborted ?? false,
      onProgress: (done, total) => context.onProgress?.(done, total, "summarizing game"),
    });
    throwIfAborted(context.signal);
    return records === null ? { error: "engine_unavailable" } : gameSummaryResult(records);
  },
  export_annotated_pgn: async (args, context) => {
    const pgn = pgnFor(args, context.currentPgn);
    const records = await analyzeMainline(pgn, (args.depth as number | undefined) ?? toolDefault("export_annotated_pgn", "depth", 14), commandAnalyse(context), {
      shouldCancel: () => context.signal?.aborted ?? false,
      onProgress: (done, total) => context.onProgress?.(done, total, "annotating game"),
    });
    throwIfAborted(context.signal);
    if (records === null) return { error: "engine_unavailable" };
    const result = annotatedGameResult(pgn, records);
    if ("error" in result) return result;
    const base = (context.currentFileName() ?? "game.pgn").replace(/\.pgn$/i, "");
    return context.createArtifact("pgn", result.annotated_pgn, `${base}-annotated.pgn`);
  },
  batch_review: async (args, context) => {
    const result = await batchReviewOperation(
      args.pgn as string,
      {
        groupBy: (args.group_by as "eco" | "color" | undefined) ?? toolDefault("batch_review", "group_by", "eco"),
        username: args.username as string | undefined,
        maxGames: (args.max_games as number | undefined) ?? toolDefault("batch_review", "max_games", 100),
        depth: (args.depth as number | undefined) ?? toolDefault("batch_review", "depth", 12),
      },
      await context.openings(),
      commandAnalyse(context),
      {
        shouldCancel: () => context.signal?.aborted ?? false,
        onProgress: (done, total) => context.onProgress?.(done, total, "reviewing games"),
      },
    );
    throwIfAborted(context.signal);
    return result;
  },
  lichess_games: async (args, context) => {
    const games = await context.lichessGames(
      args.username as string,
      (args.max_games as number | undefined) ?? toolDefault("lichess_games", "max_games", 20),
      args.opening_eco as string | undefined,
      (args.include_pgn as boolean | undefined) ?? toolDefault("lichess_games", "include_pgn", false),
      context.signal,
    );
    throwIfAborted(context.signal);
    return games === null
      ? { error: "fetch_failed", reason: "offline or unknown user" }
      : { platform: "lichess", username: args.username, total: games.length, games };
  },
  chesscom_games: async (args, context) => {
    const games = await context.chesscomGames(
      args.username as string,
      args.year as number,
      args.month as number,
      args.opening_eco as string | undefined,
      (args.include_pgn as boolean | undefined) ?? false,
      context.signal,
    );
    throwIfAborted(context.signal);
    return games === null
      ? { error: "fetch_failed", reason: "offline or unknown user" }
      : { platform: "chesscom", username: args.username, year: args.year, month: args.month, total: games.length, games };
  },
  repertoire_vs_history: async (args, context) => {
    const platform = (args.platform as "lichess" | "chesscom" | undefined) ?? toolDefault("repertoire_vs_history", "platform", "lichess");
    const username = args.username as string;
    const games = platform === "chesscom"
      ? args.year == null || args.month == null
        ? null
        : await context.chesscomGames(username, args.year as number, args.month as number, undefined, true, context.signal)
      : await context.lichessGames(username, (args.max_games as number | undefined) ?? toolDefault("repertoire_vs_history", "max_games", 30), undefined, true, context.signal);
    throwIfAborted(context.signal);
    if (platform === "chesscom" && (args.year == null || args.month == null)) return { error: "missing_arg", reason: "chesscom requires year and month" };
    return games === null ? { error: "fetch_failed", reason: "offline or unknown user" } : repertoireHistoryResult(context.currentTree(), context.currentColor(), games);
  },
} satisfies Record<string, BrowserCommandHandler>;
