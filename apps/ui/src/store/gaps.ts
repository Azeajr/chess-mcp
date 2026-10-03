import { createSignal } from "solid-js";
import type { GameTree, Severity, Path } from "@chess-mcp/chess-tools";
import { executeBrowserCommand } from "../application/browser-commands/client";
import { defaultBrowserCommandDependencies } from "../application/browser-commands/default-context";
import { analysisDepth } from "./engine-settings";
import {
  registerOperation,
  settleOperation,
  updateOperation,
  runningOperations,
  type Operation,
} from "./operations";
import { assertTestOnly } from "./test-seam";
import { currentTree, documentId, version, color } from "./game";

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
const MIN_SEVERITY: Severity = "low";
const LIMIT = 50;

/* The panel states this bound up front, the way the audit and only-move scans state their own. */
export const GAP_SCAN_MAX_POSITIONS = MAX_POSITIONS;

/*
  What the finished scan actually covered. `MAX_POSITIONS` truncates the decision nodes and `LIMIT`
  truncates the gaps, so "No gaps found" is only ever a statement about the checked slice — on a
  real repertoire that slice is a small fraction of the tree. Keep the counts so the panel can say
  so instead of showing an unqualified tick.
*/
export interface ScanScope {
  scanned: number;
  available: number;
  found: number;
}

const [rawGaps, setGaps] = createSignal<Gap[]>([]);
const [rawCovered, setCovered] = createSignal<CoveredGap[]>([]);
const [scanSource, setScanSource] = createSignal<{
  document: string;
  color: string;
  revision: number;
} | null>(null);
let scanTree: GameTree | null = null;
const sameSource = () =>
  scanSource() === null ||
  (scanSource()?.document === documentId() && scanSource()?.color === color());
const gaps = () =>
  sameSource()
    ? rawGaps().flatMap((gap) => {
        const path = currentTree().indexPathOfSan(gap.sanPath);
        if (!path || currentTree().indexPathOfSan([...gap.sanPath, gap.uncoveredMove])) return [];
        return [{ ...gap, path }];
      })
    : [];
const covered = () =>
  sameSource() && (!scanSource() || scanSource()?.revision === version()) ? rawCovered() : [];
const [scanError, setScanError] = createSignal<string | null>(null);
const [rawScanCompleted, setScanCompleted] = createSignal(false);
const [rawScanScope, setScanScope] = createSignal<ScanScope | null>(null);
const scanCompleted = () => sameSource() && rawScanCompleted();
const scanScope = () => (sameSource() ? rawScanScope() : null);
export const gapsStale = () =>
  scanCompleted() && scanSource() !== null && scanSource()?.revision !== version();
export { gaps, covered, scanError, scanCompleted, scanScope };

export function setScanErrorForTesting(message: string) {
  assertTestOnly();
  setScanError(message);
}

export function setCoveredGapsForTesting(next: CoveredGap[]) {
  assertTestOnly();
  setCovered(next);
  setScanCompleted(true);
}

export function setScanScopeForTesting(next: ScanScope) {
  assertTestOnly();
  setScanScope(next);
  setScanCompleted(true);
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
  document: string;
  revision: number;
  color: string;
  bestEval: FillOption;
  bestFit: FillOption | null;
}
type FillState = "loading" | { error: string } | GapFill;

export function gapKey(g: Gap): string {
  return `${g.sanPath.join(" ")}|${g.uncoveredMove}`;
}

const [rawFills, setFills] = createSignal<Record<string, FillState>>({});
const fills = () =>
  Object.fromEntries(
    Object.entries(rawFills()).filter(
      ([, fill]) =>
        sameSource() &&
        (typeof fill === "string" ||
          "error" in fill ||
          (fill.document === documentId() &&
            fill.revision === version() &&
            fill.color === color())),
    ),
  );
export { fills };

let fillGen = 0;

export async function fillGap(g: Gap) {
  const key = gapKey(g);
  if (fills()[key] === "loading") return;
  const gen = fillGen;
  const source = { document: documentId(), revision: version(), color: color() };
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
    if (
      source.document !== documentId() ||
      source.revision !== version() ||
      source.color !== color()
    ) {
      setFills((p) => ({ ...p, [key]: { error: "Repertoire changed. Choose fill again." } }));
      return;
    }
    const fill = { ...source, bestEval, bestFit };
    setFills((p) => ({ ...p, [key]: fill }));
    return fill;
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

export async function scanGaps(continueScan = false) {
  // Continue the original immutable sweep even after accepting a fill. New positions require a
  // fresh scan; existing rows are re-resolved and answered replies hidden against the live tree.
  const start = continueScan && sameSource() ? (scanScope()?.scanned ?? 0) : 0;
  const previousGaps = start ? rawGaps() : [];
  const previousCovered = start ? rawCovered() : [];
  if (!start || !scanTree) {
    scanTree = currentTree().clone();
    setScanSource({ document: documentId(), color: color(), revision: version() });
  }
  const snapshot = scanTree;
  const source = { document: documentId(), revision: version(), color: color() };
  cancelScan();
  const controller = new AbortController();
  scanController = controller;

  setScanError(null);
  setGaps(previousGaps);
  setCovered(previousCovered);
  setScanCompleted(false);
  setScanScope(null);
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
        position_start: start,
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
      { ...defaultBrowserCommandDependencies, currentTree: () => snapshot },
    )) as {
      error?: string;
      positions_scanned?: number;
      positions_available?: number;
      gaps_found?: number;
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
    if (
      source.document !== documentId() ||
      source.revision !== version() ||
      source.color !== color()
    ) {
      setScanError("Repertoire changed during scan. Scan again.");
      return;
    }
    if (res.error) {
      setScanError(res.error === "engine_unavailable" ? "engine offline" : res.error);
      return;
    }
    setScanCompleted(true);
    setScanScope({
      scanned: start + (res.positions_scanned ?? 0),
      available: res.positions_available ?? 0,
      found: previousGaps.length + (res.gaps_found ?? res.gaps?.length ?? 0),
    });
    setGaps([
      ...previousGaps,
      ...(res.gaps ?? []).map((gap) => ({
        path: gap.path,
        sanPath: gap.san_path,
        uncoveredMove: gap.uncovered_move,
        evalCp: gap.eval,
        mate: gap.mate,
        severity: gap.severity,
      })),
    ]);
    setCovered([
      ...previousCovered,
      ...(res.covered_by_transposition ?? []).map((gap) => ({
        path: gap.path,
        uncoveredMove: gap.uncovered_move,
        joinsPath: gap.joins_path,
      })),
    ]);
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
