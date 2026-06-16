/**
 * Node MCP server (Phase 5a) — exposes chess-tools + the Node Stockfish engine over MCP. This
 * is the start of replacing the Python chess-analysis + chess-files servers with one Node process
 * (host fs directly, bundled engine, no Docker). Tool-for-tool parity with Python is incremental;
 * the heavy domain ports (structure classifier, ECO, illustrative lines, suggest, batch_review)
 * are still in the Python server, which stays until parity (see docs/design/UI_DESIGN.md).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve as pathResolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GameTree,
  validateFen,
  validatePgn,
  validateLine,
  legalMoves,
  cloudEval,
  tablebaseLookup,
  moveSan,
  decisionNodes,
  gapSeverity,
  SEVERITY_RANK,
  type Color,
  type Severity,
} from "@chess-mcp/chess-tools";
import { parsePgn, makePgn } from "chessops/pgn";
import { analyseMulti } from "./engine.js";
import { analyzeMainline, type MoveRecord } from "./gameanalysis.js";
import { moveAccuracy, parseOpeningsTsv, identifyDeepest, boardSvg, aggregateGames, lichessGames, chesscomGames, walkGameVsRepertoire, positionProfile, aggregateProfile, analyzeCongruence, type GameRecord } from "@chess-mcp/chess-tools";
import { makeFen } from "chessops/fen";
import { store, get } from "./handles.js";

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });
const notFound = () =>
  ok({ error: "repertoire_not_found", reason: "unknown or expired repertoire_id; call load_repertoire" });

// File-path tools are confined to REPERTOIRE_DIR (the chess-files proxy's base-dir guard).
const BASE = pathResolve(process.env.REPERTOIRE_DIR ?? pathResolve(process.cwd(), "repertoires"));
function confine(p: string): string | null {
  const real = pathResolve(BASE, p);
  return real === BASE || real.startsWith(BASE + "/") ? real : null;
}

const server = new McpServer({ name: "chess-analysis", version: "2.0.0" });

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
  ({ fen, moves }) => ok(validateLine(fen, moves)),
);
server.tool("get_legal_moves", "Legal moves (SAN) at a FEN.", { fen: z.string() }, ({ fen }) =>
  ok({ fen, moves: legalMoves(fen) }),
);
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

// --- engine ---
server.tool(
  "evaluate_position",
  "Local Stockfish multi-line analysis (white-POV cp/mate).",
  { fen: z.string(), depth: z.number().int().min(1).max(30).optional(), lines: z.number().int().min(1).max(5).optional() },
  async ({ fen, depth, lines }) => {
    const res = await analyseMulti(fen, lines ?? 3, depth ?? 16);
    if (!res) return ok({ error: "engine_unavailable" });
    return ok({ fen, lines: res.map((l) => ({ uci: l.uci, san: moveSan(fen, l.uci), cp: l.cp, mate: l.mate, depth: l.depth })) });
  },
);
server.tool(
  "engine_move",
  "Best move from local Stockfish.",
  { fen: z.string(), depth: z.number().int().min(1).max(30).optional() },
  async ({ fen, depth }) => {
    const res = await analyseMulti(fen, 1, depth ?? 16);
    const best = res?.[0];
    if (!best) return ok({ error: "engine_unavailable" });
    return ok({ uci: best.uci, san: moveSan(fen, best.uci), cp: best.cp, mate: best.mate, depth: best.depth });
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
    if (!real) return ok({ error: "path_not_allowed", reason: `outside ${BASE}` });
    let pgn: string;
    try {
      pgn = await readFile(real, "utf8");
    } catch (e) {
      return ok({ error: "file_not_found", reason: e instanceof Error ? e.message : String(e) });
    }
    let tree: GameTree;
    try {
      tree = GameTree.fromPgn(pgn);
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
    if (!real) return ok({ error: "path_not_allowed", reason: `outside ${BASE}` });
    const pgn = e.tree.toPgn();
    await writeFile(real, pgn, "utf8");
    return ok({ path: real, bytes: Buffer.byteLength(pgn, "utf8"), leaves: e.tree.stats().leaves });
  },
);

// --- gaps (engine scan) ---
const MATE_CP = 100000;
server.tool(
  "find_repertoire_gaps",
  "Scan decision nodes for uncovered strong opponent replies, ranked by severity.",
  {
    repertoire_id: z.string(),
    depth: z.number().int().min(1).max(30).optional(),
    min_severity: z.enum(["low", "medium", "high"]).optional(),
    max_positions: z.number().int().min(1).max(60).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  async ({ repertoire_id, depth, min_severity, max_positions, limit }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    const minSev: Severity = min_severity ?? "medium";
    const nodes = decisionNodes(e.tree, e.color).slice(0, max_positions ?? 20);
    const found: { path: number[]; fen: string; uncovered_move: string; eval: number | null; mate: number | null; severity: Severity }[] = [];
    for (const node of nodes) {
      const res = await analyseMulti(node.fen, 4, depth ?? 14);
      if (!res) return ok({ error: "engine_unavailable" });
      const moverIsWhite = node.fen.split(" ")[1] === "w";
      const moverCp = (l: (typeof res)[number]) => {
        const w = l.mate !== null ? (l.mate > 0 ? MATE_CP : -MATE_CP) : (l.cp ?? 0);
        return moverIsWhite ? w : -w;
      };
      const best = res.length ? moverCp(res[0]!) : 0;
      for (const l of res) {
        const san = moveSan(node.fen, l.uci);
        if (node.covered.includes(san)) continue;
        found.push({ path: node.path, fen: node.fen, uncovered_move: san, eval: l.cp, mate: l.mate, severity: gapSeverity(best, moverCp(l)) });
      }
    }
    const gaps = found
      .filter((g) => SEVERITY_RANK[g.severity] >= SEVERITY_RANK[minSev])
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
      .slice(0, limit ?? 10);
    return ok({ color: e.color, positions_scanned: nodes.length, total_gaps: gaps.length, gaps });
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
  "get_repertoire_coverage",
  "Tree-shape hygiene: dangling lines (your-turn leaves owed a move) vs natural frontiers.",
  { repertoire_id: z.string(), limit: z.number().int().min(1).max(100).optional() },
  ({ repertoire_id, limit }) => {
    const e = get(repertoire_id);
    if (!e) return notFound();
    const c = e.tree.coverage(e.color);
    return ok({
      color: e.color,
      leaves: c.leaves,
      dangling_count: c.danglingCount,
      dangling_lines: c.danglingLines.slice(0, limit ?? 20),
      frontier_count: c.frontierCount,
      max_depth: c.maxDepth,
      shallowest_leaf_ply: c.shallowestLeafPly,
    });
  },
);

server.tool(
  "compare_moves",
  "Rank candidate moves at a FEN by local Stockfish (mover POV). Illegal moves are flagged.",
  { fen: z.string(), moves: z.array(z.string()), depth: z.number().int().min(1).max(30).optional() },
  async ({ fen, moves, depth }) => {
    const moverIsWhite = fen.split(" ")[1] === "w";
    const out: Record<string, unknown>[] = [];
    for (const san of moves) {
      const chk = validateLine(fen, [san]);
      if (!chk.ok || !chk.finalFen) {
        out.push({ san, error: "illegal_move" });
        continue;
      }
      const res = await analyseMulti(chk.finalFen, 1, depth ?? 14);
      const line = res?.[0];
      if (!line) {
        out.push({ san: chk.canonical[0], error: "engine_unavailable" });
        continue;
      }
      const whiteCp = line.mate !== null ? (line.mate > 0 ? MATE_CP : -MATE_CP) : (line.cp ?? 0);
      out.push({ san: chk.canonical[0], uci: chk.firstUci, eval_cp: line.cp, mate: line.mate, mover_cp: moverIsWhite ? whiteCp : -whiteCp });
    }
    out.sort((a, b) => ((b.mover_cp as number) ?? -Infinity) - ((a.mover_cp as number) ?? -Infinity));
    out.forEach((o, i) => (o.rank = i + 1));
    return ok({ fen, candidates: out });
  },
);

// --- game analysis (engine) ---
const lean = (r: MoveRecord) => ({ ply: r.ply, color: r.color, san: r.san, cp_loss: r.cp_loss, classification: r.classification });

server.tool(
  "analyze_game",
  "Per-move engine review of a game's mainline: cp loss + classification (blunder/mistake/inaccuracy/good).",
  { pgn: z.string(), depth: z.number().int().min(1).max(30).optional(), verbose: z.boolean().optional() },
  async ({ pgn, depth, verbose }) => {
    let records: MoveRecord[] | null;
    try {
      records = await analyzeMainline(pgn, depth ?? 14);
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
    let records: MoveRecord[] | null;
    try {
      records = await analyzeMainline(pgn, depth ?? 14);
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
    let records: MoveRecord[] | null;
    try {
      records = await analyzeMainline(pgn, depth ?? 14);
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
    const { tree, error } = e.tree.edit(action, path, { addMoves: add_moves, promoteMove: promote_move });
    if (error || !tree) return ok({ error: error ?? "invalid_edit" });
    const id = store(tree, e.color);
    const s = tree.stats();
    const where = path.length ? path.join(" ") : "root";
    const summary =
      action === "prune"
        ? `pruned subtree at '${where}'`
        : action === "add"
          ? `added ${add_moves?.length ?? 0} ply under '${where}'`
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

// --- board image (SVG) ---
server.tool(
  "board_image",
  "Render a position as an SVG (unicode piece glyphs).",
  {
    fen: z.string(),
    orientation: z.enum(["white", "black"]).optional(),
    size: z.number().int().min(120).max(1024).optional(),
  },
  ({ fen, orientation, size }) => {
    const v = validateFen(fen);
    if (!v.valid) return ok(v);
    return ok({ format: "svg", svg: boardSvg(v.fen!, { orientation, size }) });
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
      const recs = await analyzeMainline(gamePgn, depth ?? 12);
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
  "Recent games for a Lichess user (metadata by default; include_pgn attaches PGNs). opening_eco filters by ECO prefix.",
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
  "Games for a Chess.com user in a given month (metadata by default; include_pgn attaches PGNs). opening_eco filters by ECO prefix.",
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
    const dev = new Map<string, { fen: string; prescribed: string[]; played: string; count: number }>();
    const unc = new Map<string, { fen: string; played: string; count: number }>();
    for (const g of matched) {
      const w = walkGameVsRepertoire(map, e.color, g.pgn!);
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

// --- structure (descriptive; named-structure scorers deferred) ---
server.tool(
  "get_structural_profile",
  "Static pawn-structure profile of a repertoire. variation_path (SAN list) → one position's profile (center, primitives, files, themes). Omit it → aggregate fingerprint over all leaves. structure_class is currently 'unknown' (named-structure scorers not yet ported); the themes carry the structural signal.",
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

await server.connect(new StdioServerTransport());
console.error("[chess-mcp] Node MCP server ready (stdio)");
