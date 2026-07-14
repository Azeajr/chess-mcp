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
  findRepertoireGaps,
  auditRepertoireMoves,
  findOnlyMoves,
  onlyMoveDeckCsv,
  resolveDanglingStubs,
  compareMoves,
  suggestComplementaryLines,
  suggestReplacementLine,
  moveAccuracy,
  parseOpeningsTsv,
  identifyDeepest,
  aggregateGames,
  lichessGames,
  chesscomGames,
  walkGameVsRepertoire,
  positionProfile,
  aggregateProfile,
  searchStructures,
  STRUCTURE_NAMES,
  annotateRepertoire,
  compareShortcutLines,
  checkShortcutCoverage,
  analyzeCongruence,
  type Color,
  type MoveRecord,
  type GameRecord,
} from "@chess-mcp/chess-tools";
import { parsePgn, makePgn } from "chessops/pgn";
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
server.tool("validate_fen", "Validate a FEN; returns the normalised FEN when legal.", { fen: z.string() }, ({ fen }) =>
  ok(validateFen(fen)),
);
server.tool("validate_pgn", "Validate a PGN; returns the game count.", { pgn: z.string() }, ({ pgn }) =>
  ok(validatePgn(pgn)),
);
server.tool(
  "validate_line",
  "Validate SAN moves from a FEN; returns canonical SANs or the first illegal index.",
  { fen: z.string(), moves: z.array(z.string()) },
  ({ fen, moves }) => {
    // Gate the FEN: validateLine → parseFen().unwrap() throws a raw FenError on garbage input.
    const v = validateFen(fen);
    if (!v.valid) return ok({ error: "invalid_fen", reason: v.reason });
    return ok(validateLine(v.fen!, moves));
  },
);
server.tool("get_legal_moves", "Legal moves (SAN) at a FEN.", { fen: z.string() }, ({ fen }) => {
  const v = validateFen(fen);
  if (!v.valid) return ok({ error: "invalid_fen", reason: v.reason });
  return ok({ fen: v.fen, moves: legalMoves(v.fen!) });
});
server.tool("get_position", "Normalised FEN, side to move, and legal moves.", { fen: z.string() }, ({ fen }) => {
  const v = validateFen(fen);
  if (!v.valid) return ok(v);
  return ok({ fen: v.fen, turn: v.fen!.split(" ")[1] === "w" ? "white" : "black", legal_moves: legalMoves(v.fen!) });
});

// --- network (offline-safe) ---
server.tool("cloud_eval", "Lichess cloud evaluation (white-POV) for a FEN, or unavailable.", { fen: z.string() }, async ({ fen }) => {
  const c = await cloudEval(fen);
  return ok(c ? { fen, ...c } : { fen, available: false });
});
server.tool("tablebase_lookup", "Lichess tablebase result for a ≤7-piece FEN, or null.", { fen: z.string() }, async ({ fen }) => {
  const t = await tablebaseLookup(fen);
  return ok(t ?? { available: false });
});
server.tool(
  "position_popularity",
  'Lichess opening-explorer stats at a FEN — what humans actually play here: per-move frequencies and win rates (white-POV), total games, opening name. db "lichess" (online games, 1800+ blitz/rapid/classical) or "masters" (OTB 2200+ FIDE).',
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
    return ok(res ? { fen: v.fen, db: db ?? "lichess", ...res } : { fen: v.fen, available: false });
  },
);

