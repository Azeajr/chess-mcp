/**
 * Board-move helpers for the training drill surface.
 *
 * These live outside `DrillBoard.tsx` because the training store owns the attempt decision — it
 * converts the squares the user moved into the SAN a drill is scored against — and a store must not
 * import a component to do it.
 */
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { makeSanAndPlay } from "chessops/san";
import { parseSquare } from "chessops/util";
import type { NormalMove } from "chessops/types";

/** The side to move at `fen`, which is also the orientation the drill is shown from. */
export function drillOrientation(fen: string): "white" | "black" {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

/**
 * The position at `fen`, or null when it is not a legal one. Deliberately not `parseFen` alone:
 * a syntactically valid FEN can still describe an impossible position.
 */
export function drillPosition(fen: string): Chess | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const position = Chess.fromSetup(setup.value);
  return position.isErr ? null : position.value;
}

/**
 * SAN for a board move at `fen`, or null when it is not legal there. A pawn reaching the last rank
 * is auto-queened, matching `GameTree.playMove`; the drill surface has no promotion picker, and a
 * drill whose expected move is an under-promotion would simply read as not recalled.
 */
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
