import { createSignal } from "solid-js";
import {
  buildRepertoireGraph,
  type IntentionalResolutionReason,
  type RepertoireGraph,
  type StrategicFinding,
  type StrategicFitDocumentMetadata,
  type StrategicFitPersistedResolution,
  type StrategicFitPersistedResolutionState,
} from "@chess-mcp/chess-tools";
import { actions, color, currentTree, documentId, version } from "./game";
import { strategicFitFindingQueue } from "./strategic-fit-finding-queue";
import { strategicFitMetadata } from "./strategic-fit-metadata";
import { strategicFitProfile, strategicFitProfileIdentity } from "./strategic-fit-profile";
import {
  strategicFitAnalysisSettingsIdentity,
  upsertStrategicFitResolution,
  reopenStrategicFitResolution,
  type StrategicFitResolutionMutationInput,
  type StrategicFitSettingsMutationResult,
} from "./strategic-fit-resolutions";
import {
  prepareCompletedStrategicFitReportForResolution,
  retainCompletedStrategicFitReportAfterResolution,
  strategicFitLifecycle,
  type StrategicFitCompletedResult,
  type StrategicFitRequestSnapshot,
} from "./strategic-fit";

export const STRATEGIC_FIT_REVIEW_RESOLUTION_STATES = [
  "keep-intentionally",
  "defer",
  "exclude-from-analysis",
  "invalid-comparison",
  "automatically-resolved-by-another-edit",
] as const;
export type StrategicFitReviewResolutionState =
  (typeof STRATEGIC_FIT_REVIEW_RESOLUTION_STATES)[number];
export type StrategicFitDisplayedResolutionState =
  | StrategicFinding["resolution_state"]
  | "invalid-comparison";

export type StrategicFitResolutionReviewStatus = "idle" | "ready" | "updated" | "blocked";

interface StrategicFitResolutionProjection {
  readonly state: StrategicFitDisplayedResolutionState;
  readonly baseline_state: StrategicFitDisplayedResolutionState;
}

export interface StrategicFitResolutionReviewSnapshot {
  readonly report_id: string | null;
  readonly status: StrategicFitResolutionReviewStatus;
  readonly code: string | null;
  readonly message: string | null;
  readonly finding_id: string | null;
  readonly projections: Readonly<Record<string, StrategicFitResolutionProjection>>;
}

export interface StrategicFitResolutionAvailability {
  readonly available: boolean;
  readonly code: string | null;
  readonly message: string | null;
  readonly finding: StrategicFinding | null;
}

export interface StrategicFitFindingResolutionTransitionInput {
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly state: StrategicFitReviewResolutionState;
  readonly intentional_reason?: IntentionalResolutionReason | null;
  readonly note?: string | null;
}

export interface StrategicFitFindingResolutionReopenInput {
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
}

export interface StrategicFitFindingResolutionTransitionResult {
  readonly state: "updated" | "unchanged" | "reopened" | "blocked";
  readonly code: string | null;
  readonly message: string;
  readonly resolution: StrategicFitDisplayedResolutionState;
}

export interface StrategicFitFindingResolutionBoundary {
  currentReport(): StrategicFitCompletedResult | null;
  currentFinding(reportId: string, findingId: string): StrategicFinding | null;
  currentSnapshot(): StrategicFitRequestSnapshot;
  currentMetadata(): StrategicFitDocumentMetadata;
  currentGraph(): RepertoireGraph;
  upsertResolution(input: StrategicFitResolutionMutationInput): StrategicFitSettingsMutationResult;
  reopenResolution(resolutionId: string): StrategicFitSettingsMutationResult;
  prepareReport(reportId: string): boolean;
  retainReport(reportId: string): boolean;
}

export interface StrategicFitFindingResolutionState {
  snapshot(): StrategicFitResolutionReviewSnapshot;
  synchronize(reportId: string | null): void;
  availability(
    reportId: string,
    findingId: string,
    semanticFindingId: string,
  ): StrategicFitResolutionAvailability;
  displayState(finding: StrategicFinding): StrategicFitDisplayedResolutionState;
  unresolvedCount(report: StrategicFitCompletedResult["result"]): number;
  transition(
    input: StrategicFitFindingResolutionTransitionInput,
  ): StrategicFitFindingResolutionTransitionResult;
  reopen(input: StrategicFitFindingResolutionReopenInput): StrategicFitFindingResolutionTransitionResult;
}

