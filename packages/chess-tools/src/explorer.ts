import { makeFen } from "chessops/fen";
import { Chess } from "chessops/chess";
import { parseSan } from "chessops/san";
import type { Node, PgnNodeData } from "chessops/pgn";
import { fetchJson } from "./apiclient.js";
import { positionKey } from "./congruence.js";
import type { GameTree } from "./pgn.js";
import { assertDefined } from "./assert.js";

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
  speeds?: readonly ExplorerSpeed[];
  ratings?: readonly ExplorerRatingBucket[];
  since?: string;
  until?: string;
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
  played_pct: number;
  white_pct: number;
  draw_pct: number;
  black_pct: number;
  average_rating: number | null;
}

export interface ExplorerPosition {
  total_games: number;
  white_pct: number;
  draw_pct: number;
  black_pct: number;
  opening: { eco: string; name: string } | null;
  moves: ExplorerMove[];
}

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
export function setExplorerToken(token: string | null): void {
  explorerToken = token?.trim() ? token.trim() : null;
}
export function hasExplorerToken(): boolean {
  return explorerToken !== null;
}

const cache = new Map<string, ExplorerPosition>();

function uniqueSorted<T>(values: readonly T[], order: (value: T) => number): T[] {
  const unique = [...new Set(values)];
  for (const value of unique) order(value);
  return unique.sort((left, right) => order(left) - order(right));
}

