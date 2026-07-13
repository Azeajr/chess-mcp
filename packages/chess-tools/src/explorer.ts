/**
 * Lichess opening-explorer client (explorer.lichess.org) + the theory-depth walk built on it.
 * Two databases: `lichess` (online games, rating/speed-filtered — the practical-play default)
 * and `masters` (OTB 2200+ FIDE). Over the rate-limited, offline-safe apiclient — miss/offline
 * → null, never throws.
 *
 * AUTH: since ~2026-03 the explorer requires a login (post-DDoS; the endpoints declare
 * `security: OAuth2` in the Lichess API spec) — anonymous requests 401. The host wires a
 * personal API token (no scopes needed) via setExplorerToken(); without one every lookup
 * degrades to null, and hosts should say so rather than let it read as "offline".
 *
 * Responses are cached in-memory per process, keyed by db + transposition key + filters. No
 * persistence on purpose: the lichess db grows daily, and a stale popularity number is silently
 * wrong (unlike a stale engine eval, which is merely shallow). The per-process cache is what
 * collapses transposition re-hits and repeated tool calls, where the 1 req/s limiter hurts.
 *
 * Per-move and per-position win counts are white-POV always (the API's convention, matching
 * cloud_eval) — NOT side-to-move.
 */
import { makeFen } from "chessops/fen";
import { Chess } from "chessops/chess";
import { parseSan } from "chessops/san";
import type { Node, PgnNodeData } from "chessops/pgn";
import { fetchJson } from "./apiclient.js";
import { positionKey } from "./congruence.js";
import type { GameTree } from "./pgn.js";

export type ExplorerDb = "lichess" | "masters";

export interface ExplorerFilters {
  db?: ExplorerDb;
  /** lichess db only. Default blitz/rapid/classical — practical play, not bullet noise. */
  speeds?: string[];
  /** lichess db only: rating buckets (1000..2500). Default 1800+ — club-strength opposition. */
  ratings?: number[];
  /** How many top moves to return (0 = counts only). Default 12. */
  movesLimit?: number;
}

export interface ExplorerMove {
  san: string;
  uci: string;
  games: number;
  /** % of games at this position that played this move (0-100, 1dp). */
  played_pct: number;
  /** white-POV outcome shares (0-100, 1dp). */
  white_pct: number;
  draw_pct: number;
  black_pct: number;
  average_rating: number | null;
}

export interface ExplorerPosition {
  total_games: number;
  /** white-POV outcome shares over all games here (0-100, 1dp). */
  white_pct: number;
  draw_pct: number;
  black_pct: number;
  opening: { eco: string; name: string } | null;
  /** Most-played moves, frequency-desc (the API's order). */
  moves: ExplorerMove[];
}

/** A position lookup — the injection point tools take so tests can stub the network. */
export type ExplorerLookup = (fen: string) => Promise<ExplorerPosition | null>;

const DEFAULT_SPEEDS = ["blitz", "rapid", "classical"];
const DEFAULT_RATINGS = [1800, 2000, 2200, 2500];

interface RawMove {
  uci: string;
  san: string;
  averageRating?: number;
  white: number;
  draws: number;
  black: number;
}
interface RawExplorer {
  white: number;
  draws: number;
  black: number;
  moves: RawMove[];
  opening?: { eco: string; name: string } | null;
}

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);

let explorerToken: string | null = null;
/** Lichess personal API token (no scopes) — required by the explorer since ~2026-03. */
export function setExplorerToken(token: string | null): void {
  explorerToken = token && token.trim() ? token.trim() : null;
}
export function hasExplorerToken(): boolean {
  return explorerToken !== null;
}

const cache = new Map<string, ExplorerPosition>();

/**
 * Explorer stats at `fen`, or null on miss/offline. Successful responses (including 0-game
 * positions — valid data) are cached; failures are not, so a transient blip doesn't poison
 * the process.
 */
export async function explorerPosition(fen: string, filters: ExplorerFilters = {}): Promise<ExplorerPosition | null> {
  const db = filters.db ?? "lichess";
  const movesLimit = filters.movesLimit ?? 12;
  const speeds = (filters.speeds ?? DEFAULT_SPEEDS).join(",");
  const ratings = (filters.ratings ?? DEFAULT_RATINGS).join(",");
  const key = db === "masters" ? `masters|${movesLimit}|${positionKey(fen)}` : `lichess|${movesLimit}|${speeds}|${ratings}|${positionKey(fen)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const f = encodeURIComponent(fen);
  const url =
    db === "masters"
      ? `https://explorer.lichess.org/masters?fen=${f}&moves=${movesLimit}&topGames=0`
      : `https://explorer.lichess.org/lichess?variant=standard&fen=${f}&speeds=${speeds}&ratings=${ratings}&moves=${movesLimit}&topGames=0&recentGames=0`;
  const raw = await fetchJson<RawExplorer>(url, explorerToken ? { Authorization: `Bearer ${explorerToken}` } : undefined);
  if (!raw || !Array.isArray(raw.moves)) return null;

  const total = raw.white + raw.draws + raw.black;
  const out: ExplorerPosition = {
    total_games: total,
    white_pct: pct(raw.white, total),
    draw_pct: pct(raw.draws, total),
    black_pct: pct(raw.black, total),
    opening: raw.opening ?? null,
    moves: raw.moves.map((m) => {
      const g = m.white + m.draws + m.black;
      return {
        san: m.san,
        uci: m.uci,
        games: g,
        played_pct: pct(g, total),
        white_pct: pct(m.white, g),
        draw_pct: pct(m.draws, g),
        black_pct: pct(m.black, g),
        average_rating: m.averageRating ?? null,
      };
    }),
  };
  cache.set(key, out);
  return out;
}

