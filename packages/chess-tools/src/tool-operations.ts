import { legalMoves, validateFen } from "./validate.js";
import { analyzeMainline, findRepertoireGaps, type Analyse, type EngineLine, type GapsOptions } from "./enginetools.js";
import type { Color } from "./congruence.js";
import type { MoveRecord } from "./enginetools.js";
import { aggregateGames, moveAccuracy, walkGameVsRepertoire, type GameRecord } from "./game.js";
import { identifyDeepest, type OpeningTable } from "./openings.js";
import { toolDefault } from "./tool-contract.js";
import { aggregateProfile, positionProfile } from "./structure.js";
import { GameTree } from "./pgn.js";
import { makeFen } from "chessops/fen";
import { makePgn, parsePgn } from "chessops/pgn";

export type PositionError = { error: "invalid_fen"; reason: string };
export type GroundedPosition = { fen: string; turn: "white" | "black"; legal_moves: string[] };

/** Shared validation and result shaping for position-grounding host adapters. */
export function groundPosition(rawFen: string): GroundedPosition | PositionError {
  const checked = validateFen(rawFen);
  if (!checked.valid) return { error: "invalid_fen", reason: checked.reason ?? "invalid FEN" };
  const fen = checked.fen!;
  return { fen, turn: fen.split(" ")[1] === "w" ? "white" : "black", legal_moves: legalMoves(fen) };
}

export interface EvaluationMove {
  uci: string;
  san: string | null;
  cp: number | null;
  mate: number | null;
  depth: number;
}

/** Shared semantic shape; hosts inject only the UCI-to-SAN conversion. */
export function shapeEvaluation(
  fen: string,
  lines: readonly EngineLine[],
  sanForUci: (fen: string, uci: string) => string | null,
): { fen: string; eval_pov: "white"; eval_sign: string; lines: EvaluationMove[] } {
  return {
    fen,
    eval_pov: "white",
    eval_sign: "positive favors White; negative favors Black",
    lines: lines.map((line) => ({
      uci: line.uci,
      san: sanForUci(fen, line.uci),
      cp: line.cp,
      mate: line.mate,
      depth: line.depth,
    })),
  };
}

export function transpositionResult(tree: GameTree, limit: number) {
  const groups = tree.transpositions();
  const shown = groups.slice(0, limit);
  return { total: groups.length, returned: shown.length, transpositions: shown };
}

export function repertoireCoverageResult(tree: GameTree, color: Color, limit: number) {
  const coverage = tree.coverage(color);
  return {
    color,
    leaves: coverage.leaves,
    dangling_count: coverage.danglingCount,
    frontier_count: coverage.frontierCount,
    max_depth: coverage.maxDepth,
    shallowest_leaf_ply: coverage.shallowestLeafPly,
    dangling_lines: coverage.danglingLines.slice(0, limit),
  };
}

export function gapScanOperation(
  tree: GameTree,
  color: Color,
  args: { depth?: number; min_severity?: "low" | "medium" | "high"; max_positions?: number; limit?: number },
  analyse: Analyse,
  popularity?: GapsOptions["popularity"],
  control?: Pick<GapsOptions, "onProgress" | "shouldCancel">,
) {
  return findRepertoireGaps(
    tree,
    color,
    {
      depth: args.depth ?? toolDefault("find_repertoire_gaps", "depth", 14),
      minSeverity: args.min_severity,
      maxPositions: args.max_positions,
      limit: args.limit ?? toolDefault("find_repertoire_gaps", "limit", 20),
      popularity,
      ...control,
    },
    analyse,
  );
}

export function illustrativeLinesResult(tree: GameTree, color: Color, limit: number) {
  const { lines, illustrativeLeaves } = tree.illustrativeLines();
  const shown = lines.slice(0, limit);
  return { color, leaves_total: tree.stats().leaves, illustrative_leaves: illustrativeLeaves, lines: shown, truncated: shown.length < lines.length };
}

export function structuralProfileResult(tree: GameTree, color: Color, variationPath?: string[]) {
  if (variationPath?.length) {
    const pos = tree.positionAtSanPath(variationPath);
    if (!pos) return { error: "variation_not_found" as const, reason: "path does not match a line in the repertoire" };
    return positionProfile(pos.board, color, makeFen(pos.toSetup()));
  }
  return { color, ...aggregateProfile(tree.leafPositions().map((pos) => pos.board), color) };
}

const leanMove = (record: MoveRecord) => ({ ply: record.ply, color: record.color, san: record.san, cp_loss: record.cp_loss, classification: record.classification });
export function gameAnalysisResult(records: MoveRecord[]) {
  return { total_moves: records.length, moves: records.map(leanMove) };
}

export function gameSummaryResult(records: MoveRecord[]) {
  const side = (color: Color) => {
    const moves = records.filter((record) => record.color === color);
    const accuracy = moves.reduce((sum, record) => sum + moveAccuracy(record.cp_loss), 0);
    return {
      blunders: moves.filter((record) => record.classification === "blunder").length,
      mistakes: moves.filter((record) => record.classification === "mistake").length,
      inaccuracies: moves.filter((record) => record.classification === "inaccuracy").length,
      good_moves: moves.filter((record) => record.classification === "good").length,
      accuracy_pct: moves.length ? Math.round((accuracy / moves.length) * 1000) / 10 : null,
    };
  };
  return { total_moves: records.length, white: side("white"), black: side("black"), worst_moves: [...records].sort((a, b) => b.cp_loss - a.cp_loss).slice(0, 3).map(leanMove) };
}