// --- engine ---
server.tool(
  "evaluate_position",
  "Local Stockfish multi-line analysis (white-POV cp/mate).",
  { fen: z.string(), depth: z.number().int().min(1).max(30).optional(), lines: z.number().int().min(1).max(5).optional() },
  async ({ fen, depth, lines }) => {
    // Reject an illegal-but-parseable FEN up front (the same gate get_position/suggest_* apply):
    // without it, moveSan below throws (chessops rejects the setup) instead of a closed-set error.
    const v = validateFen(fen);
    if (!v.valid) return ok({ error: "invalid_fen", reason: v.reason });
    // Hand the engine the NORMALISED FEN (v.fen), never the raw string: validateFen already rejects
    // newlines/garbage, and this keeps the only caller-FEN that reaches `position fen ...` canonical.
    const res = await analyseMulti(v.fen!, lines ?? 3, depth ?? 16);
    if (!res) return ok({ error: "engine_unavailable" });
    return ok({ fen: v.fen, lines: res.map((l) => ({ uci: l.uci, san: moveSan(v.fen!, l.uci), cp: l.cp, mate: l.mate, depth: l.depth })) });
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
  "Parse a repertoire PGN and return a handle (repertoire_id) for the other repertoire tools.",
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
  "Load a repertoire PGN by path (confined to REPERTOIRE_DIR) without the PGN entering context.",
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
server.tool("export_repertoire", "Serialize a repertoire handle back to a PGN string.", { repertoire_id: z.string() }, ({ repertoire_id }) => {
  const e = get(repertoire_id);
  if (!e) return notFound();
  const s = e.tree.stats();
  return ok({ pgn: e.tree.toPgn(), nodes: s.nodes, leaves: s.leaves, max_depth: s.maxDepth });
});
server.tool(
  "export_repertoire_to_file",
  "Write a repertoire handle's PGN to a path (confined to REPERTOIRE_DIR).",
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
  "Scan decision nodes for uncovered strong opponent replies, ranked by severity. popularity=true additionally annotates each gap with how often the move is actually played (opening explorer) and re-ranks by frequency within each severity tier.",
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
      await findRepertoireGaps(
        e.tree,
        e.color,
        {
          depth,
          minSeverity: min_severity,
          maxPositions: max_positions,
          limit,
          // movesLimit 30: a gap move outside the explorer's top list reads as ~never played, so
          // ask deep enough that the approximation only bites on true rarities.
          popularity: popularity ? (fen) => explorerPosition(fen, { db: popularity_db, movesLimit: 30 }) : undefined,
        },
        analyseMulti,
      ),
    );
  },
);

server.tool(
  "find_theory_depth",
  'Where each repertoire line leaves known theory: walks the tree querying the opening explorer and reports, per line, the ply at which game counts collapse below min_games — the point where memorization stops paying. db "lichess" (default, min_games 100) or "masters" (OTB, min_games 5). Network-bound: ~1 query/s per unique in-theory position, capped by max_positions.',
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
    const d: ExplorerDb = db ?? "lichess";
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
  "Engine-check YOUR prescribed moves tree-wide: every your-turn position is searched and each repertoire move scored vs the engine's best; findings ranked worst-first by cp_loss (classification: good/inaccuracy/mistake/blunder). best_margin (best minus second line) flags only-move positions. Answers \"which of my repertoire moves are actually bad\" — the complement of find_repertoire_gaps (which checks OPPONENT coverage).",
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
  'Tag your-turn positions where the engine best move stands alone (best minus second >= min_margin cp) — the "only move" positions where misremembering the repertoire is punished. Findings ranked by margin; lines[] ranks leaf lines by only-move density ("sharpest lines to drill"). prescribed_is_best=false flags a sharp position whose repertoire move is NOT the engine best — fix via audit_repertoire_moves before drilling. export_path (confined to REPERTOIRE_DIR) writes the FULL tagged set as a flashcard CSV (front,back,fen,margin — Anki-importable); limit only truncates the in-context findings.',
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
    if ("error" in res) return ok(res);
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
    return ok({ ...res, findings: res.findings.slice(0, limit ?? 25), ...(deck ? { deck } : {}) });
  },
);

server.tool(
  "get_transpositions",
  "Positions the repertoire reaches by more than one move order, largest groups first.",
  { repertoire_id: z.string(), limit: z.number().int().min(1).max(100).optional() },
  ({ repertoire_id, limit }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    const groups = e.tree.transpositions();
    const shown = groups.slice(0, limit ?? 20);
    return ok({ total: groups.length, returned: shown.length, transpositions: shown });
  },
);

