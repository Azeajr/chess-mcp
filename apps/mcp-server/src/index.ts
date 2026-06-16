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
import { resolve as pathResolve } from "node:path";
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
import { analyseMulti } from "./engine.js";
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

await server.connect(new StdioServerTransport());
console.error("[chess-mcp] Node MCP server ready (stdio)");
