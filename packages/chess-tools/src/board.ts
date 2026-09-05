import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseSquare } from "chessops/util";

export interface SquarePiece {
  readonly role: "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";
  readonly color: "white" | "black";
}

export function pieceAt(fen: string, square: string): SquarePiece | undefined {
  const setup = parseFen(fen);
  if (setup.isErr) return undefined;
  const sq = parseSquare(square);
  if (sq === undefined) return undefined;
  const piece = setup.value.board.get(sq);
  return piece ? { role: piece.role, color: piece.color } : undefined;
}

export function isCheck(fen: string): boolean {
  const setup = parseFen(fen);
  if (setup.isErr) return false;
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return false;
  return pos.value.isCheck();
}
