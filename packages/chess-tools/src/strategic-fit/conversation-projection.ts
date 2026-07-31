/**
 * Bounded conversation projections over an immutable Strategic Fit report.
 *
 * The assistant must be able to discuss a report without receiving it. These projections return
 * only what a grounded explanation needs — report identity, overview state, one bounded finding
 * list, and one finding with its evidence and navigable SAN paths — under fixed size limits.
 *
 * Deliberately excluded: source provenance records and snapshots, the analysis manifest,
 * full metric values, complete reference identity lists, and any host document artifact such as
 * PGN, FEN, file names, or persisted metadata. Report identity and staleness rules are reused from
 * `report-projection.ts`, so a stale report or finding identity fails closed there.
 */
import type {
  ConfidenceCap,
  EvidenceComparisonDimension,
  JsonValue,
  PreflightIssue,
  StrategicFinding,
  StrategicFitMetric,
  StrategicFitMetricId,
  StrategicFitOverview,
  StrategicFitPreflight,
  StrategicFitProfileMode,
  StrategicFitReport,
} from "./types.js";
import type { StrategicFitFindingSort } from "./analyze.js";
import {
  projectStrategicFitReport,
  StrategicFitReportProjectionError,
  type StrategicFitCursorPageInput,
} from "./report-projection.js";

/** Fixed bounds. Every truncation is disclosed in the projection rather than silently applied. */
export const STRATEGIC_FIT_CONVERSATION_LIMITS = Object.freeze({
  findings_page_default: 10,
  findings_page_maximum: 25,
  preflight_issues: 5,
  san_paths: 3,
  san_path_plies: 24,
  evidence_dimensions: 6,
  identity_list: 8,
  confidence_caps: 3,
  text_characters: 400,
});

export type StrategicFitConversationView = "summary" | "findings" | "finding";

export interface StrategicFitConversationRequest {
  readonly view: StrategicFitConversationView;
  readonly report_id: string;
  readonly expected_repertoire_revision: string;
  readonly finding_id?: string;
  readonly page?: StrategicFitCursorPageInput;
  readonly sort?: StrategicFitFindingSort;
}

export interface StrategicFitConversationText {
  readonly text: string;
  readonly truncated: boolean;
}

export interface StrategicFitConversationPath {
  readonly san: readonly string[];
  /** True when the path was shortened for transport; navigation still starts from the root. */
  readonly truncated: boolean;
}

export interface StrategicFitConversationIdentityList {
  readonly ids: readonly string[];
  readonly total_count: number;
}

export interface StrategicFitConversationMetric {
  readonly metric_id: StrategicFitMetricId;
  readonly state: string;
  readonly unit: string;
  /** Present only for scalar metrics; composite values stay in the workspace views. */
  readonly value: number | null;
  readonly reason: string | null;
}

export interface StrategicFitConversationSummary {
  readonly retrieval: "strategic-fit-summary";
  readonly report_id: string;
  readonly repertoire_revision: string;
  readonly schema_version: string;
  readonly analysis_version: string;
  readonly profile_mode: StrategicFitProfileMode;
  readonly profile_provisional: boolean;
  readonly finding_count: number;
  readonly preflight: {
    readonly state: StrategicFitPreflight["state"];
    readonly route_count: number;
    readonly comparable_route_count: number;
    readonly incomplete_route_count: number;
    readonly issue_counts: Readonly<Record<PreflightIssue["severity"], number>>;
    readonly issues: readonly {
      readonly code: PreflightIssue["code"];
      readonly kind: PreflightIssue["kind"];
      readonly severity: PreflightIssue["severity"];
      readonly message: StrategicFitConversationText;
    }[];
    readonly omitted_issue_count: number;
  };
  readonly summary: {
    readonly workload: StrategicFitOverview["workload"];
    readonly strategic_family_count: number;
    readonly expected_concept_burden: number | null;
    readonly intentional_exception_count: number;
    readonly unresolved_finding_count: number;
    readonly insufficient_evidence_branch_count: number;
  };
  readonly metrics: readonly StrategicFitConversationMetric[];
}

export interface StrategicFitConversationFindingRow {
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly classification: StrategicFinding["classification"];
  readonly plain_language_category: string;
  readonly opening_scope: string;
  readonly affected_line_summary: StrategicFitConversationText;
  readonly expected_frequency: number | null;
  readonly learning_burden: number;
  readonly confidence: { readonly label: string; readonly score: number };
  readonly difference: { readonly magnitude: string; readonly distance: number };
  readonly replacement_priority: { readonly label: string; readonly score: number };
  readonly training_priority: { readonly label: string; readonly score: number };
  readonly objective_quality: { readonly state: string; readonly verdict: string };
  readonly resolution_state: StrategicFinding["resolution_state"];
  readonly provisional: boolean;
  readonly source_san_paths: readonly StrategicFitConversationPath[];
  readonly total_san_path_count: number;
}