// --- theory depth (where each repertoire line leaves known games) ---

export interface TheoryDepthOptions {
  /** A position with fewer explorer games than this is "out of theory". Default 100 (use ~5 for masters). */
  minGames?: number;
  /** Explorer-query budget — bounds wall-clock at 1 req/s. Default 60. */
  maxPositions?: number;
}

export interface TheoryLine {
  /** Full SAN line to the leaf. */
  san_path: string[];
  /** Ply of the first out-of-theory position (= how many plies of the line are book), or null when the whole line stays inside theory. */
  theory_exit_ply: number | null;
  /** Explorer games at the first out-of-theory position (null when the line never exits). */
  games_at_exit: number | null;
  /** Explorer games at the deepest in-theory position reached on this line. */
  games_at_last_theory: number;
}

export type TheoryDepthResult =
  | { error: "explorer_unavailable" }
  | {
      positions_queried: number;
      /** true when the query budget ran out — `lines` covers only the visited subtree. */
      truncated: boolean;
      lines_skipped: number;
      /** Per-leaf verdicts, earliest theory exit first (never-exits last). */
      lines: TheoryLine[];
      median_exit_ply: number | null;
    };

/**
 * Walk the repertoire from the root, querying the explorer at each position, and mark where each
 * line's game count collapses below `minGames` — the ply where the line leaves known theory and
 * memorization stops paying. Once a position is out of theory the walk does NOT descend (children
 * can only be rarer), and transpositions are queried once — so queries ≈ unique in-theory
 * positions, not tree size. One transient lookup failure is retried once; a second failure aborts
 * (offline aborts on the first query, so a long walk can't half-complete silently).
 */
export async function theoryDepth(tree: GameTree, opts: TheoryDepthOptions, lookup: ExplorerLookup): Promise<TheoryDepthResult> {
  const minGames = opts.minGames ?? 100;
  const maxPositions = opts.maxPositions ?? 60;

  const seen = new Map<string, ExplorerPosition | null>(); // walk-local transposition dedupe
  let queried = 0;
  let budgetOut = false;
  let offline = false;
  const query = async (fen: string): Promise<ExplorerPosition | null> => {
    const key = positionKey(fen);
    if (seen.has(key)) return seen.get(key)!;
    if (queried >= maxPositions) {
      budgetOut = true;
      return null;
    }
    queried++;
    let res = await lookup(fen);
    if (res === null) res = await lookup(fen); // one retry through the rate limiter
    if (res === null) offline = true;
    seen.set(key, res);
    return res;
  };

  // Collect every leaf line under `node` without further queries (used below an exit / the budget).
  const leavesUnder = (node: Node<PgnNodeData>, sanPath: string[], acc: string[][]) => {
    if (!node.children.length) {
      acc.push(sanPath);
      return;
    }
    for (const c of node.children) leavesUnder(c, [...sanPath, c.data.san], acc);
  };

  const lines: TheoryLine[] = [];
  let skipped = 0;

  // DFS carrying the position; `lastTheoryGames` = games at the deepest in-theory node so far.
  const walk = async (node: Node<PgnNodeData>, pos: Chess, sanPath: string[], lastTheoryGames: number): Promise<void> => {
    if (offline) return;
    const res = await query(makeFen(pos.toSetup()));
    if (offline) return;
    if (res === null) {
      // budget ran out — everything under here is unvisited
      const acc: string[][] = [];
      leavesUnder(node, sanPath, acc);
      skipped += acc.length;
      return;
    }
    if (res.total_games < minGames) {
      // theory exits here: every leaf below shares this exit ply
      const acc: string[][] = [];
      leavesUnder(node, sanPath, acc);
      for (const p of acc)
        lines.push({ san_path: p, theory_exit_ply: sanPath.length, games_at_exit: res.total_games, games_at_last_theory: lastTheoryGames });
      return;
    }
    if (!node.children.length) {
      lines.push({ san_path: sanPath, theory_exit_ply: null, games_at_exit: null, games_at_last_theory: res.total_games });
      return;
    }
    for (const child of node.children) {
      const next = pos.clone();
      const move = parseSan(next, child.data.san);
      if (!move) continue;
      next.play(move);
      await walk(child, next, [...sanPath, child.data.san], res.total_games);
    }
  };

  await walk(tree.game.moves, Chess.default(), [], 0);
  if (offline) return { error: "explorer_unavailable" };

  lines.sort((a, b) => (a.theory_exit_ply ?? Infinity) - (b.theory_exit_ply ?? Infinity));
  const exits = lines
    .map((l) => l.theory_exit_ply)
    .filter((p): p is number => p !== null)
    .sort((a, b) => a - b);
  const mid = Math.floor(exits.length / 2);
  const median = !exits.length ? null : exits.length % 2 ? exits[mid]! : Math.round((exits[mid - 1]! + exits[mid]!) / 2);
  return { positions_queried: queried, truncated: budgetOut, lines_skipped: skipped, lines, median_exit_ply: median };
}
