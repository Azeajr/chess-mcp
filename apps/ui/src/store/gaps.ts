/**
 * On-demand repertoire gap scan — a thin wrapper over the shared chess-tools
 * `findRepertoireGaps` (R7: the scan loop used to be a hand-maintained fork for progress +
 * cancel; the shared implementation now takes onProgress/shouldCancel, so severity math and
 * covered-by-transposition semantics have a single owner). This store only adapts the result
 * to UI shapes and runs the per-gap fill suggestions.
 *
 * Engine-heavy, so it runs only when the user clicks Scan, is cancellable, and reports progress.
 */
import { createSignal } from "solid-js";
import {
  findRepertoireGaps,
  suggestGapFills,
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
export interface CoveredGap {
  path: Path;
  uncoveredMove: string;
  /** the prepared line this reply transposes into (shallowest SAN path). */
  joinsPath: string[];
}

const MAX_POSITIONS = 12; // decision points scanned (shallowest first)
const SCAN_DEPTH = 12; // shallower than the live bar — a full scan trades depth for time
const MIN_SEVERITY: Severity = "medium";
const LIMIT = 12;

const [gaps, setGaps] = createSignal<Gap[]>([]);
const [covered, setCovered] = createSignal<CoveredGap[]>([]);
const [scanning, setScanning] = createSignal(false);
const [progress, setProgress] = createSignal<{ done: number; total: number } | null>(null);
const [scanError, setScanError] = createSignal<string | null>(null);

export { gaps, covered, scanning, progress, scanError };

// --- per-gap fill suggestions (on-demand: best-eval + best-fit reply to the uncovered move) ---

/** One suggested reply + the full line it stages (SAN, from the gap node). */
export interface FillOption {
  reply: string;
  /** the complete staged SAN line from the gap node: [uncoveredMove, reply, …engine tail]. */
  line: string[];
  /** mover-POV cp after the reply (null if mate). */
  evalCp: number | null;
  /** structural fit with the repertoire (blended structure+center+themes profile, 0..1). */
  fit: number;
}
export interface GapFill {
  bestEval: FillOption;
  /** null when the best-fit reply is the same move as best-eval (deduped → single badge). */
  bestFit: FillOption | null;
}
type FillState = "loading" | { error: string } | GapFill;

/** Stable identity for a gap row (path + the specific uncovered move). */
export function gapKey(g: Gap): string {
  return `${g.path.join(",")}|${g.uncoveredMove}`;
}

const [fills, setFills] = createSignal<Record<string, FillState>>({});
export { fills };

// Generation token bumped ONLY on rescan, so a fill in flight from a previous scan is discarded.
// It is NOT bumped per click — multiple gaps fill concurrently, each updating its own row.
let fillGen = 0;

/**
 * Suggest a line that fills `g`. Anchor is the position AFTER the gap's specific uncovered move (not
 * the decision-node FEN — that would suggest a reply to the engine's best opponent move instead).
 * Returns the user's best-eval and best-fit replies, deduped.
 */
export async function fillGap(g: Gap) {
  const key = gapKey(g);
  if (fills()[key] === "loading") return;
  const gen = fillGen; // capture (do NOT bump) — only a rescan invalidates this fill
  setFills((p) => ({ ...p, [key]: "loading" }));

  try {
    const res = await suggestGapFills(currentTree(), color(), g.path, g.uncoveredMove, {}, analyseMulti);
    if (gen !== fillGen) return; // superseded by a rescan
    if ("error" in res) {
      setFills((p) => ({ ...p, [key]: { error: res.error === "engine_unavailable" ? "engine offline" : res.error } }));
      return;
    }
    const toOption = (option: (typeof res.options)[number]): FillOption => ({
      reply: option.reply, line: option.line, evalCp: option.eval_cp, fit: option.fit,
    });
    const bestEval = toOption(res.options.find((option) => option.kind === "best_eval")!);
    const fit = res.options.find((option) => option.kind === "best_fit");
    const bestFit = fit ? toOption(fit) : null;
    setFills((p) => ({ ...p, [key]: { bestEval, bestFit } }));
  } catch (e) {
    if (gen !== fillGen) return;
    setFills((p) => ({ ...p, [key]: { error: e instanceof Error ? e.message : String(e) } }));
  }
}

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

  setScanError(null);
  setGaps([]);
  setCovered([]);
  setFills({});
  fillGen++; // discard any in-flight fill from the previous scan
  setScanning(true);
  setProgress({ done: 0, total: 0 });

  const res = await findRepertoireGaps(
    tree,
    col,
    {
      depth: SCAN_DEPTH,
      minSeverity: MIN_SEVERITY,
      maxPositions: MAX_POSITIONS,
      limit: LIMIT,
      onProgress: (done, total) => {
        if (token === cancelToken) setProgress({ done, total });
      },
      shouldCancel: () => token !== cancelToken,
    },
    analyseMulti,
  );
  if (token !== cancelToken || "cancelled" in res) return; // cancelled / superseded
  if ("error" in res) {
    setScanError("engine offline");
    setScanning(false);
    setProgress(null);
    return;
  }

  setGaps(
    res.gaps.map((g) => ({ path: g.path, uncoveredMove: g.uncovered_move, evalCp: g.eval, mate: g.mate, severity: g.severity })),
  );
  setCovered(
    res.covered_by_transposition.map((c) => ({ path: c.path, uncoveredMove: c.uncovered_move, joinsPath: c.joins_path })),
  );
  setScanning(false);
  setProgress(null);
}
