/**
 * Chess tools exposed to the chat model (OpenAI function-calling schema) + a local executor.
 * Every tool runs IN THE BROWSER against chess-tools / the local engine / Lichess — the model
 * never guesses a FEN or eval, it calls these. This is the full repertoire toolset the dev MCP
 * bridge used to provide, reimplemented client-side so it also works in the deployed PWA (no Node
 * process). The engine-dependent orchestration (gaps, game review, suggest_*) is the shared
 * chess-tools implementation the Node MCP server uses too — one source of truth.
 *
 * Handle model: the MCP server is stateful (repertoire_id handles); the browser has ONE current
 * GameTree (store/game), so the repertoire tools operate on `currentTree()` directly — no handle.
 * propose_line stages a suggestion for the user to accept; it does not mutate the repertoire.
 */
import type { ToolSchema } from "./openrouter";
import type { ChatMode } from "./workflows";
import { fen, color, actions, currentTree, currentPath, fileName, version } from "../store/game";
import { analyseMulti } from "../engine/stockfish";
import {
  explorerPosition,
  theoryDepth,
  hasExplorerToken,
  type ExplorerDb,
  identifyDeepest,
  parseOpeningsTsv,
  lichessGames,
  chesscomGames,
  analyzeCongruence,
  analyzeMainline,
  resolveDanglingStubs,
  suggestComplementaryLines,
  suggestReplacementLine,
  type OpeningTable,
  type Color,
  contractsForHost,
  toolDefault,
  jsonSchemaForTool,
  validateToolArguments,
  transpositionResult,
  repertoireCoverageResult,
  illustrativeLinesResult,
  structuralProfileResult,
  gameAnalysisResult,
  gameSummaryResult,
  annotatedGameResult,
  repertoireHistoryResult,
  batchReviewOperation,
  gapScanOperation,
} from "@chess-mcp/chess-tools";
import { addSuggestion, stageEdit } from "../store/suggestions";
import { createArtifact } from "../store/artifacts";
import { POSITION_TOOL_NAMES, runBrowserPositionTool } from "./browser-position-tools";

// Shared engine orchestration expects (fen, multipv, depth) → lines; the browser engine matches.
const analyse = analyseMulti;

// ECO table: fetched once from the static asset (copied to public/ on prebuild). Falls back to an
// empty table if the asset is missing/offline — identify_opening then returns null, congruence
// still clusters via its structure/theme/first-move fallback.
let openingsPromise: Promise<OpeningTable> | null = null;
function openings(): Promise<OpeningTable> {
  if (!openingsPromise) {
    openingsPromise = fetch("/openings.tsv")
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => "")
      .then((t) => parseOpeningsTsv(t));
  }
  return openingsPromise;
}

// The opening explorer requires a Lichess login (anonymous → 401); the token comes from the
// Settings drawer (store/settings feeds the shared chess-tools holder).
const explorerAuthRequired = () => ({
  error: "explorer_auth_required",
  reason: "the Lichess opening explorer requires authentication; ask the user to add a personal API token (no scopes needed, lichess.org/account/oauth/token) in Settings",
});

export const toolSchemas: ToolSchema[] = contractsForHost("browser").map((contract) => ({
  type: "function",
  function: {
    name: contract.name,
    description: contract.description,
    parameters: jsonSchemaForTool(contract.name, "browser")!,
  },
}));

