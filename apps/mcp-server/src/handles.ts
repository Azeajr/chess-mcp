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
const STRATEGIC_FIT_INDEX_ENTRIES_PER_REPERTOIRE = 256;

export interface RepertoireEntry {
  tree: GameTree;
  color: Color;
  revision: string;
  contentKey: string;
  strategicFitReports: Map<string, StrategicFitReport>;
  strategicFitIndex: StrategicFitIndexCache;
  strategicFitCheckpoint: StrategicFitJobCheckpoint | null;
  strategicFitRecovery: StrategicFitJobRecovery | null;
  ts: number;
}

const map = new Map<string, RepertoireEntry>();

function drop(key: string, entry: RepertoireEntry): void {
  entry.strategicFitReports.clear();
  entry.strategicFitIndex.clear();
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
    for (const [k, v] of map) {
      if (v.ts < oldestTs) {
        oldestTs = v.ts;
        oldestKey = k;
      }
    }
    if (oldestKey === undefined) break;
    const entry = map.get(oldestKey);
    if (!entry) break;
    drop(oldestKey, entry);
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
  evict();
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

  const completeOptions = strategicFitCompleteAnalysisOptions(options);
  const compatibility = strategicFitJobCompatibility(entry.contentKey, completeOptions);
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
  entry.strategicFitCheckpoint = null;
  entry.strategicFitReports.set(key, report);
  while (entry.strategicFitReports.size > MAX_STRATEGIC_FIT_REPORTS) {
    const oldest = entry.strategicFitReports.keys().next().value;
    if (oldest === undefined) break;
    entry.strategicFitReports.delete(oldest);
  }
  return report;
}

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

export const strategicFitJobRecovery = (entry: RepertoireEntry): StrategicFitJobRecovery | null =>
  entry.strategicFitRecovery;

export const hasStrategicFitJobCheckpoint = (entry: RepertoireEntry): boolean =>
  entry.strategicFitCheckpoint !== null;
