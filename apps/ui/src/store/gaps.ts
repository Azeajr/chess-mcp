import { createSignal } from "solid-js";
import { type Severity, type Path } from "@chess-mcp/chess-tools";
import { executeBrowserCommand } from "../application/browser-commands/client";
import { analysisDepth } from "./engine-settings";
import {
  registerOperation,
  settleOperation,
  updateOperation,
  runningOperations,
  type Operation,
} from "./operations";
import { assertTestOnly } from "./test-seam";

export interface Gap {
  path: Path;
  sanPath: string[];
  uncoveredMove: string;
  evalCp: number | null;
  mate: number | null;
  severity: Severity;
}
export interface CoveredGap {
  path: Path;
  uncoveredMove: string;
  joinsPath: string[];
}

const MAX_POSITIONS = 12;
const MIN_SEVERITY: Severity = "medium";
const LIMIT = 12;

const [gaps, setGaps] = createSignal<Gap[]>([]);
const [covered, setCovered] = createSignal<CoveredGap[]>([]);
const [scanError, setScanError] = createSignal<string | null>(null);
const [scanCompleted, setScanCompleted] = createSignal(false);
export { gaps, covered, scanError, scanCompleted };

export function setScanErrorForTesting(message: string) {
  assertTestOnly();
  setScanError(message);
}

export const scanning = () =>
  runningOperations().some((operation) => operation.kind === "gaps-scan");
export const progress = (): { done: number; total: number } | null => {
  const operation = runningOperations().find(
    (entry): entry is Operation & { done: number; total: number } =>
      entry.kind === "gaps-scan" && entry.done !== undefined && entry.total !== undefined,
  );
  return operation ? { done: operation.done, total: operation.total } : null;
};

export interface FillOption {
  reply: string;
  line: string[];
  evalCp: number | null;
  fit: number;
}
export interface GapFill {
  bestEval: FillOption;
  bestFit: FillOption | null;
}
type FillState = "loading" | { error: string } | GapFill;

export function gapKey(g: Gap): string {
  return `${g.path.join(",")}|${g.uncoveredMove}`;
}

const [fills, setFills] = createSignal<Record<string, FillState>>({});
export { fills };

let fillGen = 0;

export async function fillGap(g: Gap) {
  const key = gapKey(g);
  if (fills()[key] === "loading") return;
  const gen = fillGen;
  setFills((p) => ({ ...p, [key]: "loading" }));

  try {
    const res = (await executeBrowserCommand("suggest_gap_fills", {
      variation_path: g.sanPath,
      uncovered_move: g.uncoveredMove,
      depth: analysisDepth(),
    })) as
      | { error: string }
      | {
          options: {
            kind: "best_eval" | "best_fit";
            reply: string;
            line: string[];
            eval_cp: number | null;
            fit: number;
          }[];
        };
    if (gen !== fillGen) return;
    if ("error" in res) {
      setFills((p) => ({
        ...p,
        [key]: { error: res.error === "engine_unavailable" ? "engine offline" : res.error },
      }));
      return;
    }
    const toOption = (option: (typeof res.options)[number]): FillOption => ({
      reply: option.reply,
      line: option.line,
      evalCp: option.eval_cp,
      fit: option.fit,
    });
    const bestEvalOption = res.options.find((option) => option.kind === "best_eval");
    if (!bestEvalOption) {
      setFills((p) => ({ ...p, [key]: { error: "Best-evaluation fill option is unavailable" } }));
      return;
    }
    const bestEval = toOption(bestEvalOption);
    const fit = res.options.find((option) => option.kind === "best_fit");
    const bestFit = fit ? toOption(fit) : null;
    setFills((p) => ({ ...p, [key]: { bestEval, bestFit } }));
  } catch (e) {
    if (gen !== fillGen) return;
    setFills((p) => ({ ...p, [key]: { error: e instanceof Error ? e.message : String(e) } }));
  }
}

let scanController: AbortController | null = null;
let scanOperationId: string | null = null;

export function cancelScan() {
  scanController?.abort();
  scanController = null;
  if (scanOperationId !== null) {
    settleOperation(scanOperationId, "cancelled");
    scanOperationId = null;
  }
}

export async function scanGaps() {
  cancelScan();
  const controller = new AbortController();
  scanController = controller;

  setScanError(null);
  setGaps([]);
  setCovered([]);
  setFills({});
  fillGen++;
  const id = registerOperation({
    kind: "gaps-scan",
    label: "Gaps scan",
    surface: "repertoire",
    cancel: () => {
      cancelScan();
    },
  });
  scanOperationId = id;
  updateOperation(id, { done: 0, total: 0 });

  try {
    const res = (await executeBrowserCommand(
      "find_repertoire_gaps",
      {
        depth: analysisDepth(),
        min_severity: MIN_SEVERITY,
        max_positions: MAX_POSITIONS,
        limit: LIMIT,
      },
      {
        signal: controller.signal,
        onProgress: (done, total) => {
          if (scanController === controller && scanOperationId !== null)
            updateOperation(scanOperationId, { done, total: total ?? 0 });
        },
      },
    )) as {
      error?: string;
      gaps?: {
        path: Path;
        san_path: string[];
        uncovered_move: string;
        eval: number | null;
        mate: number | null;
        severity: Severity;
      }[];
      covered_by_transposition?: { path: Path; uncovered_move: string; joins_path: string[] }[];
    };
    if (scanController !== controller || controller.signal.aborted) return;
    if (res.error) {
      setScanError(res.error === "engine_unavailable" ? "engine offline" : res.error);
      return;
    }
    setScanCompleted(true);
    setGaps(
      (res.gaps ?? []).map((gap) => ({
        path: gap.path,
        sanPath: gap.san_path,
        uncoveredMove: gap.uncovered_move,
        evalCp: gap.eval,
        mate: gap.mate,
        severity: gap.severity,
      })),
    );
    setCovered(
      (res.covered_by_transposition ?? []).map((gap) => ({
        path: gap.path,
        uncoveredMove: gap.uncovered_move,
        joinsPath: gap.joins_path,
      })),
    );
  } catch (error) {
    if (scanController === controller && !controller.signal.aborted)
      setScanError(error instanceof Error ? error.message : String(error));
  } finally {
    if (scanController === controller) {
      scanController = null;
      const failed = scanError() !== null;
      const opId = scanOperationId;
      if (typeof opId === "string") {
        settleOperation(opId, failed ? "failed" : "completed");
        scanOperationId = null;
      }
    }
  }
}