const REVIEW_NAG: Record<string, number> = { blunder: 4, mistake: 2, inaccuracy: 6 };
export function annotatedGameResult(pgn: string, records: MoveRecord[]): { annotated_pgn: string } | { error: "invalid_pgn"; reason: string } {
  let game;
  try {
    game = parsePgn(pgn)[0];
  } catch (error) {
    return { error: "invalid_pgn", reason: error instanceof Error ? error.message : String(error) };
  }
  if (!game) return { error: "invalid_pgn", reason: "no game" };
  let node = game.moves;
  for (let index = 0; node.children.length && index < records.length; index++) {
    const child = node.children[0]!;
    const record = records[index]!;
    if (record.classification !== "good") {
      child.data.nags = [REVIEW_NAG[record.classification]!];
      child.data.comments = [`best: ${record.best_move} (${(record.best_eval / 100).toFixed(2)})`];
    }
    node = child;
  }
  return { annotated_pgn: makePgn(game) };
}

export function repertoireHistoryResult(
  tree: GameTree,
  color: Color,
  games: readonly { user_color?: Color | null; pgn?: string | null }[],
) {
  const matched = games.filter((game) => game.user_color === color && game.pgn);
  const moveMap = tree.moveMap();
  let reached = 0;
  let plySum = 0;
  let skipped = 0;
  const deviations = new Map<string, { ply: number; fen: string; prescribed: string[]; played: string; count: number }>();
  const uncovered = new Map<string, { ply: number; fen: string; played: string; count: number }>();
  for (const game of matched) {
    let walk;
    try {
      walk = walkGameVsRepertoire(moveMap, color, game.pgn!);
    } catch {
      skipped++;
      continue;
    }
    if (walk.in_book_plies >= 1) reached++;
    plySum += walk.in_book_plies;
    for (const item of walk.player_deviations) {
      const key = `${item.fen}|${item.played}`;
      const current = deviations.get(key) ?? { ...item, count: 0 };
      current.count++;
      deviations.set(key, current);
    }
    for (const item of walk.uncovered_opponents) {
      const key = `${item.fen}|${item.played}`;
      const current = uncovered.get(key) ?? { ...item, count: 0 };
      current.count++;
      uncovered.set(key, current);
    }
  }
  const walked = matched.length - skipped;
  const byCount = <T extends { count: number }>(items: Map<string, T>) => [...items.values()].sort((a, b) => b.count - a.count);
  return {
    games_total: games.length,
    games_matched_color: matched.length,
    games_skipped_fen_setup: skipped,
    games_reached_prep: reached,
    coverage_pct: walked ? Math.round((reached / walked) * 1000) / 10 : null,
    avg_in_book_plies: walked ? Math.round((plySum / walked) * 10) / 10 : null,
    player_deviations: byCount(deviations).slice(0, 20),
    uncovered_opponent_moves: byCount(uncovered).slice(0, 20),
  };
}

export async function batchReviewOperation(
  pgn: string,
  options: { groupBy: "eco" | "color"; username?: string; maxGames: number; depth: number },
  openings: OpeningTable,
  analyse: Analyse,
) {
  if (options.groupBy === "color" && !options.username) return { error: "missing_username" as const, reason: "color grouping requires username" };
  let games;
  try {
    games = parsePgn(pgn);
  } catch (error) {
    return { error: "invalid_pgn" as const, reason: error instanceof Error ? error.message : String(error) };
  }
  if (!games.length) return { error: "invalid_pgn" as const, reason: "no games" };
  games = games.slice(0, options.maxGames);
  const records: GameRecord[] = [];
  let skippedFenSetup = 0;
  for (const game of games) {
    let userColor: Color | null = null;
    if (options.username) {
      const username = options.username.toLowerCase();
      const white = (game.headers.get("White") ?? "").toLowerCase();
      const black = (game.headers.get("Black") ?? "").toLowerCase();
      if (white === username) userColor = "white";
      else if (black === username) userColor = "black";
      else continue;
    }
    const gamePgn = makePgn(game);
    let moves;
    try {
      moves = await analyzeMainline(gamePgn, options.depth, analyse);
    } catch {
      skippedFenSetup++;
      continue;
    }
    if (moves === null) return { error: "engine_unavailable" as const };
    const relevant = userColor ? moves.filter((move) => move.color === userColor) : moves;
    const avgCpl = relevant.length ? relevant.reduce((sum, move) => sum + move.cp_loss, 0) / relevant.length : 0;
    const blunders = relevant.filter((move) => move.classification !== "good").map((move) => ({ move: move.san, classification: move.classification }));
    const opening = options.groupBy === "eco" ? identifyDeepest(openings, gamePgn) : null;
    const groupKey = options.groupBy === "color" ? userColor! : opening?.eco ?? "unknown";
    const groupName = options.groupBy === "color" ? userColor! : opening?.name ?? "Unknown";
    let result: GameRecord["result"] = null;
    if (options.username) {
      const header = game.headers.get("Result") ?? "*";
      if (header === "1/2-1/2") result = "draw";
      else if (header === "1-0") result = userColor === "white" ? "win" : "loss";
      else if (header === "0-1") result = userColor === "black" ? "win" : "loss";
    }
    records.push({ result, group_key: groupKey, group_name: groupName, avg_cpl: Math.round(avgCpl * 10) / 10, blunders });
  }
  return { ...aggregateGames(records, !!options.username), games_skipped_fen_setup: skippedFenSetup };
}
