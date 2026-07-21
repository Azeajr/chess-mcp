import { createSignal } from "solid-js";
import {
  STRATEGIC_FIT_MAX_PAGE_SIZE,
  buildRepertoireGraph,
  type RepertoireGraph,
  type StrategicCohort,
  type StrategicCohortOverride,
  type StrategicFinding,
  type StrategicFitAnalysisResult,
  type StrategicFitDocumentMetadata,
} from "@chess-mcp/chess-tools";
import type { BrowserCommandExecutionOptions } from "../application/browser-commands/types";
import { executeDirectBrowserCommand } from "./commands";
import { strategicFitFindingQueue } from "./strategic-fit-finding-queue";
import { strategicFitMetadata } from "./strategic-fit-metadata";
import {
  analyzeStrategicFit,
  strategicFitLifecycle,
  type StrategicFitCompletedResult,
  type StrategicFitRequestSnapshot,
} from "./strategic-fit";
import {
  removeStrategicFitCohortLabel,
  removeStrategicFitCohortOverride,
  upsertStrategicFitCohortLabel,
  upsertStrategicFitCohortOverride,
  type StrategicFitCohortLabelMutationInput,
  type StrategicFitCohortOverrideMutationInput,
  type StrategicFitSettingsMutationResult,
} from "./strategic-fit-resolutions";
import { actions, color, currentTree, documentId, version } from "./game";
import { strategicFitProfile, strategicFitProfileIdentity } from "./strategic-fit-profile";
import { strategicFitAnalysisSettingsIdentity } from "./strategic-fit-resolutions";

export type StrategicFitCohortAdjustmentDraft =
  | { readonly kind: "merge"; readonly route_ids: readonly string[]; readonly reason?: string | null }
  | { readonly kind: "split"; readonly route_ids: readonly string[]; readonly reason?: string | null }
  | {
      readonly kind: "exclude";
      readonly route_ids?: readonly string[];
      readonly decision_ids?: readonly string[];
      readonly reason?: string | null;
    }
  | { readonly kind: "rename"; readonly cohort_id: string; readonly display_name: string }
  | {
      readonly kind: "reset";
      readonly target: "override" | "rename";
      readonly target_id: string;
    };

export type StrategicFitCohortAdjustmentStatus =
  | "idle"
  | "previewing"
  | "ready"
  | "applying"
  | "applied"
  | "blocked";

export interface StrategicFitCohortAdjustmentImpactList {
  readonly state: "available" | "unavailable";
  readonly ids: readonly string[];
  readonly count: number | null;
  readonly reason: string | null;
}

export interface StrategicFitCohortAdjustmentPreview {
  readonly preview_id: string;
  readonly report_id: string;
  readonly draft: StrategicFitCohortAdjustmentDraft;
  readonly override_id: string | null;
  readonly label_id: string | null;
  readonly current_cohorts: StrategicFitCohortAdjustmentImpactList;
  readonly proposed_cohorts: StrategicFitCohortAdjustmentImpactList;
  readonly affected_routes: StrategicFitCohortAdjustmentImpactList;
  readonly current_baselines: StrategicFitCohortAdjustmentImpactList;
  readonly proposed_baselines: StrategicFitCohortAdjustmentImpactList;
  readonly current_findings: StrategicFitCohortAdjustmentImpactList;
  readonly proposed_findings: StrategicFitCohortAdjustmentImpactList;
  readonly summary: string;
  readonly binding: StrategicFitCohortAdjustmentBinding;
}

export interface StrategicFitCohortAdjustmentBinding {
  readonly request_snapshot: StrategicFitRequestSnapshot;
  readonly metadata_identity: string;
}

export interface StrategicFitCohortAdjustmentSnapshot {
  readonly report_id: string | null;
  readonly status: StrategicFitCohortAdjustmentStatus;
  readonly code: string | null;
  readonly message: string | null;
  readonly preview: StrategicFitCohortAdjustmentPreview | null;
}

