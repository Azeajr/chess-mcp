/**
 * Repertoire congruence + engine-weight classification for the board arrow overlay
 * (UI_DESIGN.md "Color System"). Pure functions over chessops — the TS counterpart of the
 * Python server's position keying / congruence.
 *
 * Two independent dimensions per engine move:
 *   - Fit (color family): in-book (green) / adjacent (yellow) / out (red)
 *   - Weight (arrow thickness): from YOUR side's eval — thick / medium / thin
 */
import { Chess } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { makeSan } from "chessops/san";

export type Fit = "in-book" | "adjacent" | "out";
export type Weight = "thick" | "medium" | "thin";
export type Color = "white" | "black";

/**
 * Transposition key: placement + turn + castling + en-passant (the first four FEN fields,
 * clocks dropped). Matches the Python server's board.epd()-based _position_key so two routes
 * to the same position compare equal.
 */
export function positionKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

export interface MoveFit {
  san: string;
  fit: Fit;
  /** Transposition key of the position after the move. */
  key: string;
}

/**
 * Classify an engine move (UCI) against the loaded repertoire:
 *   - in-book  — its SAN is a known continuation at this node (`childSans`)
 *   - adjacent — not a child here, but the resulting position transposes to some tree node
 *   - out      — neither
 */
export function classifyUciMove(
  fen: string,
  uci: string,
  childSans: readonly string[],
  repertoireKeys: ReadonlySet<string>,
): MoveFit {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const move = parseUci(uci);
  if (!move) throw new Error(`bad uci: ${uci}`);
  const san = makeSan(pos, move);
  pos.play(move);
  const key = positionKey(makeFen(pos.toSetup()));
  const fit: Fit = childSans.includes(san) ? "in-book" : repertoireKeys.has(key) ? "adjacent" : "out";
  return { san, fit, key };
}

/**
 * Arrow weight from the engine score, taken from YOUR side. cp/mate are white-POV (as the
 * engine layer normalises them); flip for Black. Thresholds per UI_DESIGN.md:
 * thick ≥ +0.5, thin < −0.3, medium between.
 */
export function weightFor(cp: number | null, mate: number | null, color: Color): Weight {
  const sign = color === "white" ? 1 : -1;
  if (mate !== null) return mate * sign > 0 ? "thick" : "thin";
  const c = (cp ?? 0) * sign;
  if (c >= 50) return "thick";
  if (c < -30) return "thin";
  return "medium";
}
