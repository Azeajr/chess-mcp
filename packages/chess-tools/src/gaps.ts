import { makeFen, parseFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { Chess } from "chessops/chess";
import type { Node, PgnNodeData } from "chessops/pgn";
import type { GameTree } from "./pgn.js";
import { buildKeyIndex, type Path } from "./pgn.js";
import { positionKey, type Color } from "./congruence.js";
import { assertDefined } from "./assert.js";

export type Severity = "low" | "medium" | "high";
export const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

export interface DecisionNode {
  path: Path;
  sanPath: string[];
  fen: string;
  covered: string[];
  transpositionPaths: Path[];
}

export function turnNodes(tree: GameTree, sideToMove: Color): DecisionNode[] {
  const byKey = new Map<string, DecisionNode>();

  const consider = (node: Node<PgnNodeData>, pos: Chess, path: Path, sanPath: string[]) => {
    if (pos.turn === sideToMove && node.children.length) {
      const covered = node.children.map((c) => c.data.san);
      const fen = makeFen(pos.toSetup());
      const key = positionKey(fen);
      const existing = byKey.get(key);
      if (existing) {
        for (const s of covered) if (!existing.covered.includes(s)) existing.covered.push(s);
        existing.transpositionPaths.push(path);
        if (path.length < existing.path.length) {
          existing.path = path;
          existing.sanPath = sanPath;
        }
      } else {
        byKey.set(key, { path, sanPath, fen, covered: [...covered], transpositionPaths: [path] });
      }
    }
    node.children.forEach((child, i) => {
      const next = pos.clone();
      const move = parseSan(next, child.data.san);
      if (!move) return;
      next.play(move);
      consider(child, next, [...path, i], [...sanPath, child.data.san]);
    });
  };
  consider(tree.game.moves, Chess.default(), [], []);

  return [...byKey.values()].sort((a, b) => a.path.length - b.path.length);
}

export function decisionNodes(tree: GameTree, color: Color): DecisionNode[] {
  return turnNodes(tree, color === "white" ? "black" : "white");
}

const GAP_HIGH_CP = 30;
const GAP_MED_CP = 80;
const GAP_EDGE_LOW = 25;
const GAP_EDGE_MED = 60;

export function gapSeverity(bestMoverCp: number, moverCp: number): Severity {
  const loss = bestMoverCp - moverCp;
  let sev: Severity = loss <= GAP_HIGH_CP ? "high" : loss <= GAP_MED_CP ? "medium" : "low";
  if (moverCp < GAP_EDGE_LOW) sev = "low";
  else if (moverCp < GAP_EDGE_MED && sev === "high") sev = "medium";
  return sev;
}

export function medianLineLength(tree: GameTree): number {
  const { keyCount } = buildKeyIndex(tree.game.moves);
  const depths = tree
    .leaves()
    .filter((l) => (keyCount.get(positionKey(makeFen(l.pos.toSetup()))) ?? 0) <= 1)
    .map((l) => l.path.length)
    .sort((a, b) => a - b);
  if (!depths.length) return 0;
  const mid = Math.floor(depths.length / 2);
  return depths.length % 2
    ? assertDefined(depths[mid])
    : Math.round((assertDefined(depths[mid - 1]) + assertDefined(depths[mid])) / 2);
}

export function moveSan(fen: string, uci: string): string {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const move = parseUci(uci);
  if (!move) throw new Error(`bad uci: ${uci}`);
  return makeSan(pos, move);
}
