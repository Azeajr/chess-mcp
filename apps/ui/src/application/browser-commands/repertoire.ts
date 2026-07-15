import {
  STRUCTURE_NAMES,
  analyzeCongruence,
  annotateRepertoire,
  auditRepertoireMoves,
  checkShortcutCoverage,
  compareShortcutLines,
  findOnlyMoves,
  gapScanOperation,
  illustrativeLinesResult,
  onlyMoveDeckCsv,
  opponentPrepResult,
  repertoireCoverageResult,
  resolveDanglingStubs,
  searchStructures,
  structuralProfileResult,
  suggestComplementaryLines,
  suggestGapFills,
  suggestReplacementLine,
  theoryDepth,
  toolDefault,
  transpositionResult,
  type ExplorerDb,
} from "@chess-mcp/chess-tools";
import { makeFen } from "chessops/fen";
import type { BrowserCommandHandler } from "./types";
import { commandAnalyse, throwIfAborted } from "./types";

const explorerAuthRequired = () => ({
  error: "explorer_auth_required",
  reason: "the Lichess opening explorer requires authentication; ask the user to add a personal API token (no scopes needed, lichess.org/account/oauth/token) in Settings",
});

type RepertoireCommandName =
  | "find_repertoire_gaps"
  | "suggest_gap_fills"
  | "find_theory_depth"
  | "get_transpositions"
  | "find_pruning_transpositions"
  | "get_repertoire_coverage"
  | "get_structural_profile"
  | "analyze_repertoire_congruence"
  | "classify_illustrative_lines"
  | "modify_repertoire_line"
  | "suggest_complementary_lines"
  | "suggest_replacement_line"
  | "audit_repertoire_moves"
  | "find_only_moves"
  | "find_structures"
  | "inspect_shortcut"
  | "export_annotated_repertoire"
  | "prep_vs_opponent";

