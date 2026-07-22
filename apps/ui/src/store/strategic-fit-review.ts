import { createSignal } from "solid-js";
import {
  type StrategicFinding,
  type StrategicFitDocumentMetadata,
  type StrategicFitPersistedResolution,
  type StrategicFitPersistedResolutionState,
  type StrategicFitSourceProvenance,
} from "@chess-mcp/chess-tools";
import { createArtifact } from "./artifacts";
import { documentId } from "./game";
import { reopenStrategicFitFinding } from "./strategic-fit-finding-resolutions";
import { strategicFitMetadata } from "./strategic-fit-metadata";
import {
  strategicFitLifecycle,
  type StrategicFitCompletedResult,
  type StrategicFitLifecycleStatus,
} from "./strategic-fit";

export const STRATEGIC_FIT_REVIEW_SUMMARY_KIND = "chess-mcp/strategic-fit-review-summary";
export const STRATEGIC_FIT_REVIEW_SUMMARY_VERSION = "1.0.0";

export type StrategicFitReviewMetricId =
  | "coverage"
  | "objective-evaluation"
  | "strategic-workload";

export interface StrategicFitReviewMetricDelta {
  readonly metric_id: StrategicFitReviewMetricId;
  readonly label: string;
  readonly state: "available" | "unavailable";
  readonly before: number | null;
  readonly after: number | null;
  readonly delta: number | null;
  readonly unit: string;
  readonly reason: string | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface StrategicFitReviewResolutionSummary {
  readonly resolution_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly state: StrategicFitPersistedResolutionState;
  readonly note: string | null;
  readonly linked_training_ids: readonly string[];
  readonly linked_staged_edit_ids: readonly string[];
}

export interface StrategicFitReviewCompletionRecord {
  readonly summary_kind: typeof STRATEGIC_FIT_REVIEW_SUMMARY_KIND;
  readonly summary_version: typeof STRATEGIC_FIT_REVIEW_SUMMARY_VERSION;
  readonly summary_id: string;
  readonly history_sequence: number;
  readonly state: "completed" | "reopened";
  readonly document_id: string;
  readonly request_id: string;
  readonly report_id: string;
  readonly repertoire_revision: string;
  readonly analysis_version: string;
  readonly completed_at: string;
  readonly reopened_at: string | null;
  readonly reopened_semantic_finding_id: string | null;
  readonly profile_identity: string;
  readonly settings_identity: string;
  readonly finding_count: number;
  readonly resolution_counts: Readonly<Record<string, number>>;
  readonly edits_made_resolution_ids: readonly string[];
  readonly edits_made_semantic_finding_ids: readonly string[];
  readonly retained_exception_resolution_ids: readonly string[];
  readonly retained_exception_semantic_finding_ids: readonly string[];
  readonly training_item_ids: readonly string[];
  readonly deferred_semantic_finding_ids: readonly string[];
  readonly uncertain_semantic_finding_ids: readonly string[];
  readonly remaining_uncertainty_count: number;
  readonly automatic_resolution_ids: readonly string[];
  readonly resolutions: readonly StrategicFitReviewResolutionSummary[];
  readonly metric_deltas: readonly StrategicFitReviewMetricDelta[];
  readonly source_report_provenance: StrategicFitCompletedResult["result"]["provenance"];
  readonly source_reanalysis: StrategicFitCompletedResult["reanalysis"];
}

export interface StrategicFitReviewExport {
  readonly artifact_kind: typeof STRATEGIC_FIT_REVIEW_SUMMARY_KIND;
  readonly artifact_version: typeof STRATEGIC_FIT_REVIEW_SUMMARY_VERSION;
  readonly summary: StrategicFitReviewCompletionRecord;
}

export type StrategicFitReviewStatus =
  | "unavailable"
  | "incomplete"
  | "ready"
  | "completed"
  | "stale";

export interface StrategicFitReviewSnapshot {
  readonly status: StrategicFitReviewStatus;
  readonly report_id: string | null;
  readonly unreviewed_semantic_finding_ids: readonly string[];
  readonly current_summary: StrategicFitReviewCompletionRecord | null;
  readonly history: readonly StrategicFitReviewCompletionRecord[];
  readonly message: string;
}

export interface StrategicFitReviewActionResult {
  readonly state: "completed" | "reopened" | "blocked" | "exported";
  readonly code: string | null;
  readonly message: string;
  readonly summary: StrategicFitReviewCompletionRecord | null;
  readonly artifact_id: string | null;
}

export interface StrategicFitReviewBoundary {
  currentDocumentId(): string;
  currentLifecycle(): {
    readonly status: StrategicFitLifecycleStatus;
    readonly current_result: StrategicFitCompletedResult | null;
  };
  currentMetadata(): StrategicFitDocumentMetadata;
  reopen(input: {
    readonly report_id: string;
    readonly finding_id: string;
    readonly semantic_finding_id: string;
  }): { readonly state: string; readonly code: string | null; readonly message: string };
  createArtifact(format: "json", content: string, name: string): unknown;
  now(): string;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(",")}}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function artifactId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const id = (value as { artifact_id?: unknown }).artifact_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function completeFindings(result: StrategicFitCompletedResult): readonly StrategicFinding[] | null {
  const findings = result.findings_snapshot;
  if (
    findings === undefined ||
    findings.length !== result.result.finding_page.total_count ||
    new Set(findings.map((finding) => finding.semantic_finding_id)).size !== findings.length
  ) return null;
  return findings;
}

