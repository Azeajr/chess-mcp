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
    }

    try {
      const report = await pending;
      if (execution.signal?.aborted) throw abortError();
      return report;
    } catch (error) {
      if (this.reports.get(key) === pending) this.reports.delete(key);
      throw error;
    }
  }
}

const defaultReportCache = new StrategicFitReportCache();

export const getCachedStrategicFitReport = (
  pgn: string,
  options: AnalyzeStrategicFitOptions,
  execution?: StrategicFitReportExecutionOptions,
) => defaultReportCache.getReport(pgn, options, execution);