export const repertoireCommands: Record<RepertoireCommandName, BrowserCommandHandler> = {
  find_repertoire_gaps: async (args, context) => {
    const popularity = args.popularity as boolean | undefined;
    if (popularity && !context.hasExplorerToken()) return explorerAuthRequired();
    const result = await gapScanOperation(
      context.currentTree(),
      context.currentColor(),
      {
        depth: args.depth as number | undefined,
        min_severity: args.min_severity as never,
        max_positions: args.max_positions as number | undefined,
        limit: args.limit as number | undefined,
      },
      commandAnalyse(context),
      popularity ? (fen) => context.explorerPosition(fen, { db: args.popularity_db as ExplorerDb | undefined, movesLimit: 30 }, context.signal) : undefined,
      {
        onProgress: (done, total) => context.onProgress?.(done, total, "scanning repertoire positions"),
        shouldCancel: () => context.signal?.aborted ?? false,
      },
    );
    throwIfAborted(context.signal);
    return result;
  },
  suggest_gap_fills: async (args, context) => {
    const tree = context.currentTree();
    const path = tree.indexPathOfSan((args.variation_path as string[]) ?? []);
    if (!path) return { error: "path_not_found", reason: "variation_path is not in the repertoire" };
    const result = await suggestGapFills(tree, context.currentColor(), path, args.uncovered_move as string, {
      depth: args.depth as number | undefined,
      limit: args.limit as number | undefined,
      target_plies: args.target_plies as number | undefined,
    }, commandAnalyse(context));
    throwIfAborted(context.signal);
    return result;
  },
  find_theory_depth: async (args, context) => {
    if (!context.hasExplorerToken()) return explorerAuthRequired();
    const db = (args.db as ExplorerDb | undefined) ?? toolDefault("find_theory_depth", "db", "lichess");
    const result = await theoryDepth(
      context.currentTree(),
      {
        minGames: (args.min_games as number | undefined) ?? (db === "masters" ? 5 : 100),
        maxPositions: args.max_positions as number | undefined,
        shouldCancel: () => context.signal?.aborted ?? false,
        onProgress: (done, total) => context.onProgress?.(done, total, "querying opening explorer"),
      },
      (fen) => context.explorerPosition(fen, { db, movesLimit: 0 }, context.signal),
    );
    throwIfAborted(context.signal);
    return "error" in result ? result : { db, ...result };
  },
  get_transpositions: (args, context) => transpositionResult(context.currentTree(), (args.limit as number | undefined) ?? toolDefault("get_transpositions", "limit", 20)),
  find_pruning_transpositions: async (args, context) => {
    context.onProgress?.(0, args.budget as number | undefined, "checking shortcut candidates");
    const result = await context.currentTree().pruneTranspositions(
      context.currentColor(),
      {
        multipv: (args.multipv as number | undefined) ?? toolDefault("find_pruning_transpositions", "multipv", 4),
        cpThreshold: (args.cp_threshold as number | undefined) ?? toolDefault("find_pruning_transpositions", "cp_threshold", 50),
        maxLossCp: args.max_loss_cp as number | undefined,
        budget: args.budget as number | undefined,
        leafStart: args.leaf_start as number | undefined,
        leafCount: args.leaf_count as number | undefined,
        confirmDepth: args.confirm_depth as number | undefined,
        shouldCancel: () => context.signal?.aborted ?? false,
      },
      (fen, multipv, depth) => context.analyse(
        fen,
        multipv,
        depth ?? ((args.depth as number | undefined) ?? toolDefault("find_pruning_transpositions", "depth", 14)),
        depth != null ? undefined : args.movetime_ms as number | undefined,
        context.signal,
      ),
      (done, total) => context.onProgress?.(done, total, "checking shortcut candidates"),
    );
    throwIfAborted(context.signal);
    const suggestions = result.suggestions.slice(0, (args.limit as number | undefined) ?? toolDefault("find_pruning_transpositions", "limit", 20));
    context.onProgress?.(result.positionsAnalysed, result.totalPositionsEstimate, "shortcut scan");
    return {
      total: result.suggestions.length,
      returned: suggestions.length,
      suggestions,
      total_leaves: result.totalLeaves,
      leaf_start: result.leafStart,
      leaves_scanned: result.leavesScanned,
      next_leaf: result.nextLeaf,
      positions_analysed: result.positionsAnalysed,
      total_positions_estimate: result.totalPositionsEstimate,
      estimated_positions_remaining: result.estimatedPositionsRemaining,
      partial: result.partial,
    };
  },
  get_repertoire_coverage: async (args, context) => {
    const base = repertoireCoverageResult(context.currentTree(), context.currentColor(), (args.limit as number | undefined) ?? toolDefault("get_repertoire_coverage", "limit", 20));
    if (!args.connect_stubs) return base;
    const result = await resolveDanglingStubs(context.currentTree(), context.currentColor(), {
      limit: args.limit as number | undefined,
      shouldCancel: () => context.signal?.aborted ?? false,
      onProgress: (done, total) => context.onProgress?.(done, total, "connecting dangling stubs"),
    }, commandAnalyse(context));
    throwIfAborted(context.signal);
    return "error" in result ? { ...base, error: result.error } : { ...base, stubs_resolved: result.resolved, dangling_lines: result.dangling };
  },
  get_structural_profile: (args, context) => structuralProfileResult(context.currentTree(), context.currentColor(), args.variation_path as string[] | undefined),
  analyze_repertoire_congruence: async (args, context) => analyzeCongruence(context.currentTree(), context.currentColor(), await context.openings(), {
    minSeverity: args.min_severity as never,
    limit: args.limit as number | undefined,
    acknowledgedWeaknesses: args.acknowledged_weaknesses as string[][] | undefined,
    excludePaths: args.exclude_paths as string[][] | undefined,
  }),
  classify_illustrative_lines: (args, context) => illustrativeLinesResult(context.currentTree(), context.currentColor(), (args.limit as number | undefined) ?? toolDefault("classify_illustrative_lines", "limit", 20)),
  modify_repertoire_line: (args, context) => context.stageEdit(args.action as "add" | "prune" | "reorder", (args.path as string[]) ?? [], {
    addMoves: args.add_moves as string[] | undefined,
    promoteMove: args.promote_move as string | undefined,
  }),
  suggest_complementary_lines: async (args, context) => {
    const result = await suggestComplementaryLines(
      context.currentTree(), context.currentColor(), (args.fen as string | undefined) || context.currentFen(),
      { mode: args.mode as never, depth: args.depth as number | undefined, limit: args.limit as number | undefined },
      commandAnalyse(context),
    );
    throwIfAborted(context.signal);
    return result;
  },
  suggest_replacement_line: async (args, context) => {
    const result = await suggestReplacementLine(
      context.currentTree(), context.currentColor(), (args.outlier_variation_path as string[]) ?? [],
      { mode: args.mode as never, depth: args.depth as number | undefined }, commandAnalyse(context),
    );
    throwIfAborted(context.signal);
    return result;
  },
  audit_repertoire_moves: async (args, context) => {
    const result = await auditRepertoireMoves(context.currentTree(), context.currentColor(), {
      depth: (args.depth as number | undefined) ?? toolDefault("audit_repertoire_moves", "depth", 14),
      minCpLoss: (args.min_cp_loss as number | undefined) ?? toolDefault("audit_repertoire_moves", "min_cp_loss", 50),
      maxPositions: (args.max_positions as number | undefined) ?? toolDefault("audit_repertoire_moves", "max_positions", 20),
      limit: (args.limit as number | undefined) ?? toolDefault("audit_repertoire_moves", "limit", 10),
      shouldCancel: () => context.signal?.aborted ?? false,
      onProgress: (done, total) => context.onProgress?.(done, total, "auditing prescribed moves"),
    }, commandAnalyse(context));
    throwIfAborted(context.signal);
    return result;
  },
  find_only_moves: async (args, context) => {
    const result = await findOnlyMoves(context.currentTree(), context.currentColor(), {
      depth: (args.depth as number | undefined) ?? toolDefault("find_only_moves", "depth", 14),
      minMargin: (args.min_margin as number | undefined) ?? toolDefault("find_only_moves", "min_margin", 100),
      maxPositions: (args.max_positions as number | undefined) ?? toolDefault("find_only_moves", "max_positions", 300),
      linesLimit: (args.lines_limit as number | undefined) ?? toolDefault("find_only_moves", "lines_limit", 10),
      shouldCancel: () => context.signal?.aborted ?? false,
      onProgress: (done, total) => context.onProgress?.(done, total, "finding critical positions"),
    }, commandAnalyse(context));
    throwIfAborted(context.signal);
    if ("error" in result) return result;
    if ("cancelled" in result) return result;
    const findings = result.findings.slice(0, (args.limit as number | undefined) ?? toolDefault("find_only_moves", "limit", 25));
    return args.export_deck
      ? { ...result, findings, deck: context.createArtifact("csv", onlyMoveDeckCsv(result.color, result.findings), "only-move-drill.csv") }
      : { ...result, findings };
  },
  find_structures: (args, context) => {
    const structure = args.structure as string | undefined;
    const center = args.center as "tense" | "locked" | "open" | "semi-open" | undefined;
    const themes = args.themes as string[] | undefined;
    const colorComplex = args.color_complex as "light" | "dark" | undefined;
    if (!structure && !center && !themes?.length && !colorComplex) return { error: "missing_criteria", reason: "provide at least one of structure/center/themes/color_complex" };
    if (structure && !STRUCTURE_NAMES.some((candidate) => candidate.toLowerCase() === structure.toLowerCase()))
      return { error: "unknown_structure", reason: `structure must be one of: ${STRUCTURE_NAMES.join(", ")}` };
    const leaves = context.currentTree().leaves().map((leaf) => ({ path: leaf.path, board: leaf.pos.board, fen: makeFen(leaf.pos.toSetup()) }));
    const matches = searchStructures(leaves, context.currentColor(), {
      structure,
      minConfidence: (args.min_confidence as number | undefined) ?? toolDefault("find_structures", "min_confidence", 0.6),
      center,
      themes: themes as never,
      colorComplex,
    });
    return { color: context.currentColor(), leaves_total: leaves.length, total_matches: matches.length, matches: matches.slice(0, (args.limit as number | undefined) ?? toolDefault("find_structures", "limit", 30)) };
  },
  inspect_shortcut: async (args, context) => {
    const depth = (args.depth as number | undefined) ?? toolDefault("inspect_shortcut", "depth", 12);
    const linePath = args.line_path as string[];
    const atPly = args.at_ply as number;
    const joinsPath = args.joins_path as string[];
    context.onProgress?.(0, 2, "comparing shortcut lines");
    const quality = await compareShortcutLines(context.currentTree(), context.currentColor(), {
      linePath, atPly, joinsPath, depth,
      evalTiebreakCp: (args.eval_tiebreak_cp as number | undefined) ?? toolDefault("inspect_shortcut", "eval_tiebreak_cp", 30),
    }, commandAnalyse(context));
    throwIfAborted(context.signal);
    context.onProgress?.(1, 2, "checking coverage after pruning");
    const coverage = await checkShortcutCoverage(context.currentTree(), context.currentColor(), {
      linePath, atPly, depth,
      maxPositions: (args.max_positions as number | undefined) ?? toolDefault("inspect_shortcut", "max_positions", 12),
      minSeverity: args.min_severity as never,
      limit: args.limit as number | undefined,
      shouldCancel: () => context.signal?.aborted ?? false,
    }, commandAnalyse(context));
    throwIfAborted(context.signal);
    context.onProgress?.(2, 2, "shortcut inspection complete");
    return { quality, coverage };
  },
  export_annotated_repertoire: async (args, context) => {
    context.onProgress?.(0, args.max_positions as number | undefined, "running repertoire analyses");
    const result = await annotateRepertoire(context.currentTree(), context.currentColor(), {
      include: args.include as never,
      depth: (args.depth as number | undefined) ?? toolDefault("export_annotated_repertoire", "depth", 14),
      maxPositions: args.max_positions as number | undefined,
      minCpLoss: args.min_cp_loss as number | undefined,
      minMargin: args.min_margin as number | undefined,
      minSeverity: args.min_severity as never,
      shouldCancel: () => context.signal?.aborted ?? false,
      onProgress: (done, total) => context.onProgress?.(done, total, "annotating repertoire"),
    }, commandAnalyse(context), await context.openings());
    throwIfAborted(context.signal);
    if ("error" in result) return result;
    if ("cancelled" in result) return result;
    const base = (context.currentFileName() ?? "repertoire.pgn").replace(/\.pgn$/i, "");
    return { ...context.createArtifact("pgn", result.pgn, `${base}-annotated.pgn`) as object, color: result.color, annotated: result.annotated };
  },
  prep_vs_opponent: async (args, context) => {
    const platform = (args.platform as "lichess" | "chesscom" | undefined) ?? toolDefault("prep_vs_opponent", "platform", "lichess");
    const username = args.username as string;
    if (platform === "chesscom" && (args.year == null || args.month == null)) return { error: "missing_arg", reason: "chesscom requires year and month" };
    const games = platform === "chesscom"
      ? await context.chesscomGames(username, args.year as number, args.month as number, undefined, true, context.signal)
      : await context.lichessGames(username, (args.max_games as number | undefined) ?? toolDefault("prep_vs_opponent", "max_games", 30), undefined, true, context.signal);
    throwIfAborted(context.signal);
    return games === null ? { error: "fetch_failed", reason: "offline or unknown user" } : opponentPrepResult(context.currentTree(), context.currentColor(), username, games, await context.openings());
  },
};
