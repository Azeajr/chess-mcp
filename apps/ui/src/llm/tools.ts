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
import { fen, color, actions, currentTree } from "../store/game";
import { analyseMulti } from "../engine/stockfish";
import {
  cloudEval,
  tablebaseLookup,
  legalMoves,
  moveSan,
  validateFen,
  validatePgn,
  validateLine,
  identifyDeepest,
  parseOpeningsTsv,
  aggregateGames,
  lichessGames,
  chesscomGames,
  walkGameVsRepertoire,
  positionProfile,
  aggregateProfile,
  analyzeCongruence,
  analyzeMainline,
  findRepertoireGaps,
  resolveDanglingStubs,
  compareMoves,
  suggestComplementaryLines,
  suggestReplacementLine,
  moveAccuracy,
  type OpeningTable,
  type GameRecord,
  type Color,
  type MoveRecord,
} from "@chess-mcp/chess-tools";
import { parsePgn, makePgn } from "chessops/pgn";
import { makeFen } from "chessops/fen";
import { addSuggestion } from "../store/suggestions";

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

const MATE_CP = 100000;
const lean = (r: MoveRecord) => ({ ply: r.ply, color: r.color, san: r.san, cp_loss: r.cp_loss, classification: r.classification });
const NAG: Record<string, number> = { blunder: 4, mistake: 2, inaccuracy: 6 };

