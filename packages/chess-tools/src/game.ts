/**
 * Game (single-line) walking + move classification — the engine-free half of analyze_game /
 * get_game_summary / export_annotated_pgn. The engine pass (evaluating each position) is the
 * caller's; these provide the mainline positions and the cp-loss → label/accuracy mapping
 * (exact thresholds from the Python server).
 */
import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parseSan, makeSan } from "chessops/san";
import { parsePgn } from "chessops/pgn";
import { positionKey, type Color } from "./congruence.js";
import { rejectFenSetup } from "./pgn.js";

export interface MainlineMove {
  ply: number;
  color: Color;
  san: string;
  fenBefore: string;
  fenAfter: string;
}

/** The mainline moves of a PGN's first game (standard start; FEN-setup games throw). */
export function mainline(pgn: string): MainlineMove[] {
  const game = parsePgn(pgn)[0];
  if (!game) throw new Error("no game found in PGN");
  rejectFenSetup(game);
  const pos = Chess.default();
  const out: MainlineMove[] = [];
  let node = game.moves;
  let ply = 0;
  while (node.children.length) {
    const child = node.children[0]!;
    const move = parseSan(pos, child.data.san);
    if (!move) break;
    const fenBefore = makeFen(pos.toSetup());
    const color = pos.turn;
    const san = makeSan(pos, move);
    pos.play(move);
    ply++;
    out.push({ ply, color, san, fenBefore, fenAfter: makeFen(pos.toSetup()) });
    node = child;
  }
  return out;
}

export type MoveClass = "blunder" | "mistake" | "inaccuracy" | "good";

/** Classify a move by centipawn loss (blunder >200, mistake >100, inaccuracy >50, else good). */
export function classifyCpLoss(cpLoss: number): MoveClass {
  if (cpLoss > 200) return "blunder";
  if (cpLoss > 100) return "mistake";
  if (cpLoss > 50) return "inaccuracy";
  return "good";
}

/** Per-move accuracy in [0,1] from cp loss: exp(-loss/300). Averaged → accuracy_pct. */
export function moveAccuracy(cpLoss: number): number {
  return Math.exp(-Math.max(0, cpLoss) / 300);
}

export type RepertoireMoveMap = Map<string, { sans: string[]; turn: Color }>;

export interface PlayerDeviation {
  ply: number;
  fen: string;
  prescribed: string[];
  played: string;
}
export interface UncoveredOpponent {
  ply: number;
  fen: string;
  played: string;
}
export interface GameWalk {
  /** plies the game stayed in the repertoire before its first departure. */
  in_book_plies: number;
  /** every position where the user (repertoire side) left their own prep. */
  player_deviations: PlayerDeviation[];
  /** every position where the opponent played a move the prep doesn't cover. */
  uncovered_opponents: UncoveredOpponent[];
}

/**
 * Walk a played game's mainline against a repertoire move-map (port of walk_game_vs_repertoire).
 * Records EVERY departure, not just the first (T7): after a departure the walk continues over the
 * remaining moves, checking each position against the map by transposition key — a game that
 * leaves book at ply 6 can wander back into prep and still contain an opponent novelty at ply 14
 * the prep should learn from. `in_book_plies` stays the consecutive-from-the-start count.
 * `repColor` is the side the repertoire is for.
 */
export function walkGameVsRepertoire(map: RepertoireMoveMap, repColor: Color, pgn: string): GameWalk {
  const moves = mainline(pgn);
  let inBook = 0;
  let stillInBook = true;
  const player_deviations: PlayerDeviation[] = [];
  const uncovered_opponents: UncoveredOpponent[] = [];
  for (const m of moves) {
    const entry = map.get(positionKey(m.fenBefore));
    if (!entry) {
      stillInBook = false; // position not in the prep — keep walking; a transposition may re-enter it
      continue;
    }
    const covered = entry.sans.includes(m.san);
    if (!covered) {
      if (m.color === repColor) player_deviations.push({ ply: m.ply, fen: m.fenBefore, prescribed: entry.sans, played: m.san });
      else uncovered_opponents.push({ ply: m.ply, fen: m.fenBefore, played: m.san });
      stillInBook = false;
    }
    if (stillInBook) inBook++;
  }
  return { in_book_plies: inBook, player_deviations, uncovered_opponents };
}

export interface GameRecord {
  result: "win" | "loss" | "draw" | null;
  group_key: string;
  group_name: string;
  avg_cpl: number;
  blunders: { move: string; classification: MoveClass }[];
}

/**
 * Aggregate per-game records by group (port of _aggregate_games). Computes avg CPL, top blunders
 * by frequency, and — when `decided` (a user POV exists) — win/draw/loss rates + worst/best group.
 */
export function aggregateGames(records: GameRecord[], decided: boolean) {
  if (!records.length) return { total_games: 0, groups: [], worst_group: null, best_group: null };

  interface Acc {
    key: string;
    name: string;
    games: number;
    cplSum: number;
    wins: number;
    draws: number;
    losses: number;
    bc: Map<string, number>;
  }
  const groups = new Map<string, Acc>();
  for (const r of records) {
    let g = groups.get(r.group_key);
    if (!g) {
      g = { key: r.group_key, name: r.group_name, games: 0, cplSum: 0, wins: 0, draws: 0, losses: 0, bc: new Map() };
      groups.set(r.group_key, g);
    }
    g.games++;
    g.cplSum += r.avg_cpl;
    if (decided && r.result === "win") g.wins++;
    else if (decided && r.result === "draw") g.draws++;
    else if (decided && r.result === "loss") g.losses++;
    for (const b of r.blunders) g.bc.set(b.move, (g.bc.get(b.move) ?? 0) + 1);
  }

  const out = [...groups.values()]
    .map((g) => {
      const top_blunders = [...g.bc.entries()].sort((a, b) => b[1] - a[1]).map(([move, frequency]) => ({ move, frequency }));
      const base = { key: g.key, name: g.name, games: g.games, avg_cpl: Math.round((g.cplSum / g.games) * 10) / 10, top_blunders };
      return decided ? { ...base, win_rate: g.wins / g.games, draw_rate: g.draws / g.games, loss_rate: g.losses / g.games } : base;
    })
    .sort((a, b) => b.games - a.games);

  // A 1-game group must not be crowned best/worst opening; require a minimal sample before the
  // headline pick. Per-group stats (incl. games) are still reported for every group above.
  const MIN_HEADLINE_GAMES = 3;
  let worst_group = null;
  let best_group = null;
  if (decided) {
    const byWin = ([...out] as Array<{ key: string; name: string; games: number; win_rate: number }>)
      .filter((g) => g.games >= MIN_HEADLINE_GAMES)
      .sort((a, b) => a.win_rate - b.win_rate);
    const lo = byWin[0];
    const hi = byWin[byWin.length - 1];
    if (lo) worst_group = { key: lo.key, name: lo.name, win_rate: lo.win_rate, games: lo.games };
    if (hi) best_group = { key: hi.key, name: hi.name, win_rate: hi.win_rate, games: hi.games };
  }
  return { total_games: records.length, groups: out, worst_group, best_group };
}