export interface StrategicFitConversationFindings {
  readonly retrieval: "strategic-fit-findings";
  readonly report_id: string;
  readonly repertoire_revision: string;
  readonly sort: StrategicFitFindingSort;
  readonly page: {
    readonly offset: number;
    readonly limit: number;
    readonly total_count: number;
    readonly returned_count: number;
    readonly has_more: boolean;
  };
  readonly cursor: string;
  readonly next_cursor: string | null;
  readonly findings: readonly StrategicFitConversationFindingRow[];
}

export interface StrategicFitConversationFinding {
  readonly retrieval: "strategic-fit-finding";
  readonly report_id: string;
  readonly repertoire_revision: string;
  readonly finding: StrategicFitConversationFindingRow & {
    readonly explanation: StrategicFitConversationText;
    readonly confidence_explanation: StrategicFitConversationText;
    readonly applied_caps: readonly {
      readonly reason: ConfidenceCap["reason"];
      readonly maximum_score: number;
    }[];
    readonly objective_reason: StrategicFitConversationText | null;
    readonly evidence: {
      readonly cohort_id: string;
      readonly comparison_basis: {
        readonly effective_branches: number;
        readonly weighted_reference_games: number | null;
        readonly structural_classification_coverage: number;
        readonly analysis_window: readonly [number, number] | null;
        readonly profile_mode: StrategicFitProfileMode;
      };
      readonly dimensions: readonly {
        readonly dimension_id: string;
        readonly contribution: number;
        readonly typical_value: number | string | boolean | null;
        readonly affected_value: number | string | boolean | null;
        readonly values_omitted: boolean;
        readonly explanation: StrategicFitConversationText;
      }[];
      readonly omitted_dimension_count: number;
      readonly causality: {
        readonly label: string;
        readonly controllability: number | null;
        readonly player_contribution: number | null;
        readonly opponent_contribution: number | null;
        readonly explanation: StrategicFitConversationText;
        readonly likely_causal_decision_ids: StrategicFitConversationIdentityList;
      };
      readonly data_quality_issue_count: number;
    };
    readonly references: {
      readonly route_ids: StrategicFitConversationIdentityList;
      readonly decision_ids: StrategicFitConversationIdentityList;
      readonly position_ids: StrategicFitConversationIdentityList;
    };
  };
}

export type StrategicFitConversationProjection =
  | StrategicFitConversationSummary
  | StrategicFitConversationFindings
  | StrategicFitConversationFinding;

function text(value: string): StrategicFitConversationText {
  const limit = STRATEGIC_FIT_CONVERSATION_LIMITS.text_characters;
  return value.length <= limit
    ? { text: value, truncated: false }
    : { text: `${value.slice(0, limit)}…`, truncated: true };
}

function identityList(ids: readonly string[]): StrategicFitConversationIdentityList {
  return {
    ids: ids.slice(0, STRATEGIC_FIT_CONVERSATION_LIMITS.identity_list),
    total_count: ids.length,
  };
}

function paths(finding: StrategicFinding): readonly StrategicFitConversationPath[] {
  const { san_paths: maxPaths, san_path_plies: maxPlies } = STRATEGIC_FIT_CONVERSATION_LIMITS;
  return finding.references.source_san_paths.slice(0, maxPaths).map((path) => ({
    san: path.slice(0, maxPlies),
    truncated: path.length > maxPlies,
  }));
}

function scalar(value: JsonValue): number | string | boolean | null {
  return value === null || typeof value === "number" || typeof value === "string" ||
      typeof value === "boolean"
    ? value
    : null;
}

const isComposite = (value: JsonValue): boolean =>
  value !== null && typeof value === "object";

function dimension(item: EvidenceComparisonDimension) {
  const composite = isComposite(item.typical_value) || isComposite(item.affected_value);
  return {
    dimension_id: item.dimension_id,
    contribution: item.contribution,
    typical_value: scalar(item.typical_value),
    affected_value: scalar(item.affected_value),
    values_omitted: composite,
    explanation: text(item.explanation),
  };
}

