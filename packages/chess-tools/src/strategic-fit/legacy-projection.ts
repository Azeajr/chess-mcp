/**
 * Temporary Congruence V1 result compatibility for consumers that still read `incongruencies`.
 *
 * This module deliberately contains no Strategic Fit decision logic. It only renames the frozen
 * V2 classification, translates an already-calculated replacement-priority label to the legacy
 * severity vocabulary, and copies navigation paths. Remove it at the final V2 cutover (Task 12.5).
 */
import type {
  FindingPriorityLabel,
  StrategicFinding,
  StrategicFitClassification,
  StrategicFitReport,
} from "./types.js";

export const LEGACY_CONGRUENCE_PROJECTION_DEFAULT_LIMIT = 10;
export const LEGACY_CONGRUENCE_PROJECTION_MAX_LIMIT = 50;

export const LEGACY_CONGRUENCE_TYPE_BY_CLASSIFICATION = Object.freeze({
  "genuine-inconsistency": "genuine_inconsistency",
  "forced-diversity": "forced_diversity",
  "intentional-diversity": "intentional_diversity",
  "productive-diversity": "productive_diversity",
  "mixed-strategic-profile": "mixed_strategic_profile",
  uncertain: "uncertain",
  "data-quality-issue": "data_quality_issue",
  "transpositional-equivalence": "transpositional_equivalence",
} satisfies Readonly<Record<StrategicFitClassification, string>>);

export type LegacyCongruenceSeverity = "low" | "medium" | "high";

export const LEGACY_CONGRUENCE_SEVERITY_BY_PRIORITY = Object.freeze({
  "review-now": "high",
  "review-later": "medium",
  informational: "low",
  "insufficient-evidence": "low",
} satisfies Readonly<Record<FindingPriorityLabel, LegacyCongruenceSeverity>>);

export interface LegacyCongruenceIncongruency {
  readonly type: string;
  readonly severity: LegacyCongruenceSeverity;
  readonly description: string;
  readonly paths: readonly (readonly string[])[];
  readonly cluster: string;
  /** Stable bridge back to the native V2 finding. */
  readonly source_finding_id: string;
  /** True when the legacy panel's first path is navigation only, not a standalone fix target. */
  readonly multi_path: boolean;
  readonly projection_note: string | null;
}

export interface LegacyCongruenceProjectionMetadata {
  readonly projection: "congruence-v1-incongruencies";
  readonly deprecated: true;
  readonly removal_task: "12.5";
  readonly requested_limit: number;
  readonly applied_limit: number;
  readonly projected_finding_count: number;
  readonly omitted_finding_count: number;
  readonly note: string;
}

export interface LegacyCongruenceProjectionOptions {
  readonly limit?: number;
}

export type StrategicFitLegacyProjection<T extends StrategicFitReport = StrategicFitReport> = T & {
  readonly incongruencies: readonly LegacyCongruenceIncongruency[];
  readonly legacy_projection: LegacyCongruenceProjectionMetadata;
};

function projectionLimit(options: LegacyCongruenceProjectionOptions): {
  requested: number;
  applied: number;
} {
  const requested = options.limit ?? LEGACY_CONGRUENCE_PROJECTION_DEFAULT_LIMIT;
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new Error(`strategic_fit_legacy_projection_invalid_limit: ${String(requested)}`);
  }
  return {
    requested,
    applied: Math.min(requested, LEGACY_CONGRUENCE_PROJECTION_MAX_LIMIT),
  };
}

function copiedPaths(finding: StrategicFinding): readonly (readonly string[])[] {
  return finding.references.source_san_paths.map((path) => [...path]);
}

function projectFinding(finding: StrategicFinding): LegacyCongruenceIncongruency | null {
  const paths = copiedPaths(finding);
  if (paths.length === 0) return null;

  const multiPath = paths.length > 1;
  const projectionNote = multiPath
    ? `Legacy compatibility view: this V2 finding covers ${paths.length} paths. ` +
      "The first path is for navigation only and is not a standalone fix recommendation."
    : null;
  return {
    type: LEGACY_CONGRUENCE_TYPE_BY_CLASSIFICATION[finding.classification],
    severity: LEGACY_CONGRUENCE_SEVERITY_BY_PRIORITY[finding.replacement_priority.label],
    description: [finding.plain_language_category, finding.explanation, projectionNote]
      .filter((value): value is string => Boolean(value))
      .join(": "),
    paths,
    cluster: finding.opening_scope,
    source_finding_id: finding.finding_id,
    multi_path: multiPath,
    projection_note: projectionNote,
  };
}

/**
 * Add the deprecated, bounded V1 `incongruencies` projection without modifying the V2 report.
 * Native `analysis_version`, `preflight`, `summary`, and `findings` values remain authoritative.
 */
export function projectStrategicFitLegacyResult<T extends StrategicFitReport>(
  report: T,
  options: LegacyCongruenceProjectionOptions = {},
): StrategicFitLegacyProjection<T> {
  const limit = projectionLimit(options);
  const projected = report.findings
    .map(projectFinding)
    .filter((finding): finding is LegacyCongruenceIncongruency => finding !== null)
    .slice(0, limit.applied);

  return {
    ...report,
    incongruencies: projected,
    legacy_projection: {
      projection: "congruence-v1-incongruencies",
      deprecated: true,
      removal_task: "12.5",
      requested_limit: limit.requested,
      applied_limit: limit.applied,
      projected_finding_count: projected.length,
      omitted_finding_count: Math.max(0, report.findings.length - projected.length),
      note: "Temporary compatibility projection only; native Strategic Fit fields are authoritative.",
    },
  };
}
