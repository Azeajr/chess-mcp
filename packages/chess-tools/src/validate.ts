/**
 * Validate a sequence of SAN moves from a FEN, returning canonical SANs and the first move's
 * UCI (for an arrow). Used to vet chat-proposed lines before they touch the GameTree — an
 * illegal move must never be grafted in (it would later throw on replay).
 */
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseSan, makeSan } from "chessops/san";
import { makeSquare, parseSquare } from "chessops/util";
import { chessgroundDests } from "chessops/compat";
import type { NormalMove } from "chessops/types";

export interface LineCheck {
  ok: boolean;
  /** canonical SANs up to the first illegal move (all of them when ok). */
  canonical: string[];
  /** UCI of the first move, for a board arrow. */
  firstUci?: string;
  /** index of the first illegal SAN, when !ok. */
  badIndex?: number;
}

export function validateLine(fen: string, sans: readonly string[]): LineCheck {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const canonical: string[] = [];
  let firstUci: string | undefined;
  for (let i = 0; i < sans.length; i++) {
    const move = parseSan(pos, sans[i]!);
    if (!move) return { ok: false, canonical, badIndex: i };
    if (i === 0 && "from" in move) firstUci = makeSquare(move.from) + makeSquare(move.to);
    canonical.push(makeSan(pos, move));
    pos.play(move);
  }
  return { ok: true, canonical, firstUci };
}

/** Legal moves (SAN) at a FEN — pawns to the last rank are listed as queen promotions. */
export function legalMoves(fen: string): string[] {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const out: string[] = [];
  for (const [orig, dests] of chessgroundDests(pos)) {
    const from = parseSquare(orig)!;
    for (const dest of dests) {
      const to = parseSquare(dest)!;
      const piece = pos.board.get(from);
      const toRank = to >> 3;
      const move: NormalMove =
        piece?.role === "pawn" && (toRank === 0 || toRank === 7) ? { from, to, promotion: "queen" } : { from, to };
      out.push(makeSan(pos, move));
    }
  }
  return out;
}