function findingRow(finding: StrategicFinding): StrategicFitConversationFindingRow {
  return {
    finding_id: finding.finding_id,
    semantic_finding_id: finding.semantic_finding_id,
    classification: finding.classification,
    plain_language_category: finding.plain_language_category,
    opening_scope: finding.opening_scope,
    affected_line_summary: text(finding.affected_line_summary),
    expected_frequency: finding.expected_frequency,
    learning_burden: finding.learning_burden,
    confidence: { label: finding.confidence.label, score: finding.confidence.score },
    difference: { magnitude: finding.difference.magnitude, distance: finding.difference.distance },
    replacement_priority: {
      label: finding.replacement_priority.label,
      score: finding.replacement_priority.score,
    },
    training_priority: {
      label: finding.training_priority.label,
      score: finding.training_priority.score,
    },
    objective_quality: {
      state: finding.objective_quality.state,
      verdict: finding.objective_quality.verdict,
    },
    resolution_state: finding.resolution_state,
    provisional: finding.provisional,
    source_san_paths: paths(finding),
    total_san_path_count: finding.references.source_san_paths.length,
  };
}

function summaryProjection(report: StrategicFitReport): StrategicFitConversationSummary {
  const issueCounts = report.preflight.issues.reduce(
    (counts, issue) => ({ ...counts, [issue.severity]: counts[issue.severity] + 1 }),
    { blocking: 0, degraded: 0, informational: 0 },
  );
  const issues = report.preflight.issues.slice(0, STRATEGIC_FIT_CONVERSATION_LIMITS.preflight_issues);
  const metrics = Object.values(report.summary.metrics as unknown as Readonly<Record<string, unknown>>)
    // `metrics` also carries the analysis version; only the metric records are projected.
    .filter((metric): metric is StrategicFitMetric<unknown> =>
      typeof metric === "object" && metric !== null && "metric_id" in metric)
    .map((metric) => ({
      metric_id: metric.metric_id,
      state: metric.state,
      unit: metric.unit,
      value: typeof metric.value === "number" ? metric.value : null,
      reason: metric.reason,
    }));
  return {
    retrieval: "strategic-fit-summary",
    report_id: report.report_id,
    repertoire_revision: report.repertoire_revision,
    schema_version: report.schema_version,
    analysis_version: report.analysis_version,
    profile_mode: report.profile.mode,
    profile_provisional: report.profile.provisional,
    finding_count: report.findings.length,
    preflight: {
      state: report.preflight.state,
      route_count: report.preflight.route_count,
      comparable_route_count: report.preflight.comparable_route_count,
      incomplete_route_count: report.preflight.incomplete_route_count,
      issue_counts: issueCounts,
      issues: issues.map((issue) => ({
        code: issue.code,
        kind: issue.kind,
        severity: issue.severity,
        message: text(issue.message),
      })),
      omitted_issue_count: report.preflight.issues.length - issues.length,
    },
    summary: {
      workload: report.summary.workload,
      strategic_family_count: report.summary.strategic_family_count,
      expected_concept_burden: report.summary.expected_concept_burden,
      intentional_exception_count: report.summary.intentional_exception_count,
      unresolved_finding_count: report.summary.unresolved_finding_count,
      insufficient_evidence_branch_count: report.summary.insufficient_evidence_branch_count,
    },
    metrics,
  };
}

function findingsProjection(
  report: StrategicFitReport,
  request: StrategicFitConversationRequest,
): StrategicFitConversationFindings {
  const { findings_page_default: fallback, findings_page_maximum: maximum } =
    STRATEGIC_FIT_CONVERSATION_LIMITS;
  const requestedLimit = request.page?.limit ?? fallback;
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit <= 0 || requestedLimit > maximum) {
    throw new StrategicFitReportProjectionError(
      "strategic_fit_invalid_page_limit",
      `Conversation finding pages are limited to ${maximum} findings.`,
    );
  }
  const projection = projectStrategicFitReport(report, {
    kind: "page",
    expected_repertoire_revision: request.expected_repertoire_revision,
    expected_report_id: request.report_id,
    ...(request.page === undefined ? {} : { page: request.page }),
    ...(request.sort === undefined ? {} : { sort: request.sort }),
  });
  if (projection.projection !== "page") {
    throw new StrategicFitReportProjectionError(
      "strategic_fit_unexpected_projection",
      "The Strategic Fit page projection returned an unexpected shape.",
    );
  }
  const page = projection.report.finding_page;
  return {
    retrieval: "strategic-fit-findings",
    report_id: projection.report.report_id,
    repertoire_revision: projection.report.repertoire_revision,
    sort: request.sort ?? "replacement-priority",
    page: {
      offset: page.offset,
      limit: page.limit,
      total_count: page.total_count,
      returned_count: page.returned_count,
      has_more: page.has_more,
    },
    cursor: projection.cursor,
    next_cursor: projection.next_cursor,
    findings: projection.report.findings.map(findingRow),
  };
}