const initialSnapshot = (): StrategicFitResolutionReviewSnapshot => ({
  report_id: null,
  status: "idle",
  code: null,
  message: null,
  finding_id: null,
  projections: {},
});

function activeResolution(
  metadata: StrategicFitDocumentMetadata,
  semanticFindingId: string,
): StrategicFitPersistedResolution | null {
  return metadata.resolutions.find((resolution) =>
    resolution.record_state === "active" &&
    resolution.semantic_finding_id === semanticFindingId
  ) ?? null;
}

function sameSnapshot(left: StrategicFitRequestSnapshot, right: StrategicFitRequestSnapshot): boolean {
  return left.document_id === right.document_id &&
    left.repertoire_revision === right.repertoire_revision &&
    left.repertoire_pgn === right.repertoire_pgn &&
    left.repertoire_color === right.repertoire_color &&
    left.profile_identity === right.profile_identity &&
    left.settings_identity === right.settings_identity;
}

function missingSemanticReference(
  finding: StrategicFinding,
  graph: RepertoireGraph,
): string | null {
  const references = finding.references;
  if (
    references.position_ids.length === 0 &&
    references.decision_ids.length === 0 &&
    references.route_ids.length === 0
  ) return "The finding has no canonical position, decision, or route identity.";
  const positions = new Set(graph.positions.map((position) => position.position_id));
  const decisions = new Set(graph.decisions.map((decision) => decision.decision_id));
  const routes = new Set(graph.routes.map((route) => route.route_id));
  if (references.position_ids.some((id) => !positions.has(id))) {
    return "A semantic position referenced by this finding no longer belongs to the current repertoire.";
  }
  if (references.decision_ids.some((id) => !decisions.has(id))) {
    return "A semantic decision referenced by this finding no longer belongs to the current repertoire.";
  }
  if (references.route_ids.some((id) => !routes.has(id))) {
    return "A semantic route referenced by this finding no longer belongs to the current repertoire.";
  }
  return null;
}

function actionLabel(state: StrategicFitReviewResolutionState): string {
  if (state === "keep-intentionally") return "Kept intentionally";
  if (state === "defer") return "Deferred";
  if (state === "exclude-from-analysis") return "Excluded from analysis";
  if (state === "invalid-comparison") return "Marked as an invalid comparison";
  return "Resolved by another edit";
}

function persistedReason(state: StrategicFitReviewResolutionState): string {
  if (state === "automatically-resolved-by-another-edit") {
    return "Strategic Fit recorded that another edit resolved this finding.";
  }
  return `Strategic Fit review action: ${actionLabel(state).toLowerCase()}.`;
}