// Mode-filtered toolsets (CHAT_TOOLSET_REVIEW §10): the schema set is re-sent on every round of
// every turn, so each chat mode ships only the tools its workflow uses. CORE is the grounding
// set every mode needs; "general" (the catch-all) keeps the full set.
const CORE = ["get_position", "get_legal_moves", "evaluate_position", "compare_moves", "validate_fen", "validate_pgn", "validate_line", "propose_line"];
const MODE_TOOLS: Partial<Record<ChatMode, string[]>> = {
  position: [...CORE, "cloud_eval", "tablebase_lookup", "identify_opening", "position_popularity"],
  repertoire: [
    ...CORE,
    "identify_opening",
    "position_popularity",
    "find_theory_depth",
    "find_repertoire_gaps",
    "get_transpositions",
    "find_pruning_transpositions",
    "get_repertoire_coverage",
    "get_structural_profile",
    "analyze_repertoire_congruence",
    "classify_illustrative_lines",
    "modify_repertoire_line",
    "suggest_complementary_lines",
    "suggest_replacement_line",
    "repertoire_vs_history",
  ],
  review: [...CORE, "cloud_eval", "identify_opening", "analyze_game", "get_game_summary", "batch_review", "lichess_games", "chesscom_games"],
  annotate: [...CORE, "export_annotated_pgn"],
};

export function toolSchemasFor(mode: ChatMode): ToolSchema[] {
  const names = MODE_TOOLS[mode];
  if (!names) return toolSchemas;
  const keep = new Set(names);
  return toolSchemas.filter((t) => keep.has(t.function.name));
}

type Args = Record<string, unknown>;
export type ToolExecutionOptions = {
  signal?: AbortSignal;
  onProgress?: (done: number, total?: number, detail?: string) => void;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
};