function findingProjection(
  report: StrategicFitReport,
  request: StrategicFitConversationRequest,
): StrategicFitConversationFinding {
  if (typeof request.finding_id !== "string" || request.finding_id.length === 0) {
    throw new StrategicFitReportProjectionError(
      "strategic_fit_missing_finding_identity",
      "A conversation finding projection requires the exact finding identity.",
    );
  }
  const projection = projectStrategicFitReport(report, {
    kind: "finding",
    expected_repertoire_revision: request.expected_repertoire_revision,
    expected_report_id: request.report_id,
    finding_id: request.finding_id,
  });
  if (projection.projection !== "finding") {
    throw new StrategicFitReportProjectionError(
      "strategic_fit_unexpected_projection",
      "The Strategic Fit finding projection returned an unexpected shape.",
    );
  }
  const finding = projection.finding;
  const dimensions = finding.evidence.dimensions
    .slice(0, STRATEGIC_FIT_CONVERSATION_LIMITS.evidence_dimensions)
    .map(dimension);
  return {
    retrieval: "strategic-fit-finding",
    report_id: projection.report_id,
    repertoire_revision: projection.repertoire_revision,
    finding: {
      ...findingRow(finding),
      explanation: text(finding.explanation),
      confidence_explanation: text(finding.confidence.explanation),
      applied_caps: finding.confidence.applied_caps
        .slice(0, STRATEGIC_FIT_CONVERSATION_LIMITS.confidence_caps)
        .map((cap) => ({ reason: cap.reason, maximum_score: cap.maximum_score })),
      objective_reason: finding.objective_quality.reason === null
        ? null
        : text(finding.objective_quality.reason),
      evidence: {
        cohort_id: finding.evidence.cohort_id,
        comparison_basis: {
          effective_branches: finding.evidence.comparison_basis.effective_branches,
          weighted_reference_games: finding.evidence.comparison_basis.weighted_reference_games,
          structural_classification_coverage:
            finding.evidence.comparison_basis.structural_classification_coverage,
          analysis_window: finding.evidence.comparison_basis.analysis_window,
          profile_mode: finding.evidence.comparison_basis.profile_mode,
        },
        dimensions,
        omitted_dimension_count: finding.evidence.dimensions.length - dimensions.length,
        causality: {
          label: finding.evidence.causality.label,
          controllability: finding.evidence.causality.controllability,
          player_contribution: finding.evidence.causality.player_contribution,
          opponent_contribution: finding.evidence.causality.opponent_contribution,
          explanation: text(finding.evidence.causality.explanation),
          likely_causal_decision_ids: identityList(
            finding.evidence.causality.likely_causal_decision_ids,
          ),
        },
        data_quality_issue_count: finding.evidence.data_quality_issue_ids.length,
      },
      references: {
        route_ids: identityList(finding.references.route_ids),
        decision_ids: identityList(finding.references.decision_ids),
        position_ids: identityList(finding.references.position_ids),
      },
    },
  };
}

export interface StrategicFitConversationErrorResult {
  readonly error: string;
  readonly reason: string;
}

/**
 * Structured result for an identity that is not resolvable in a host's bounded report cache.
 * Reports are dropped by eviction, revision change, and settings change, so an absent identity is
 * reported as unavailable instead of being answered from an older report.
 */
export const strategicFitReportUnavailableResult = (
  reportId: string,
): StrategicFitConversationErrorResult => ({
  error: "strategic_fit_report_unavailable",
  reason: `Strategic Fit report ${reportId} is not available for the current repertoire; run the analysis again to obtain a current report.`,
});

/** Shared host mapping from a projection failure to one structured, code-bearing result. */
export function strategicFitConversationErrorResult(
  error: unknown,
): StrategicFitConversationErrorResult {
  if (error instanceof StrategicFitReportProjectionError) {
    return { error: error.code, reason: error.message };
  }
  throw error;
}

/**
 * Project one bounded conversation view. Identity, revision, and finding staleness are enforced by
 * the shared report projection, so an outdated report or finding identity fails closed.
 */
export function projectStrategicFitConversation(
  report: StrategicFitReport,
  request: StrategicFitConversationRequest,
): StrategicFitConversationProjection {
  if (typeof request.report_id !== "string" || request.report_id.length === 0) {
    throw new StrategicFitReportProjectionError(
      "strategic_fit_missing_report_identity",
      "Conversation projections require the exact Strategic Fit report identity.",
    );
  }
  if (request.view === "summary") {
    projectStrategicFitReport(report, {
      kind: "summary",
      expected_repertoire_revision: request.expected_repertoire_revision,
      expected_report_id: request.report_id,
    });
    return summaryProjection(report);
  }
  if (request.view === "findings") return findingsProjection(report, request);
  return findingProjection(report, request);
}