function activeResolutions(metadata: StrategicFitDocumentMetadata): StrategicFitPersistedResolution[] {
  return metadata.resolutions
    .filter((resolution): resolution is StrategicFitPersistedResolution & { semantic_finding_id: string } =>
      resolution.record_state === "active" && resolution.semantic_finding_id !== null
    )
    .sort((left, right) => compareStrings(left.resolution_id, right.resolution_id));
}

function currentResolutionState(
  finding: StrategicFinding,
  bySemanticId: ReadonlyMap<string, StrategicFitPersistedResolution>,
): StrategicFitPersistedResolutionState | "unresolved" {
  return bySemanticId.get(finding.semantic_finding_id)?.state ?? finding.resolution_state;
}

interface MetricSnapshot {
  readonly value: number | null;
  readonly unit: string;
  readonly reason: string | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

type ReviewMetrics = Readonly<Record<StrategicFitReviewMetricId, MetricSnapshot>>;

function reportMetrics(result: StrategicFitCompletedResult): ReviewMetrics {
  const summary = result.result.summary;
  const coverage = summary.metrics.familiarity_adjusted_coverage;
  const objective = summary.metrics.repertoire_regret;
  const reportSources = result.result.provenance.sources;
  return {
    coverage: {
      value: typeof coverage.value === "number" ? coverage.value : null,
      unit: coverage.unit,
      reason: coverage.reason,
      provenance: coverage.provenance,
    },
    "objective-evaluation": {
      value: typeof objective.value === "number" ? objective.value : null,
      unit: objective.unit,
      reason: objective.reason,
      provenance: objective.provenance,
    },
    "strategic-workload": {
      value: typeof summary.expected_concept_burden === "number"
        ? summary.expected_concept_burden
        : null,
      unit: "expected-concept-burden",
      reason: summary.expected_concept_burden === null
        ? "The report did not provide an expected concept burden."
        : null,
      provenance: reportSources,
    },
  };
}

const METRIC_LABELS: Readonly<Record<StrategicFitReviewMetricId, string>> = {
  coverage: "Familiarity-adjusted coverage",
  "objective-evaluation": "Repertoire regret",
  "strategic-workload": "Expected concept burden",
};

function metricDeltas(before: ReviewMetrics, after: ReviewMetrics): StrategicFitReviewMetricDelta[] {
  return (Object.keys(METRIC_LABELS) as StrategicFitReviewMetricId[]).map((metricId) => {
    const previous = before[metricId];
    const current = after[metricId];
    const available = previous.value !== null && current.value !== null;
    return {
      metric_id: metricId,
      label: METRIC_LABELS[metricId],
      state: available ? "available" : "unavailable",
      before: previous.value,
      after: current.value,
      delta: available ? current.value! - previous.value! : null,
      unit: current.unit,
      reason: available ? null : current.reason ?? previous.reason ?? "Comparable metric evidence is unavailable.",
      provenance: current.provenance,
    };
  });
}

function blocked(code: string, message: string): StrategicFitReviewActionResult {
  return { state: "blocked", code, message, summary: null, artifact_id: null };
}

export function createStrategicFitReviewState(boundary: StrategicFitReviewBoundary) {
  const [snapshot, setSnapshot] = createSignal<StrategicFitReviewSnapshot>({
    status: "unavailable",
    report_id: null,
    unreviewed_semantic_finding_ids: [],
    current_summary: null,
    history: [],
    message: "Complete a current Strategic Fit report before finishing the review.",
  });
  const historyByDocument = new Map<string, StrategicFitReviewCompletionRecord[]>();
  const baselineByDocument = new Map<string, ReviewMetrics>();

  const synchronize = (): StrategicFitReviewSnapshot => {
    const documentId = boundary.currentDocumentId();
    const history = historyByDocument.get(documentId) ?? [];
    const lifecycle = boundary.currentLifecycle();
    const current = lifecycle.current_result;
    if (lifecycle.status === "stale" || current === null && history.length > 0) {
      const next: StrategicFitReviewSnapshot = {
        status: "stale",
        report_id: null,
        unreviewed_semantic_finding_ids: [],
        current_summary: null,
        history,
        message: "The saved review history is not current for the active report inputs.",
      };
      setSnapshot(next);
      return next;
    }
    if (lifecycle.status !== "completed" || current === null) {
      const next: StrategicFitReviewSnapshot = {
        status: "unavailable",
        report_id: null,
        unreviewed_semantic_finding_ids: [],
        current_summary: null,
        history,
        message: "Complete a current Strategic Fit report before finishing the review.",
      };
      setSnapshot(next);
      return next;
    }
    baselineByDocument.set(documentId, baselineByDocument.get(documentId) ?? reportMetrics(current));
    const findings = completeFindings(current);
    if (findings === null) {
      const next: StrategicFitReviewSnapshot = {
        status: "unavailable",
        report_id: current.report_id,
        unreviewed_semantic_finding_ids: [],
        current_summary: null,
        history,
        message: "Review completion is unavailable because the complete canonical finding set is missing.",
      };
      setSnapshot(next);
      return next;
    }
    const resolutions = activeResolutions(boundary.currentMetadata());
    const bySemanticId = new Map(resolutions.map((resolution) => [resolution.semantic_finding_id!, resolution]));
    const unreviewed = findings
      .filter((finding) => currentResolutionState(finding, bySemanticId) === "unresolved")
      .map((finding) => finding.semantic_finding_id)
      .sort(compareStrings);
    const reopenedCurrentRequest = [...history].reverse().find((entry) =>
      entry.state === "reopened" && entry.request_id === current.request_id
    )?.reopened_semantic_finding_id;
    if (reopenedCurrentRequest !== null && reopenedCurrentRequest !== undefined) {
      unreviewed.push(reopenedCurrentRequest);
      unreviewed.sort(compareStrings);
    }
    const uniqueUnreviewed = [...new Set(unreviewed)];
    const currentSummary = [...history].reverse().find((entry) =>
      entry.state === "completed" && entry.request_id === current.request_id
    ) ?? null;
    const next: StrategicFitReviewSnapshot = {
      status: uniqueUnreviewed.length > 0 ? "incomplete" : currentSummary === null ? "ready" : "completed",
      report_id: current.report_id,
      unreviewed_semantic_finding_ids: uniqueUnreviewed,
      current_summary: currentSummary,
      history,
      message: uniqueUnreviewed.length > 0
        ? `${uniqueUnreviewed.length} current finding(s) still require a terminal review decision.`
        : currentSummary === null
          ? "Every current finding has a terminal review state. The review can now be completed."
          : "This revision-bound review is complete.",
    };
    setSnapshot(next);
    return next;
  };

  const complete = (): StrategicFitReviewActionResult => {
    const availability = synchronize();
    if (availability.status !== "ready") {
      return blocked(
        availability.status === "incomplete"
          ? "strategic_fit_review_incomplete"
          : "strategic_fit_review_not_current",
        availability.message,
      );
    }
    const documentId = boundary.currentDocumentId();
    const current = boundary.currentLifecycle().current_result!;
    const findings = completeFindings(current)!;
    const metadata = boundary.currentMetadata();
    const resolutions = activeResolutions(metadata);
    const bySemanticId = new Map(resolutions.map((resolution) => [resolution.semantic_finding_id!, resolution]));
    const counts: Record<string, number> = {};
    for (const finding of findings) {
      const state = currentResolutionState(finding, bySemanticId);
      counts[state] = (counts[state] ?? 0) + 1;
    }
    const currentSemanticIds = new Set(findings.map((finding) => finding.semantic_finding_id));
    const currentResolutions = resolutions.filter((resolution) =>
      currentSemanticIds.has(resolution.semantic_finding_id!)
    );
    const resolutionSummaries = currentResolutions.map((resolution) => ({
      resolution_id: resolution.resolution_id,
      finding_id: resolution.finding_id,
      semantic_finding_id: resolution.semantic_finding_id!,
      state: resolution.state,
      note: resolution.note,
      linked_training_ids: [...resolution.linked_training_ids],
      linked_staged_edit_ids: [...resolution.linked_staged_edit_ids],
    }));
    const stateBySemanticId = new Map(findings.map((finding) =>
      [finding.semantic_finding_id, currentResolutionState(finding, bySemanticId)]
    ));
    const deferred = [...stateBySemanticId.entries()]
      .filter(([, state]) => state === "defer")
      .map(([semanticId]) => semanticId)
      .sort(compareStrings);
    const uncertain = findings
      .filter((finding) => {
        const state = stateBySemanticId.get(finding.semantic_finding_id);
        return state === "insufficient-evidence" || state === "invalid-comparison" ||
          finding.classification === "uncertain" || finding.classification === "data-quality-issue";
      })
      .map((finding) => finding.semantic_finding_id)
      .sort(compareStrings);
    const history = historyByDocument.get(documentId) ?? [];
    const completedAt = boundary.now();
    const identity = {
      document_id: documentId,
      request_id: current.request_id,
      report_id: current.report_id,
      repertoire_revision: current.result.repertoire_revision,
      completed_at: completedAt,
      resolution_ids: resolutionSummaries.map((resolution) => resolution.resolution_id),
    };
    const record: StrategicFitReviewCompletionRecord = {
      summary_kind: STRATEGIC_FIT_REVIEW_SUMMARY_KIND,
      summary_version: STRATEGIC_FIT_REVIEW_SUMMARY_VERSION,
      summary_id: `strategic-fit-review:${stableHash(stableSerialize(identity))}`,
      history_sequence: history.length + 1,
      state: "completed",
      document_id: documentId,
      request_id: current.request_id,
      report_id: current.report_id,
      repertoire_revision: current.result.repertoire_revision,
      analysis_version: current.result.analysis_version,
      completed_at: completedAt,
      reopened_at: null,
      reopened_semantic_finding_id: null,
      profile_identity: current.request_snapshot.profile_identity,
      settings_identity: current.request_snapshot.settings_identity,
      finding_count: findings.length,
      resolution_counts: Object.fromEntries(Object.entries(counts).sort(([left], [right]) =>
        compareStrings(left, right)
      )),
      edits_made_resolution_ids: currentResolutions
        .filter((resolution) => resolution.state === "change-repertoire")
        .map((resolution) => resolution.resolution_id),
      edits_made_semantic_finding_ids: [...stateBySemanticId.entries()]
        .filter(([, state]) => state === "change-repertoire")
        .map(([semanticId]) => semanticId)
        .sort(compareStrings),
      retained_exception_resolution_ids: currentResolutions
        .filter((resolution) => [
          "keep-intentionally", "exclude-from-analysis", "reclassify-cohort",
        ].includes(resolution.state))
        .map((resolution) => resolution.resolution_id),
      retained_exception_semantic_finding_ids: [...stateBySemanticId.entries()]
        .filter(([, state]) => [
          "keep-intentionally", "exclude-from-analysis", "reclassify-cohort",
        ].includes(state))
        .map(([semanticId]) => semanticId)
        .sort(compareStrings),
      training_item_ids: [...new Set(currentResolutions.flatMap((resolution) =>
        resolution.linked_training_ids
      ))].sort(compareStrings),
      deferred_semantic_finding_ids: deferred,
      uncertain_semantic_finding_ids: uncertain,
      remaining_uncertainty_count: new Set([...deferred, ...uncertain]).size,
      automatic_resolution_ids: resolutions
        .filter((resolution) => resolution.state === "automatically-resolved-by-another-edit")
        .map((resolution) => resolution.resolution_id),
      resolutions: resolutionSummaries,
      metric_deltas: metricDeltas(
        baselineByDocument.get(documentId) ?? reportMetrics(current),
        reportMetrics(current),
      ),
      source_report_provenance: current.result.provenance,
      source_reanalysis: current.reanalysis,
    };
    historyByDocument.set(documentId, [...history, record]);
    synchronize();
    return {
      state: "completed",
      code: null,
      message: "Review completed for the current report revision.",
      summary: record,
      artifact_id: null,
    };
  };

  const reopen = (
    summaryId: string,
    semanticFindingId: string,
  ): StrategicFitReviewActionResult => {
    const current = synchronize();
    const summary = current.current_summary;
    const lifecycle = boundary.currentLifecycle().current_result;
    if (summary === null || summary.summary_id !== summaryId || lifecycle === null) {
      return blocked("strategic_fit_review_summary_stale", "Only the current completed review can be reopened.");
    }
    const resolution = summary.resolutions.find((entry) =>
      entry.semantic_finding_id === semanticFindingId
    );
    const finding = completeFindings(lifecycle)?.find((entry) =>
      entry.semantic_finding_id === semanticFindingId
    );
    if (resolution === undefined || finding === undefined) {
      return blocked("strategic_fit_review_resolution_missing", "That current review resolution cannot be reopened.");
    }
    const reopened = boundary.reopen({
      report_id: lifecycle.report_id,
      finding_id: finding.finding_id,
      semantic_finding_id: semanticFindingId,
    });
    if (reopened.state !== "reopened") {
      return blocked(reopened.code ?? "strategic_fit_review_reopen_failed", reopened.message);
    }
    const documentId = boundary.currentDocumentId();
    const history = historyByDocument.get(documentId) ?? [];
    const reopenedSummary: StrategicFitReviewCompletionRecord = {
      ...summary,
      state: "reopened",
      reopened_at: boundary.now(),
      reopened_semantic_finding_id: semanticFindingId,
    };
    historyByDocument.set(documentId, history.map((entry) =>
      entry.summary_id === summary.summary_id ? reopenedSummary : entry
    ));
    synchronize();
    return {
      state: "reopened",
      code: null,
      message: "Review reopened. A fresh affected-cohort report is required before completion.",
      summary: reopenedSummary,
      artifact_id: null,
    };
  };

  const exportSummary = (summaryId: string): StrategicFitReviewActionResult => {
    const documentHistory = historyByDocument.get(boundary.currentDocumentId()) ?? [];
    const summary = documentHistory.find((entry) => entry.summary_id === summaryId);
    if (summary === undefined) {
      return blocked("strategic_fit_review_summary_missing", "The requested review summary is unavailable.");
    }
    const artifact: StrategicFitReviewExport = {
      artifact_kind: STRATEGIC_FIT_REVIEW_SUMMARY_KIND,
      artifact_version: STRATEGIC_FIT_REVIEW_SUMMARY_VERSION,
      summary,
    };
    const created = boundary.createArtifact(
      "json",
      `${JSON.stringify(artifact, null, 2)}\n`,
      `${summary.summary_id.replace(/[^a-z0-9-]+/gi, "-")}.json`,
    );
    return {
      state: "exported",
      code: null,
      message: "Portable review summary created.",
      summary,
      artifact_id: artifactId(created),
    };
  };

  return { snapshot, synchronize, complete, reopen, exportSummary };
}

const browserReview = createStrategicFitReviewState({
  currentDocumentId: documentId,
  currentLifecycle: () => {
    const lifecycle = strategicFitLifecycle();
    return { status: lifecycle.status, current_result: lifecycle.current_result };
  },
  currentMetadata: strategicFitMetadata,
  reopen: reopenStrategicFitFinding,
  createArtifact,
  now: () => new Date().toISOString(),
});

export const strategicFitReview = () => browserReview.snapshot();
export const synchronizeStrategicFitReview = () => browserReview.synchronize();
export const completeStrategicFitReview = () => browserReview.complete();
export const reopenCompletedStrategicFitReview = (
  summaryId: string,
  semanticFindingId: string,
) => browserReview.reopen(summaryId, semanticFindingId);
export const exportStrategicFitReviewSummary = (summaryId: string) =>
  browserReview.exportSummary(summaryId);
