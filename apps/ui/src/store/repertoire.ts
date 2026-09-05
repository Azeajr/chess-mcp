import { createSignal } from "solid-js";
import {
  type ExtendedBridge,
  type PruneSuggestion,
  type ShortcutComparison,
  type ShortcutCoverage,
} from "@chess-mcp/chess-tools";
import { executeBrowserCommand } from "../application/browser-commands/client";
import { analysisDepth } from "./engine-settings";
import { assertTestOnly } from "./test-seam";

const MULTIPV = 3;
const CP_THRESHOLD = 50;

const [extBridges, setExtBridges] = createSignal<ExtendedBridge[] | null>(null);
const [bridgeScanning, setBridgeScanning] = createSignal(false);
const [bridgeError, setBridgeError] = createSignal<string | null>(null);
export { extBridges, bridgeScanning, bridgeError };

export async function scanBridges() {
  setBridgeError(null);
  setExtBridges(null);
  setBridgeScanning(true);
  try {
    const result = (await executeBrowserCommand("get_repertoire_coverage", {
      connect_stubs: true,
      limit: 20,
      depth: analysisDepth(),
    })) as {
      error?: string;
      color?: "white" | "black";
      dangling_lines?: {
        path: string[];
        connects_via?: string[];
        joins_path?: string[];
        joins_ply?: number;
      }[];
    };
    if (result.error) {
      setBridgeError(result.error === "engine_unavailable" ? "engine offline" : result.error);
      return;
    }
    const resolved: ExtendedBridge[] = (result.dangling_lines ?? [])
      .filter((stub) => stub.connects_via?.length && stub.joins_path?.length)
      .map((stub) => ({
        fromPath: stub.path,
        moves: stub.connects_via ?? [],
        sideToMove: result.color ?? "white",
        joinsPath: stub.joins_path ?? [],
        joinsPly: stub.joins_ply ?? stub.joins_path?.length ?? 0,
      }));
    setExtBridges(resolved);
  } catch (e) {
    setBridgeError(e instanceof Error ? e.message : String(e));
  } finally {
    setBridgeScanning(false);
  }
}

const [pruneSuggestions, setPruneSuggestions] = createSignal<PruneSuggestion[] | null>(null);
const [pruneScanning, setPruneScanning] = createSignal(false);
const [pruneError, setPruneError] = createSignal<string | null>(null);
const [pruneDone, setPruneDone] = createSignal(0);
const [pruneTotal, setPruneTotal] = createSignal(0);
export { pruneSuggestions, pruneScanning, pruneError, pruneDone, pruneTotal };

export function setPruneSuggestionsForTesting(next: PruneSuggestion[]) {
  assertTestOnly();
  setPruneSuggestions(next);
}

let pruneController: AbortController | null = null;

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
    const res = (await executeBrowserCommand(
      "find_pruning_transpositions",
      {
        multipv: MULTIPV,
        cp_threshold: CP_THRESHOLD,
        confirm_depth: analysisDepth(),
        depth: analysisDepth(),
        limit: 100,
      },
      {
        signal: controller.signal,
        onProgress: (done, total) => {
          if (pruneController !== controller) return;
          setPruneDone(done);
          setPruneTotal(total ?? 0);
        },
      },
    )) as { error?: string; suggestions?: PruneSuggestion[] };
    if (pruneController !== controller || controller.signal.aborted) return;
    if (res.error) throw new Error(res.error);
    setPruneSuggestions(res.suggestions ?? []);
    setPruneDone(pruneTotal());
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

const INSPECT_MAX_POSITIONS = 12;

const [inspectKey, setInspectKey] = createSignal<string | null>(null);
const [comparison, setComparison] = createSignal<ShortcutComparison | null>(null);
const [coverage, setCoverage] = createSignal<ShortcutCoverage | null>(null);
const [inspecting, setInspecting] = createSignal(false);
const [inspectError, setInspectError] = createSignal<string | null>(null);
export { inspectKey, comparison, coverage, inspecting, inspectError };

export function setInspectResultForTesting(
  key: string,
  next: ShortcutComparison | null,
  cov: ShortcutCoverage | null,
) {
  assertTestOnly();
  setInspectKey(key);
  setComparison(next);
  setCoverage(cov);
  setInspecting(false);
  setInspectError(null);
}

export function shortcutKey(p: PruneSuggestion): string {
  return `${p.linePath.join(",")}|${p.atPly}|${p.rerouteMove}`;
}

let inspectToken = 0;

export async function inspectShortcut(p: PruneSuggestion) {
  const key = shortcutKey(p);
  if (inspectKey() === key && !inspecting()) {
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
    const result = (await executeBrowserCommand("inspect_shortcut", {
      line_path: p.linePath,
      at_ply: p.atPly,
      joins_path: p.joinsPath,
      depth: analysisDepth(),
      max_positions: INSPECT_MAX_POSITIONS,
    })) as {
      quality: ShortcutComparison | { error: string };
      coverage: ShortcutCoverage | { error: string };
    };
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

interface ComplementaryMove {
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
    const r = (await executeBrowserCommand("suggest_complementary_lines", {
      mode,
      depth: analysisDepth(),
    })) as {
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
