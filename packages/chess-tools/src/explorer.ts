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

export const EXPLORER_SPEEDS = [
  "ultraBullet",
  "bullet",
  "blitz",
  "rapid",
  "classical",
  "correspondence",
] as const;
export type ExplorerSpeed = (typeof EXPLORER_SPEEDS)[number];

export const EXPLORER_RATING_BUCKETS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500] as const;
export type ExplorerRatingBucket = (typeof EXPLORER_RATING_BUCKETS)[number];

export interface ExplorerFilters {
  db?: ExplorerDb;
  /** lichess db only. Default blitz/rapid/classical — practical play, not bullet noise. */
  speeds?: readonly ExplorerSpeed[];
  /** lichess db only: the explorer's 0..2500 rating buckets. Default 1800+ — club-strength opposition. */
  ratings?: readonly ExplorerRatingBucket[];
  /** Lichess: inclusive YYYY-MM. Masters: inclusive YYYY. */
  since?: string;
  /** Lichess: inclusive YYYY-MM. Masters: inclusive YYYY. */
  until?: string;
  /** How many top moves to return (0 = counts only). Default 12. */
  movesLimit?: number;
}

export interface NormalizedExplorerFilters {
  readonly db: ExplorerDb;
  readonly speeds: readonly ExplorerSpeed[];
  readonly ratings: readonly ExplorerRatingBucket[];
  readonly since: string | null;
  readonly until: string | null;
  readonly movesLimit: number;
}