export const toolSchemas: ToolSchema[] = [
  fn("get_position", "Current board state: FEN, the repertoire color the user plays, and the full working PGN (with variations). Call this to ground yourself before analysing.", {}),
  fn("get_legal_moves", "Legal moves (SAN) at a position.", { fen: { type: "string", description: "FEN; defaults to the current position" } }),
  fn("evaluate_position", "Local Stockfish multi-line analysis. Returns top moves with white-POV evaluation (cp, or mate): positive favors White, negative favors Black. Use this for any 'what's best / how good is' question.", {
    fen: { type: "string", description: "FEN; defaults to the current position" },
    lines: { type: "integer", description: "number of top lines (default 3)" },
  }),
  fn("compare_moves", "Rank candidate SAN moves at a position by local Stockfish (mover POV). Illegal moves are flagged.", {
    moves: { type: "array", items: { type: "string" }, description: "candidate SAN moves" },
    fen: { type: "string", description: "FEN; defaults to the current position" },
    depth: { type: "integer" },
  }, ["moves"]),
  fn("validate_fen", "Validate a FEN; returns the normalised FEN when legal.", { fen: { type: "string" } }, ["fen"]),
  fn("validate_pgn", "Validate a PGN; returns the game count.", { pgn: { type: "string" } }, ["pgn"]),
  fn("validate_line", "Validate SAN moves from a position; returns canonical SANs or the first illegal index.", {
    moves: { type: "array", items: { type: "string" } },
    fen: { type: "string", description: "FEN; defaults to the current position" },
  }, ["moves"]),
  fn("cloud_eval", "Lichess community cloud evaluation for a position (white-POV), if available.", { fen: { type: "string", description: "FEN; defaults to the current position" } }),
  fn("tablebase_lookup", "Lichess tablebase result for a ≤7-piece endgame position (win/draw/loss, DTZ), or unavailable.", { fen: { type: "string", description: "FEN; defaults to the current position" } }),
  fn("identify_opening", "Name the deepest ECO opening the current line (or a given PGN) reaches.", { pgn: { type: "string", description: "PGN; defaults to the current working line" } }),
  // --- repertoire tools (operate on the current working repertoire tree) ---
  fn("find_repertoire_gaps", "Scan the current repertoire's decision nodes for uncovered strong opponent replies, ranked by severity.", {
    depth: { type: "integer" },
    min_severity: { type: "string", enum: ["low", "medium", "high"] },
    max_positions: { type: "integer" },
    limit: { type: "integer" },
  }),
  fn("get_transpositions", "Positions the current repertoire reaches by more than one move order, largest groups first.", { limit: { type: "integer" } }),
  fn("find_pruning_transpositions", "Engine-backed. SHORTEN lines to cut memorization: for each leaf line, walk YOUR moves earliest-first; among the top engine moves within a near-best window of #1 (cp_threshold — never a blunder, even if multipv ranks one), find a move that transposes into a DIFFERENT prepared line, making the original tail redundant. Each suggestion reports savedPlies + the eval trade (evalStay vs evalTranspose). One earliest re-route per line, ranked by tail saved. Engine effort per position: depth (default 14) or movetime_ms (time-based, a better dial than depth for sharp positions). Leave budget UNSET for full coverage (it is spent in tree order, so a low cap silently misses transposable lines that sort last). For a long scan, page with leaf_start/leaf_count and report the returned next_leaf / total_leaves between calls.", { limit: { type: "integer" }, multipv: { type: "integer" }, cp_threshold: { type: "integer" }, max_loss_cp: { type: "integer" }, depth: { type: "integer" }, movetime_ms: { type: "integer", description: "ms per position (overrides depth)" }, budget: { type: "integer", description: "max positions analysed; leave unset for full coverage" }, leaf_start: { type: "integer", description: "cursor: first leaf to scan (default 0)" }, leaf_count: { type: "integer", description: "cursor: leaves to scan from leaf_start (default: all)" }, confirm_depth: { type: "integer", description: "E1: deep-confirm depth for each line's best-eval re-route" } }),
  fn("get_repertoire_coverage", "Tree-shape hygiene: dangling lines (your-turn leaves owed a move) vs natural frontiers. Pass connect_stubs=true to engine-check whether each dangling stub bridges back into prep — resolved stubs report connects_via + joins_path.", { limit: { type: "integer" }, connect_stubs: { type: "boolean" } }),
  fn("get_structural_profile", "Static pawn-structure profile of the current repertoire. With variation_path (SAN list): one position's classified structure, center, primitives, themes. Without it: an aggregate structure fingerprint over all leaves.", {
    variation_path: { type: "array", items: { type: "string" }, description: "SAN path to one line; omit for the aggregate" },
  }),
  fn("analyze_repertoire_congruence", "Flag thematic inconsistencies across the current repertoire's lines (engine-free), clustered by opening system: structure_outlier, weakness_inconsistency, center_inconsistency.", {
    min_severity: { type: "string", enum: ["low", "medium", "high"] },
    limit: { type: "integer" },
    exclude_paths: { type: "array", items: { type: "array", items: { type: "string" } } },
  }),
  fn("classify_illustrative_lines", "Flag illustrative side lines in the current repertoire marked with a mistake/dubious/blunder NAG ($2/$4/$6) — they inflate leaf/gap counts.", { limit: { type: "integer" } }),
  fn("modify_repertoire_line", "Preview an edit (prune/add/reorder by SAN path) to the current repertoire — returns the resulting PGN + stats WITHOUT changing the board (the user applies it via the board UI).", {
    action: { type: "string", enum: ["prune", "add", "reorder"] },
    path: { type: "array", items: { type: "string" }, description: "SAN path to the line" },
    add_moves: { type: "array", items: { type: "string" } },
    promote_move: { type: "string" },
  }, ["action", "path"]),
  fn("suggest_complementary_lines", "Engine-validated complementary moves from an anchor FEN, ranked to fit the current repertoire's structures (low_memorization) or maximise imbalance (sharp).", {
    fen: { type: "string", description: "anchor FEN; defaults to the current position" },
    mode: { type: "string", enum: ["low_memorization", "sharp"] },
    depth: { type: "integer" },
    limit: { type: "integer" },
  }),
  fn("suggest_replacement_line", "Replacement for an incongruent line in the current repertoire. Given an outlier variation_path (from analyze_repertoire_congruence), suggests sound alternatives ranked by structural fit.", {
    outlier_variation_path: { type: "array", items: { type: "string" } },
    mode: { type: "string", enum: ["structural_fit", "low_memorization", "solid"] },
    depth: { type: "integer" },
  }, ["outlier_variation_path"]),
  // --- game review + history ---
  fn("analyze_game", "Per-move engine review of a game's mainline: cp loss + classification (blunder/mistake/inaccuracy/good).", {
    pgn: { type: "string", description: "PGN; defaults to the current working line" },
    depth: { type: "integer" },
  }),
  fn("get_game_summary", "Game review summary: per-side blunder/mistake/inaccuracy counts, accuracy %, and the 3 worst moves.", {
    pgn: { type: "string", description: "PGN; defaults to the current working line" },
    depth: { type: "integer" },
  }),
  fn("export_annotated_pgn", "Annotate a game's mainline with move glyphs ($2/$4/$6) and best-move/eval comments.", {
    pgn: { type: "string", description: "PGN; defaults to the current working line" },
    depth: { type: "integer" },
  }),
  fn("batch_review", "Analyze multiple games (one PGN with several games), aggregated by opening (eco) or color.", {
    pgn: { type: "string", description: "multi-game PGN" },
    group_by: { type: "string", enum: ["eco", "color"] },
    username: { type: "string", description: "required for color grouping; filters to this user's games" },
    max_games: { type: "integer" },
    depth: { type: "integer" },
  }, ["pgn"]),
  fn("lichess_games", "Recent games for a Lichess user (metadata by default; include_pgn attaches PGNs).", {
    username: { type: "string" },
    max_games: { type: "integer" },
    opening_eco: { type: "string" },
    include_pgn: { type: "boolean" },
  }, ["username"]),
  fn("chesscom_games", "Games for a Chess.com user in a given month.", {
    username: { type: "string" },
    year: { type: "integer" },
    month: { type: "integer" },
    opening_eco: { type: "string" },
    include_pgn: { type: "boolean" },
  }, ["username", "year", "month"]),
  fn("repertoire_vs_history", "Compare the current repertoire against a user's real games: how often they reach prep, where they leave it, and what opponents play past it.", {
    username: { type: "string" },
    platform: { type: "string", enum: ["lichess", "chesscom"] },
    max_games: { type: "integer" },
    year: { type: "integer" },
    month: { type: "integer" },
  }, ["username"]),
  // --- staging (PWA-only) ---
  fn("propose_line", "Propose a line for the CURRENT position as SAN moves. It is validated and shown to the user as a blue arrow + accept/reject entry — it is NOT added to the repertoire until the user accepts.", {
    moves: { type: "array", items: { type: "string" }, description: "SAN moves from the current position" },
    comment: { type: "string", description: "one-line rationale" },
  }, ["moves"]),
];