export interface StrategicFitCohortAdjustmentBoundary {
  currentReport(): StrategicFitCompletedResult | null;
  currentFindings(reportId: string): {
    readonly ready: boolean;
    readonly findings: readonly StrategicFinding[];
    readonly total_count: number;
  };
  currentSnapshot(): StrategicFitRequestSnapshot;
  currentMetadata(): StrategicFitDocumentMetadata;
  currentGraph(): RepertoireGraph;
  execute(
    command: "analyze_repertoire_congruence",
    args: Record<string, unknown>,
    options: BrowserCommandExecutionOptions,
  ): Promise<unknown>;
  upsertOverride(input: StrategicFitCohortOverrideMutationInput): StrategicFitSettingsMutationResult;
  removeOverride(overrideId: string): StrategicFitSettingsMutationResult;
  upsertLabel(input: StrategicFitCohortLabelMutationInput): StrategicFitSettingsMutationResult;
  removeLabel(labelId: string): StrategicFitSettingsMutationResult;
  analyze(): Promise<void>;
}

export interface StrategicFitCohortAdjustmentState {
  snapshot(): StrategicFitCohortAdjustmentSnapshot;
  synchronize(reportId: string | null): void;
  preview(
    reportId: string,
    draft: StrategicFitCohortAdjustmentDraft,
  ): Promise<StrategicFitCohortAdjustmentPreview | null>;
  confirm(previewId: string): Promise<boolean>;
  cancel(): void;
}

const emptySnapshot = (reportId: string | null = null): StrategicFitCohortAdjustmentSnapshot => ({
  report_id: reportId,
  status: "idle",
  code: null,
  message: null,
  preview: null,
});

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortedUnique = (values: readonly string[]): string[] =>
  [...new Set(values)].sort(compareStrings);