server.tool(
  "find_pruning_transpositions",
  "Engine-backed. SHORTEN lines to cut memorization: for each leaf line, walk YOUR moves earliest-first (earliest re-route = biggest cut); among the top engine moves within a near-best window of #1 (cp_threshold — so never a blunder, even if multipv ranks one), find a move that transposes into a DIFFERENT prepared line, making the original tail redundant. Each suggestion reports savedPlies and the eval trade (evalStay vs evalTranspose, evalDelta). ALL viable re-routes per line are returned (not just the earliest) — each line's two picks are tagged bestSavings (biggest tail cut) and bestEval (best resulting eval); they may differ, so the user trades memorization vs quality. confirm_depth deep-confirms each line's bestEval pick (evalConfirmed=true) so the eval you act on is trustworthy. Engine effort per position: depth (default 14) or movetime_ms (time-based — a better dial than depth for sharp positions). COVERAGE: by default the whole tree is scanned — leave budget UNSET for full coverage (the transposable lines are often last in the PGN, and budget is spent in tree order, so a low cap silently misses them). RANKING (C6): a full (no-cursor) call returns ALL suggestions globally sorted — that is the authoritative ranking; use it. leaf_start/leaf_count are for PROGRESS ONLY: each chunk sets partial:true and its sort is chunk-local — NEVER merge/re-sort chunks yourself (the tool owns the ranking; for the final ranked set make one full call, which P1 keeps cheap). Returns total_leaves, leaves_scanned, next_leaf (cursor; null = done), positions_analysed, total_positions_estimate, estimated_positions_remaining, partial.",
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
      { multipv: multipv ?? 4, cpThreshold: cp_threshold ?? 50, maxLossCp: max_loss_cp, budget, leafStart: leaf_start, leafCount: leaf_count, confirmDepth: confirm_depth },
      // depth override d (E1 deep confirm) uses fixed depth and bypasses movetime; else the scan effort.
      (fen, mpv, d) => analyseMulti(fen, mpv, d ?? depth ?? 14, d != null ? undefined : movetime_ms),
    );
    const shown = res.suggestions.slice(0, limit ?? 20);
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
  "C4 — before applying a shorten suggestion, check the prune doesn't open a NEW gap. Prunes the line's redundant tail (line_path truncated to at_ply+1 — the same node pruneTailPath gives) on a COPY, re-runs the gap scan, and returns gaps present AFTER the prune but not before: uncovered opponent replies the pruned tail had been covering (e.g. by transposition for another line). introduces_gap=false ⇒ the shortcut is coverage-safe. Engine-backed — run it for the one suggestion you're about to apply, not every suggestion.",
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
  "C3 — for a shorten suggestion, judge the line you'd ADOPT (transpose into joins_path = Line B) vs the one you'd ABANDON (stay on line_path past at_ply = Line A), on two axes. EVAL at the fork: your-POV cp after the stay move (evalStay) vs after the re-route into the join node (evalTranspose); evalDelta = evalStay − evalTranspose (>0 ⇒ staying better, <0 ⇒ transposing better). FIT: each branch's blended structural fit — named structure + center + themes — scored against the repertoire (fitStay/fitTranspose, 0..1, higher = more on-theme); structureStay/structureTranspose are each branch's mainline-leaf structure_class (readable label); unknownShare* = how much of a branch can't be NAMED (informational — center/themes still score it, so unknown no longer forces fit to 0). RECOMMEND: eval decides unless |evalDelta| ≤ eval_tiebreak_cp (default 30), then fit breaks the tie; eval_disagrees_with_fit flags opposite pulls. This is the QUALITY axis — weigh against the suggestion's savedPlies (memorization).",
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
  "Tree-shape hygiene: dangling lines (your-turn leaves owed a move) vs natural frontiers. Pass connect_stubs=true to engine-check whether each dangling stub bridges back into existing prep — resolved stubs report connects_via (the engine-best SAN sequence) + joins_path, so you wire them with no new theory.",
  { repertoire_id: z.string(), limit: z.number().int().min(1).max(100).optional(), connect_stubs: z.boolean().optional() },
  async ({ repertoire_id, limit, connect_stubs }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    const c = e.tree.coverage(e.color);
    const base = {
      color: e.color,
      leaves: c.leaves,
      dangling_count: c.danglingCount,
      frontier_count: c.frontierCount,
      max_depth: c.maxDepth,
      shallowest_leaf_ply: c.shallowestLeafPly,
    };
    if (!connect_stubs) return ok({ ...base, dangling_lines: c.danglingLines.slice(0, limit ?? 20) });
    const r = await resolveDanglingStubs(e.tree, e.color, { limit }, analyseMulti);
    if ("error" in r) return ok({ ...base, error: r.error });
    return ok({ ...base, stubs_resolved: r.resolved, dangling_lines: r.dangling });
  },
);

