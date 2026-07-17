/**
 * Immutable Strategic Fit report projections and cache identities.
 *
 * Analysis settings determine the cached logical report. Sorting, paging, and selecting one
 * finding are projections over that report and therefore never participate in the cache key.
 */
import type {
  AnalyzeStrategicFitOptions,
  StrategicFitAnalysisResult,
  StrategicFitFindingPage,
  StrategicFitFindingPageInput,
  StrategicFitFindingSort,
} from "./analyze.js";
import type {
  StrategicFinding,
  StrategicFitAnalysisManifest,
  StrategicFitOverview,
  StrategicFitPreflight,
  StrategicFitProfile,
  StrategicFitProvenance,
  StrategicFitReport,
} from "./types.js";
import { STRATEGIC_FIT_ANALYSIS_MANIFEST } from "./version.js";

export const STRATEGIC_FIT_MAX_PAGE_SIZE = 50;
export const STRATEGIC_FIT_MAX_FULL_PROJECTION_FINDINGS = 500;
/** Internal only: obtain every finding once so hosts can cache and cheaply re-project the report. */
export const STRATEGIC_FIT_COMPLETE_REPORT_LIMIT = Number.MAX_SAFE_INTEGER;

export type StrategicFitProjectionKind = "summary" | "page" | "finding" | "full";

export interface StrategicFitProjectionIdentity {
  readonly expected_repertoire_revision: string;
  readonly expected_report_id?: string;
}

export interface StrategicFitSummaryProjectionRequest extends StrategicFitProjectionIdentity {
  readonly kind: "summary";
}

export interface StrategicFitCursorPageInput extends StrategicFitFindingPageInput {
  readonly cursor?: string;
}

export interface StrategicFitPageProjectionRequest extends StrategicFitProjectionIdentity {
  readonly kind: "page";
  readonly page?: StrategicFitCursorPageInput;
  readonly sort?: StrategicFitFindingSort;
}

export interface StrategicFitFindingProjectionRequest extends StrategicFitProjectionIdentity {
  readonly kind: "finding";
  readonly finding_id: string;
}

export interface StrategicFitFullProjectionRequest extends StrategicFitProjectionIdentity {
  readonly kind: "full";
}

export type StrategicFitProjectionRequest =
  | StrategicFitSummaryProjectionRequest
  | StrategicFitPageProjectionRequest
  | StrategicFitFindingProjectionRequest
  | StrategicFitFullProjectionRequest;

export interface StrategicFitSummaryProjection {
  readonly projection: "summary";
  readonly report_id: string;
  readonly repertoire_revision: string;
  readonly schema_version: string;
  readonly analysis_version: string;
  readonly manifest: StrategicFitAnalysisManifest;
  readonly profile: StrategicFitProfile;
  readonly preflight: StrategicFitPreflight;
  readonly summary: StrategicFitOverview;
  readonly finding_count: number;
  readonly provenance: StrategicFitProvenance;
}

export interface StrategicFitPageProjection {
  readonly projection: "page";
  readonly report: StrategicFitAnalysisResult;
  /** Cursor for this page; useful when a selection moves away and later returns. */
  readonly cursor: string;
  readonly next_cursor: string | null;
}

export interface StrategicFitFindingProjection {
  readonly projection: "finding";
  readonly report_id: string;
  readonly repertoire_revision: string;
  readonly finding: StrategicFinding;
}

export interface StrategicFitFullProjection {
  readonly projection: "full";
  readonly report: StrategicFitReport;
}

export type StrategicFitProjection =
  | StrategicFitSummaryProjection
  | StrategicFitPageProjection
  | StrategicFitFindingProjection
  | StrategicFitFullProjection;

