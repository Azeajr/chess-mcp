import {
  completeStrategicFitReport,
  strategicFitCompleteAnalysisOptions,
  strategicFitJobCompatibility,
  strategicFitReportCacheKey,
  type AnalyzeStrategicFitOptions,
  type StrategicFitAnalysisResult,
  type StrategicFitJobCheckpoint,
  type StrategicFitJobRecovery,
  type StrategicFitProgress,
  type StrategicFitReport,
} from "@chess-mcp/chess-tools";
import {
  createStrategicFitCheckpointPort,
  type StrategicFitCheckpointPort,
} from "./strategic-fit-checkpoint-store";
import { analyzeStrategicFitInWorker } from "./strategic-fit-worker";

export interface StrategicFitReportExecutionOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: StrategicFitProgress) => void;
  readonly resume?: StrategicFitJobCheckpoint;
  readonly onCheckpoint?: (checkpoint: StrategicFitJobCheckpoint) => void;
  readonly onRecovery?: (recovery: StrategicFitJobRecovery) => void;
}

export type StrategicFitReportAnalyzer = (
  pgn: string,
  options: AnalyzeStrategicFitOptions,
  execution?: StrategicFitReportExecutionOptions,
) => Promise<StrategicFitAnalysisResult>;

const DEFAULT_STRATEGIC_FIT_REPORT_CACHE_SIZE = 4;

function abortError() {
  return new DOMException("Strategic Fit analysis cancelled", "AbortError");
}

export class StrategicFitReportCache {
  private readonly reports = new Map<string, Promise<StrategicFitReport>>();
  private readonly reportIdsByKey = new Map<string, string>();
  private readonly reportsById = new Map<string, StrategicFitReport>();
  private recovery: StrategicFitJobRecovery | null = null;

  constructor(
    private readonly analyze: StrategicFitReportAnalyzer = analyzeStrategicFitInWorker,
    private readonly maximumReports = DEFAULT_STRATEGIC_FIT_REPORT_CACHE_SIZE,
    private readonly checkpoints: StrategicFitCheckpointPort | null = createStrategicFitCheckpointPort(),
  ) {
    if (!Number.isSafeInteger(maximumReports) || maximumReports <= 0) {
      throw new Error("strategic_fit_invalid_report_cache_size");
    }
  }

  lastRecovery(): StrategicFitJobRecovery | null {
    return this.recovery;
  }

  get size(): number {
    return this.reports.size;
  }

  clear(): void {
    this.reports.clear();
    this.reportIdsByKey.clear();
    this.reportsById.clear();
  }

  reportById(reportId: string): StrategicFitReport | null {
    return this.reportsById.get(reportId) ?? null;
  }

  private forget(key: string): void {
    const reportId = this.reportIdsByKey.get(key);
    this.reportIdsByKey.delete(key);
    if (reportId === undefined) return;
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

    const completeOptions = strategicFitCompleteAnalysisOptions(options);
    const pending = (async () => {
      const resume = await this.resumableCheckpoint(pgn, completeOptions);
      const result = await this.analyze(pgn, completeOptions, {
        ...execution,
        ...(resume === null ? {} : { resume }),
        onCheckpoint: (checkpoint) => {
          this.checkpoints?.save(checkpoint);
          execution.onCheckpoint?.(checkpoint);
        },
        onRecovery: (recovery) => {
          this.recovery = recovery;
          execution.onRecovery?.(recovery);
        },
      });
      return completeStrategicFitReport(result);
    })();
    this.reports.set(key, pending);
    while (this.reports.size > this.maximumReports) {
      const oldest = this.reports.keys().next().value;
      if (oldest === undefined) break;
      this.reports.delete(oldest);
      this.forget(oldest);
    }

    try {
      const report = await pending;
      this.remember(key, pending, report);
      this.checkpoints?.discard("The analysis completed, so its checkpoint is no longer a job.");
      if (execution.signal?.aborted) throw abortError();
      return report;
    } catch (error) {
      if (this.reports.get(key) === pending) {
        this.reports.delete(key);
        this.forget(key);
      }
      this.checkpoints?.discard(
        execution.signal?.aborted === true
          ? "The analysis was cancelled, so its checkpoint was dropped rather than resumed."
          : "The analysis failed, so its checkpoint was dropped rather than resumed.",
      );
      throw error;
    }
  }

  private async resumableCheckpoint(
    pgn: string,
    completeOptions: AnalyzeStrategicFitOptions,
  ): Promise<StrategicFitJobCheckpoint | null> {
    if (this.checkpoints === null) return null;
    try {
      return await this.checkpoints.load(strategicFitJobCompatibility(pgn, completeOptions));
    } catch {
      return null;
    }
  }
}

const defaultReportCache = new StrategicFitReportCache();

export const invalidateCachedStrategicFitReports = () => {
  defaultReportCache.clear();
};

export const getCachedStrategicFitReportById = (reportId: string) =>
  defaultReportCache.reportById(reportId);

export const getCachedStrategicFitReport = (
  pgn: string,
  options: AnalyzeStrategicFitOptions,
  execution?: StrategicFitReportExecutionOptions,
) => defaultReportCache.getReport(pgn, options, execution);
