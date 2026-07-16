/**
 * On-demand repertoire gap scan — a thin wrapper over the shared chess-tools
 * `find_repertoire_gaps` browser application command. This store only adapts the semantic result
 * to UI view models and drives `suggest_gap_fills` for an individual row.
 *
 * Engine-heavy, so it runs only when the user clicks Scan, is cancellable, and reports progress.
 */
import { createSignal } from "solid-js";
import {
  type Severity,
  type Path,
} from "@chess-mcp/chess-tools";
import { executeBrowserCommand } from "../application/browser-commands/client";
import { analysisDepth } from "./engine-settings";

export interface Gap {
  path: Path;
  sanPath: string[];
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
    const res = await executeBrowserCommand("suggest_gap_fills", {
      variation_path: g.sanPath,
      uncovered_move: g.uncoveredMove,
      depth: analysisDepth(),
    }) as { error: string } | { options: { kind: "best_eval" | "best_fit"; reply: string; line: string[]; eval_cp: number | null; fit: number }[] };
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

let scanController: AbortController | null = null;

export function cancelScan() {
  scanController?.abort();
  scanController = null;
  setScanning(false);
  setProgress(null);
}

export async function scanGaps() {
  cancelScan();
  const controller = new AbortController();
  scanController = controller;

  setScanError(null);
  setGaps([]);
  setCovered([]);
  setFills({});
  fillGen++; // discard any in-flight fill from the previous scan
  setScanning(true);
  setProgress({ done: 0, total: 0 });

  try {
    const res = await executeBrowserCommand("find_repertoire_gaps", {
      depth: analysisDepth(),
      min_severity: MIN_SEVERITY,
      max_positions: MAX_POSITIONS,
      limit: LIMIT,
    }, {
      signal: controller.signal,
      onProgress: (done, total) => {
        if (scanController === controller) setProgress({ done, total: total ?? 0 });
      },
    }) as {
      error?: string;
      gaps?: { path: Path; san_path: string[]; uncovered_move: string; eval: number | null; mate: number | null; severity: Severity }[];
      covered_by_transposition?: { path: Path; uncovered_move: string; joins_path: string[] }[];
    };
    if (scanController !== controller || controller.signal.aborted) return;
    if (res.error) {
      setScanError(res.error === "engine_unavailable" ? "engine offline" : res.error);
      return;
    }
    setGaps((res.gaps ?? []).map((gap) => ({ path: gap.path, sanPath: gap.san_path, uncoveredMove: gap.uncovered_move, evalCp: gap.eval, mate: gap.mate, severity: gap.severity })));
    setCovered((res.covered_by_transposition ?? []).map((gap) => ({ path: gap.path, uncoveredMove: gap.uncovered_move, joinsPath: gap.joins_path })));
  } catch (error) {
    if (scanController === controller && !controller.signal.aborted) setScanError(error instanceof Error ? error.message : String(error));
  } finally {
    if (scanController === controller) {
      scanController = null;
      setScanning(false);
      setProgress(null);
    }
  }
}
