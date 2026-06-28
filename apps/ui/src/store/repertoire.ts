/**
 * Feature 6 backbone: deterministic, no-API repertoire reports surfaced in the side panel.
 * Tier A scans (congruence — gaps live in store/gaps.ts) and Tier B actions (extend / fix) all
 * run through llm/tools runTool against the shared chess-tools functions + local engine — the same
 * source of truth the chat uses, just driven directly here instead of by the model.
 */
import { createSignal } from "solid-js";
import type { ExtendedBridge, PruneSuggestion } from "@chess-mcp/chess-tools";
import { runTool } from "../llm/tools";
import { currentTree, color } from "./game";
import { analyseMulti } from "../engine/stockfish";

// --- Tier A: congruence (engine-free) ---

export interface CongruenceFlag {
  type: string;
  severity: "low" | "medium" | "high";
  description: string;
  paths: string[][];
  cluster?: string;
}

const [congruence, setCongruence] = createSignal<CongruenceFlag[] | null>(null);
const [congScanning, setCongScanning] = createSignal(false);
const [congError, setCongError] = createSignal<string | null>(null);
export { congruence, congScanning, congError };

export async function scanCongruence() {
  setCongError(null);
  setCongScanning(true);
  try {
    const r = (await runTool("analyze_repertoire_congruence", { min_severity: "low" })) as {
      incongruencies?: CongruenceFlag[];
      error?: string;
    };
    if (r.error) {
      setCongError(r.error);
      setCongruence(null);
    } else {
      setCongruence(r.incongruencies ?? []);
    }
  } catch (e) {
    setCongError(e instanceof Error ? e.message : String(e));
  } finally {
    setCongScanning(false);
  }
}

// --- Tier A: connect dangling stubs into prep (engine-vetted) ---
// A stopped line (frontier leaf, your turn) continued by the color's engine-best moves until it
// rejoins existing prep (GameTree.extendedBridges). This is frontier_link / stub resolution — the
// surviving, useful half of the old bridges tool. move_order_merge is dropped; coverage_confirmed
// now surfaces inside the Gaps scan as covered-by-transposition.

const MULTIPV = 3;
const SCAN_DEPTH = 12;
const CONFIRM_DEPTH = 18; // E1: deeper re-check of each line's best-eval re-route
const CP_THRESHOLD = 50; // a color move within 0.5 of best counts as "good"
const MATE_CP = 100000;
const MAX_DEPTH = 4;
const NODE_BUDGET = 40;

const [extBridges, setExtBridges] = createSignal<ExtendedBridge[] | null>(null);
const [bridgeScanning, setBridgeScanning] = createSignal(false);
const [bridgeError, setBridgeError] = createSignal<string | null>(null);
export { extBridges, bridgeScanning, bridgeError };

let bridgeToken = 0;

/** The color's engine-best moves (UCI) at a position, within CP_THRESHOLD of best. [] on error. */
async function pickColorMoves(fen: string): Promise<string[]> {
  const res = await analyseMulti(fen, MULTIPV, SCAN_DEPTH);
  if (!res || !res.length) return [];
  const moverIsWhite = fen.split(" ")[1] === "w";
  const moverCp = (l: (typeof res)[number]) => {
    const white = l.mate !== null ? (l.mate > 0 ? MATE_CP : -MATE_CP) : (l.cp ?? 0);
    return moverIsWhite ? white : -white;
  };
  const best = moverCp(res[0]!);
  return res.filter((l) => best - moverCp(l) <= CP_THRESHOLD).map((l) => l.uci);
}

export async function scanBridges() {
  const token = ++bridgeToken;
  setBridgeError(null);
  setExtBridges(null);
  setBridgeScanning(true);
  try {
    // Engine-guided: continue each frontier stub with the color's best moves until it rejoins prep.
    // Includes 1-ply links (the old engine-free pass-1 is gone; these are now engine-vetted instead).
    const ext = await currentTree().extendedBridges(color(), { maxDepth: MAX_DEPTH, nodeBudget: NODE_BUDGET }, pickColorMoves);
    if (token !== bridgeToken) return;
    setExtBridges(ext);
  } catch (e) {
    if (token !== bridgeToken) return;
    setBridgeError(e instanceof Error ? e.message : String(e));
  } finally {
    if (token === bridgeToken) setBridgeScanning(false);
  }
}