function fn(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolSchema {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, ...(required.length ? { required } : {}) } } };
}

type Args = Record<string, unknown>;

export async function runTool(name: string, args: Args): Promise<unknown> {
  const atFen = (typeof args.fen === "string" && args.fen) || fen();
  const pgnArg = (typeof args.pgn === "string" && args.pgn) || actions.toPgn();
  const depth = typeof args.depth === "number" ? args.depth : undefined;
  const tree = currentTree();
  const col = color() as Color;

  switch (name) {
    case "get_position":
      return { fen: fen(), color: color(), pgn: actions.toPgn() };

    case "get_legal_moves":
      return { fen: atFen, moves: legalMoves(atFen) };

    case "evaluate_position": {
      const lines = typeof args.lines === "number" ? Math.max(1, Math.min(5, args.lines)) : 3;
      const res = await analyse(atFen, lines, depth ?? 14);
      if (!res) return { error: "engine offline" };
      return { fen: atFen, eval_pov: "white", eval_sign: "positive favors White; negative favors Black", lines: res.map((l) => ({ uci: l.uci, san: moveSan(atFen, l.uci), cp: l.cp, mate: l.mate, depth: l.depth })) };
    }

    case "compare_moves":
      return compareMoves(atFen, (args.moves as string[]) ?? [], depth ?? 14, analyse);

    case "validate_fen":
      return validateFen(atFen);

    case "validate_pgn":
      return validatePgn(pgnArg);

    case "validate_line":
      return validateLine(atFen, (args.moves as string[]) ?? []);

    case "cloud_eval": {
      const c = await cloudEval(atFen);
      return c ? { fen: atFen, ...c } : { fen: atFen, available: false };
    }

    case "tablebase_lookup": {
      const t = await tablebaseLookup(atFen);
      return t ?? { available: false };
    }

    case "identify_opening": {
      const hit = identifyDeepest(await openings(), pgnArg);
      return hit ?? { opening: null };
    }

    case "find_repertoire_gaps":
      return findRepertoireGaps(
        tree,
        col,
        { depth, minSeverity: args.min_severity as never, maxPositions: args.max_positions as number, limit: args.limit as number },
        analyse,
      );

    case "get_transpositions": {
      const groups = tree.transpositions();
      const shown = groups.slice(0, (args.limit as number) ?? 20);
      return { total: groups.length, returned: shown.length, transpositions: shown };
    }

    case "find_pruning_transpositions": {
      const res = await tree.pruneTranspositions(
        col,
        {
          multipv: (args.multipv as number) ?? 4,
          cpThreshold: (args.cp_threshold as number) ?? 50,
          maxLossCp: args.max_loss_cp as number | undefined,
          budget: args.budget as number | undefined,
          leafStart: args.leaf_start as number | undefined,
          leafCount: args.leaf_count as number | undefined,
          confirmDepth: args.confirm_depth as number | undefined,
        },
        (f, mpv, d) =>
          analyseMulti(f, mpv, d ?? ((args.depth as number) ?? 14), d != null ? undefined : (args.movetime_ms as number | undefined)),
      );
      const shown = res.suggestions.slice(0, (args.limit as number) ?? 20);
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
      };
    }

    case "get_repertoire_coverage": {
      const c = tree.coverage(col);
      const base = {
        color: col,
        leaves: c.leaves,
        dangling_count: c.danglingCount,
        frontier_count: c.frontierCount,
        max_depth: c.maxDepth,
        shallowest_leaf_ply: c.shallowestLeafPly,
      };
      if (!args.connect_stubs) return { ...base, dangling_lines: c.danglingLines.slice(0, (args.limit as number) ?? 20) };
      const r = await resolveDanglingStubs(tree, col, { limit: args.limit as number }, analyse);
      if ("error" in r) return { ...base, error: r.error };
      return { ...base, stubs_resolved: r.resolved, dangling_lines: r.dangling };
    }

    case "get_structural_profile": {
      const vp = args.variation_path as string[] | undefined;
      if (vp && vp.length) {
        const pos = tree.positionAtSanPath(vp);
        if (!pos) return { error: "variation_not_found", reason: "path does not match a line in the repertoire" };
        return positionProfile(pos.board, col, makeFen(pos.toSetup()));
      }
      return { color: col, ...aggregateProfile(tree.leafPositions().map((p) => p.board), col) };
    }

    case "analyze_repertoire_congruence":
      return analyzeCongruence(tree, col, await openings(), {
        minSeverity: args.min_severity as never,
        limit: args.limit as number,
        excludePaths: args.exclude_paths as string[][] | undefined,
      });

    case "classify_illustrative_lines": {
      const { lines, illustrativeLeaves } = tree.illustrativeLines();
      const shown = lines.slice(0, (args.limit as number) ?? 20);
      return { color: col, leaves_total: tree.stats().leaves, illustrative_leaves: illustrativeLeaves, lines: shown, truncated: shown.length < lines.length };
    }

    case "modify_repertoire_line": {
      const { tree: edited, error, added } = tree.edit(args.action as never, (args.path as string[]) ?? [], {
        addMoves: args.add_moves as string[] | undefined,
        promoteMove: args.promote_move as string | undefined,
      });
      if (error || !edited) return { error: error ?? "invalid_edit" };
      const s = edited.stats();
      return {
        action: args.action,
        nodes: s.nodes,
        leaves: s.leaves,
        max_depth: s.maxDepth,
        pgn: edited.toPgn(),
        // For an add, echo where the graft actually anchored + the moves grafted — the path may
        // have been re-split when it ran past the existing tree (so the model can see it worked).
        ...(added ? { added_from: added.from, added_moves: added.moves } : {}),
        note: "preview only — apply via the board to keep it",
      };
    }

    case "suggest_complementary_lines":
      return suggestComplementaryLines(tree, col, atFen, { mode: args.mode as never, depth, limit: args.limit as number }, analyse);

    case "suggest_replacement_line":
      return suggestReplacementLine(tree, col, (args.outlier_variation_path as string[]) ?? [], { mode: args.mode as never, depth }, analyse);

    case "analyze_game": {
      const records = await analyzeMainline(pgnArg, depth ?? 14, analyse);
      if (records === null) return { error: "engine offline" };
      return { total_moves: records.length, moves: records.map(lean) };
    }

    case "get_game_summary": {
      const records = await analyzeMainline(pgnArg, depth ?? 14, analyse);
      if (records === null) return { error: "engine offline" };
      const side = (c: Color) => {
        const rs = records.filter((r) => r.color === c);
        const accSum = rs.reduce((a, r) => a + moveAccuracy(r.cp_loss), 0);
        return {
          blunders: rs.filter((r) => r.classification === "blunder").length,
          mistakes: rs.filter((r) => r.classification === "mistake").length,
          inaccuracies: rs.filter((r) => r.classification === "inaccuracy").length,
          good_moves: rs.filter((r) => r.classification === "good").length,
          accuracy_pct: rs.length ? Math.round((accSum / rs.length) * 1000) / 10 : null,
        };
      };
      const worst = [...records].sort((a, b) => b.cp_loss - a.cp_loss).slice(0, 3).map(lean);
      return { total_moves: records.length, white: side("white"), black: side("black"), worst_moves: worst };
    }

    case "export_annotated_pgn": {
      const records = await analyzeMainline(pgnArg, depth ?? 14, analyse);
      if (records === null) return { error: "engine offline" };
      const game = parsePgn(pgnArg)[0];
      if (!game) return { error: "invalid_pgn", reason: "no game" };
      let node = game.moves;
      for (let k = 0; node.children.length && k < records.length; k++) {
        const child = node.children[0]!;
        const r = records[k]!;
        if (r.classification !== "good") {
          child.data.nags = [NAG[r.classification]!];
          child.data.comments = [`best: ${r.best_move} (${(r.best_eval / 100).toFixed(2)})`];
        }
        node = child;
      }
      return { annotated_pgn: makePgn(game) };
    }

    case "batch_review": {
      const mode = (args.group_by as "eco" | "color") ?? "eco";
      const username = args.username as string | undefined;
      if (mode === "color" && !username) return { error: "missing_username", reason: "color grouping requires username" };
      let games;
      try {
        games = parsePgn(args.pgn as string);
      } catch (e) {
        return { error: "invalid_pgn", reason: e instanceof Error ? e.message : String(e) };
      }
      if (!games.length) return { error: "invalid_pgn", reason: "no games" };
      games = games.slice(0, (args.max_games as number) ?? 100);
      const table = await openings();
      const records: GameRecord[] = [];
      for (const game of games) {
        let userColor: Color | null = null;
        if (username) {
          const u = username.toLowerCase();
          if ((game.headers.get("White") ?? "").toLowerCase() === u) userColor = "white";
          else if ((game.headers.get("Black") ?? "").toLowerCase() === u) userColor = "black";
          else continue;
        }
        const gamePgn = makePgn(game);
        const recs = await analyzeMainline(gamePgn, depth ?? 12, analyse);
        if (recs === null) return { error: "engine offline" };
        const relevant = userColor ? recs.filter((r) => r.color === userColor) : recs;
        const avg_cpl = relevant.length ? relevant.reduce((a, r) => a + r.cp_loss, 0) / relevant.length : 0;
        const blunders = relevant.filter((r) => r.classification !== "good").map((r) => ({ move: r.san, classification: r.classification }));
        let group_key: string, group_name: string;
        if (mode === "color") {
          group_key = userColor!;
          group_name = userColor!;
        } else {
          const op = identifyDeepest(table, gamePgn);
          group_key = op?.eco ?? "unknown";
          group_name = op?.name ?? "Unknown";
        }
        let result: GameRecord["result"] = null;
        if (username) {
          const rh = game.headers.get("Result") ?? "*";
          if (rh === "1/2-1/2") result = "draw";
          else if (rh === "1-0") result = userColor === "white" ? "win" : "loss";
          else if (rh === "0-1") result = userColor === "black" ? "win" : "loss";
        }
        records.push({ result, group_key, group_name, avg_cpl: Math.round(avg_cpl * 10) / 10, blunders });
      }
      return aggregateGames(records, !!username);
    }

    case "lichess_games": {
      const games = await lichessGames(args.username as string, (args.max_games as number) ?? 20, args.opening_eco as string | undefined, (args.include_pgn as boolean) ?? false);
      if (games === null) return { error: "fetch_failed", reason: "offline or unknown user" };
      return { platform: "lichess", username: args.username, total: games.length, games };
    }

    case "chesscom_games": {
      const games = await chesscomGames(args.username as string, args.year as number, args.month as number, args.opening_eco as string | undefined, (args.include_pgn as boolean) ?? false);
      if (games === null) return { error: "fetch_failed", reason: "offline or unknown user" };
      return { platform: "chesscom", username: args.username, year: args.year, month: args.month, total: games.length, games };
    }

    case "repertoire_vs_history": {
      const plat = (args.platform as "lichess" | "chesscom") ?? "lichess";
      let games;
      if (plat === "chesscom") {
        if (args.year == null || args.month == null) return { error: "missing_arg", reason: "chesscom requires year and month" };
        games = await chesscomGames(args.username as string, args.year as number, args.month as number, undefined, true);
      } else {
        games = await lichessGames(args.username as string, (args.max_games as number) ?? 30, undefined, true);
      }
      if (games === null) return { error: "fetch_failed", reason: "offline or unknown user" };
      const matched = games.filter((g) => g.user_color === col && g.pgn);
      const map = tree.moveMap();
      let reached = 0, plySum = 0;
      const dev = new Map<string, { fen: string; prescribed: string[]; played: string; count: number }>();
      const unc = new Map<string, { fen: string; played: string; count: number }>();
      for (const g of matched) {
        const w = walkGameVsRepertoire(map, col, g.pgn!);
        if (w.in_book_plies >= 1) reached++;
        plySum += w.in_book_plies;
        if (w.player_deviation) {
          const k = `${w.player_deviation.fen}|${w.player_deviation.played}`;
          const cur = dev.get(k) ?? { ...w.player_deviation, count: 0 };
          cur.count++;
          dev.set(k, cur);
        }
        if (w.uncovered_opponent) {
          const k = `${w.uncovered_opponent.fen}|${w.uncovered_opponent.played}`;
          const cur = unc.get(k) ?? { ...w.uncovered_opponent, count: 0 };
          cur.count++;
          unc.set(k, cur);
        }
      }
      const byCount = <T extends { count: number }>(m: Map<string, T>) => [...m.values()].sort((a, b) => b.count - a.count);
      return {
        games_total: games.length,
        games_matched_color: matched.length,
        games_reached_prep: reached,
        coverage_pct: matched.length ? Math.round((reached / matched.length) * 1000) / 10 : null,
        avg_in_book_plies: matched.length ? Math.round((plySum / matched.length) * 10) / 10 : null,
        player_deviations: byCount(dev).slice(0, 20),
        uncovered_opponent_moves: byCount(unc).slice(0, 20),
      };
    }

    case "propose_line":
      return addSuggestion((args.moves as string[]) ?? [], args.comment as string | undefined);

    default:
      return { error: `unknown tool: ${name}` };
  }
}