export class StrategicFitReportProjectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StrategicFitReportProjectionError";
    this.code = code;
  }
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** The canonical finding order used by both a cold analysis and a cached page projection. */
export function sortStrategicFitFindings(
  findings: readonly StrategicFinding[],
  sort: StrategicFitFindingSort,
): StrategicFinding[] {
  const descendingNumber = (left: number | null, right: number | null): number =>
    (right ?? -1) - (left ?? -1);
  return [...findings].sort((left, right) => {
    let primary = 0;
    if (sort === "replacement-priority") {
      primary = right.replacement_priority.score - left.replacement_priority.score;
    } else if (sort === "training-priority") {
      primary = right.training_priority.score - left.training_priority.score;
    } else if (sort === "expected-frequency") {
      primary = descendingNumber(left.expected_frequency, right.expected_frequency);
    } else if (sort === "opening-scope") {
      primary = compareStrings(left.opening_scope, right.opening_scope);
    }
    return primary || compareStrings(left.finding_id, right.finding_id);
  });
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => typeof item !== "function")
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    .join(",")}}`;
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function openingTableIdentity(options: AnalyzeStrategicFitOptions) {
  return [...(options.openingTable ?? new Map()).entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([position, entry]) => [position, entry.eco, entry.name]);
}

/**
 * Stable host cache key. `contentKey` should be the normalized PGN (browser) or immutable handle
 * content key (MCP); including it prevents a reused revision label from serving different data.
 */
export function strategicFitReportCacheKey(
  contentKey: string,
  options: AnalyzeStrategicFitOptions,
): string {
  const identity = {
    content_key: contentKey,
    repertoire_revision: options.repertoireRevision,
    repertoire_color: options.repertoireColor,
    manifest: STRATEGIC_FIT_ANALYSIS_MANIFEST,
    profile: options.profile ?? null,
    trajectory: options.trajectory ?? null,
    weighting: options.weighting ?? null,
    cohorts: options.cohorts ?? null,
    modes: options.modes ?? null,
    distance: options.distance ?? null,
    training: options.training ?? null,
    route_assessments: options.routeAssessments ?? [],
    opening_table: openingTableIdentity(options),
  };
  return `strategic-fit-report-cache:${stableHash(stableSerialize(identity))}`;
}

/** Remove projection-only options and request the complete canonical finding order. */
export function strategicFitCompleteAnalysisOptions(
  options: AnalyzeStrategicFitOptions,
): AnalyzeStrategicFitOptions {
  return {
    ...options,
    sort: "finding-id",
    page: { offset: 0, limit: STRATEGIC_FIT_COMPLETE_REPORT_LIMIT },
  };
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item, seen);
  return Object.freeze(value);
}

/** Convert the internal all-findings analyzer result into the immutable cache representation. */
export function completeStrategicFitReport(result: StrategicFitAnalysisResult): StrategicFitReport {
  if (
    result.finding_page.offset !== 0 ||
    result.finding_page.returned_count !== result.finding_page.total_count ||
    result.findings.length !== result.finding_page.total_count
  ) {
    throw new StrategicFitReportProjectionError(
      "strategic_fit_incomplete_cached_report",
      "A host attempted to cache a paged Strategic Fit result as a complete report.",
    );
  }
  const { finding_page: _findingPage, ...report } = result;
  return deepFreeze(report);
}

function assertCurrent(report: StrategicFitReport, request: StrategicFitProjectionIdentity): void {
  if (report.repertoire_revision !== request.expected_repertoire_revision) {
    throw new StrategicFitReportProjectionError(
      "strategic_fit_stale_revision",
      `Report ${report.report_id} belongs to ${report.repertoire_revision}, not ${request.expected_repertoire_revision}.`,
    );
  }
  if (request.expected_report_id !== undefined && report.report_id !== request.expected_report_id) {
    throw new StrategicFitReportProjectionError(
      "strategic_fit_stale_report",
      `Report ${request.expected_report_id} is no longer current for this analysis.`,
    );
  }
}

const PAGE_CURSOR_PREFIX = "strategic-fit-page";

function pageCursor(reportId: string, sort: StrategicFitFindingSort, offset: number): string {
  return [PAGE_CURSOR_PREFIX, reportId, sort, offset].map(encodeURIComponent).join("|");
}

function cursorOffset(
  cursor: string,
  reportId: string,
  sort: StrategicFitFindingSort,
): number {
  const parts = cursor.split("|").map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return "";
    }
  });
  if (parts.length !== 4 || parts[0] !== PAGE_CURSOR_PREFIX || parts[1] !== reportId || parts[2] !== sort) {
    throw new StrategicFitReportProjectionError(
      "strategic_fit_stale_page_cursor",
      "The Strategic Fit page cursor belongs to a different report or sort order.",
    );
  }
  const offset = Number(parts[3]);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new StrategicFitReportProjectionError(
      "strategic_fit_invalid_page_cursor",
      "The Strategic Fit page cursor is malformed.",
    );
  }
  return offset;
}

function pageProjection(
  report: StrategicFitReport,
  request: StrategicFitPageProjectionRequest,
): StrategicFitPageProjection {
  const sort = request.sort ?? "replacement-priority";
  if (request.page?.cursor !== undefined && request.page.offset !== undefined) {
    throw new StrategicFitReportProjectionError(
      "strategic_fit_ambiguous_page",
      "Use either a Strategic Fit page cursor or an offset, not both.",
    );
  }
  const offset = request.page?.cursor === undefined
    ? request.page?.offset ?? 0
    : cursorOffset(request.page.cursor, report.report_id, sort);
  const requestedLimit = request.page?.limit ?? STRATEGIC_FIT_MAX_PAGE_SIZE;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new StrategicFitReportProjectionError(
      "strategic_fit_invalid_page_offset",
      "Strategic Fit page offsets must be non-negative safe integers.",
    );
  }
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit <= 0) {
    throw new StrategicFitReportProjectionError(
      "strategic_fit_invalid_page_limit",
      "Strategic Fit page limits must be positive safe integers.",
    );
  }
  const limit = Math.min(requestedLimit, STRATEGIC_FIT_MAX_PAGE_SIZE);
  const findings = sortStrategicFitFindings(report.findings, sort);
  const returnedCount = Math.max(0, Math.min(limit, findings.length - offset));
  const findingPage: StrategicFitFindingPage = {
    offset,
    limit,
    total_count: findings.length,
    returned_count: returnedCount,
    has_more: offset + returnedCount < findings.length,
  };
  return {
    projection: "page",
    report: {
      ...report,
      findings: findings.slice(offset, offset + limit),
      finding_page: findingPage,
    },
    cursor: pageCursor(report.report_id, sort, offset),
    next_cursor: findingPage.has_more
      ? pageCursor(report.report_id, sort, offset + returnedCount)
      : null,
  };
}

export function projectStrategicFitReport(
  report: StrategicFitReport,
  request: StrategicFitProjectionRequest,
): StrategicFitProjection {
  assertCurrent(report, request);
  if (request.kind === "summary") {
    return {
      projection: "summary",
      report_id: report.report_id,
      repertoire_revision: report.repertoire_revision,
      schema_version: report.schema_version,
      analysis_version: report.analysis_version,
      manifest: report.manifest,
      profile: report.profile,
      preflight: report.preflight,
      summary: report.summary,
      finding_count: report.findings.length,
      provenance: report.provenance,
    };
  }
  if (request.kind === "page") return pageProjection(report, request);
  if (request.kind === "finding") {
    const finding = report.findings.find((candidate) => candidate.finding_id === request.finding_id);
    if (!finding || finding.repertoire_revision !== request.expected_repertoire_revision) {
      throw new StrategicFitReportProjectionError(
        "strategic_fit_finding_not_found",
        `Finding ${request.finding_id} is not current in report ${report.report_id}.`,
      );
    }
    return {
      projection: "finding",
      report_id: report.report_id,
      repertoire_revision: report.repertoire_revision,
      finding,
    };
  }
  if (report.findings.length > STRATEGIC_FIT_MAX_FULL_PROJECTION_FINDINGS) {
    throw new StrategicFitReportProjectionError(
      "strategic_fit_full_projection_too_large",
      `Full Strategic Fit projections are limited to ${STRATEGIC_FIT_MAX_FULL_PROJECTION_FINDINGS} findings; use pages instead.`,
    );
  }
  return { projection: "full", report };
}