function stableSerialize(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
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

function sameSnapshot(left: StrategicFitRequestSnapshot, right: StrategicFitRequestSnapshot): boolean {
  return left.document_id === right.document_id &&
    left.repertoire_revision === right.repertoire_revision &&
    left.repertoire_pgn === right.repertoire_pgn &&
    left.repertoire_color === right.repertoire_color &&
    left.profile_identity === right.profile_identity &&
    left.settings_identity === right.settings_identity;
}

function available(ids: readonly string[]): StrategicFitCohortAdjustmentImpactList {
  const normalized = sortedUnique(ids);
  return { state: "available", ids: normalized, count: normalized.length, reason: null };
}

function unavailable(reason: string): StrategicFitCohortAdjustmentImpactList {
  return { state: "unavailable", ids: [], count: null, reason };
}

function allCohortRoutes(cohort: StrategicCohort): string[] {
  return sortedUnique([...cohort.route_ids, ...cohort.excluded_route_ids]);
}

function cohortSignature(cohort: StrategicCohort): string {
  return stableSerialize({
    cohort_id: cohort.cohort_id,
    state: cohort.state,
    route_ids: cohort.route_ids,
    excluded_route_ids: cohort.excluded_route_ids,
    route_weights: cohort.route_weights,
    modes: cohort.modes.map((mode) => ({
      mode_id: mode.mode_id,
      representative_route_id: mode.representative_route_id,
      supporting_route_ids: mode.supporting_route_ids,
    })),
  });
}

function routeCohortSignatures(cohorts: readonly StrategicCohort[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const cohort of cohorts) {
    const signature = cohortSignature(cohort);
    for (const routeId of allCohortRoutes(cohort)) result.set(routeId, signature);
  }
  return result;
}

function impactedFindings(
  findings: readonly StrategicFinding[],
  cohortIds: ReadonlySet<string>,
  routeIds: ReadonlySet<string>,
): string[] {
  return findings.filter((finding) =>
    cohortIds.has(finding.evidence.cohort_id) ||
    finding.references.route_ids.some((routeId) => routeIds.has(routeId))
  ).map((finding) => finding.finding_id).sort(compareStrings);
}

function impactFromReports(
  current: StrategicFitAnalysisResult,
  currentFindings: readonly StrategicFinding[],
  proposed: StrategicFitAnalysisResult,
): Omit<StrategicFitCohortAdjustmentPreview,
  "preview_id" | "report_id" | "draft" | "override_id" | "label_id" | "summary" | "binding"> {
  const currentByRoute = routeCohortSignatures(current.cohorts);
  const proposedByRoute = routeCohortSignatures(proposed.cohorts);
  const routeIds = sortedUnique([...currentByRoute.keys(), ...proposedByRoute.keys()]);
  const affectedRouteIds = routeIds.filter((routeId) =>
    currentByRoute.get(routeId) !== proposedByRoute.get(routeId)
  );
  const affectedRouteSet = new Set(affectedRouteIds);
  const currentCohorts = current.cohorts.filter((cohort) =>
    allCohortRoutes(cohort).some((routeId) => affectedRouteSet.has(routeId))
  );
  const proposedCohorts = proposed.cohorts.filter((cohort) =>
    allCohortRoutes(cohort).some((routeId) => affectedRouteSet.has(routeId))
  );
  const currentCohortIds = new Set(currentCohorts.map((cohort) => cohort.cohort_id));
  const proposedCohortIds = new Set(proposedCohorts.map((cohort) => cohort.cohort_id));
  const currentBaselines = sortedUnique(currentCohorts.flatMap((cohort) =>
    cohort.modes.map((mode) => mode.representative_route_id)
  ));
  const proposedBaselines = sortedUnique(proposedCohorts.flatMap((cohort) =>
    cohort.modes.map((mode) => mode.representative_route_id)
  ));
  return {
    current_cohorts: available([...currentCohortIds]),
    proposed_cohorts: available([...proposedCohortIds]),
    affected_routes: available(affectedRouteIds),
    current_baselines: currentBaselines.length === 0
      ? unavailable("The current affected cohorts have no supported baseline mode.")
      : available(currentBaselines),
    proposed_baselines: proposedBaselines.length === 0
      ? unavailable("The proposed affected cohorts have no supported baseline mode.")
      : available(proposedBaselines),
    current_findings: available(impactedFindings(
      currentFindings,
      currentCohortIds,
      affectedRouteSet,
    )),
    proposed_findings: available(impactedFindings(
      proposed.findings,
      proposedCohortIds,
      affectedRouteSet,
    )),
  };
}

function renameImpact(
  report: StrategicFitAnalysisResult,
  findings: readonly StrategicFinding[],
  cohortId: string,
): ReturnType<typeof impactFromReports> {
  const cohort = report.cohorts.find((candidate) => candidate.cohort_id === cohortId);
  if (cohort === undefined) throw new Error(`strategic_fit_cohort_adjustment_unknown_cohort: ${cohortId}`);
  const routes = allCohortRoutes(cohort);
  const baselines = cohort.modes.map((mode) => mode.representative_route_id);
  const affectedFindings = impactedFindings(findings, new Set([cohortId]), new Set(routes));
  return {
    current_cohorts: available([cohortId]),
    proposed_cohorts: available([cohortId]),
    affected_routes: available(routes),
    current_baselines: baselines.length === 0
      ? unavailable("This cohort has no supported baseline mode.")
      : available(baselines),
    proposed_baselines: baselines.length === 0
      ? unavailable("This cohort has no supported baseline mode.")
      : available(baselines),
    current_findings: available(affectedFindings),
    proposed_findings: available(affectedFindings),
  };
}

function validReportPage(
  value: unknown,
  expectedOffset: number,
  expectedReportId: string | null,
  expectedTotal: number | null,
): StrategicFitAnalysisResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("strategic_fit_cohort_preview_invalid_report");
  }
  const candidate = value as Partial<StrategicFitAnalysisResult> & { error?: unknown; reason?: unknown };
  if (typeof candidate.error === "string") {
    throw new Error(typeof candidate.reason === "string" ? candidate.reason : candidate.error);
  }
  const page = candidate.finding_page;
  if (
    typeof candidate.report_id !== "string" || !Array.isArray(candidate.findings) ||
    !Array.isArray(candidate.cohorts) || page === undefined || page.offset !== expectedOffset ||
    page.returned_count !== candidate.findings.length ||
    (expectedReportId !== null && candidate.report_id !== expectedReportId) ||
    (expectedTotal !== null && page.total_count !== expectedTotal)
  ) throw new Error("strategic_fit_cohort_preview_inconsistent_report");
  return candidate as StrategicFitAnalysisResult;
}

async function loadProposedReport(
  boundary: StrategicFitCohortAdjustmentBoundary,
  overrides: readonly StrategicCohortOverride[],
  controller: AbortController,
): Promise<StrategicFitAnalysisResult> {
  let offset = 0;
  let reportId: string | null = null;
  let total: number | null = null;
  let first: StrategicFitAnalysisResult | null = null;
  const findings: StrategicFinding[] = [];
  do {
    const value = await boundary.execute("analyze_repertoire_congruence", {
      cohort_overrides: overrides,
      sort: "finding-id",
      page: { offset, limit: STRATEGIC_FIT_MAX_PAGE_SIZE },
    }, { signal: controller.signal });
    if (controller.signal.aborted) throw new DOMException("Preview cancelled", "AbortError");
    const page = validReportPage(value, offset, reportId, total);
    first ??= page;
    reportId ??= page.report_id;
    total ??= page.finding_page.total_count;
    findings.push(...page.findings);
    if (page.finding_page.returned_count === 0 && offset < total) {
      throw new Error("strategic_fit_cohort_preview_empty_page");
    }
    offset += page.finding_page.returned_count;
  } while (offset < (total ?? 0));
  if (first === null) throw new Error("strategic_fit_cohort_preview_missing_report");
  return {
    ...first,
    findings,
    finding_page: {
      offset: 0,
      limit: Math.max(1, findings.length),
      total_count: findings.length,
      returned_count: findings.length,
      has_more: false,
    },
  };
}

