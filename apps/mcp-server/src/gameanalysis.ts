/**
 * Shared "walk the mainline, eval each position" pass for analyze_game / get_game_summary /
 * export_annotated_pgn. One engine eval per position (N+1 for N moves); cp_loss per move comes
 * from consecutive white-POV evals. No eval cache yet (Phase 5d) — keep depth modest on long games.
 */
import { mainline, classifyCpLoss, moveSan, type MoveClass, type Color } from "@chess-mcp/chess-tools";
import { analyseMulti } from "./engine.js";

const MATE_CP = 100000;

export interface MoveRecord {
  ply: number;
  color: Color;
  san: string;
  cp_loss: number;
  classification: MoveClass;
  /** white-POV eval after the played move. */
  eval_cp: number;
  /** best move at the position (SAN). */
  best_move: string;
  /** white-POV eval of best play before the move. */
  best_eval: number;
}

export async function analyzeMainline(pgn: string, depth: number): Promise<MoveRecord[] | null> {
  const moves = mainline(pgn);
  if (!moves.length) return [];
  const fens = moves.map((m) => m.fenBefore);
  fens.push(moves[moves.length - 1]!.fenAfter);

  const evals: { whiteCp: number; bestUci: string }[] = [];
  for (const fen of fens) {
    const res = await analyseMulti(fen, 1, depth);
    const l = res?.[0];
    if (!l) return null; // engine unavailable
    const whiteCp = l.mate !== null ? (l.mate > 0 ? MATE_CP : -MATE_CP) : (l.cp ?? 0);
    evals.push({ whiteCp, bestUci: l.uci });
  }

  return moves.map((m, k) => {
    const before = evals[k]!;
    const after = evals[k + 1]!;
    // White wants higher, Black wants lower; cp_loss is how much the mover gave up vs best play.
    const loss = m.color === "white" ? before.whiteCp - after.whiteCp : after.whiteCp - before.whiteCp;
    const cp_loss = Math.max(0, loss);
    return {
      ply: m.ply,
      color: m.color,
      san: m.san,
      cp_loss,
      classification: classifyCpLoss(cp_loss),
      eval_cp: after.whiteCp,
      best_move: moveSan(m.fenBefore, before.bestUci),
      best_eval: before.whiteCp,
    };
  });
}
