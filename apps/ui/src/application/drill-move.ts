import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { makeSanAndPlay } from "chessops/san";
import { parseSquare } from "chessops/util";
import type { NormalMove } from "chessops/types";

export function drillOrientation(fen: string): "white" | "black" {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

export function drillPosition(fen: string): Chess | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const position = Chess.fromSetup(setup.value);
  return position.isErr ? null : position.value;
}

export function sanForDrillMove(fen: string, orig: string, dest: string): string | null {
  const position = drillPosition(fen);
  if (!position) return null;
  const from = parseSquare(orig);
  const to = parseSquare(dest);
  if (from === undefined || to === undefined) return null;
  const move: NormalMove = { from, to };
  const piece = position.board.get(from);
  const toRank = to >> 3;
  if (piece?.role === "pawn" && (toRank === 0 || toRank === 7)) move.promotion = "queen";
  if (!position.isLegal(move)) return null;
  return makeSanAndPlay(position, move);
}
