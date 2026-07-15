/**
 * Node MCP server — exposes chess-tools + the Node Stockfish engine over MCP. One Node process: host
 * filesystem directly, bundled wasm engine, no Docker. (Supersedes an earlier Python chess-analysis +
 * chess-files stack, since removed.)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GameTree,
  validateFen,
  validatePgn,
  validateLine,
  legalMoves,
  cloudEval,
  tablebaseLookup,
  explorerPosition,
  theoryDepth,
  setExplorerToken,
  hasExplorerToken,
  type ExplorerDb,
  moveSan,
  analyzeMainline,
  auditRepertoireMoves,
  findOnlyMoves,
  onlyMoveDeckCsv,
  resolveDanglingStubs,
  compareMoves,
  suggestComplementaryLines,
  suggestReplacementLine,
  parseOpeningsTsv,
  identifyDeepest,
  lichessGames,
  chesscomGames,
  searchStructures,
  STRUCTURE_NAMES,
  annotateRepertoire,
  compareShortcutLines,
  checkShortcutCoverage,
  analyzeCongruence,
  type Color,
  type MoveRecord,
  toolContract,
  toolDefault,
  groundPosition,
  shapeEvaluation,
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
  suggestGapFills,
  opponentPrepResult,
} from "@chess-mcp/chess-tools";
import { analyseMulti } from "./engine.js";
import { makeFen } from "chessops/fen";
import { store, get } from "./handles.js";
import { confine, readCappedPgn, MAX_PGN_BYTES } from "./paths.js";

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });
const notFound = () =>
  ok({ error: "repertoire_not_found", reason: "unknown or expired repertoire_id; call load_repertoire" });

// Untrusted-input caps (the threat is caller-supplied PGN/FEN/path, not a network peer). The PGN
// byte cap bounds parse/memory DoS on every PGN that enters; MAX_COMPARE_MOVES bounds compare_moves'
// per-candidate engine work. confine() (paths.ts) is the file-path containment guard.
const pgnTooLarge = (pgn: string) =>
  Buffer.byteLength(pgn, "utf8") > MAX_PGN_BYTES
    ? ok({ error: "pgn_too_large", reason: `PGN exceeds the ${MAX_PGN_BYTES}-byte limit` })
    : null;
const MAX_COMPARE_MOVES = 64;

const server = new McpServer({ name: "chess-analysis", version: "2.0.0" });

// The opening explorer requires a Lichess login since ~2026-03 (anonymous → 401). A personal API
// token with no scopes is enough; without one the explorer tools return explorer_auth_required
// instead of letting the 401 masquerade as "offline".
setExplorerToken(process.env.LICHESS_TOKEN ?? null);
const explorerAuthRequired = () =>
  ok({
    error: "explorer_auth_required",
    reason: "the Lichess opening explorer requires authentication; set LICHESS_TOKEN to a personal API token (no scopes needed, https://lichess.org/account/oauth/token)",
  });

// --- validation / position (engine-free) ---
server.tool(
  "validate_fen",
  toolContract("validate_fen").description, { fen: z.string() }, ({ fen }) =>
  ok(validateFen(fen)),
);
server.tool(
  "validate_pgn",
  toolContract("validate_pgn").description, { pgn: z.string() }, ({ pgn }) =>
  ok(validatePgn(pgn)),
);
server.tool(
  "validate_line",
  toolContract("validate_line").description,
  { fen: z.string(), moves: z.array(z.string()) },
  ({ fen, moves }) => {
    // Gate the FEN: validateLine → parseFen().unwrap() throws a raw FenError on garbage input.
    const v = validateFen(fen);
    if (!v.valid) return ok({ error: "invalid_fen", reason: v.reason });
    return ok(validateLine(v.fen!, moves));
  },
);
server.tool(
  "get_legal_moves",
  toolContract("get_legal_moves").description, { fen: z.string() }, ({ fen }) => {
  const grounded = groundPosition(fen);
  if ("error" in grounded) return ok(grounded);
  return ok({ fen: grounded.fen, moves: grounded.legal_moves });
});
server.tool(
  "get_position",
  toolContract("get_position").description, { fen: z.string() }, ({ fen }) => {
  return ok(groundPosition(fen));
});

// --- network (offline-safe) ---
server.tool(
  "cloud_eval",
  toolContract("cloud_eval").description, { fen: z.string() }, async ({ fen }) => {
  const c = await cloudEval(fen);
  return ok(c ? { fen, ...c } : { fen, available: false });
});
server.tool(
  "tablebase_lookup",
  toolContract("tablebase_lookup").description, { fen: z.string() }, async ({ fen }) => {
  const t = await tablebaseLookup(fen);
  return ok(t ?? { available: false });
});
server.tool(
  "position_popularity",
  toolContract("position_popularity").description,
  {
    fen: z.string(),
    db: z.enum(["lichess", "masters"]).optional(),
    top_moves: z.number().int().min(0).max(30).optional(),
  },
  async ({ fen, db, top_moves }) => {
    const v = validateFen(fen);
    if (!v.valid) return ok({ error: "invalid_fen", reason: v.reason });
    if (!hasExplorerToken()) return explorerAuthRequired();
    const res = await explorerPosition(v.fen!, { db, movesLimit: top_moves });
    return ok(res ? { fen: v.fen, db: db ?? toolDefault("position_popularity", "db", "lichess"), ...res } : { fen: v.fen, available: false });
  },
);

// --- engine ---
server.tool(
  "evaluate_position",
  toolContract("evaluate_position").description,
  { fen: z.string(), depth: z.number().int().min(1).max(30).optional(), lines: z.number().int().min(1).max(5).optional() },
  async ({ fen, depth, lines }) => {
    // Reject an illegal-but-parseable FEN up front (the same gate get_position/suggest_* apply):
    // without it, moveSan below throws (chessops rejects the setup) instead of a closed-set error.
    const v = validateFen(fen);
    if (!v.valid) return ok({ error: "invalid_fen", reason: v.reason });
    // Hand the engine the NORMALISED FEN (v.fen), never the raw string: validateFen already rejects
    // newlines/garbage, and this keeps the only caller-FEN that reaches `position fen ...` canonical.
    const res = await analyseMulti(v.fen!, lines ?? toolDefault("evaluate_position", "lines", 3), depth ?? toolDefault("evaluate_position", "depth", 16));
    if (!res) return ok({ error: "engine_unavailable" });
    return ok(shapeEvaluation(v.fen!, res, moveSan));
  },
);

// --- repertoire handles ---
const colorSchema = z.enum(["white", "black"]);
function loadSummary(id: string, tree: GameTree, color: Color) {
  const s = tree.stats();
  return { repertoire_id: id, color, nodes: s.nodes, leaves: s.leaves, max_depth: s.maxDepth };
}

server.tool(
  "load_repertoire",
  toolContract("load_repertoire").description,
  { pgn: z.string(), color: colorSchema },
  ({ pgn, color }) => {
    const tl = pgnTooLarge(pgn);
    if (tl) return tl;
    let tree: GameTree;
    try {
      tree = GameTree.fromPgn(pgn);
    } catch (e) {
      return ok({ error: "invalid_pgn", reason: e instanceof Error ? e.message : String(e) });
    }
    const id = store(tree, color);
    return ok(loadSummary(id, tree, color));
  },
);
server.tool(
  "load_repertoire_from_file",
  toolContract("load_repertoire_from_file").description,
  { path: z.string(), color: colorSchema },
  async ({ path, color }) => {
    const real = confine(path);
    if (!real) return ok({ error: "path_not_allowed", reason: "path escapes the repertoire directory" });
    const r = await readCappedPgn(real);
    if ("notFound" in r) return ok({ error: "file_not_found", reason: "no such PGN under the repertoire directory" });
    if ("tooLarge" in r) return ok({ error: "pgn_too_large", reason: `PGN exceeds the ${MAX_PGN_BYTES}-byte limit` });
    let tree: GameTree;
    try {
      tree = GameTree.fromPgn(r.text);
    } catch (e) {
      return ok({ error: "invalid_pgn", reason: e instanceof Error ? e.message : String(e) });
    }
    return ok(loadSummary(store(tree, color), tree, color));
  },
);
server.tool(
  "export_repertoire",
  toolContract("export_repertoire").description, { repertoire_id: z.string() }, ({ repertoire_id }) => {
  const e = get(repertoire_id);
  if (!e) return notFound();
  const s = e.tree.stats();
  return ok({ pgn: e.tree.toPgn(), nodes: s.nodes, leaves: s.leaves, max_depth: s.maxDepth });
});
server.tool(
  "export_repertoire_to_file",
  toolContract("export_repertoire_to_file").description,
  { repertoire_id: z.string(), path: z.string() },
  async ({ repertoire_id, path }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    const real = confine(path);
    if (!real) return ok({ error: "path_not_allowed", reason: "path escapes the repertoire directory" });
    const pgn = e.tree.toPgn();
    try {
      await writeFile(real, pgn, "utf8");
    } catch {
      // Don't surface the raw fs error (it carries the absolute host path); a missing parent dir or
      // permission failure is reported as a closed-set error instead.
      return ok({ error: "write_failed", reason: "could not write under the repertoire directory" });
    }
    return ok({ path: real, bytes: Buffer.byteLength(pgn, "utf8"), leaves: e.tree.stats().leaves });
  },
);

// --- gaps (engine scan) ---
server.tool(
  "find_repertoire_gaps",
  toolContract("find_repertoire_gaps").description,
  {
    repertoire_id: z.string(),
    depth: z.number().int().min(1).max(30).optional(),
    min_severity: z.enum(["low", "medium", "high"]).optional(),
    max_positions: z.number().int().min(1).max(60).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    popularity: z.boolean().optional(),
    popularity_db: z.enum(["lichess", "masters"]).optional(),
  },
  async ({ repertoire_id, depth, min_severity, max_positions, limit, popularity, popularity_db }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    if (popularity && !hasExplorerToken()) return explorerAuthRequired();
    return ok(
      await gapScanOperation(
        e.tree,
        e.color,
        {
          depth,
          min_severity,
          max_positions,
          limit,
        },
        analyseMulti,
        // movesLimit 30: a gap move outside the explorer's top list reads as ~never played, so
        // ask deep enough that the approximation only bites on true rarities.
        popularity ? (fen) => explorerPosition(fen, { db: popularity_db, movesLimit: 30 }) : undefined,
      ),
    );
  },
);

server.tool(
  "suggest_gap_fills",
  toolContract("suggest_gap_fills").description,
  {
    repertoire_id: z.string(),
    variation_path: z.array(z.string()),
    uncovered_move: z.string(),
    depth: z.number().int().min(1).max(30).optional(),
    limit: z.number().int().min(2).max(10).optional(),
    target_plies: z.number().int().min(2).max(200).optional(),
  },
  async ({ repertoire_id, variation_path, uncovered_move, depth, limit, target_plies }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    const path = e.tree.indexPathOfSan(variation_path);
    if (!path) return ok({ error: "path_not_found", reason: "variation_path is not in the repertoire" });
    return ok(await suggestGapFills(e.tree, e.color, path, uncovered_move, { depth, limit, target_plies }, analyseMulti));
  },
);

server.tool(
  "find_theory_depth",
  toolContract("find_theory_depth").description,
  {
    repertoire_id: z.string(),
    db: z.enum(["lichess", "masters"]).optional(),
    min_games: z.number().int().min(1).optional(),
    max_positions: z.number().int().min(1).max(120).optional(),
  },
  async ({ repertoire_id, db, min_games, max_positions }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    if (!hasExplorerToken()) return explorerAuthRequired();
    const d: ExplorerDb = db ?? toolDefault("find_theory_depth", "db", "lichess");
    const res = await theoryDepth(
      e.tree,
      { minGames: min_games ?? (d === "masters" ? 5 : 100), maxPositions: max_positions },
      (fen) => explorerPosition(fen, { db: d, movesLimit: 0 }),
    );
    return ok("error" in res ? res : { db: d, ...res });
  },
);

server.tool(
  "audit_repertoire_moves",
  toolContract("audit_repertoire_moves").description,
  {
    repertoire_id: z.string(),
    depth: z.number().int().min(1).max(30).optional(),
    min_cp_loss: z.number().int().min(0).optional(),
    max_positions: z.number().int().min(1).max(60).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  async ({ repertoire_id, depth, min_cp_loss, max_positions, limit }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    return ok(
      await auditRepertoireMoves(
        e.tree,
        e.color,
        { depth, minCpLoss: min_cp_loss, maxPositions: max_positions, limit },
        analyseMulti,
      ),
    );
  },
);

server.tool(
  "find_only_moves",
  toolContract("find_only_moves").description,
  {
    repertoire_id: z.string(),
    depth: z.number().int().min(1).max(30).optional(),
    min_margin: z.number().int().min(0).optional(),
    max_positions: z.number().int().min(1).max(300).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    lines_limit: z.number().int().min(1).max(50).optional(),
    export_path: z.string().optional(),
  },
  async ({ repertoire_id, depth, min_margin, max_positions, limit, lines_limit, export_path }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    // Resolve the export path BEFORE the engine scan so a bad path fails in ms, not after it.
    let real: string | null = null;
    if (export_path !== undefined) {
      real = confine(export_path);
      if (!real) return ok({ error: "path_not_allowed", reason: "path escapes the repertoire directory" });
    }
    const res = await findOnlyMoves(
      e.tree,
      e.color,
      { depth, minMargin: min_margin, maxPositions: max_positions, linesLimit: lines_limit },
      analyseMulti,
    );
    if ("error" in res || "cancelled" in res) return ok(res);
    let deck: { path: string; rows: number; bytes: number } | undefined;
    if (real) {
      const csv = onlyMoveDeckCsv(res.color, res.findings);
      try {
        await writeFile(real, csv, "utf8");
      } catch {
        // Don't surface the raw fs error (it carries the absolute host path).
        return ok({ error: "write_failed", reason: "could not write under the repertoire directory" });
      }
      deck = { path: real, rows: res.findings.length, bytes: Buffer.byteLength(csv, "utf8") };
    }
    return ok({ ...res, findings: res.findings.slice(0, limit ?? toolDefault("find_only_moves", "limit", 25)), ...(deck ? { deck } : {}) });
  },
);

server.tool(
  "get_transpositions",
  toolContract("get_transpositions").description,
  { repertoire_id: z.string(), limit: z.number().int().min(1).max(100).optional() },
  ({ repertoire_id, limit }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    return ok(transpositionResult(e.tree, limit ?? toolDefault("get_transpositions", "limit", 20)));
  },
);

server.tool(
  "find_pruning_transpositions",
  toolContract("find_pruning_transpositions").description,
  {
    repertoire_id: z.string(),
    limit: z.number().int().min(1).max(100).optional(),
    multipv: z.number().int().min(1).max(8).optional(),
    cp_threshold: z.number().int().min(0).max(500).optional(),
    max_loss_cp: z.number().int().min(0).max(1000).optional(),
    depth: z.number().int().min(1).max(30).optional(),
    movetime_ms: z.number().int().min(50).max(10000).optional(),
    budget: z.number().int().min(1).max(500).optional(),
    leaf_start: z.number().int().min(0).optional(),
    leaf_count: z.number().int().min(1).max(200).optional(),
    confirm_depth: z.number().int().min(1).max(30).optional(),
  },
  async ({ repertoire_id, limit, multipv, cp_threshold, max_loss_cp, depth, movetime_ms, budget, leaf_start, leaf_count, confirm_depth }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    const res = await e.tree.pruneTranspositions(
      e.color,
      { multipv: multipv ?? toolDefault("find_pruning_transpositions", "multipv", 4), cpThreshold: cp_threshold ?? toolDefault("find_pruning_transpositions", "cp_threshold", 50), maxLossCp: max_loss_cp, budget, leafStart: leaf_start, leafCount: leaf_count, confirmDepth: confirm_depth },
      // depth override d (E1 deep confirm) uses fixed depth and bypasses movetime; else the scan effort.
      (fen, mpv, d) => analyseMulti(fen, mpv, d ?? depth ?? toolDefault("find_pruning_transpositions", "depth", 14), d != null ? undefined : movetime_ms),
    );
    const shown = res.suggestions.slice(0, limit ?? toolDefault("find_pruning_transpositions", "limit", 20));
    return ok({
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
    });
  },
);

server.tool(
  "check_shortcut_coverage",
  toolContract("check_shortcut_coverage").description,
  {
    repertoire_id: z.string(),
    line_path: z.array(z.string()),
    at_ply: z.number().int().min(0),
    depth: z.number().int().min(1).max(30).optional(),
    min_severity: z.enum(["low", "medium", "high"]).optional(),
    max_positions: z.number().int().min(1).max(60).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  async ({ repertoire_id, line_path, at_ply, depth, min_severity, max_positions, limit }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    return ok(
      await checkShortcutCoverage(
        e.tree,
        e.color,
        { linePath: line_path, atPly: at_ply, depth, minSeverity: min_severity, maxPositions: max_positions, limit },
        analyseMulti,
      ),
    );
  },
);

server.tool(
  "compare_shortcut_lines",
  toolContract("compare_shortcut_lines").description,
  {
    repertoire_id: z.string(),
    line_path: z.array(z.string()),
    at_ply: z.number().int().min(0),
    joins_path: z.array(z.string()),
    depth: z.number().int().min(1).max(30).optional(),
    eval_tiebreak_cp: z.number().int().min(0).max(500).optional(),
  },
  async ({ repertoire_id, line_path, at_ply, joins_path, depth, eval_tiebreak_cp }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    return ok(
      await compareShortcutLines(
        e.tree,
        e.color,
        { linePath: line_path, atPly: at_ply, joinsPath: joins_path, depth, evalTiebreakCp: eval_tiebreak_cp },
        analyseMulti,
      ),
    );
  },
);

server.tool(
  "get_repertoire_coverage",
  toolContract("get_repertoire_coverage").description,
  { repertoire_id: z.string(), limit: z.number().int().min(1).max(100).optional(), connect_stubs: z.boolean().optional() },
  async ({ repertoire_id, limit, connect_stubs }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    const base = repertoireCoverageResult(e.tree, e.color, limit ?? toolDefault("get_repertoire_coverage", "limit", 20));
    if (!connect_stubs) return ok(base);
    const r = await resolveDanglingStubs(e.tree, e.color, { limit }, analyseMulti);
    if ("error" in r) return ok({ ...base, error: r.error });
    return ok({ ...base, stubs_resolved: r.resolved, dangling_lines: r.dangling });
  },
);

server.tool(
  "compare_moves",
  toolContract("compare_moves").description,
  { fen: z.string(), moves: z.array(z.string()), depth: z.number().int().min(1).max(30).optional() },
  async ({ fen, moves, depth }) => {
    // Gate the FEN (compareMoves → validateLine throws a raw FenError on garbage) and cap the
    // candidate list — each candidate triggers a separate engine search, so an unbounded array is a
    // per-call DoS.
    const v = validateFen(fen);
    if (!v.valid) return ok({ error: "invalid_fen", reason: v.reason });
    if (moves.length > MAX_COMPARE_MOVES)
      return ok({ error: "too_many_moves", reason: `at most ${MAX_COMPARE_MOVES} candidate moves` });
    return ok(await compareMoves(v.fen!, moves, depth ?? toolDefault("compare_moves", "depth", 14), analyseMulti));
  },
);

// --- game analysis (engine) ---
server.tool(
  "analyze_game",
  toolContract("analyze_game").description,
  { pgn: z.string(), depth: z.number().int().min(1).max(30).optional(), verbose: z.boolean().optional() },
  async ({ pgn, depth, verbose }) => {
    const tl = pgnTooLarge(pgn);
    if (tl) return tl;
    let records: MoveRecord[] | null;
    try {
      records = await analyzeMainline(pgn, depth ?? toolDefault("analyze_game", "depth", 14), analyseMulti);
    } catch (e) {
      return ok({ error: "invalid_pgn", reason: e instanceof Error ? e.message : String(e) });
    }
    if (records === null) return ok({ error: "engine_unavailable" });
    return ok(verbose ? { total_moves: records.length, moves: records } : gameAnalysisResult(records));
  },
);

server.tool(
  "get_game_summary",
  toolContract("get_game_summary").description,
  { pgn: z.string(), depth: z.number().int().min(1).max(30).optional() },
  async ({ pgn, depth }) => {
    const tl = pgnTooLarge(pgn);
    if (tl) return tl;
    let records: MoveRecord[] | null;
    try {
      records = await analyzeMainline(pgn, depth ?? toolDefault("get_game_summary", "depth", 14), analyseMulti);
    } catch (e) {
      return ok({ error: "invalid_pgn", reason: e instanceof Error ? e.message : String(e) });
    }
    if (records === null) return ok({ error: "engine_unavailable" });

    return ok(gameSummaryResult(records));
  },
);

server.tool(
  "export_annotated_pgn",
  toolContract("export_annotated_pgn").description,
  { pgn: z.string(), depth: z.number().int().min(1).max(30).optional() },
  async ({ pgn, depth }) => {
    const tl = pgnTooLarge(pgn);
    if (tl) return tl;
    let records: MoveRecord[] | null;
    try {
      records = await analyzeMainline(pgn, depth ?? toolDefault("export_annotated_pgn", "depth", 14), analyseMulti);
    } catch (e) {
      return ok({ error: "invalid_pgn", reason: e instanceof Error ? e.message : String(e) });
    }
    if (records === null) return ok({ error: "engine_unavailable" });

    return ok(annotatedGameResult(pgn, records));
  },
);

server.tool(
  "export_annotated_repertoire",
  toolContract("export_annotated_repertoire").description,
  {
    repertoire_id: z.string(),
    include: z.array(z.enum(["audit", "only_moves", "gaps", "congruence"])).optional(),
    depth: z.number().int().min(1).max(30).optional(),
    max_positions: z.number().int().min(1).max(300).optional(),
    min_cp_loss: z.number().int().min(0).optional(),
    min_margin: z.number().int().min(0).optional(),
    min_severity: z.enum(["low", "medium", "high"]).optional(),
    export_path: z.string().optional(),
  },
  async ({ repertoire_id, include, depth, max_positions, min_cp_loss, min_margin, min_severity, export_path }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    // Resolve the export path BEFORE the engine scans so a bad path fails in ms, not after them.
    let real: string | null = null;
    if (export_path !== undefined) {
      real = confine(export_path);
      if (!real) return ok({ error: "path_not_allowed", reason: "path escapes the repertoire directory" });
    }
    const res = await annotateRepertoire(
      e.tree,
      e.color,
      { include, depth, maxPositions: max_positions, minCpLoss: min_cp_loss, minMargin: min_margin, minSeverity: min_severity },
      analyseMulti,
      openingsTable,
    );
    if ("error" in res || "cancelled" in res) return ok(res);
    if (real) {
      try {
        await writeFile(real, res.pgn, "utf8");
      } catch {
        // Don't surface the raw fs error (it carries the absolute host path).
        return ok({ error: "write_failed", reason: "could not write under the repertoire directory" });
      }
      return ok({ color: res.color, path: real, bytes: Buffer.byteLength(res.pgn, "utf8"), annotated: res.annotated });
    }
    return ok(res);
  },
);

// --- repertoire edit + illustrative lines ---
server.tool(
  "modify_repertoire_line",
  toolContract("modify_repertoire_line").description,
  {
    repertoire_id: z.string(),
    action: z.enum(["prune", "add", "reorder"]),
    path: z.array(z.string()),
    add_moves: z.array(z.string()).optional(),
    promote_move: z.string().optional(),
  },
  ({ repertoire_id, action, path, add_moves, promote_move }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    const { tree, error, added } = e.tree.edit(action, path, { addMoves: add_moves, promoteMove: promote_move });
    if (error || !tree) return ok({ error: error ?? "invalid_edit" });
    const id = store(tree, e.color);
    const s = tree.stats();
    const where = path.length ? path.join(" ") : "root";
    // For add, report the prefix the graft actually anchored to (the path may have been
    // re-split when it ran past the tree), not the raw input path.
    const addWhere = added?.from.length ? added.from.join(" ") : "root";
    const summary =
      action === "prune"
        ? `pruned subtree at '${where}'`
        : action === "add"
          ? `added ${added?.moves.length ?? 0} ply under '${addWhere}'`
          : `promoted '${promote_move}' to mainline at '${where}'`;
    return ok({ new_repertoire_id: id, action, nodes: s.nodes, leaves: s.leaves, max_depth: s.maxDepth, summary });
  },
);

server.tool(
  "classify_illustrative_lines",
  toolContract("classify_illustrative_lines").description,
  { repertoire_id: z.string(), limit: z.number().int().min(1).max(100).optional() },
  ({ repertoire_id, limit }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    return ok(illustrativeLinesResult(e.tree, e.color, limit ?? toolDefault("classify_illustrative_lines", "limit", 20)));
  },
);

// --- ECO opening lookup ---
const openingsTable = parseOpeningsTsv(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "data", "openings.tsv"), "utf8"),
);
server.tool(
  "identify_opening",
  toolContract("identify_opening").description,
  { pgn: z.string() },
  ({ pgn }) => {
    const hit = identifyDeepest(openingsTable, pgn);
    return ok(hit ?? { opening: null });
  },
);

// --- batch review (engine, multi-game) ---
server.tool(
  "batch_review",
  toolContract("batch_review").description,
  {
    pgn: z.string(),
    group_by: z.enum(["eco", "color"]).optional(),
    username: z.string().optional(),
    max_games: z.number().int().min(1).max(100).optional(),
    depth: z.number().int().min(1).max(30).optional(),
  },
  async ({ pgn, group_by, username, max_games, depth }) => {
    const tl = pgnTooLarge(pgn);
    if (tl) return tl;
    return ok(await batchReviewOperation(
      pgn,
      {
        groupBy: group_by ?? toolDefault("batch_review", "group_by", "eco"),
        username,
        maxGames: max_games ?? toolDefault("batch_review", "max_games", 100),
        depth: depth ?? toolDefault("batch_review", "depth", 12),
      },
      openingsTable,
      analyseMulti,
    ));
  },
);

// --- game history (network) ---
server.tool(
  "lichess_games",
  toolContract("lichess_games").description,
  {
    username: z.string(),
    max_games: z.number().int().min(1).max(100).optional(),
    opening_eco: z.string().optional(),
    include_pgn: z.boolean().optional(),
  },
  async ({ username, max_games, opening_eco, include_pgn }) => {
    const games = await lichessGames(username, max_games ?? toolDefault("lichess_games", "max_games", 20), opening_eco, include_pgn ?? toolDefault("lichess_games", "include_pgn", false));
    if (games === null) return ok({ error: "fetch_failed", reason: "offline or unknown user" });
    return ok({ platform: "lichess", username, total: games.length, games });
  },
);

server.tool(
  "chesscom_games",
  toolContract("chesscom_games").description,
  {
    username: z.string(),
    year: z.number().int(),
    month: z.number().int().min(1).max(12),
    opening_eco: z.string().optional(),
    include_pgn: z.boolean().optional(),
  },
  async ({ username, year, month, opening_eco, include_pgn }) => {
    const games = await chesscomGames(username, year, month, opening_eco, include_pgn ?? false);
    if (games === null) return ok({ error: "fetch_failed", reason: "offline or unknown user" });
    return ok({ platform: "chesscom", username, year, month, total: games.length, games });
  },
);

// --- repertoire vs played games (network + handle) ---
server.tool(
  "repertoire_vs_history",
  toolContract("repertoire_vs_history").description,
  {
    repertoire_id: z.string(),
    username: z.string(),
    platform: z.enum(["lichess", "chesscom"]).optional(),
    max_games: z.number().int().min(1).max(100).optional(),
    year: z.number().int().optional(),
    month: z.number().int().min(1).max(12).optional(),
  },
  async ({ repertoire_id, username, platform, max_games, year, month }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    const plat = platform ?? toolDefault("repertoire_vs_history", "platform", "lichess");
    let games;
    if (plat === "chesscom") {
      if (year == null || month == null) return ok({ error: "missing_arg", reason: "chesscom requires year and month" });
      games = await chesscomGames(username, year, month, undefined, true);
    } else {
      games = await lichessGames(username, max_games ?? toolDefault("repertoire_vs_history", "max_games", 30), undefined, true);
    }
    if (games === null) return ok({ error: "fetch_failed", reason: "offline or unknown user" });

    return ok(repertoireHistoryResult(e.tree, e.color, games));
  },
);

// --- match prep vs a specific opponent (network + handle) ---
server.tool(
  "prep_vs_opponent",
  toolContract("prep_vs_opponent").description,
  {
    repertoire_id: z.string(),
    username: z.string(),
    platform: z.enum(["lichess", "chesscom"]).optional(),
    max_games: z.number().int().min(1).max(100).optional(),
    year: z.number().int().optional(),
    month: z.number().int().min(1).max(12).optional(),
  },
  async ({ repertoire_id, username, platform, max_games, year, month }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    const plat = platform ?? toolDefault("prep_vs_opponent", "platform", "lichess");
    let games;
    if (plat === "chesscom") {
      if (year == null || month == null) return ok({ error: "missing_arg", reason: "chesscom requires year and month" });
      games = await chesscomGames(username, year, month, undefined, true);
    } else {
      games = await lichessGames(username, max_games ?? toolDefault("prep_vs_opponent", "max_games", 30), undefined, true);
    }
    if (games === null) return ok({ error: "fetch_failed", reason: "offline or unknown user" });

    return ok(opponentPrepResult(e.tree, e.color, username, games, openingsTable));
  },
);

// --- structure (descriptive: named-structure classifier + themes/center) ---
server.tool(
  "get_structural_profile",
  toolContract("get_structural_profile").description,
  { repertoire_id: z.string(), variation_path: z.array(z.string()).optional() },
  ({ repertoire_id, variation_path }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    return ok(structuralProfileResult(e.tree, e.color, variation_path));
  },
);

server.tool(
  "find_structures",
  toolContract("find_structures").description,
  {
    repertoire_id: z.string(),
    structure: z.string().optional(),
    min_confidence: z.number().min(0).max(1).optional(),
    center: z.enum(["tense", "locked", "open", "semi-open"]).optional(),
    themes: z
      .array(z.enum(["fianchetto_white", "fianchetto_black", "minority_attack_white", "minority_attack_black", "flank_vs_center"]))
      .optional(),
    color_complex: z.enum(["light", "dark"]).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  ({ repertoire_id, structure, min_confidence, center, themes, color_complex, limit }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    if (!structure && !center && !themes?.length && !color_complex)
      return ok({ error: "missing_criteria", reason: "provide at least one of structure/center/themes/color_complex" });
    if (structure && !STRUCTURE_NAMES.some((n) => n.toLowerCase() === structure.toLowerCase()))
      return ok({ error: "unknown_structure", reason: `structure must be one of: ${STRUCTURE_NAMES.join(", ")}` });
    const leaves = e.tree.leaves().map((l) => ({ path: l.path, board: l.pos.board, fen: makeFen(l.pos.toSetup()) }));
    const matches = searchStructures(leaves, e.color, {
      structure,
      minConfidence: min_confidence,
      center,
      themes,
      colorComplex: color_complex,
    });
    return ok({
      color: e.color,
      leaves_total: leaves.length,
      total_matches: matches.length,
      matches: matches.slice(0, limit ?? toolDefault("find_structures", "limit", 30)),
    });
  },
);

server.tool(
  "analyze_repertoire_congruence",
  toolContract("analyze_repertoire_congruence").description,
  {
    repertoire_id: z.string(),
    min_severity: z.enum(["low", "medium", "high"]).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    acknowledged_weaknesses: z.array(z.array(z.string())).optional(),
    exclude_paths: z.array(z.array(z.string())).optional(),
  },
  ({ repertoire_id, min_severity, limit, acknowledged_weaknesses, exclude_paths }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    return ok(
      analyzeCongruence(e.tree, e.color, openingsTable, {
        minSeverity: min_severity,
        limit,
        acknowledgedWeaknesses: acknowledged_weaknesses,
        excludePaths: exclude_paths,
      }),
    );
  },
);

// --- suggest complementary lines (engine + structure) ---
server.tool(
  "suggest_complementary_lines",
  toolContract("suggest_complementary_lines").description,
  {
    repertoire_id: z.string(),
    fen: z.string(),
    mode: z.enum(["low_memorization", "sharp"]).optional(),
    depth: z.number().int().min(1).max(30).optional(),
    limit: z.number().int().min(1).max(10).optional(),
  },
  async ({ repertoire_id, fen, mode, depth, limit }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    return ok(await suggestComplementaryLines(e.tree, e.color, fen, { mode, depth, limit }, analyseMulti));
  },
);

// --- suggest replacement line (pivot resolution + engine + structure) ---
server.tool(
  "suggest_replacement_line",
  toolContract("suggest_replacement_line").description,
  {
    repertoire_id: z.string(),
    outlier_variation_path: z.array(z.string()),
    mode: z.enum(["structural_fit", "low_memorization", "solid"]).optional(),
    depth: z.number().int().min(1).max(30).optional(),
  },
  async ({ repertoire_id, outlier_variation_path, mode, depth }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    return ok(await suggestReplacementLine(e.tree, e.color, outlier_variation_path, { mode, depth }, analyseMulti));
  },
);

await server.connect(new StdioServerTransport());
console.error("[chess-mcp] Node MCP server ready (stdio)");