export function normalizeExplorerFilters(filters: ExplorerFilters = {}): NormalizedExplorerFilters {
  const db = filters.db ?? "lichess";
  const movesLimit = filters.movesLimit ?? 12;
  if (!Number.isSafeInteger(movesLimit) || movesLimit < 0 || movesLimit > 30) {
    throw new Error(`explorer_invalid_moves_limit: ${String(movesLimit)}`);
  }

  if (db === "masters" && (filters.speeds !== undefined || filters.ratings !== undefined)) {
    throw new Error(
      "explorer_unsupported_masters_population_filter: speeds and ratings apply only to the lichess database",
    );
  }

  const speeds = uniqueSorted(filters.speeds ?? DEFAULT_EXPLORER_SPEEDS, (speed) => {
    const index = SPEED_ORDER.get(speed);
    if (index === undefined) throw new Error(`explorer_invalid_speed: ${speed}`);
    return index;
  });
  if (db === "lichess" && speeds.length === 0) throw new Error("explorer_empty_speeds");

  const ratings = uniqueSorted(filters.ratings ?? DEFAULT_EXPLORER_RATINGS, (rating) => {
    if (!RATING_BUCKETS.has(rating))
      throw new Error(`explorer_invalid_rating_bucket: ${String(rating)}`);
    return rating;
  });
  if (db === "lichess" && ratings.length === 0) throw new Error("explorer_empty_ratings");

  const recencyPattern = db === "masters" ? MASTERS_YEAR : LICHESS_MONTH;
  for (const [name, value] of [
    ["since", filters.since],
    ["until", filters.until],
  ] as const) {
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

export function explorerFilterKey(filters: ExplorerFilters = {}): string {
  return normalizedExplorerFilterKey(normalizeExplorerFilters(filters));
}

export function explorerRequest(fen: string, filters: ExplorerFilters = {}): ExplorerRequest {
  const normalized = normalizeExplorerFilters(filters);
  const filterKey = normalizedExplorerFilterKey(normalized);
  const cacheKey = `${filterKey}|position=${positionKey(fen)}`;
  const f = encodeURIComponent(fen);
  const recency = [
    normalized.since === null ? "" : `&since=${encodeURIComponent(normalized.since)}`,
    normalized.until === null ? "" : `&until=${encodeURIComponent(normalized.until)}`,
  ].join("");
  const url =
    normalized.db === "masters"
      ? `https://explorer.lichess.org/masters?fen=${f}&moves=${normalized.movesLimit}&topGames=0${recency}`
      : `https://explorer.lichess.org/lichess?variant=standard&fen=${f}&speeds=${normalized.speeds.join(",")}&ratings=${normalized.ratings.join(",")}&moves=${normalized.movesLimit}&topGames=0&recentGames=0${recency}`;
  return { url, cache_key: cacheKey, filter_key: filterKey, filters: normalized };
}

export async function explorerPosition(
  fen: string,
  filters: ExplorerFilters = {},
  signal?: AbortSignal,
): Promise<ExplorerPosition | null> {
  if (signal?.aborted) return null;
  const request = explorerRequest(fen, filters);
  const hit = cache.get(request.cache_key);
  if (hit) return hit;

  const raw = await fetchJson<RawExplorer>(
    request.url,
    explorerToken ? { Authorization: `Bearer ${explorerToken}` } : undefined,
    signal,
  );
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

export interface TheoryDepthOptions {
  minGames?: number;
  maxPositions?: number;
  shouldCancel?: () => boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface TheoryLine {
  san_path: string[];
  theory_exit_ply: number | null;
  games_at_exit: number | null;
  games_at_last_theory: number;
}

export type TheoryDepthResult =
  | { error: "explorer_unavailable" }
  | {
      positions_queried: number;
      truncated: boolean;
      lines_skipped: number;
      lines: TheoryLine[];
      median_exit_ply: number | null;
      cancelled?: true;
    };

export async function theoryDepth(
  tree: GameTree,
  opts: TheoryDepthOptions,
  lookup: ExplorerLookup,
): Promise<TheoryDepthResult> {
  const minGames = opts.minGames ?? 100;
  const maxPositions = opts.maxPositions ?? 60;

  const seen = new Map<string, ExplorerPosition | null>();
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
    if (seen.has(key)) {
      const cached = seen.get(key);
      if (cached === undefined) throw new Error("theoryDepth: seen cache inconsistent");
      return cached;
    }
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
    res ??= await lookup(fen);
    if (opts.shouldCancel?.()) {
      cancelled = true;
      return null;
    }
    if (res === null) offline = true;
    seen.set(key, res);
    return res;
  };

  const leavesUnder = (node: Node<PgnNodeData>, sanPath: string[], acc: string[][]) => {
    if (!node.children.length) {
      acc.push(sanPath);
      return;
    }
    for (const c of node.children) leavesUnder(c, [...sanPath, c.data.san], acc);
  };

  const lines: TheoryLine[] = [];
  let skipped = 0;

  const walk = async (
    node: Node<PgnNodeData>,
    pos: Chess,
    sanPath: string[],
    lastTheoryGames: number,
  ): Promise<void> => {
    if (offline || cancelled || opts.shouldCancel?.()) {
      cancelled ||= opts.shouldCancel?.() ?? false;
      return;
    }
    const res = await query(makeFen(pos.toSetup()));
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (offline) return;
    if (res === null) {
      const acc: string[][] = [];
      leavesUnder(node, sanPath, acc);
      skipped += acc.length;
      return;
    }
    if (res.total_games < minGames) {
      const acc: string[][] = [];
      leavesUnder(node, sanPath, acc);
      for (const p of acc)
        lines.push({
          san_path: p,
          theory_exit_ply: sanPath.length,
          games_at_exit: res.total_games,
          games_at_last_theory: lastTheoryGames,
        });
      return;
    }
    if (!node.children.length) {
      lines.push({
        san_path: sanPath,
        theory_exit_ply: null,
        games_at_exit: null,
        games_at_last_theory: res.total_games,
      });
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
  /* eslint-disable @typescript-eslint/no-unnecessary-condition */
  if (cancelled)
    return {
      positions_queried: queried,
      truncated: true,
      lines_skipped: skipped,
      lines,
      median_exit_ply: null,
      cancelled: true,
    };
  if (offline) return { error: "explorer_unavailable" };
  /* eslint-enable @typescript-eslint/no-unnecessary-condition */

  lines.sort((a, b) => (a.theory_exit_ply ?? Infinity) - (b.theory_exit_ply ?? Infinity));
  const exits = lines
    .map((l) => l.theory_exit_ply)
    .filter((p): p is number => p !== null)
    .sort((a, b) => a - b);
  const mid = Math.floor(exits.length / 2);
  const median = !exits.length
    ? null
    : exits.length % 2
      ? assertDefined(exits[mid])
      : Math.round((assertDefined(exits[mid - 1]) + assertDefined(exits[mid])) / 2);
  return {
    positions_queried: queried,
    truncated: budgetOut,
    lines_skipped: skipped,
    lines,
    median_exit_ply: median,
  };
}