server.tool(
  "compare_moves",
  "Rank candidate moves at a FEN by local Stockfish (mover POV). Illegal moves are flagged.",
  { fen: z.string(), moves: z.array(z.string()), depth: z.number().int().min(1).max(30).optional() },
  async ({ fen, moves, depth }) => {
    // Gate the FEN (compareMoves → validateLine throws a raw FenError on garbage) and cap the
    // candidate list — each candidate triggers a separate engine search, so an unbounded array is a
    // per-call DoS.
    const v = validateFen(fen);
    if (!v.valid) return ok({ error: "invalid_fen", reason: v.reason });
    if (moves.length > MAX_COMPARE_MOVES)
      return ok({ error: "too_many_moves", reason: `at most ${MAX_COMPARE_MOVES} candidate moves` });
    return ok(await compareMoves(v.fen!, moves, depth ?? 14, analyseMulti));
  },
);

// --- game analysis (engine) ---
const lean = (r: MoveRecord) => ({ ply: r.ply, color: r.color, san: r.san, cp_loss: r.cp_loss, classification: r.classification });

server.tool(
  "analyze_game",
  "Per-move engine review of a game's mainline: cp loss + classification (blunder/mistake/inaccuracy/good).",
  { pgn: z.string(), depth: z.number().int().min(1).max(30).optional(), verbose: z.boolean().optional() },
  async ({ pgn, depth, verbose }) => {
    const tl = pgnTooLarge(pgn);
    if (tl) return tl;
    let records: MoveRecord[] | null;
    try {
      records = await analyzeMainline(pgn, depth ?? 14, analyseMulti);
    } catch (e) {
      return ok({ error: "invalid_pgn", reason: e instanceof Error ? e.message : String(e) });
    }
    if (records === null) return ok({ error: "engine_unavailable" });
    return ok({ total_moves: records.length, moves: verbose ? records : records.map(lean) });
  },
);

server.tool(
  "get_game_summary",
  "Game review summary: per-side blunder/mistake/inaccuracy counts, accuracy %, and the 3 worst moves.",
  { pgn: z.string(), depth: z.number().int().min(1).max(30).optional() },
  async ({ pgn, depth }) => {
    const tl = pgnTooLarge(pgn);
    if (tl) return tl;
    let records: MoveRecord[] | null;
    try {
      records = await analyzeMainline(pgn, depth ?? 14, analyseMulti);
    } catch (e) {
      return ok({ error: "invalid_pgn", reason: e instanceof Error ? e.message : String(e) });
    }
    if (records === null) return ok({ error: "engine_unavailable" });

    const side = (color: Color) => {
      const rs = records!.filter((r) => r.color === color);
      const count = rs.length;
      const accSum = rs.reduce((a, r) => a + moveAccuracy(r.cp_loss), 0);
      return {
        blunders: rs.filter((r) => r.classification === "blunder").length,
        mistakes: rs.filter((r) => r.classification === "mistake").length,
        inaccuracies: rs.filter((r) => r.classification === "inaccuracy").length,
        good_moves: rs.filter((r) => r.classification === "good").length,
        accuracy_pct: count ? Math.round((accSum / count) * 1000) / 10 : null,
      };
    };
    const worst = [...records].sort((a, b) => b.cp_loss - a.cp_loss).slice(0, 3).map(lean);
    return ok({ total_moves: records.length, white: side("white"), black: side("black"), worst_moves: worst });
  },
);

const NAG: Record<string, number> = { blunder: 4, mistake: 2, inaccuracy: 6 };
server.tool(
  "export_annotated_pgn",
  "Annotate a game's mainline with move glyphs ($2/$4/$6) and best-move/eval comments.",
  { pgn: z.string(), depth: z.number().int().min(1).max(30).optional() },
  async ({ pgn, depth }) => {
    const tl = pgnTooLarge(pgn);
    if (tl) return tl;
    let records: MoveRecord[] | null;
    try {
      records = await analyzeMainline(pgn, depth ?? 14, analyseMulti);
    } catch (e) {
      return ok({ error: "invalid_pgn", reason: e instanceof Error ? e.message : String(e) });
    }
    if (records === null) return ok({ error: "engine_unavailable" });

    const game = parsePgn(pgn)[0];
    if (!game) return ok({ error: "invalid_pgn", reason: "no game" });
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
    return ok({ annotated_pgn: makePgn(game) });
  },
);

