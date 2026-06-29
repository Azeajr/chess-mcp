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

export interface MainlineMove {
  ply: number;
  color: Color;
  san: string;
  fenBefore: string;
  fenAfter: string;
}

/** The mainline moves of a PGN's first game (standard start; FEN-setup games unsupported). */
export function mainline(pgn: string): MainlineMove[] {
  const game = parsePgn(pgn)[0];
  if (!game) throw new Error("no game found in PGN");
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

export interface GameWalk {
  /** plies the game stayed in the repertoire before its first departure. */
  in_book_plies: number;
  /** where the user (repertoire side) left their own prep, if they did. */
  player_deviation: { fen: string; prescribed: string[]; played: string } | null;
  /** where the opponent played a move the prep doesn't cover, if they did. */
  uncovered_opponent: { fen: string; played: string } | null;
}

/**
 * Walk a played game's mainline against a repertoire move-map (port of walk_game_vs_repertoire).
 * Records only the FIRST departure from book. `repColor` is the side the repertoire is for.
 */
export function walkGameVsRepertoire(map: RepertoireMoveMap, repColor: Color, pgn: string): GameWalk {
  const moves = mainline(pgn);
  let inBook = 0;
  for (const m of moves) {
    const entry = map.get(positionKey(m.fenBefore));
    if (!entry) break; // position not in the prep
    if (m.color === repColor) {
      // player to move: did they follow their own prep?
      if (!entry.sans.includes(m.san))
        return { in_book_plies: inBook, player_deviation: { fen: m.fenBefore, prescribed: entry.sans, played: m.san }, uncovered_opponent: null };
    } else {
      // opponent to move: is their move covered?
      if (!entry.sans.includes(m.san))
        return { in_book_plies: inBook, player_deviation: null, uncovered_opponent: { fen: m.fenBefore, played: m.san } };
    }
    inBook++;
  }
  return { in_book_plies: inBook, player_deviation: null, uncovered_opponent: null };
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

  let worst_group = null;
  let best_group = null;
  if (decided) {
    const byWin = ([...out] as Array<{ key: string; name: string; win_rate: number }>).sort(
      (a, b) => a.win_rate - b.win_rate,
    );
    const lo = byWin[0];
    const hi = byWin[byWin.length - 1];
    if (lo) worst_group = { key: lo.key, name: lo.name, win_rate: lo.win_rate };
    if (hi) best_group = { key: hi.key, name: hi.name, win_rate: hi.win_rate };
  }
  return { total_games: records.length, groups: out, worst_group, best_group };
}
