/**
 * ECO opening lookup (port of openings.py). Pure: the caller supplies the table text (the
 * server reads data/openings.tsv; chess-tools stays env-agnostic). Keyed by positionKey so the
 * table and the lookup share one identity — see scripts/build-openings.mjs.
 */
import { Chess } from "chessops/chess";
import { parseSan } from "chessops/san";
import { makeFen } from "chessops/fen";
import { parsePgn } from "chessops/pgn";
import { positionKey } from "./congruence.js";

/** Like identifyDeepest but over a SAN move list (for addressing a tree leaf by its path). */
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

export type OpeningTable = Map<string, { eco: string; name: string }>;

/** Parse the generated TSV (positionKey<TAB>eco<TAB>name) into a lookup map. */
export function parseOpeningsTsv(text: string): OpeningTable {
  const table: OpeningTable = new Map();
  for (const line of text.split("\n")) {
    if (!line) continue;
    const [key, eco, name] = line.split("\t");
    if (key && eco && name) table.set(key, { eco, name });
  }
  return table;
}

/** The named opening at exactly this position, or null. */
export function identifyAt(table: OpeningTable, fen: string): { eco: string; name: string } | null {
  return table.get(positionKey(fen)) ?? null;
}

/**
 * The deepest named opening the PGN mainline passes through (standard "walk forward, last match
 * wins"), with the ply it is reached at, or null.
 */
export function identifyDeepest(table: OpeningTable, pgn: string): { eco: string; name: string; ply: number } | null {
  const game = parsePgn(pgn)[0];
  if (!game) return null;
  const pos = Chess.default();
  let best: { eco: string; name: string; ply: number } | null = null;
  let node = game.moves;
  let ply = 0;
  while (node.children.length) {
    const child = node.children[0]!;
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