server.tool(
  "export_annotated_repertoire",
  "Embed repertoire analysis findings as PGN comments/NAGs at the flagged nodes — portable to any board GUI. include selects the sources: audit (engine-checks YOUR moves; NAG + cp-loss comment), only_moves (only-move drill notes), gaps (uncovered opponent replies), congruence (thematic outliers; engine-free). Default: all four. Engine-backed sources share searches via the eval cache, so a prior audit/gap scan fronts most of the work. export_path (confined to REPERTOIRE_DIR) writes the PGN to a file; otherwise it is returned inline.",
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
    if ("error" in res) return ok(res);
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
  "Edit one line (prune/add/reorder by SAN path) → a NEW repertoire_id; the source is unchanged.",
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
  "Flag illustrative side lines marked with a mistake/dubious/blunder NAG ($2/$4/$6) — they inflate leaf/gap counts. NAG tier only (engine tier deferred).",
  { repertoire_id: z.string(), limit: z.number().int().min(1).max(100).optional() },
  ({ repertoire_id, limit }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    const { lines, illustrativeLeaves } = e.tree.illustrativeLines();
    const shown = lines.slice(0, limit ?? 20);
    return ok({
      color: e.color,
      leaves_total: e.tree.stats().leaves,
      illustrative_leaves: illustrativeLeaves,
      lines: shown,
      truncated: shown.length < lines.length,
    });
  },
);

// --- ECO opening lookup ---
const openingsTable = parseOpeningsTsv(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "data", "openings.tsv"), "utf8"),
);
server.tool(
  "identify_opening",
  "Name the deepest ECO opening a game's mainline reaches (eco, name, ply), or null.",
  { pgn: z.string() },
  ({ pgn }) => {
    const hit = identifyDeepest(openingsTable, pgn);
    return ok(hit ?? { opening: null });
  },
);

