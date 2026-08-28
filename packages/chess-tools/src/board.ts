/**
 * Board/piece lookup helpers built on chessops. Shared by the browser tool-call validators
 * (`validate.ts`) and the UI's keyboard board layer (WP-014), which both need to answer
 * "what's on this square" / "is this side in check" without hand-rolling FEN parsing again.
 */
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseSquare } from "chessops/util";

export interface SquarePiece {
  readonly role: "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";
  readonly color: "white" | "black";
}

/** The piece on `square` (e.g. "e4") at `fen`, or undefined when empty, invalid, or off-board. */
export function pieceAt(fen: string, square: string): SquarePiece | undefined {
  const setup = parseFen(fen);
  if (setup.isErr) return undefined;
  const sq = parseSquare(square);
  if (sq === undefined) return undefined;
  const piece = setup.value.board.get(sq);
  return piece ? { role: piece.role, color: piece.color } : undefined;
}

/** True when the side to move at `fen` is in check. False for an unparseable/illegal FEN. */
export function isCheck(fen: string): boolean {
  const setup = parseFen(fen);
  if (setup.isErr) return false;
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return false;
  return pos.value.isCheck();
}
