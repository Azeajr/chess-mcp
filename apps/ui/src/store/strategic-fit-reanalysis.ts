import {
  GameTree,
  buildRepertoireGraph,
  type StrategicFinding,
  type StrategicFitDocumentMetadata,
  type StrategicFitPersistedResolution,
  type StrategicFitReport,
} from "@chess-mcp/chess-tools";
import type { StrategicFitRequestSnapshot } from "./strategic-fit";

export type StrategicFitReanalysisTrigger =
  | "document-change"
  | "profile-change"
  | "resolution-change"
  | "cohort-override"
  | "unknown-change";

export interface StrategicFitAffectedCohortScope {
  readonly kind: "affected-cohorts";
  readonly cohort_ids: readonly string[];
  readonly reason: string;
}

export interface StrategicFitFullScanScope {
  readonly kind: "full-scan";
  readonly cohort_ids: readonly string[];
  readonly reason: string;
}

export type StrategicFitReanalysisScope =
  | StrategicFitAffectedCohortScope
  | StrategicFitFullScanScope;

export interface StrategicFitReanalysisRequest {
  readonly trigger: StrategicFitReanalysisTrigger;
  readonly scope: StrategicFitReanalysisScope;
}

export interface StrategicFitReanalysisSummary {
  readonly trigger: StrategicFitReanalysisTrigger;
  readonly scope: StrategicFitReanalysisScope;
  readonly previous_report_id: string;
  readonly report_id: string;
  readonly resolving_revision: string;
  readonly disappeared_semantic_finding_ids: readonly string[];
  readonly auto_resolved_semantic_finding_ids: readonly string[];
  readonly reappeared_semantic_finding_ids: readonly string[];
  readonly changed_evidence_semantic_finding_ids: readonly string[];
  readonly new_semantic_finding_ids: readonly string[];
  readonly preserved_resolution_ids: readonly string[];
}

export interface StrategicFitReconciliationActions {
  readonly automatically_resolve: readonly StrategicFinding[];
  readonly reopen_semantic_finding_ids: readonly string[];
}

