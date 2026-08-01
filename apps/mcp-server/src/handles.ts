/**
 * Repertoire handle cache — the Node port of the Python server's in-memory LRU+TTL. load_*
 * returns a short id; the other repertoire tools take it. The MCP contract stays a pure
 * function of (id, args): the id is an input key, not call-order state.
 */
import { randomUUID } from "node:crypto";
import {
  StrategicFitIndexCache,
  completeStrategicFitReport,
  createStrategicFitJobRecorder,
  restoreStrategicFitJobCheckpoint,
  strategicFitColdJobRecovery,
  strategicFitCompleteAnalysisOptions,
  strategicFitJobCompatibility,
  strategicFitReportCacheKey,
  type AnalyzeStrategicFitOptions,
  type Color,
  type GameTree,
  type StrategicFitAnalysisResult,
  type StrategicFitJobCheckpoint,
  type StrategicFitJobRecovery,
  type StrategicFitReport,
} from "@chess-mcp/chess-tools";

const MAX = Number(process.env.MAX_REPERTOIRES ?? 16);
const TTL_MS = Number(process.env.REPERTOIRE_TTL_S ?? 3600) * 1000;
const configuredStrategicFitReports = Number(
  process.env.MAX_STRATEGIC_FIT_REPORTS_PER_REPERTOIRE ?? 4,
);
const MAX_STRATEGIC_FIT_REPORTS =
  Number.isSafeInteger(configuredStrategicFitReports) && configuredStrategicFitReports > 0
    ? configuredStrategicFitReports
    : 4;
/** Explicit per-handle bound on indexed graph/signal/trajectory entries; the LRU never exceeds it. */
const STRATEGIC_FIT_INDEX_ENTRIES_PER_REPERTOIRE = 256;

export interface RepertoireEntry {
  tree: GameTree;
  color: Color;
  /** Immutable clone-on-write handle generation used as the Strategic Fit report revision. */
  revision: string;
  /** Normalized immutable content protects against accidental revision-label reuse. */
  contentKey: string;
  strategicFitReports: Map<string, StrategicFitReport>;
  /** Bounded incremental index shared by every analysis of this immutable handle. */
  strategicFitIndex: StrategicFitIndexCache;
  /** The one checkpoint an interrupted analysis of this handle left behind, if any. */
  strategicFitCheckpoint: StrategicFitJobCheckpoint | null;
  /** Recovery provenance for the handle's most recent analysis. */
  strategicFitRecovery: StrategicFitJobRecovery | null;
  ts: number;
}

const map = new Map<string, RepertoireEntry>();

function drop(key: string, entry: RepertoireEntry): void {
  entry.strategicFitReports.clear();
  entry.strategicFitIndex.clear();
  // An evicted handle takes its interrupted job with it: nothing may resume against a handle whose
  // content is no longer held here.
  entry.strategicFitCheckpoint = null;
  entry.strategicFitRecovery = null;
  map.delete(key);
}

function evict() {
  const now = Date.now();
  for (const [k, v] of map) if (now - v.ts > TTL_MS) drop(k, v);
  while (map.size > MAX) {
    let oldestKey: string | undefined;
    let oldestTs = Infinity;
    for (const [k, v] of map) if (v.ts < oldestTs) ((oldestTs = v.ts), (oldestKey = k));
    if (oldestKey === undefined) break;
    drop(oldestKey, map.get(oldestKey)!);
  }
}

export function store(tree: GameTree, color: Color): string {
  const id = randomUUID();
  map.set(id, {
    tree,
    color,
    revision: `mcp:${id}`,
    contentKey: tree.toPgn(),
    strategicFitReports: new Map(),
    strategicFitIndex: new StrategicFitIndexCache({
      maximumEntries: STRATEGIC_FIT_INDEX_ENTRIES_PER_REPERTOIRE,
    }),
    strategicFitCheckpoint: null,
    strategicFitRecovery: null,
    ts: Date.now(),
  });
  evict(); // after insert: evict-before-insert capped at MAX+1 (size checked pre-add); the new
  // entry has the newest ts, so the LRU sweep never evicts what we just stored.
  return id;
}

export function get(id: string): RepertoireEntry | null {
  const e = map.get(id);
  if (!e) return null;
  const now = Date.now();
  if (now - e.ts > TTL_MS) {
    drop(id, e);
    return null;
  }
  e.ts = now;
  return e;
}

/** Analyze once per immutable handle/settings identity, then reuse the complete report for views. */
export function getOrCreateStrategicFitReport(
  entry: RepertoireEntry,
  options: AnalyzeStrategicFitOptions,
  analyze: (completeOptions: AnalyzeStrategicFitOptions) => StrategicFitAnalysisResult,
): StrategicFitReport {
  const key = strategicFitReportCacheKey(entry.contentKey, options);
  const cached = entry.strategicFitReports.get(key);
  if (cached) {
    entry.strategicFitReports.delete(key);
    entry.strategicFitReports.set(key, cached);
    return cached;
  }

  // The index only memoizes deterministic stages under a content identity, so a settings-varied
  // analysis of the same handle reuses work without changing the report it produces.
  const completeOptions = strategicFitCompleteAnalysisOptions(options);
  const compatibility = strategicFitJobCompatibility(entry.contentKey, completeOptions);
  // A call that threw — a cancelled scan, a dropped client — leaves its checkpoint on the handle;
  // the next call for the same content, revision, settings, and generation continues that job.
  entry.strategicFitRecovery =
    entry.strategicFitCheckpoint === null
      ? strategicFitColdJobRecovery(
          "The handle held no interrupted analysis, so this one ran cold.",
        )
      : restoreStrategicFitJobCheckpoint(
          entry.strategicFitIndex,
          entry.strategicFitCheckpoint,
          compatibility,
        );
  if (entry.strategicFitRecovery.state === "discarded") entry.strategicFitCheckpoint = null;
  const record = createStrategicFitJobRecorder({
    compatibility,
    save: (checkpoint) => {
      entry.strategicFitCheckpoint = checkpoint;
    },
  });

  const report = completeStrategicFitReport(
    analyze({
      ...completeOptions,
      index: entry.strategicFitIndex,
      onCheckpoint: record,
    }),
  );
  // The job settled, so its checkpoint stops being a job; the report itself is now the answer.
  entry.strategicFitCheckpoint = null;
  entry.strategicFitReports.set(key, report);
  while (entry.strategicFitReports.size > MAX_STRATEGIC_FIT_REPORTS) {
    const oldest = entry.strategicFitReports.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    entry.strategicFitReports.delete(oldest);
  }
  return report;
}

/**
 * Resolve a cached report by its exact identity. The per-handle cache is bounded, so an evicted or
 * foreign report is simply absent and the caller fails closed instead of answering from older data.
 */
export function strategicFitReportById(
  entry: RepertoireEntry,
  reportId: string,
): StrategicFitReport | null {
  for (const report of entry.strategicFitReports.values()) {
    if (report.report_id === reportId) return report;
  }
  return null;
}

export const strategicFitReportCacheSize = (entry: RepertoireEntry): number =>
  entry.strategicFitReports.size;

/** Recovery provenance for this handle's most recent analysis; `null` before one has run. */
export const strategicFitJobRecovery = (entry: RepertoireEntry): StrategicFitJobRecovery | null =>
  entry.strategicFitRecovery;

/** Whether this handle is still holding an interrupted analysis that a later call can continue. */
export const hasStrategicFitJobCheckpoint = (entry: RepertoireEntry): boolean =>
  entry.strategicFitCheckpoint !== null;