function activeOverrides(metadata: StrategicFitDocumentMetadata): StrategicCohortOverride[] {
  return [...metadata.cohort_overrides, ...metadata.exclusions]
    .filter((entry) => entry.record_state === "active")
    .map((entry) => entry.kind === "exclude"
      ? {
          override_id: entry.override_id,
          kind: "exclude" as const,
          route_ids: [...(entry.route_ids ?? [])],
          decision_ids: [...(entry.decision_ids ?? [])],
          provenance: entry.provenance,
        }
      : {
          override_id: entry.override_id,
          kind: entry.kind,
          route_ids: [...entry.route_ids],
          provenance: entry.provenance,
        })
    .sort((left, right) => compareStrings(left.override_id, right.override_id));
}

function normalizedIds(values: readonly string[] | undefined, code: string): string[] {
  const original = (values ?? []).map((value) => value.trim());
  if (original.some((value) => value.length === 0) || new Set(original).size !== original.length) {
    throw new Error(code);
  }
  return original.sort(compareStrings);
}

function proposedMutation(
  draft: StrategicFitCohortAdjustmentDraft,
  metadata: StrategicFitDocumentMetadata,
  graph: RepertoireGraph,
  report: StrategicFitAnalysisResult,
): {
  override: StrategicFitCohortOverrideMutationInput | null;
  label: StrategicFitCohortLabelMutationInput | null;
  removeOverrideId: string | null;
  removeLabelId: string | null;
  analyzerOverrides: StrategicCohortOverride[];
} {
  const routeIds = new Set(graph.routes.map((route) => route.route_id));
  const decisionIds = new Set(graph.decisions.map((decision) => decision.decision_id));
  const currentOverrides = activeOverrides(metadata);
  if (draft.kind === "reset") {
    if (draft.target === "override") {
      const target = currentOverrides.find((entry) => entry.override_id === draft.target_id);
      if (target === undefined) throw new Error("strategic_fit_cohort_adjustment_missing_override");
      return {
        override: null,
        label: null,
        removeOverrideId: target.override_id,
        removeLabelId: null,
        analyzerOverrides: currentOverrides.filter((entry) => entry.override_id !== target.override_id),
      };
    }
    const target = metadata.cohort_labels.find((entry) =>
      entry.record_state === "active" && entry.label_id === draft.target_id
    );
    if (target === undefined) throw new Error("strategic_fit_cohort_adjustment_missing_label");
    return {
      override: null,
      label: null,
      removeOverrideId: null,
      removeLabelId: target.label_id,
      analyzerOverrides: currentOverrides,
    };
  }
  if (draft.kind === "rename") {
    const cohortId = draft.cohort_id.trim();
    const displayName = draft.display_name.trim();
    if (cohortId.length === 0 || !report.cohorts.some((cohort) => cohort.cohort_id === cohortId)) {
      throw new Error("strategic_fit_cohort_adjustment_unknown_cohort");
    }
    if (displayName.length === 0) throw new Error("strategic_fit_cohort_adjustment_empty_name");
    if (displayName.length > 120) throw new Error("strategic_fit_cohort_adjustment_name_too_long");
    return {
      override: null,
      label: {
        label_id: `strategic-fit-cohort-label:${stableHash(cohortId)}`,
        cohort_id: cohortId,
        display_name: displayName,
        reason: "User-facing Strategic Fit cohort name.",
      },
      removeOverrideId: null,
      removeLabelId: null,
      analyzerOverrides: currentOverrides,
    };
  }
  const selectedRouteIds = normalizedIds(draft.route_ids, "strategic_fit_cohort_adjustment_duplicate_route");
  const selectedDecisionIds = draft.kind === "exclude"
    ? normalizedIds(draft.decision_ids, "strategic_fit_cohort_adjustment_duplicate_decision")
    : [];
  if (selectedRouteIds.some((id) => !routeIds.has(id))) {
    throw new Error("strategic_fit_cohort_adjustment_unknown_route");
  }
  if (selectedDecisionIds.some((id) => !decisionIds.has(id))) {
    throw new Error("strategic_fit_cohort_adjustment_unknown_decision");
  }
  if (draft.kind !== "exclude" && selectedRouteIds.length === 0) {
    throw new Error(`strategic_fit_cohort_adjustment_empty_${draft.kind}`);
  }
  if (draft.kind === "exclude" && selectedRouteIds.length === 0 && selectedDecisionIds.length === 0) {
    throw new Error("strategic_fit_cohort_adjustment_empty_exclude");
  }
  const identity = stableSerialize({
    kind: draft.kind,
    route_ids: selectedRouteIds,
    decision_ids: selectedDecisionIds,
  });
  const overrideId = `strategic-fit-cohort-${draft.kind}:${stableHash(identity)}`;
  const override: StrategicFitCohortOverrideMutationInput = {
    override_id: overrideId,
    kind: draft.kind,
    route_ids: selectedRouteIds,
    ...(draft.kind === "exclude" ? { decision_ids: selectedDecisionIds } : {}),
    reason: draft.reason ?? `Strategic Fit ${draft.kind} adjustment.`,
  };
  const analyzerOverride: StrategicCohortOverride = draft.kind === "exclude"
    ? {
        override_id: overrideId,
        kind: "exclude",
        route_ids: selectedRouteIds,
        decision_ids: selectedDecisionIds,
      }
    : { override_id: overrideId, kind: draft.kind, route_ids: selectedRouteIds };
  return {
    override,
    label: null,
    removeOverrideId: null,
    removeLabelId: null,
    analyzerOverrides: [
      ...currentOverrides.filter((entry) => entry.override_id !== overrideId),
      analyzerOverride,
    ].sort((left, right) => compareStrings(left.override_id, right.override_id)),
  };
}

