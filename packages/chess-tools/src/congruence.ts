import { Chess } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { makeSan } from "chessops/san";

export type Fit = "in-book" | "adjacent" | "out";
export type Weight = "thick" | "medium" | "thin";
export type Color = "white" | "black";

export function positionKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

export interface MoveFit {
  san: string;
  fit: Fit;
  key: string;
}

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
  const fit: Fit = childSans.includes(san)
    ? "in-book"
    : repertoireKeys.has(key)
      ? "adjacent"
      : "out";
  return { san, fit, key };
}

export function weightFor(cp: number | null, mate: number | null, color: Color): Weight {
  const sign = color === "white" ? 1 : -1;
  if (mate !== null) return mate * sign > 0 ? "thick" : "thin";
  const c = (cp ?? 0) * sign;
  if (c >= 50) return "thick";
  if (c < -30) return "thin";
  return "medium";
}