// --- batch review (engine, multi-game) ---
server.tool(
  "batch_review",
  "Analyze multiple games, aggregated by opening (eco) or the user's color (needs username). With a username, only that user's games are included and results are from their POV.",
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
    const mode = group_by ?? "eco";
    if (mode === "color" && !username) return ok({ error: "missing_username", reason: "color grouping requires username" });
    let games;
    try {
      games = parsePgn(pgn);
    } catch (e) {
      return ok({ error: "invalid_pgn", reason: e instanceof Error ? e.message : String(e) });
    }
    if (!games.length) return ok({ error: "invalid_pgn", reason: "no games" });
    games = games.slice(0, max_games ?? 100);

    const records: GameRecord[] = [];
    for (const game of games) {
      let userColor: Color | null = null;
      if (username) {
        const u = username.toLowerCase();
        const white = (game.headers.get("White") ?? "").toLowerCase();
        const black = (game.headers.get("Black") ?? "").toLowerCase();
        if (white === u) userColor = "white";
        else if (black === u) userColor = "black";
        else continue; // username given but didn't play this game
      }
      const gamePgn = makePgn(game);
      const recs = await analyzeMainline(gamePgn, depth ?? 12, analyseMulti);
      if (recs === null) return ok({ error: "engine_unavailable" });

      const relevant = userColor ? recs.filter((r) => r.color === userColor) : recs;
      const avg_cpl = relevant.length ? relevant.reduce((a, r) => a + r.cp_loss, 0) / relevant.length : 0;
      const blunders = relevant
        .filter((r) => r.classification !== "good")
        .map((r) => ({ move: r.san, classification: r.classification }));

      let group_key: string;
      let group_name: string;
      if (mode === "color") {
        group_key = userColor!;
        group_name = userColor!;
      } else {
        const op = identifyDeepest(openingsTable, gamePgn);
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
    return ok(aggregateGames(records, !!username));
  },
);

// --- game history (network) ---
server.tool(
  "lichess_games",
  "Recent games for a Lichess user (metadata by default; include_pgn attaches PGNs). opening_eco filters the fetched max_games by ECO prefix (applied after the fetch — the API has no ECO filter), so fewer than max_games may return.",
  {
    username: z.string(),
    max_games: z.number().int().min(1).max(100).optional(),
    opening_eco: z.string().optional(),
    include_pgn: z.boolean().optional(),
  },
  async ({ username, max_games, opening_eco, include_pgn }) => {
    const games = await lichessGames(username, max_games ?? 20, opening_eco, include_pgn ?? false);
    if (games === null) return ok({ error: "fetch_failed", reason: "offline or unknown user" });
    return ok({ platform: "lichess", username, total: games.length, games });
  },
);

server.tool(
  "chesscom_games",
  "Games for a Chess.com user in a given month (metadata by default; include_pgn attaches PGNs). opening_eco filters the month's games by ECO prefix (applied after the fetch — the API has no ECO filter).",
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
  "Compare a repertoire against a user's real games: how often they reach prep, where they leave it (player_deviations — the drill list), and what opponents play past it (uncovered_opponent_moves). Only games on the repertoire's color count.",
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
    const plat = platform ?? "lichess";
    let games;
    if (plat === "chesscom") {
      if (year == null || month == null) return ok({ error: "missing_arg", reason: "chesscom requires year and month" });
      games = await chesscomGames(username, year, month, undefined, true);
    } else {
      games = await lichessGames(username, max_games ?? 30, undefined, true);
    }
    if (games === null) return ok({ error: "fetch_failed", reason: "offline or unknown user" });

    const matched = games.filter((g) => g.user_color === e.color && g.pgn);
    const map = e.tree.moveMap();
    let reached = 0;
    let plySum = 0;
    const dev = new Map<string, { ply: number; fen: string; prescribed: string[]; played: string; count: number }>();
    const unc = new Map<string, { ply: number; fen: string; played: string; count: number }>();
    for (const g of matched) {
      // T7: the walk reports EVERY departure (it continues past the first by transposition key),
      // so one game can contribute several drill entries.
      const w = walkGameVsRepertoire(map, e.color, g.pgn!);
      if (w.in_book_plies >= 1) reached++;
      plySum += w.in_book_plies;
      for (const d of w.player_deviations) {
        const k = `${d.fen}|${d.played}`;
        const cur = dev.get(k) ?? { ...d, count: 0 };
        cur.count++;
        dev.set(k, cur);
      }
      for (const u of w.uncovered_opponents) {
        const k = `${u.fen}|${u.played}`;
        const cur = unc.get(k) ?? { ...u, count: 0 };
        cur.count++;
        unc.set(k, cur);
      }
    }
    const byCount = <T extends { count: number }>(m: Map<string, T>) => [...m.values()].sort((a, b) => b.count - a.count);
    return ok({
      games_total: games.length,
      games_matched_color: matched.length,
      games_reached_prep: reached,
      coverage_pct: matched.length ? Math.round((reached / matched.length) * 1000) / 10 : null,
      avg_in_book_plies: matched.length ? Math.round((plySum / matched.length) * 10) / 10 : null,
      player_deviations: byCount(dev).slice(0, 20),
      uncovered_opponent_moves: byCount(unc).slice(0, 20),
    });
  },
);