export interface StrategicFitReconciliationResult {
  readonly summary: StrategicFitReanalysisSummary;
  readonly actions: StrategicFitReconciliationActions;
  readonly findings: readonly StrategicFinding[];
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortedUnique = (values: readonly string[]): string[] =>
  [...new Set(values)].sort(compareStrings);

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(",")}}`;
}

function evidenceIdentity(finding: StrategicFinding): string {
  return stableSerialize({
    classification: finding.classification,
    plain_language_category: finding.plain_language_category,
    opening_scope: finding.opening_scope,
    affected_line_summary: finding.affected_line_summary,
    explanation: finding.explanation,
    references: finding.references,
    weighted_baseline_percentage: finding.weighted_baseline_percentage,
    expected_frequency: finding.expected_frequency,
    learning_burden: finding.learning_burden,
    confidence: finding.confidence,
    difference: finding.difference,
    objective_quality: finding.objective_quality,
    replacement_priority: finding.replacement_priority,
    training_priority: finding.training_priority,
    evidence: finding.evidence,
    provisional: finding.provisional,
  });
}

function allCohortIds(report: StrategicFitReport): string[] {
  return report.cohorts.map((cohort) => cohort.cohort_id).sort(compareStrings);
}

export function affectedCohortReanalysisRequest(
  trigger: Extract<StrategicFitReanalysisTrigger, "resolution-change" | "cohort-override">,
  cohortIds: readonly string[],
  reason: string,
): StrategicFitReanalysisRequest {
  const ids = sortedUnique(cohortIds.filter(Boolean));
  return ids.length === 0
    ? {
        trigger,
        scope: {
          kind: "full-scan",
          cohort_ids: [],
          reason: "Affected cohort identity was unavailable, so reconciliation requires a full scan.",
        },
      }
    : { trigger, scope: { kind: "affected-cohorts", cohort_ids: ids, reason } };
}

export function planStrategicFitReanalysis(
  previousReport: StrategicFitReport,
  previousSnapshot: StrategicFitRequestSnapshot,
  currentSnapshot: StrategicFitRequestSnapshot,
  trigger: StrategicFitReanalysisTrigger,
): StrategicFitReanalysisRequest {
  if (trigger === "profile-change") {
    return {
      trigger,
      scope: {
        kind: "affected-cohorts",
        cohort_ids: allCohortIds(previousReport),
        reason: "The target profile can change every cohort baseline and finding priority.",
      },
    };
  }
  if (
    previousSnapshot.document_id !== currentSnapshot.document_id ||
    previousSnapshot.repertoire_color !== currentSnapshot.repertoire_color
  ) {
    return {
      trigger,
      scope: {
        kind: "full-scan",
        cohort_ids: [],
        reason: "Document identity or repertoire color changed, so affected cohort scope is unknown.",
      },
    };
  }
  if (trigger !== "document-change") {
    return {
      trigger,
      scope: {
        kind: "full-scan",
        cohort_ids: [],
        reason: "The change did not provide canonical affected cohort identities.",
      },
    };
  }

  try {
    const previousGraph = buildRepertoireGraph(
      GameTree.fromPgn(previousSnapshot.repertoire_pgn),
      previousSnapshot.repertoire_color,
    );
    const currentGraph = buildRepertoireGraph(
      GameTree.fromPgn(currentSnapshot.repertoire_pgn),
      currentSnapshot.repertoire_color,
    );
    const previousRoutes = new Set(previousGraph.routes.map((route) => route.route_id));
    const currentRoutes = new Set(currentGraph.routes.map((route) => route.route_id));
    const removed = [...previousRoutes].filter((routeId) => !currentRoutes.has(routeId));
    const added = [...currentRoutes].filter((routeId) => !previousRoutes.has(routeId));
    if (removed.length === 0 && added.length > 0) {
      return {
        trigger,
        scope: {
          kind: "full-scan",
          cohort_ids: [],
          reason: "New routes have no prior cohort identity, so affected scope requires a full scan.",
        },
      };
    }
    const removedSet = new Set(removed);
    const affected = previousReport.cohorts
      .filter((cohort) => cohort.route_ids.some((routeId) => removedSet.has(routeId)))
      .map((cohort) => cohort.cohort_id);
    if (removed.length > 0 && affected.length === 0) {
      return {
        trigger,
        scope: {
          kind: "full-scan",
          cohort_ids: [],
          reason: "Changed routes could not be mapped to a prior cohort, so reconciliation requires a full scan.",
        },
      };
    }
    return {
      trigger,
      scope: {
        kind: "affected-cohorts",
        cohort_ids: sortedUnique(affected),
        reason: removed.length === 0
          ? "The repertoire graph is semantically unchanged; no prior cohort requires resolution reconciliation."
          : "Changed semantic routes map to these prior cohorts.",
      },
    };
  } catch {
    return {
      trigger,
      scope: {
        kind: "full-scan",
        cohort_ids: [],
        reason: "Canonical graph comparison was unavailable, so reconciliation requires a full scan.",
      },
    };
  }
}

function activeResolutionBySemanticId(
  metadata: StrategicFitDocumentMetadata,
): Map<string, StrategicFitPersistedResolution> {
  return new Map(metadata.resolutions
    .filter((resolution) =>
      resolution.record_state === "active" && resolution.semantic_finding_id !== null
    )
    .map((resolution) => [resolution.semantic_finding_id!, resolution]));
}

function findingInScope(
  previous: StrategicFinding | undefined,
  current: StrategicFinding | undefined,
  scope: StrategicFitReanalysisScope,
): boolean {
  if (scope.kind === "full-scan") return true;
  const cohortIds = new Set(scope.cohort_ids);
  return previous !== undefined && cohortIds.has(previous.evidence.cohort_id) ||
    current !== undefined && cohortIds.has(current.evidence.cohort_id);
}

export function reconcileStrategicFitReanalysis(
  previousReportId: string,
  previousFindings: readonly StrategicFinding[],
  nextReport: StrategicFitReport,
  nextFindings: readonly StrategicFinding[],
  metadata: StrategicFitDocumentMetadata,
  request: StrategicFitReanalysisRequest,
): StrategicFitReconciliationResult {
  const previousById = new Map(previousFindings.map((finding) => [finding.semantic_finding_id, finding]));
  const nextById = new Map(nextFindings.map((finding) => [finding.semantic_finding_id, finding]));
  const activeResolutions = activeResolutionBySemanticId(metadata);
  const allIds = sortedUnique([...previousById.keys(), ...nextById.keys()]);
  const disappeared: string[] = [];
  const autoResolved: StrategicFinding[] = [];
  const reappeared: string[] = [];
  const changed: string[] = [];
  const created: string[] = [];

  for (const semanticId of allIds) {
    const previous = previousById.get(semanticId);
    const current = nextById.get(semanticId);
    if (!findingInScope(previous, current, request.scope)) continue;
    const resolution = activeResolutions.get(semanticId);
    if (previous !== undefined && current === undefined) {
      disappeared.push(semanticId);
      if (resolution === undefined) autoResolved.push(previous);
      continue;
    }
    if (previous === undefined && current !== undefined) {
      created.push(semanticId);
      if (resolution?.state === "automatically-resolved-by-another-edit") reappeared.push(semanticId);
      continue;
    }
    if (previous !== undefined && current !== undefined && evidenceIdentity(previous) !== evidenceIdentity(current)) {
      changed.push(semanticId);
    }
  }

  const reopenIds = sortedUnique([...reappeared, ...changed.filter((id) => activeResolutions.has(id))]);
  const autoIds = autoResolved.map((finding) => finding.semantic_finding_id).sort(compareStrings);
  const preservedResolutionIds = [...activeResolutions.entries()]
    .filter(([semanticId]) => !reopenIds.includes(semanticId) && !autoIds.includes(semanticId))
    .map(([, resolution]) => resolution.resolution_id)
    .sort(compareStrings);
  const reopenSet = new Set(reopenIds);
  const findings = nextFindings.map((finding) => reopenSet.has(finding.semantic_finding_id)
    ? { ...finding, resolution_state: "unresolved" as const }
    : finding);
  return {
    summary: {
      trigger: request.trigger,
      scope: request.scope,
      previous_report_id: previousReportId,
      report_id: nextReport.report_id,
      resolving_revision: nextReport.repertoire_revision,
      disappeared_semantic_finding_ids: disappeared.sort(compareStrings),
      auto_resolved_semantic_finding_ids: autoIds,
      reappeared_semantic_finding_ids: reappeared.sort(compareStrings),
      changed_evidence_semantic_finding_ids: changed.sort(compareStrings),
      new_semantic_finding_ids: created.sort(compareStrings),
      preserved_resolution_ids: preservedResolutionIds,
    },
    actions: {
      automatically_resolve: autoResolved.sort((left, right) =>
        compareStrings(left.semantic_finding_id, right.semantic_finding_id)
      ),
      reopen_semantic_finding_ids: reopenIds,
    },
    findings,
  };
}
