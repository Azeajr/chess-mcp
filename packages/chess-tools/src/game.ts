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
import type { Color } from "./congruence.js";

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