function friendlyError(error: unknown): { code: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const code = raw.split(":", 1)[0] || "strategic_fit_cohort_adjustment_failed";
  const messages: Record<string, string> = {
    strategic_fit_cohorts_invalid_merge:
      "Merge routes must currently belong to at least two distinct automatic cohorts.",
    strategic_fit_cohorts_invalid_split:
      "Split routes must be a proper non-empty subset of exactly one automatic cohort.",
    strategic_fit_cohorts_conflicting_override_route:
      "A route cannot belong to overlapping merge or split overrides.",
    strategic_fit_cohort_adjustment_empty_merge: "Choose routes from the cohorts to merge.",
    strategic_fit_cohort_adjustment_empty_split: "Choose a proper subset of routes to split.",
    strategic_fit_cohort_adjustment_empty_exclude: "Choose a semantic route or decision subtree to exclude.",
    strategic_fit_cohort_adjustment_duplicate_route: "The same semantic route cannot be selected twice.",
    strategic_fit_cohort_adjustment_duplicate_decision: "The same semantic decision cannot be selected twice.",
    strategic_fit_cohort_adjustment_unknown_route: "A selected semantic route is no longer current.",
    strategic_fit_cohort_adjustment_unknown_decision: "A selected semantic decision is no longer current.",
    strategic_fit_cohort_adjustment_unknown_cohort: "The selected semantic cohort is no longer current.",
    strategic_fit_cohort_adjustment_empty_name: "Enter a user-facing cohort name.",
    strategic_fit_cohort_adjustment_name_too_long: "Cohort names must be 120 characters or fewer.",
    strategic_fit_cohort_adjustment_missing_override: "That cohort override is no longer active.",
    strategic_fit_cohort_adjustment_missing_label: "That cohort name is no longer active.",
    strategic_fit_cohort_adjustment_stale_report:
      "This cohort preview is blocked because the completed report is no longer current.",
    strategic_fit_cohort_adjustment_stale_context:
      "This cohort preview is blocked because the document, revision, profile, or analysis settings changed.",
    strategic_fit_cohort_adjustment_stale_preview:
      "The report or metadata changed while the cohort preview was running. Preview again.",
    strategic_fit_cohort_adjustment_stale_confirmation:
      "The cohort confirmation is stale. Preview the adjustment again against the current report.",
    strategic_fit_cohort_adjustment_findings_unavailable:
      "Exact finding counts are unavailable until the complete current finding queue is loaded.",
    strategic_fit_cohort_adjustment_cohorts_unavailable:
      "Cohort adjustment is unavailable because this report has no canonical cohorts.",
    strategic_fit_cohort_adjustment_missing_preview: "Preview an adjustment before confirming it.",
  };
  return { code, message: messages[code] ?? raw };
}

