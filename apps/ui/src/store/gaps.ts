/**
 * On-demand repertoire gap scan — the engine pass over chess-tools decisionNodes(). For each
 * opponent-to-move decision point, search the position and flag strong opponent replies the
 * repertoire does not cover, ranked by severity (port of find_repertoire_gaps).
 *
 * Engine-heavy, so it runs only when the user clicks Scan, is cancellable, and reports progress.
 * Forward-transposition suppression (move-order noise) is a later refinement — noted, not yet done.
 */
import { createSignal } from "solid-js";
import {
  decisionNodes,
  gapSeverity,
  moveSan,
  SEVERITY_RANK,
  type Severity,
  type Path,
} from "@chess-mcp/chess-tools";
import { currentTree, color } from "./game";
import { analyseMulti } from "../engine/stockfish";

export interface Gap {
  path: Path;
  uncoveredMove: string;
  /** white-POV cp after the move (null if mate). */
  evalCp: number | null;
  mate: number | null;
  severity: Severity;
}

const MAX_POSITIONS = 12; // decision points scanned (shallowest first)
const MULTIPV = 4; // opponent candidate moves examined per position
const SCAN_DEPTH = 12; // shallower than the live bar — a full scan trades depth for time
const MIN_SEVERITY: Severity = "medium";
const LIMIT = 12;
const MATE_CP = 100000;

const [gaps, setGaps] = createSignal<Gap[]>([]);
const [scanning, setScanning] = createSignal(false);
const [progress, setProgress] = createSignal<{ done: number; total: number } | null>(null);
const [scanError, setScanError] = createSignal<string | null>(null);

export { gaps, scanning, progress, scanError };

let cancelToken = 0;

export function cancelScan() {
  cancelToken++;
  setScanning(false);
  setProgress(null);
}

export async function scanGaps() {
  const token = ++cancelToken;
  const tree = currentTree();
  const col = color();
  const nodes = decisionNodes(tree, col).slice(0, MAX_POSITIONS);

  setScanError(null);
  setGaps([]);
  setScanning(true);
  setProgress({ done: 0, total: nodes.length });

  const found: Gap[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (token !== cancelToken) return; // cancelled / superseded
    const node = nodes[i]!;
    const res = await analyseMulti(node.fen, MULTIPV, SCAN_DEPTH);
    if (token !== cancelToken) return;
    if (!res) {
      setScanError("engine offline");
      setScanning(false);
      setProgress(null);
      return;
    }

    const moverIsWhite = node.fen.split(" ")[1] === "w";
    const moverCp = (l: (typeof res)[number]) => {
      const white = l.mate !== null ? (l.mate > 0 ? MATE_CP : -MATE_CP) : (l.cp ?? 0);
      return moverIsWhite ? white : -white;
    };
    const best = res.length ? moverCp(res[0]!) : 0;

    for (const l of res) {
      const san = moveSan(node.fen, l.uci);
      if (node.covered.includes(san)) continue;
      found.push({
        path: node.path,
        uncoveredMove: san,
        evalCp: l.cp,
        mate: l.mate,
        severity: gapSeverity(best, moverCp(l)),
      });
    }
    setProgress({ done: i + 1, total: nodes.length });
  }

  const ranked = found
    .filter((g) => SEVERITY_RANK[g.severity] >= SEVERITY_RANK[MIN_SEVERITY])
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, LIMIT);

  setGaps(ranked);
  setScanning(false);
  setProgress(null);
}