// --- Tier A: prune (shorten a line via an engine-vetted transposition) ---

const [pruneSuggestions, setPruneSuggestions] = createSignal<PruneSuggestion[] | null>(null);
const [pruneScanning, setPruneScanning] = createSignal(false);
const [pruneError, setPruneError] = createSignal<string | null>(null);
// Determinate progress for the (possibly multi-minute) scan: positions analysed / upper-bound total.
const [pruneDone, setPruneDone] = createSignal(0);
const [pruneTotal, setPruneTotal] = createSignal(0);
export { pruneSuggestions, pruneScanning, pruneError, pruneDone, pruneTotal };

let pruneToken = 0;

export async function scanPrune() {
  const token = ++pruneToken;
  setPruneError(null);
  setPruneSuggestions(null);
  setPruneDone(0);
  setPruneTotal(0);
  setPruneScanning(true);
  try {
    const res = await currentTree().pruneTranspositions(
      color(),
      { multipv: MULTIPV, cpThreshold: CP_THRESHOLD, confirmDepth: CONFIRM_DEPTH },
      (fen, mpv, d) => analyseMulti(fen, mpv, d ?? SCAN_DEPTH),
      (done, total) => {
        if (token !== pruneToken) return;
        setPruneDone(done);
        setPruneTotal(total);
      },
    );
    if (token !== pruneToken) return;
    setPruneSuggestions(res.suggestions);
    setPruneDone(pruneTotal()); // fill the bar — leaves that emit early leave the estimate short
  } catch (e) {
    if (token !== pruneToken) return;
    setPruneError(e instanceof Error ? e.message : String(e));
  } finally {
    if (token === pruneToken) setPruneScanning(false);
  }
}

// --- Tier B: extend (suggest_complementary_lines from the current position) ---

export interface ComplementaryMove {
  move: string;
  eval: number;
  resulting_structure: string;
  pv: string;
  profile_match?: number;
  sharpness?: number;
}

const [complementary, setComplementary] = createSignal<ComplementaryMove[] | null>(null);
const [compScanning, setCompScanning] = createSignal(false);
const [compError, setCompError] = createSignal<string | null>(null);
export { complementary, compScanning, compError };

export async function scanComplementary(mode: "low_memorization" | "sharp") {
  setCompError(null);
  setCompScanning(true);
  try {
    const r = (await runTool("suggest_complementary_lines", { mode })) as {
      suggestions?: ComplementaryMove[];
      error?: string;
    };
    if (r.error) {
      setCompError(r.error === "engine_unavailable" ? "engine offline" : r.error);
      setComplementary(null);
    } else {
      setComplementary(r.suggestions ?? []);
    }
  } catch (e) {
    setCompError(e instanceof Error ? e.message : String(e));
  } finally {
    setCompScanning(false);
  }
}

export function clearComplementary() {
  setComplementary(null);
  setCompError(null);
}

// --- Tier B: fix (suggest_replacement_line for a congruence flag), keyed by the flag's path ---

export interface ReplacementMove {
  pivot_move: string;
  line: string;
  eval_cp: number;
  resulting_structure: string;
  profile_match: number;
}
export interface ReplacementResult {
  outlier_move: string;
  pivot_path: string[];
  suggestions: ReplacementMove[];
}
type ReplacementState = "loading" | { error: string } | ReplacementResult;

const [replacements, setReplacements] = createSignal<Record<string, ReplacementState>>({});
export { replacements };

export async function fixFlag(outlierPath: string[]) {
  const key = outlierPath.join(",");
  setReplacements((p) => ({ ...p, [key]: "loading" }));
  try {
    const r = (await runTool("suggest_replacement_line", { outlier_variation_path: outlierPath })) as ReplacementResult & {
      error?: string;
    };
    setReplacements((p) => ({ ...p, [key]: r.error ? { error: r.error } : r }));
  } catch (e) {
    setReplacements((p) => ({ ...p, [key]: { error: e instanceof Error ? e.message : String(e) } }));
  }
}