export function createStrategicFitCohortAdjustmentState(
  boundary: StrategicFitCohortAdjustmentBoundary,
): StrategicFitCohortAdjustmentState {
  const [state, setState] = createSignal<StrategicFitCohortAdjustmentSnapshot>(emptySnapshot());
  let activeController: AbortController | null = null;
  let sequence = 0;

  const block = (reportId: string | null, error: unknown) => {
    const detail = friendlyError(error);
    setState({ report_id: reportId, status: "blocked", ...detail, preview: null });
  };

  const currentContext = (reportId: string) => {
    const current = boundary.currentReport();
    if (current === null || current.report_id !== reportId) {
      throw new Error("strategic_fit_cohort_adjustment_stale_report");
    }
    if (!sameSnapshot(current.request_snapshot, boundary.currentSnapshot())) {
      throw new Error("strategic_fit_cohort_adjustment_stale_context");
    }
    const findings = boundary.currentFindings(reportId);
    if (!findings.ready || findings.findings.length !== findings.total_count) {
      throw new Error("strategic_fit_cohort_adjustment_findings_unavailable");
    }
    if (current.result.cohorts.length === 0) {
      throw new Error("strategic_fit_cohort_adjustment_cohorts_unavailable");
    }
    return { current, findings: findings.findings };
  };

  return {
    snapshot: state,
    synchronize(reportId) {
      if (state().report_id === reportId) return;
      activeController?.abort();
      activeController = null;
      sequence++;
      setState(emptySnapshot(reportId));
    },
    async preview(reportId, draft) {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const requestSequence = ++sequence;
      setState({ report_id: reportId, status: "previewing", code: null, message: "Calculating exact cohort impact…", preview: null });
      try {
        const context = currentContext(reportId);
        const metadata = boundary.currentMetadata();
        const graph = boundary.currentGraph();
        const mutation = proposedMutation(draft, metadata, graph, context.current.result);
        const proposed = draft.kind === "rename" || draft.kind === "reset" && draft.target === "rename"
          ? context.current.result
          : await loadProposedReport(boundary, mutation.analyzerOverrides, controller);
        if (controller.signal.aborted || requestSequence !== sequence) return null;
        if (!sameSnapshot(context.current.request_snapshot, boundary.currentSnapshot()) ||
          JSON.stringify(metadata) !== JSON.stringify(boundary.currentMetadata())) {
          throw new Error("strategic_fit_cohort_adjustment_stale_preview");
        }
        const impact = draft.kind === "rename"
          ? renameImpact(context.current.result, context.findings, draft.cohort_id.trim())
          : draft.kind === "reset" && draft.target === "rename"
            ? renameImpact(
                context.current.result,
                context.findings,
                metadata.cohort_labels.find((entry) => entry.label_id === draft.target_id)!.cohort_id,
              )
            : impactFromReports(context.current.result, context.findings, proposed);
        const binding = {
          request_snapshot: context.current.request_snapshot,
          metadata_identity: JSON.stringify(metadata),
        };
        const previewBase = {
          report_id: reportId,
          draft,
          override_id: mutation.override?.override_id ?? mutation.removeOverrideId,
          label_id: mutation.label?.label_id ?? mutation.removeLabelId,
          ...impact,
          summary:
            `${impact.affected_routes.count ?? "Unavailable"} route(s), ` +
            `${impact.current_findings.count ?? "Unavailable"} current finding(s), and ` +
            `${impact.proposed_findings.count ?? "Unavailable"} proposed finding(s) are affected.`,
          binding,
        };
        const result: StrategicFitCohortAdjustmentPreview = {
          ...previewBase,
          preview_id: `strategic-fit-cohort-preview:${stableHash(stableSerialize(previewBase))}`,
        };
        setState({
          report_id: reportId,
          status: "ready",
          code: null,
          message: "Preview ready. No metadata or repertoire content has changed.",
          preview: result,
        });
        return result;
      } catch (error) {
        if (controller.signal.aborted || requestSequence !== sequence) return null;
        block(reportId, error);
        return null;
      } finally {
        if (activeController === controller) activeController = null;
      }
    },
    async confirm(previewId) {
      const currentState = state();
      const preview = currentState.status === "ready" && currentState.preview?.preview_id === previewId
        ? currentState.preview
        : null;
      if (preview === null) {
        block(currentState.report_id, new Error("strategic_fit_cohort_adjustment_missing_preview"));
        return false;
      }
      try {
        const context = currentContext(preview.report_id);
        if (
          !sameSnapshot(preview.binding.request_snapshot, context.current.request_snapshot) ||
          !sameSnapshot(preview.binding.request_snapshot, boundary.currentSnapshot()) ||
          preview.binding.metadata_identity !== JSON.stringify(boundary.currentMetadata())
        ) throw new Error("strategic_fit_cohort_adjustment_stale_confirmation");
        const mutation = proposedMutation(
          preview.draft,
          boundary.currentMetadata(),
          boundary.currentGraph(),
          context.current.result,
        );
        setState({ ...currentState, status: "applying", message: "Saving metadata and starting a fresh full analysis…" });
        if (mutation.override !== null) boundary.upsertOverride(mutation.override);
        else if (mutation.label !== null) boundary.upsertLabel(mutation.label);
        else if (mutation.removeOverrideId !== null) boundary.removeOverride(mutation.removeOverrideId);
        else if (mutation.removeLabelId !== null) boundary.removeLabel(mutation.removeLabelId);
        else throw new Error("strategic_fit_cohort_adjustment_missing_mutation");
        await boundary.analyze();
        setState({
          report_id: boundary.currentReport()?.report_id ?? null,
          status: "applied",
          code: null,
          message: "Cohort metadata saved. A fresh canonical analysis completed or reported its current state.",
          preview: null,
        });
        return true;
      } catch (error) {
        block(preview.report_id, error);
        return false;
      }
    },
    cancel() {
      activeController?.abort();
      activeController = null;
      sequence++;
      setState(emptySnapshot(state().report_id));
    },
  };
}