export async function runTool(name: string, args: Args, options: ToolExecutionOptions = {}): Promise<unknown> {
  throwIfAborted(options.signal);
  const checkedArgs = validateToolArguments(name, args, "browser");
  if (!checkedArgs.ok) return { error: checkedArgs.error, reason: checkedArgs.reason };
  args = checkedArgs.value;
  if (POSITION_TOOL_NAMES.has(name)) return runBrowserPositionTool(name, args);
  const atFen = (typeof args.fen === "string" && args.fen) || fen();
  const pgnArg = (typeof args.pgn === "string" && args.pgn) || actions.toPgn();
  const depth = typeof args.depth === "number" ? args.depth : undefined;
  const tree = currentTree();
  const col = color() as Color;

  if (name === "get_current_line") {
    const selected = currentPath();
    return { path: tree.sanPathAt(selected), fen: tree.fenAt(selected), path_ref: selected };
  }
  if (name === "get_document_summary") {
    const stats = tree.stats();
    return { document_type: stats.leaves > 1 ? "repertoire" : "game", revision: version(), file_name: fileName(), color: col, selected_path: tree.sanPathAt(currentPath()), current_fen: fen(), nodes: stats.nodes, leaves: stats.leaves, max_depth: stats.maxDepth };
  }
  if (name === "get_selected_subtree") {
    const sans = tree.sanPathAt(currentPath());
    const max = (args.max_plies as number | undefined) ?? 80;
    const lines: string[][] = [];
    const walk = (path: number[], tail: string[]) => {
      if (lines.length >= 20) return;
      const node = tree.nodeAt(path);
      if (!node.children.length) { lines.push(tail.slice(0, max)); return; }
      node.children.forEach((child, index) => walk([...path, index], [...tail, child.data.san]));
    };
    walk(currentPath(), []);
    return { selected_path: sans, lines, truncated: lines.length === 20 };
  }
  if (name === "get_document_pgn") return { revision: version(), pgn: actions.toPgn() };
  if (name === "expand_capabilities") return { expanded: args.outcome };

  switch (name) {
    case "identify_opening": {
      const hit = identifyDeepest(await openings(), pgnArg);
      return hit ?? { opening: null };
    }

    case "find_repertoire_gaps": {
      const popularity = args.popularity as boolean | undefined;
      if (popularity && !hasExplorerToken()) return explorerAuthRequired();
      const result = await gapScanOperation(
        tree,
        col,
        {
          depth,
          min_severity: args.min_severity as never,
          max_positions: args.max_positions as number,
          limit: args.limit as number,
        },
        analyse,
        // movesLimit 30: a gap move outside the explorer's top list reads as ~never played, so
        // ask deep enough that the approximation only bites on true rarities.
        popularity ? (f: string) => explorerPosition(f, { db: args.popularity_db as ExplorerDb | undefined, movesLimit: 30 }) : undefined,
        {
          onProgress: (done, total) => options.onProgress?.(done, total, "scanning repertoire positions"),
          shouldCancel: () => options.signal?.aborted ?? false,
        },
      );
      throwIfAborted(options.signal);
      return result;
    }

    case "find_theory_depth": {
      if (!hasExplorerToken()) return explorerAuthRequired();
      const db = (args.db as ExplorerDb | undefined) ?? toolDefault("find_theory_depth", "db", "lichess") as ExplorerDb;
      const res = await theoryDepth(
        tree,
        { minGames: (args.min_games as number | undefined) ?? (db === "masters" ? 5 : 100), maxPositions: args.max_positions as number | undefined },
        (f) => explorerPosition(f, { db, movesLimit: 0 }),
      );
      return "error" in res ? res : { db, ...res };
    }

    case "get_transpositions": {
      return transpositionResult(tree, (args.limit as number) ?? toolDefault("get_transpositions", "limit", 20));
    }

    case "find_pruning_transpositions": {
      options.onProgress?.(0, args.budget as number | undefined, "checking shortcut candidates");
      const res = await tree.pruneTranspositions(
        col,
        {
          multipv: (args.multipv as number) ?? toolDefault("find_pruning_transpositions", "multipv", 4),
          cpThreshold: (args.cp_threshold as number) ?? toolDefault("find_pruning_transpositions", "cp_threshold", 50),
          maxLossCp: args.max_loss_cp as number | undefined,
          budget: args.budget as number | undefined,
          leafStart: args.leaf_start as number | undefined,
          leafCount: args.leaf_count as number | undefined,
          confirmDepth: args.confirm_depth as number | undefined,
        },
        (f, mpv, d) =>
          analyseMulti(f, mpv, d ?? ((args.depth as number) ?? toolDefault("find_pruning_transpositions", "depth", 14)), d != null ? undefined : (args.movetime_ms as number | undefined)),
      );
      const shown = res.suggestions.slice(0, (args.limit as number) ?? toolDefault("find_pruning_transpositions", "limit", 20));
      throwIfAborted(options.signal);
      options.onProgress?.(res.positionsAnalysed, res.totalPositionsEstimate, "shortcut scan");
      return {
        total: res.suggestions.length,
        returned: shown.length,
        suggestions: shown,
        total_leaves: res.totalLeaves,
        leaf_start: res.leafStart,
        leaves_scanned: res.leavesScanned,
        next_leaf: res.nextLeaf,
        positions_analysed: res.positionsAnalysed,
        total_positions_estimate: res.totalPositionsEstimate,
        estimated_positions_remaining: res.estimatedPositionsRemaining,
        partial: res.partial,
      };
    }

    case "get_repertoire_coverage": {
      const base = repertoireCoverageResult(tree, col, (args.limit as number) ?? toolDefault("get_repertoire_coverage", "limit", 20));
      if (!args.connect_stubs) return base;
      const r = await resolveDanglingStubs(tree, col, { limit: args.limit as number }, analyse);
      if ("error" in r) return { ...base, error: r.error };
      return { ...base, stubs_resolved: r.resolved, dangling_lines: r.dangling };
    }

    case "get_structural_profile": {
      return structuralProfileResult(tree, col, args.variation_path as string[] | undefined);
    }

    case "analyze_repertoire_congruence":
      return analyzeCongruence(tree, col, await openings(), {
        minSeverity: args.min_severity as never,
        limit: args.limit as number,
        acknowledgedWeaknesses: args.acknowledged_weaknesses as string[][] | undefined,
        excludePaths: args.exclude_paths as string[][] | undefined,
      });

    case "classify_illustrative_lines": {
      return illustrativeLinesResult(tree, col, (args.limit as number) ?? toolDefault("classify_illustrative_lines", "limit", 20));
    }

    case "modify_repertoire_line": {
      return stageEdit(args.action as "add" | "prune" | "reorder", (args.path as string[]) ?? [], {
        addMoves: args.add_moves as string[] | undefined,
        promoteMove: args.promote_move as string | undefined,
      });
    }

    case "suggest_complementary_lines":
      return suggestComplementaryLines(tree, col, atFen, { mode: args.mode as never, depth, limit: args.limit as number }, analyse);

    case "suggest_replacement_line":
      return suggestReplacementLine(tree, col, (args.outlier_variation_path as string[]) ?? [], { mode: args.mode as never, depth }, analyse);

    case "analyze_game": {
      const records = await analyzeMainline(pgnArg, depth ?? toolDefault("analyze_game", "depth", 14), analyse);
      if (records === null) return { error: "engine offline" };
      return gameAnalysisResult(records);
    }

    case "get_game_summary": {
      const records = await analyzeMainline(pgnArg, depth ?? toolDefault("get_game_summary", "depth", 14), analyse);
      if (records === null) return { error: "engine offline" };
      return gameSummaryResult(records);
    }

    case "export_annotated_pgn": {
      const records = await analyzeMainline(pgnArg, depth ?? toolDefault("export_annotated_pgn", "depth", 14), analyse);
      if (records === null) return { error: "engine offline" };
      const result = annotatedGameResult(pgnArg, records);
      if ("error" in result) return result;
      const base = (fileName() ?? "game.pgn").replace(/\.pgn$/i, "");
      return createArtifact("pgn", result.annotated_pgn, `${base}-annotated.pgn`);
    }

    case "batch_review": {
      const mode = (args.group_by as "eco" | "color") ?? toolDefault("batch_review", "group_by", "eco");
      const username = args.username as string | undefined;
      return batchReviewOperation(
        args.pgn as string,
        { groupBy: mode, username, maxGames: (args.max_games as number) ?? toolDefault("batch_review", "max_games", 100), depth: depth ?? toolDefault("batch_review", "depth", 12) },
        await openings(),
        analyse,
      );
    }

    case "lichess_games": {
      const games = await lichessGames(args.username as string, (args.max_games as number) ?? toolDefault("lichess_games", "max_games", 20), args.opening_eco as string | undefined, (args.include_pgn as boolean) ?? toolDefault("lichess_games", "include_pgn", false));
      if (games === null) return { error: "fetch_failed", reason: "offline or unknown user" };
      return { platform: "lichess", username: args.username, total: games.length, games };
    }

    case "chesscom_games": {
      const games = await chesscomGames(args.username as string, args.year as number, args.month as number, args.opening_eco as string | undefined, (args.include_pgn as boolean) ?? false);
      if (games === null) return { error: "fetch_failed", reason: "offline or unknown user" };
      return { platform: "chesscom", username: args.username, year: args.year, month: args.month, total: games.length, games };
    }

    case "repertoire_vs_history": {
      const plat = (args.platform as "lichess" | "chesscom") ?? toolDefault("repertoire_vs_history", "platform", "lichess");
      let games;
      if (plat === "chesscom") {
        if (args.year == null || args.month == null) return { error: "missing_arg", reason: "chesscom requires year and month" };
        games = await chesscomGames(args.username as string, args.year as number, args.month as number, undefined, true);
      } else {
        games = await lichessGames(args.username as string, (args.max_games as number) ?? toolDefault("repertoire_vs_history", "max_games", 30), undefined, true);
      }
      if (games === null) return { error: "fetch_failed", reason: "offline or unknown user" };
      return repertoireHistoryResult(tree, col, games);
    }

    case "propose_line":
      return addSuggestion((args.moves as string[]) ?? [], args.comment as string | undefined);

    default:
      return { error: `unknown tool: ${name}` };
  }
}
