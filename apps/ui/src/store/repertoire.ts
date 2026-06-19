/**
 * Feature 6 backbone: deterministic, no-API repertoire reports surfaced in the side panel.
 * Tier A scans (congruence — gaps live in store/gaps.ts) and Tier B actions (extend / fix) all
 * run through llm/tools runTool against the shared chess-tools functions + local engine — the same
 * source of truth the chat uses, just driven directly here instead of by the model.
 */
import { createSignal } from "solid-js";
import { runTool } from "../llm/tools";

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
