import { Chess } from "chessops/chess";
import { parseSan } from "chessops/san";
import { makeFen } from "chessops/fen";
import { parsePgn } from "chessops/pgn";
import { positionKey } from "./congruence.js";
import { assertDefined } from "./assert.js";

export function identifyDeepestFromMoves(
  table: OpeningTable,
  sans: readonly string[],
): { eco: string; name: string; ply: number } | null {
  const pos = Chess.default();
  let best: { eco: string; name: string; ply: number } | null = null;
  let ply = 0;
  for (const san of sans) {
    const move = parseSan(pos, san);
    if (!move) break;
    pos.play(move);
    ply++;
    const hit = table.get(positionKey(makeFen(pos.toSetup())));
    if (hit) best = { ...hit, ply };
  }
  return best;
}

export interface OpeningEntry {
  readonly eco: string;
  readonly name: string;
}

export type OpeningTable = Map<string, OpeningEntry>;

export function parseOpeningsTsv(text: string): OpeningTable {
  const table: OpeningTable = new Map();
  for (const line of text.split("\n")) {
    if (!line) continue;
    const [key, eco, name] = line.split("\t");
    if (key && eco && name) table.set(key, { eco, name });
  }
  return table;
}

export function identifyAt(table: OpeningTable, fen: string): { eco: string; name: string } | null {
  return table.get(positionKey(fen)) ?? null;
}

export function identifyDeepest(
  table: OpeningTable,
  pgn: string,
): { eco: string; name: string; ply: number } | null {
  const game = parsePgn(pgn)[0];
  if (!game) return null;
  const pos = Chess.default();
  let best: { eco: string; name: string; ply: number } | null = null;
  let node = game.moves;
  let ply = 0;
  while (node.children.length) {
    const child = assertDefined(node.children[0]);
    const move = parseSan(pos, child.data.san);
    if (!move) break;
    pos.play(move);
    ply++;
    const hit = table.get(positionKey(makeFen(pos.toSetup())));
    if (hit) best = { ...hit, ply };
    node = child;
  }
  return best;
}
