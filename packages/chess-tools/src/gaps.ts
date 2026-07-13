/**
 * Repertoire gap detection — the engine-free half of the Python server's find_repertoire_gaps
 * (server.py / repertoire.frontier_decision_nodes). Enumerates the decision points a
 * completeness scan cares about and ranks an uncovered opponent move by severity. The engine
 * pass (running a search at each decision node) is the caller's — see the UI's store/gaps.ts.
 */
import { makeFen, parseFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { Chess } from "chessops/chess";
import type { Node, PgnNodeData } from "chessops/pgn";
import { GameTree, buildKeyIndex, type Path } from "./pgn.js";
import { positionKey, type Color } from "./congruence.js";

export type Severity = "low" | "medium" | "high";
export const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

export interface DecisionNode {
  /** Shallowest path to this position. */
  path: Path;
  /** The same shallowest path as SAN moves from the root. */
  sanPath: string[];
  fen: string;
  /** Replies the repertoire already stores here (SANs) — the side to move's tree children. */
  covered: string[];
  /** All paths that converge on this position (len > 1 ⇒ transposition endpoint). */
  transpositionPaths: Path[];
}

/**
 * Positions where `sideToMove` is to move and the repertoire stores ≥1 continuation — the
 * internal decision points (not unextended frontier leaves). Transposition-aware: positions
 * reached by multiple move orders are deduplicated and their covered sets merged. Shallowest
 * first. `decisionNodes` (gap scan) asks for the opponent's turn; `auditRepertoireMoves`
 * (enginetools) asks for the user's.
 */
export function turnNodes(tree: GameTree, sideToMove: Color): DecisionNode[] {
  const byKey = new Map<string, DecisionNode>();

  // One DFS carrying the chess position (O(nodes)). The previous shape re-derived each node's
  // position with positionAt(path) + childSansAt(path) — both replay from the root, so the whole
  // scan was O(nodes·depth). Same pre-order visit ⇒ identical "first-seen path" / merge / sort.
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
  consider(tree.game.moves, Chess.default(), [], []); // root: a Black repertoire must answer White's first moves

  return [...byKey.values()].sort((a, b) => a.path.length - b.path.length);
}

/**
 * Positions where the OPPONENT is to move and the repertoire already prepares ≥1 reply — the
 * decision points a completeness (gap) scan cares about.
 */
export function decisionNodes(tree: GameTree, color: Color): DecisionNode[] {
  return turnNodes(tree, color === "white" ? "black" : "white");
}

// Gap severity (server.py): how close an uncovered move is to the opponent's best reply, then
// capped by the absolute edge the opponent actually gains (a near-best move that keeps them
// near-equal is low-stakes, not high). All cp are from the OPPONENT's (side-to-move) POV.
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

/**
 * Filtered median of the repertoire's leaf line-lengths (plies) — the "typical depth" a gap-fill
 * should reach. Leaves whose final position also occurs elsewhere in the tree (keyCount > 1, a
 * transposition endpoint) are excluded: those lines are short on purpose (the author stopped because
 * the rest is covered by another order), so counting them would drag the median down. Same
 * transposition-leaf skip used by extendedBridges (pgn.ts). Returns 0 for an empty tree.
 */
export function medianLineLength(tree: GameTree): number {
  const { keyCount } = buildKeyIndex(tree.game.moves);
  const depths = tree
    .leaves()
    .filter((l) => (keyCount.get(positionKey(makeFen(l.pos.toSetup()))) ?? 0) <= 1)
    .map((l) => l.path.length)
    .sort((a, b) => a - b);
  if (!depths.length) return 0;
  const mid = Math.floor(depths.length / 2);
  return depths.length % 2 ? depths[mid]! : Math.round((depths[mid - 1]! + depths[mid]!) / 2);
}

/** SAN of a UCI move at `fen` (for comparing engine moves to the covered SAN set). */
export function moveSan(fen: string, uci: string): string {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const move = parseUci(uci);
  if (!move) throw new Error(`bad uci: ${uci}`);
  return makeSan(pos, move);
}