export function createStrategicFitFindingResolutionState(
  boundary: StrategicFitFindingResolutionBoundary,
): StrategicFitFindingResolutionState {
  const [review, setReview] = createSignal<StrategicFitResolutionReviewSnapshot>(initialSnapshot());

  const displayed = (finding: StrategicFinding): StrategicFitDisplayedResolutionState => {
    const current = review();
    const projection = current.report_id === boundary.currentReport()?.report_id
      ? current.projections[finding.semantic_finding_id]
      : undefined;
    if (projection !== undefined) return projection.state;
    return activeResolution(boundary.currentMetadata(), finding.semantic_finding_id)?.state ??
      finding.resolution_state;
  };

  const blocked = (
    findingId: string | null,
    code: string,
    message: string,
  ): StrategicFitFindingResolutionTransitionResult => {
    setReview((previous) => ({ ...previous, status: "blocked", code, message, finding_id: findingId }));
    return { state: "blocked", code, message, resolution: "unresolved" };
  };

  const availability = (
    reportId: string,
    findingId: string,
    semanticFindingId: string,
  ): StrategicFitResolutionAvailability => {
    const report = boundary.currentReport();
    if (report === null || report.report_id !== reportId) {
      return {
        available: false,
        code: "strategic_fit_resolution_stale_report",
        message: "Resolution actions are blocked because this is not the current completed report.",
        finding: null,
      };
    }
    if (!sameSnapshot(report.request_snapshot, boundary.currentSnapshot())) {
      return {
        available: false,
        code: "strategic_fit_resolution_stale_context",
        message: "Resolution actions are blocked because the document, revision, profile, or analysis settings changed.",
        finding: null,
      };
    }
    const finding = boundary.currentFinding(reportId, findingId);
    if (
      finding === null ||
      finding.semantic_finding_id !== semanticFindingId ||
      finding.repertoire_revision !== report.result.repertoire_revision
    ) {
      return {
        available: false,
        code: "strategic_fit_resolution_stale_finding",
        message: "Resolution actions are blocked because the finding identity is no longer current.",
        finding: null,
      };
    }
    let graph: RepertoireGraph;
    try {
      graph = boundary.currentGraph();
    } catch {
      return {
        available: false,
        code: "strategic_fit_resolution_semantic_graph_unavailable",
        message: "Resolution actions are blocked because canonical repertoire identities are unavailable.",
        finding,
      };
    }
    const missing = missingSemanticReference(finding, graph);
    if (missing !== null) {
      return {
        available: false,
        code: "strategic_fit_resolution_stale_semantic_reference",
        message: `Resolution actions are blocked. ${missing}`,
        finding,
      };
    }
    return { available: true, code: null, message: null, finding };
  };

  const project = (
    reportId: string,
    finding: StrategicFinding,
    state: StrategicFitDisplayedResolutionState,
    message: string,
  ) => {
    setReview((previous) => {
      const baseline = previous.report_id === reportId
        ? previous.projections[finding.semantic_finding_id]?.baseline_state ?? finding.resolution_state
        : finding.resolution_state;
      return {
        report_id: reportId,
        status: "updated",
        code: null,
        message,
        finding_id: finding.finding_id,
        projections: {
          ...(previous.report_id === reportId ? previous.projections : {}),
          [finding.semantic_finding_id]: { state, baseline_state: baseline },
        },
      };
    });
  };

  return {
    snapshot: review,
    synchronize(reportId) {
      if (review().report_id === reportId) return;
      setReview(reportId === null
        ? initialSnapshot()
        : { ...initialSnapshot(), report_id: reportId, status: "ready" });
    },
    availability,
    displayState: displayed,
    unresolvedCount(report) {
      const current = review();
      const projectedDelta = current.report_id !== report.report_id
        ? 0
        : Object.values(current.projections).reduce((total, projection) =>
          total + (projection.state === "unresolved" ? 1 : 0) -
            (projection.baseline_state === "unresolved" ? 1 : 0), 0);
      const projectedIds = new Set(current.report_id === report.report_id
        ? Object.keys(current.projections)
        : []);
      const persistedDelta = report.findings.reduce((total, finding) => {
        if (projectedIds.has(finding.semantic_finding_id)) return total;
        const persisted = activeResolution(boundary.currentMetadata(), finding.semantic_finding_id);
        if (persisted === null) return total;
        return total - (finding.resolution_state === "unresolved" ? 1 : 0);
      }, 0);
      return Math.max(
        0,
        report.summary.unresolved_finding_count + projectedDelta + persistedDelta,
      );
    },
    transition(input) {
      const allowed = new Set<StrategicFitPersistedResolutionState>(STRATEGIC_FIT_REVIEW_RESOLUTION_STATES);
      if (!allowed.has(input.state)) {
        return blocked(input.finding_id, "strategic_fit_resolution_invalid_transition", "That resolution transition is not supported.");
      }
      const checked = availability(input.report_id, input.finding_id, input.semantic_finding_id);
      if (!checked.available || checked.finding === null) {
        return blocked(input.finding_id, checked.code!, checked.message!);
      }
      const note = input.note?.trim() || null;
      const intentionalReason = input.state === "keep-intentionally"
        ? input.intentional_reason ?? null
        : null;
      if (intentionalReason === "custom" && note === null) {
        return blocked(
          input.finding_id,
          "strategic_fit_resolution_custom_reason_requires_note",
          "Add a note to describe the custom keep-intentionally reason.",
        );
      }
      if (!boundary.prepareReport(input.report_id)) {
        return blocked(
          input.finding_id,
          "strategic_fit_resolution_report_busy",
          "Resolution actions are blocked because the completed report is no longer available for review.",
        );
      }
      const existing = activeResolution(boundary.currentMetadata(), checked.finding.semantic_finding_id);
      let result: StrategicFitSettingsMutationResult;
      try {
        result = boundary.upsertResolution({
          resolution_id: existing?.resolution_id ??
            `strategic-fit-resolution:${checked.finding.semantic_finding_id}`,
          finding_id: checked.finding.finding_id,
          semantic_finding_id: checked.finding.semantic_finding_id,
          state: input.state,
          references: checked.finding.references,
          intentional_reason: intentionalReason,
          note,
          reason: persistedReason(input.state),
        });
      } catch (error) {
        boundary.retainReport(input.report_id);
        throw error;
      }
      boundary.retainReport(input.report_id);
      const message = `${actionLabel(input.state)}. The repertoire was not changed.`;
      project(input.report_id, checked.finding, input.state, message);
      return {
        state: result.state === "unchanged" ? "unchanged" : "updated",
        code: null,
        message,
        resolution: input.state,
      };
    },
    reopen(input) {
      const checked = availability(input.report_id, input.finding_id, input.semantic_finding_id);
      if (!checked.available || checked.finding === null) {
        return blocked(input.finding_id, checked.code!, checked.message!);
      }
      const existing = activeResolution(boundary.currentMetadata(), checked.finding.semantic_finding_id);
      if (existing === null) {
        return blocked(
          input.finding_id,
          "strategic_fit_resolution_not_active",
          "This finding has no active persisted resolution to reopen.",
        );
      }
      if (!boundary.prepareReport(input.report_id)) {
        return blocked(
          input.finding_id,
          "strategic_fit_resolution_report_busy",
          "Resolution actions are blocked because the completed report is no longer available for review.",
        );
      }
      let result: StrategicFitSettingsMutationResult;
      try {
        result = boundary.reopenResolution(existing.resolution_id);
      } catch (error) {
        boundary.retainReport(input.report_id);
        throw error;
      }
      boundary.retainReport(input.report_id);
      if (result.state === "missing") {
        return blocked(
          input.finding_id,
          "strategic_fit_resolution_stale_record",
          "The persisted resolution changed before it could be reopened.",
        );
      }
      const message = "Finding reopened. The repertoire was not changed.";
      project(input.report_id, checked.finding, "unresolved", message);
      return { state: "reopened", code: null, message, resolution: "unresolved" };
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

const browserFindingResolutionState = createStrategicFitFindingResolutionState({
  currentReport: () => {
    const lifecycle = strategicFitLifecycle();
    return lifecycle.status === "completed" ? lifecycle.current_result : null;
  },
  currentFinding: (reportId, findingId) => {
    const queue = strategicFitFindingQueue.snapshot();
    if (queue.report_id !== reportId) return null;
    return queue.findings.find((finding) => finding.finding_id === findingId) ?? null;
  },
  currentSnapshot: currentBrowserSnapshot,
  currentMetadata: strategicFitMetadata,
  currentGraph: () => buildRepertoireGraph(currentTree(), color()),
  upsertResolution: upsertStrategicFitResolution,
  reopenResolution: reopenStrategicFitResolution,
  prepareReport: prepareCompletedStrategicFitReportForResolution,
  retainReport: retainCompletedStrategicFitReportAfterResolution,
});

export const strategicFitFindingResolutionReview = () => browserFindingResolutionState.snapshot();
export const synchronizeStrategicFitFindingResolutionReview = (reportId: string | null) =>
  browserFindingResolutionState.synchronize(reportId);
export const strategicFitFindingResolutionAvailability = (
  reportId: string,
  findingId: string,
  semanticFindingId: string,
) => browserFindingResolutionState.availability(reportId, findingId, semanticFindingId);
export const displayStrategicFitFindingResolution = (finding: StrategicFinding) =>
  browserFindingResolutionState.displayState(finding);
export const strategicFitFindingResolutionUnresolvedCount = (
  report: StrategicFitCompletedResult["result"],
) => browserFindingResolutionState.unresolvedCount(report);
export const transitionStrategicFitFindingResolution = (
  input: StrategicFitFindingResolutionTransitionInput,
) => browserFindingResolutionState.transition(input);
export const reopenStrategicFitFinding = (input: StrategicFitFindingResolutionReopenInput) =>
  browserFindingResolutionState.reopen(input);