// --- match prep vs a specific opponent (network + handle) ---
server.tool(
  "prep_vs_opponent",
  "Match prep against a named opponent: fetch their games on the color they'd face this repertoire from, then report how often your prep lines will actually come up (coverage + per-opening hit/score rates) and which of their habitual moves your tree doesn't cover (uncovered_opponent_moves — the gaps to plug before the game).",
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
    const oppColor = e.color === "white" ? "black" : "white";
    const plat = platform ?? "lichess";
    let games;
    if (plat === "chesscom") {
      if (year == null || month == null) return ok({ error: "missing_arg", reason: "chesscom requires year and month" });
      games = await chesscomGames(username, year, month, undefined, true);
    } else {
      games = await lichessGames(username, max_games ?? 30, undefined, true);
    }
    if (games === null) return ok({ error: "fetch_failed", reason: "offline or unknown user" });

    // games where this opponent played the side they'd face our repertoire from.
    const matched = games.filter((g) => g.user_color === oppColor && g.pgn);
    const map = e.tree.moveMap();
    let reached = 0;
    let plySum = 0;
    const unc = new Map<string, { ply: number; fen: string; played: string; count: number }>();
    const lines = new Map<
      string,
      { name: string; eco: string | null; games: number; reached: number; wins: number; draws: number; losses: number }
    >();
    for (const g of matched) {
      const w = walkGameVsRepertoire(map, e.color, g.pgn!);
      const inPrep = w.in_book_plies >= 1;
      if (inPrep) reached++;
      plySum += w.in_book_plies;
      for (const u of w.uncovered_opponents) {
        const k = `${u.fen}|${u.played}`;
        const cur = unc.get(k) ?? { ...u, count: 0 };
        cur.count++;
        unc.set(k, cur);
      }
      const hit = identifyDeepest(openingsTable, g.pgn!);
      const key = hit?.name ?? "Unclassified";
      let l = lines.get(key);
      if (!l) {
        l = { name: key, eco: hit?.eco ?? null, games: 0, reached: 0, wins: 0, draws: 0, losses: 0 };
        lines.set(key, l);
      }
      l.games++;
      if (inPrep) l.reached++;
      if (g.user_result === "win") l.wins++;
      else if (g.user_result === "draw") l.draws++;
      else if (g.user_result === "loss") l.losses++;
    }
    const byCount = <T extends { count: number }>(m: Map<string, T>) => [...m.values()].sort((a, b) => b.count - a.count);
    const lineRows = [...lines.values()]
      .map((l) => {
        const decided = l.wins + l.draws + l.losses;
        return {
          name: l.name,
          eco: l.eco,
          games: l.games,
          hit_rate: Math.round((l.reached / l.games) * 1000) / 10,
          win_rate: decided ? Math.round((l.wins / decided) * 1000) / 10 : null,
          draw_rate: decided ? Math.round((l.draws / decided) * 1000) / 10 : null,
          loss_rate: decided ? Math.round((l.losses / decided) * 1000) / 10 : null,
        };
      })
      .sort((a, b) => b.games - a.games)
      .slice(0, 15);
    return ok({
      username,
      opponent_color: oppColor,
      games_total: games.length,
      games_matched_color: matched.length,
      games_reached_prep: reached,
      coverage_pct: matched.length ? Math.round((reached / matched.length) * 1000) / 10 : null,
      avg_in_book_plies: matched.length ? Math.round((plySum / matched.length) * 10) / 10 : null,
      uncovered_opponent_moves: byCount(unc).slice(0, 20),
      lines: lineRows,
    });
  },
);

// --- structure (descriptive: named-structure classifier + themes/center) ---
server.tool(
  "get_structural_profile",
  "Static pawn-structure profile of a repertoire. variation_path (SAN list) → one position's profile: the classified named structure_class (with confidence), center, primitives, files, themes. Omit it → an aggregate structure fingerprint (distribution of named structures) over all leaves.",
  { repertoire_id: z.string(), variation_path: z.array(z.string()).optional() },
  ({ repertoire_id, variation_path }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    if (variation_path && variation_path.length) {
      const pos = e.tree.positionAtSanPath(variation_path);
      if (!pos) return ok({ error: "variation_not_found", reason: "path does not match a line in the repertoire" });
      return ok(positionProfile(pos.board, e.color, makeFen(pos.toSetup())));
    }
    return ok({ color: e.color, ...aggregateProfile(e.tree.leafPositions().map((p) => p.board), e.color) });
  },
);

server.tool(
  "find_structures",
  'Structural position SEARCH (engine-free): every repertoire line whose final position matches the query — "show every line reaching an IQP / fianchetto / locked-center position". Criteria are AND-ed; at least one is required. structure matches the named classifier (see get_structural_profile), themes are boolean theme tags, center is the pawn-center state. The query complement of get_structural_profile (which only aggregates).',
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
      matches: matches.slice(0, limit ?? 30),
    });
  },
);

server.tool(
  "analyze_repertoire_congruence",
  "Flag thematic inconsistencies across a repertoire's lines (engine-free). Clusters leaves by opening system and judges each only against its siblings: structure_outlier, weakness_inconsistency, center_inconsistency.",
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
  "Engine-validated complementary moves from an anchor FEN, ranked to fit the repertoire's structures (low_memorization) or maximise imbalance (sharp). Auto-advances one ply if the opponent is to move.",
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
  "Single-call replacement for an incongruent line. Given an outlier variation_path (from analyze_repertoire_congruence), pivots at the divergence/weakness move, then suggests sound alternatives with engine-validated continuations ranked by structural fit (or eval, mode 'solid').",
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