export interface ExplorerRequest {
  readonly url: string;
  readonly cache_key: string;
  readonly filter_key: string;
  readonly filters: NormalizedExplorerFilters;
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

export const DEFAULT_EXPLORER_SPEEDS: readonly ExplorerSpeed[] = ["blitz", "rapid", "classical"];
export const DEFAULT_EXPLORER_RATINGS: readonly ExplorerRatingBucket[] = [1800, 2000, 2200, 2500];
const SPEED_ORDER = new Map(EXPLORER_SPEEDS.map((speed, index) => [speed, index]));
const RATING_BUCKETS = new Set<number>(EXPLORER_RATING_BUCKETS);
const LICHESS_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MASTERS_YEAR = /^\d{4}$/;

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

function uniqueSorted<T>(values: readonly T[], order: (value: T) => number): T[] {
  return [...new Set(values)].sort((left, right) => order(left) - order(right));
}

/** Validate and canonicalize every population filter before URL or cache-key construction. */
export function normalizeExplorerFilters(filters: ExplorerFilters = {}): NormalizedExplorerFilters {
  const db = filters.db ?? "lichess";
  const movesLimit = filters.movesLimit ?? 12;
  if (!Number.isSafeInteger(movesLimit) || movesLimit < 0 || movesLimit > 30) {
    throw new Error(`explorer_invalid_moves_limit: ${String(movesLimit)}`);
  }

  if (db === "masters" && (filters.speeds !== undefined || filters.ratings !== undefined)) {
    throw new Error("explorer_unsupported_masters_population_filter: speeds and ratings apply only to the lichess database");
  }

  const speeds = uniqueSorted(filters.speeds ?? DEFAULT_EXPLORER_SPEEDS, (speed) => {
    const index = SPEED_ORDER.get(speed);
    if (index === undefined) throw new Error(`explorer_invalid_speed: ${String(speed)}`);
    return index;
  });
  if (db === "lichess" && speeds.length === 0) throw new Error("explorer_empty_speeds");

  const ratings = uniqueSorted(filters.ratings ?? DEFAULT_EXPLORER_RATINGS, (rating) => {
    if (!RATING_BUCKETS.has(rating)) throw new Error(`explorer_invalid_rating_bucket: ${String(rating)}`);
    return rating;
  });
  if (db === "lichess" && ratings.length === 0) throw new Error("explorer_empty_ratings");

  const recencyPattern = db === "masters" ? MASTERS_YEAR : LICHESS_MONTH;
  for (const [name, value] of [["since", filters.since], ["until", filters.until]] as const) {
    if (value !== undefined && !recencyPattern.test(value)) {
      throw new Error(`explorer_invalid_${name}: ${value}`);
    }
  }
  if (filters.since !== undefined && filters.until !== undefined && filters.since > filters.until) {
    throw new Error(`explorer_invalid_recency_range: ${filters.since} is after ${filters.until}`);
  }

  return {
    db,
    speeds: db === "lichess" ? speeds : [],
    ratings: db === "lichess" ? ratings : [],
    since: filters.since ?? null,
    until: filters.until ?? null,
    movesLimit,
  };
}

function normalizedExplorerFilterKey(normalized: NormalizedExplorerFilters): string {
  return [
    `db=${normalized.db}`,
    `speeds=${normalized.speeds.join(",")}`,
    `ratings=${normalized.ratings.join(",")}`,
    `since=${normalized.since ?? ""}`,
    `until=${normalized.until ?? ""}`,
    `moves=${normalized.movesLimit}`,
  ].join("|");
}

/** Population-only identity reused by Strategic Fit provenance and report cache inputs. */
export function explorerFilterKey(filters: ExplorerFilters = {}): string {
  return normalizedExplorerFilterKey(normalizeExplorerFilters(filters));
}

/** Pure request construction keeps URL and cache identity under one tested contract. */
export function explorerRequest(fen: string, filters: ExplorerFilters = {}): ExplorerRequest {
  const normalized = normalizeExplorerFilters(filters);
  const filterKey = normalizedExplorerFilterKey(normalized);
  const cacheKey = `${filterKey}|position=${positionKey(fen)}`;
  const f = encodeURIComponent(fen);
  const recency = [
    normalized.since === null ? "" : `&since=${encodeURIComponent(normalized.since)}`,
    normalized.until === null ? "" : `&until=${encodeURIComponent(normalized.until)}`,
  ].join("");
  const url = normalized.db === "masters"
    ? `https://explorer.lichess.org/masters?fen=${f}&moves=${normalized.movesLimit}&topGames=0${recency}`
    : `https://explorer.lichess.org/lichess?variant=standard&fen=${f}&speeds=${normalized.speeds.join(",")}&ratings=${normalized.ratings.join(",")}&moves=${normalized.movesLimit}&topGames=0&recentGames=0${recency}`;
  return { url, cache_key: cacheKey, filter_key: filterKey, filters: normalized };
}

/**
 * Explorer stats at `fen`, or null on miss/offline. Successful responses (including 0-game
 * positions — valid data) are cached; failures are not, so a transient blip doesn't poison
 * the process.
 */
export async function explorerPosition(fen: string, filters: ExplorerFilters = {}, signal?: AbortSignal): Promise<ExplorerPosition | null> {
  if (signal?.aborted) return null;
  const request = explorerRequest(fen, filters);
  const hit = cache.get(request.cache_key);
  if (hit) return hit;

  const raw = await fetchJson<RawExplorer>(request.url, explorerToken ? { Authorization: `Bearer ${explorerToken}` } : undefined, signal);
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
  cache.set(request.cache_key, out);
  return out;
}

// --- theory depth (where each repertoire line leaves known games) ---

export interface TheoryDepthOptions {
  /** A position with fewer explorer games than this is "out of theory". Default 100 (use ~5 for masters). */
  minGames?: number;
  /** Explorer-query budget — bounds wall-clock at 1 req/s. Default 60. */
  maxPositions?: number;
  /** Host-provided cooperative cancellation check for long explorer walks. */
  shouldCancel?: () => boolean;
  /** Reports completed explorer queries against the configured query budget. */
  onProgress?: (done: number, total: number) => void;
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
      cancelled?: true;
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
  let cancelled = false;
  opts.onProgress?.(0, maxPositions);
  const query = async (fen: string): Promise<ExplorerPosition | null> => {
    if (opts.shouldCancel?.()) {
      cancelled = true;
      return null;
    }
    const key = positionKey(fen);
    if (seen.has(key)) return seen.get(key)!;
    if (queried >= maxPositions) {
      budgetOut = true;
      return null;
    }
    queried++;
    let res = await lookup(fen);
    opts.onProgress?.(queried, maxPositions);
    if (opts.shouldCancel?.()) {
      cancelled = true;
      return null;
    }
    if (res === null) res = await lookup(fen); // one retry through the rate limiter
    if (opts.shouldCancel?.()) {
      cancelled = true;
      return null;
    }
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
    if (offline || cancelled || opts.shouldCancel?.()) {
      cancelled ||= opts.shouldCancel?.() ?? false;
      return;
    }
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
      if (opts.shouldCancel?.()) {
        cancelled = true;
        return;
      }
      const next = pos.clone();
      const move = parseSan(next, child.data.san);
      if (!move) continue;
      next.play(move);
      await walk(child, next, [...sanPath, child.data.san], res.total_games);
    }
  };

  await walk(tree.game.moves, Chess.default(), [], 0);
  if (cancelled) return { positions_queried: queried, truncated: true, lines_skipped: skipped, lines, median_exit_ply: null, cancelled: true };
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
