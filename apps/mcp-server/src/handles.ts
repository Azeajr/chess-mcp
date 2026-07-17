/**
 * Repertoire handle cache — the Node port of the Python server's in-memory LRU+TTL. load_*
 * returns a short id; the other repertoire tools take it. The MCP contract stays a pure
 * function of (id, args): the id is an input key, not call-order state.
 */
import { randomUUID } from "node:crypto";
import {
  completeStrategicFitReport,
  strategicFitCompleteAnalysisOptions,
  strategicFitReportCacheKey,
  type AnalyzeStrategicFitOptions,
  type Color,
  type GameTree,
  type StrategicFitAnalysisResult,
  type StrategicFitReport,
} from "@chess-mcp/chess-tools";

const MAX = Number(process.env.MAX_REPERTOIRES ?? 16);
const TTL_MS = Number(process.env.REPERTOIRE_TTL_S ?? 3600) * 1000;
const configuredStrategicFitReports = Number(process.env.MAX_STRATEGIC_FIT_REPORTS_PER_REPERTOIRE ?? 4);
const MAX_STRATEGIC_FIT_REPORTS = Number.isSafeInteger(configuredStrategicFitReports) && configuredStrategicFitReports > 0
  ? configuredStrategicFitReports
  : 4;

export interface RepertoireEntry {
  tree: GameTree;
  color: Color;
  /** Immutable clone-on-write handle generation used as the Strategic Fit report revision. */
  revision: string;
  /** Normalized immutable content protects against accidental revision-label reuse. */
  contentKey: string;
  strategicFitReports: Map<string, StrategicFitReport>;
  ts: number;
}

const map = new Map<string, RepertoireEntry>();

function drop(key: string, entry: RepertoireEntry): void {
  entry.strategicFitReports.clear();
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

  const report = completeStrategicFitReport(analyze(strategicFitCompleteAnalysisOptions(options)));
  entry.strategicFitReports.set(key, report);
  while (entry.strategicFitReports.size > MAX_STRATEGIC_FIT_REPORTS) {
    const oldest = entry.strategicFitReports.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    entry.strategicFitReports.delete(oldest);
  }
  return report;
}

export const strategicFitReportCacheSize = (entry: RepertoireEntry): number =>
  entry.strategicFitReports.size;
