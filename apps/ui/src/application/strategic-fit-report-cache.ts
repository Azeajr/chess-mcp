import {
  completeStrategicFitReport,
  strategicFitCompleteAnalysisOptions,
  strategicFitReportCacheKey,
  type AnalyzeStrategicFitOptions,
  type StrategicFitAnalysisResult,
  type StrategicFitProgress,
  type StrategicFitReport,
} from "@chess-mcp/chess-tools";
import { analyzeStrategicFitInWorker } from "./strategic-fit-worker";

export interface StrategicFitReportExecutionOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: StrategicFitProgress) => void;
}

export type StrategicFitReportAnalyzer = (
  pgn: string,
  options: AnalyzeStrategicFitOptions,
  execution?: StrategicFitReportExecutionOptions,
) => Promise<StrategicFitAnalysisResult>;

export const DEFAULT_STRATEGIC_FIT_REPORT_CACHE_SIZE = 4;

function abortError() {
  return new DOMException("Strategic Fit analysis cancelled", "AbortError");
}

/** Bounded in-memory cache of complete immutable reports produced by the dedicated Worker. */
export class StrategicFitReportCache {
  private readonly reports = new Map<string, Promise<StrategicFitReport>>();
  /** Identity index over resolved reports only; it never outlives its cache entry. */
  private readonly reportIdsByKey = new Map<string, string>();
  private readonly reportsById = new Map<string, StrategicFitReport>();

  constructor(
    private readonly analyze: StrategicFitReportAnalyzer = analyzeStrategicFitInWorker,
    private readonly maximumReports = DEFAULT_STRATEGIC_FIT_REPORT_CACHE_SIZE,
  ) {
    if (!Number.isSafeInteger(maximumReports) || maximumReports <= 0) {
      throw new Error("strategic_fit_invalid_report_cache_size");
    }
  }

  get size(): number {
    return this.reports.size;
  }

  clear(): void {
    this.reports.clear();
    this.reportIdsByKey.clear();
    this.reportsById.clear();
  }

  /**
   * Resolve a cached report by its exact identity. Only reports still held by a live cache entry
   * are visible, so an evicted, invalidated, or foreign identity is absent and the caller fails
   * closed rather than answering from an older report.
   */
  reportById(reportId: string): StrategicFitReport | null {
    return this.reportsById.get(reportId) ?? null;
  }

  private forget(key: string): void {
    const reportId = this.reportIdsByKey.get(key);
    this.reportIdsByKey.delete(key);
    if (reportId === undefined) return;
    // A different settings key can legitimately produce the same report; keep the survivor.
    for (const retained of this.reportIdsByKey.values()) if (retained === reportId) return;
    this.reportsById.delete(reportId);
  }

  private remember(
    key: string,
    pending: Promise<StrategicFitReport>,
    report: StrategicFitReport,
  ): void {
    if (this.reports.get(key) !== pending) return;
    this.reportIdsByKey.set(key, report.report_id);
    this.reportsById.set(report.report_id, report);
  }

  async getReport(
    pgn: string,
    options: AnalyzeStrategicFitOptions,
    execution: StrategicFitReportExecutionOptions = {},
  ): Promise<StrategicFitReport> {
    if (execution.signal?.aborted) throw abortError();
    const key = strategicFitReportCacheKey(pgn, options);
    const cached = this.reports.get(key);
    if (cached) {
      this.reports.delete(key);
      this.reports.set(key, cached);
      const report = await cached;
      if (execution.signal?.aborted) throw abortError();
      return report;
    }

    const pending = this.analyze(
      pgn,
      strategicFitCompleteAnalysisOptions(options),
      execution,
    ).then(completeStrategicFitReport);
    this.reports.set(key, pending);
    while (this.reports.size > this.maximumReports) {
      const oldest = this.reports.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.reports.delete(oldest);
      this.forget(oldest);
    }

    try {
      const report = await pending;
      this.remember(key, pending, report);
      if (execution.signal?.aborted) throw abortError();
      return report;
    } catch (error) {
      if (this.reports.get(key) === pending) {
        this.reports.delete(key);
        this.forget(key);
      }
      throw error;
    }
  }
}

const defaultReportCache = new StrategicFitReportCache();

/** Narrow settings invalidation boundary; repertoire/profile stores do not own cache internals. */
export const invalidateCachedStrategicFitReports = () => defaultReportCache.clear();

/** Scoped conversation retrieval: identity lookup only, never a fresh analysis. */
export const getCachedStrategicFitReportById = (reportId: string) =>
  defaultReportCache.reportById(reportId);

export const getCachedStrategicFitReport = (
  pgn: string,
  options: AnalyzeStrategicFitOptions,
  execution?: StrategicFitReportExecutionOptions,
) => defaultReportCache.getReport(pgn, options, execution);
