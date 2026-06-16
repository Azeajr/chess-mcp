/**
 * Repertoire gap detection — the engine-free half of the Python server's find_repertoire_gaps
 * (server.py / repertoire.frontier_decision_nodes). Enumerates the decision points a
 * completeness scan cares about and ranks an uncovered opponent move by severity. The engine
 * pass (running a search at each decision node) is the caller's — see the UI's store/gaps.ts.
 */
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { GameTree, type Path } from "./pgn.js";
import { positionKey, type Color } from "./congruence.js";

export type Severity = "low" | "medium" | "high";
export const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

export interface DecisionNode {
  /** Shallowest path to this position. */
  path: Path;
  fen: string;
  /** Opponent replies already prepared here (SANs). */
  covered: string[];
  /** All paths that converge on this position (len > 1 ⇒ transposition endpoint). */
  transpositionPaths: Path[];
}

/**
 * Positions where the OPPONENT is to move and the repertoire already prepares ≥1 reply — the
 * internal decision points (not unextended frontier leaves, where every move is trivially
 * uncovered). Transposition-aware: positions reached by multiple move orders are deduplicated
 * and their covered sets merged. Shallowest first.
 */
export function decisionNodes(tree: GameTree, color: Color): DecisionNode[] {
  const opponent: Color = color === "white" ? "black" : "white";
  const byKey = new Map<string, DecisionNode>();

  const consider = (path: Path) => {
    const pos = tree.positionAt(path);
    if (pos.turn !== opponent) return;
    const covered = tree.childSansAt(path);
    if (covered.length === 0) return;
    const key = positionKey(makeFen(pos.toSetup()));
    const existing = byKey.get(key);
    if (existing) {
      for (const s of covered) if (!existing.covered.includes(s)) existing.covered.push(s);
      existing.transpositionPaths.push(path);
      if (path.length < existing.path.length) existing.path = path;
    } else {
      byKey.set(key, {
        path,
        fen: makeFen(pos.toSetup()),
        covered: [...covered],
        transpositionPaths: [path],
      });
    }
  };

  consider([]); // root: a Black repertoire must answer White's first moves
  const dfs = (node: { children: { children: unknown[] }[] }, path: Path) => {
    node.children.forEach((child, i) => {
      const p = [...path, i];
      consider(p);
      dfs(child as never, p);
    });
  };
  dfs(tree.game.moves as never, []);

  return [...byKey.values()].sort((a, b) => a.path.length - b.path.length);
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

/** SAN of a UCI move at `fen` (for comparing engine moves to the covered SAN set). */
export function moveSan(fen: string, uci: string): string {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const move = parseUci(uci);
  if (!move) throw new Error(`bad uci: ${uci}`);
  return makeSan(pos, move);
}