function currentBrowserSnapshot(): StrategicFitRequestSnapshot {
  return {
    document_id: documentId(),
    repertoire_revision: version(),
    repertoire_pgn: actions.toPgn(),
    repertoire_color: color(),
    profile_identity: strategicFitProfileIdentity(strategicFitProfile()),
    settings_identity: strategicFitAnalysisSettingsIdentity(),
  };
}

const browserCohortAdjustments = createStrategicFitCohortAdjustmentState({
  currentReport: () => {
    const lifecycle = strategicFitLifecycle();
    return lifecycle.status === "completed" ? lifecycle.current_result : null;
  },
  currentFindings: (reportId) => {
    const queue = strategicFitFindingQueue.snapshot();
    return {
      ready: queue.report_id === reportId && queue.status === "ready",
      findings: queue.report_id === reportId ? queue.findings : [],
      total_count: queue.report_id === reportId ? queue.canonical_total_count : 0,
    };
  },
  currentSnapshot: currentBrowserSnapshot,
  currentMetadata: strategicFitMetadata,
  currentGraph: () => buildRepertoireGraph(currentTree(), color()),
  execute: (command, args, options) => executeDirectBrowserCommand(command, args, options),
  upsertOverride: upsertStrategicFitCohortOverride,
  removeOverride: removeStrategicFitCohortOverride,
  upsertLabel: upsertStrategicFitCohortLabel,
  removeLabel: removeStrategicFitCohortLabel,
  analyze: analyzeStrategicFit,
});

export const strategicFitCohortAdjustment = () => browserCohortAdjustments.snapshot();
export const synchronizeStrategicFitCohortAdjustment = (reportId: string | null) =>
  browserCohortAdjustments.synchronize(reportId);
export const previewStrategicFitCohortAdjustment = (
  reportId: string,
  draft: StrategicFitCohortAdjustmentDraft,
) => browserCohortAdjustments.preview(reportId, draft);
export const confirmStrategicFitCohortAdjustment = (previewId: string) =>
  browserCohortAdjustments.confirm(previewId);
export const cancelStrategicFitCohortAdjustment = () => browserCohortAdjustments.cancel();

export function strategicFitCohortDisplayName(cohortId: string, fallback: string): string {
  return strategicFitMetadata().cohort_labels.find((entry) =>
    entry.record_state === "active" && entry.cohort_id === cohortId
  )?.display_name ?? fallback;
}
