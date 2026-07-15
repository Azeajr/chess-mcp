/**
 * Feature 6 backbone: deterministic, no-API repertoire reports surfaced in the side panel.
 * Tier A scans (congruence — gaps live in store/gaps.ts) and Tier B actions (extend / fix) all
 * run through the application browser-command client against shared chess-tools + local engine — the same
 * source of truth the chat uses, just driven directly here instead of by the model.
 */
import { createSignal } from "solid-js";
import {
  type ExtendedBridge,
  type PruneSuggestion,
  type ShortcutComparison,
  type ShortcutCoverage,
} from "@chess-mcp/chess-tools";
import { executeBrowserCommand } from "../application/browser-commands/client";

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
    const r = (await executeBrowserCommand("analyze_repertoire_congruence", { min_severity: "low" })) as {
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

const [extBridges, setExtBridges] = createSignal<ExtendedBridge[] | null>(null);
const [bridgeScanning, setBridgeScanning] = createSignal(false);
const [bridgeError, setBridgeError] = createSignal<string | null>(null);
export { extBridges, bridgeScanning, bridgeError };

export async function scanBridges() {
  setBridgeError(null);
  setExtBridges(null);
  setBridgeScanning(true);
  try {
    const result = await executeBrowserCommand("get_repertoire_coverage", { connect_stubs: true, limit: 20 }) as {
      error?: string;
      color?: "white" | "black";
      dangling_lines?: { path: string[]; connects_via?: string[]; joins_path?: string[]; joins_ply?: number }[];
    };
    if (result.error) {
      setBridgeError(result.error === "engine_unavailable" ? "engine offline" : result.error);
      return;
    }
    const resolved: ExtendedBridge[] = (result.dangling_lines ?? [])
      .filter((stub) => stub.connects_via?.length && stub.joins_path?.length)
      .map((stub) => ({ fromPath: stub.path, moves: stub.connects_via!, sideToMove: result.color ?? "white", joinsPath: stub.joins_path!, joinsPly: stub.joins_ply ?? stub.joins_path!.length }));
    setExtBridges(resolved);
  } catch (e) {
    setBridgeError(e instanceof Error ? e.message : String(e));
  } finally {
    setBridgeScanning(false);
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

let pruneController: AbortController | null = null;

/** U3: abort an in-flight shorten scan. Bumps the token so in-flight engine results are discarded
 *  (the callback + finally guard on `token === pruneToken` go stale) and clears the scanning flag. */
export function cancelPrune() {
  pruneController?.abort();
  pruneController = null;
  setPruneScanning(false);
}

export async function scanPrune() {
  cancelPrune();
  const controller = new AbortController();
  pruneController = controller;
  setPruneError(null);
  setPruneSuggestions(null);
  setPruneDone(0);
  setPruneTotal(0);
  setPruneScanning(true);
  try {
    const res = await executeBrowserCommand("find_pruning_transpositions", {
      multipv: MULTIPV,
      cp_threshold: CP_THRESHOLD,
      confirm_depth: CONFIRM_DEPTH,
      depth: SCAN_DEPTH,
      limit: 100,
    }, {
      signal: controller.signal,
      onProgress: (done, total) => {
        if (pruneController !== controller) return;
        setPruneDone(done);
        setPruneTotal(total ?? 0);
      },
    }) as { error?: string; suggestions?: PruneSuggestion[] };
    if (pruneController !== controller || controller.signal.aborted) return;
    if (res.error) throw new Error(res.error);
    setPruneSuggestions(res.suggestions ?? []);
    setPruneDone(pruneTotal()); // fill the bar — leaves that emit early leave the estimate short
  } catch (e) {
    if (pruneController !== controller || controller.signal.aborted) return;
    setPruneError(e instanceof Error ? e.message : String(e));
  } finally {
    if (pruneController === controller) {
      pruneController = null;
      setPruneScanning(false);
    }
  }
}

// --- C3/C4: inspect a chosen shortcut (quality + coverage safety), via the shared chess-tools core ---

const INSPECT_DEPTH = 12;
const INSPECT_MAX_POSITIONS = 12; // gap-scan decision nodes per side (before/after) — keep the UI snappy

const [inspectKey, setInspectKey] = createSignal<string | null>(null);
const [comparison, setComparison] = createSignal<ShortcutComparison | null>(null);
const [coverage, setCoverage] = createSignal<ShortcutCoverage | null>(null);
const [inspecting, setInspecting] = createSignal(false);
const [inspectError, setInspectError] = createSignal<string | null>(null);
export { inspectKey, comparison, coverage, inspecting, inspectError };

/** Stable identity for a suggestion row (a line can now have several re-routes). */
export function shortcutKey(p: PruneSuggestion): string {
  return `${p.linePath.join(",")}|${p.atPly}|${p.rerouteMove}`;
}

let inspectToken = 0;

export async function inspectShortcut(p: PruneSuggestion) {
  const key = shortcutKey(p);
  if (inspectKey() === key && !inspecting()) {
    // toggle the open inspection closed
    setInspectKey(null);
    setComparison(null);
    setCoverage(null);
    return;
  }
  const token = ++inspectToken;
  setInspectKey(key);
  setComparison(null);
  setCoverage(null);
  setInspectError(null);
  setInspecting(true);
  try {
    const result = await executeBrowserCommand("inspect_shortcut", {
      line_path: p.linePath,
      at_ply: p.atPly,
      joins_path: p.joinsPath,
      depth: INSPECT_DEPTH,
      max_positions: INSPECT_MAX_POSITIONS,
    }) as { quality: ShortcutComparison | { error: string }; coverage: ShortcutCoverage | { error: string } };
    const cmp = result.quality;
    const cov = result.coverage;
    if (token !== inspectToken) return;
    setComparison("error" in cmp ? null : cmp);
    setCoverage("error" in cov ? null : cov);
    const err = ("error" in cmp && cmp.error) || ("error" in cov && cov.error) || null;
    if (err) setInspectError(err === "engine_unavailable" ? "engine offline" : err);
  } catch (e) {
    if (token !== inspectToken) return;
    setInspectError(e instanceof Error ? e.message : String(e));
  } finally {
    if (token === inspectToken) setInspecting(false);
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
    const r = (await executeBrowserCommand("suggest_complementary_lines", { mode })) as {
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
    const r = (await executeBrowserCommand("suggest_replacement_line", { outlier_variation_path: outlierPath })) as ReplacementResult & {
      error?: string;
    };
    setReplacements((p) => ({ ...p, [key]: r.error ? { error: r.error } : r }));
  } catch (e) {
    setReplacements((p) => ({ ...p, [key]: { error: e instanceof Error ? e.message : String(e) } }));
  }
}
