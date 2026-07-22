import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import ProfileSetup, {
  STRATEGIC_FIT_PROFILE_LABELS,
} from "./strategic-fit/ProfileSetup";
import AnalysisLifecycle, {
  STRATEGIC_FIT_LIFECYCLE_LABELS,
} from "./strategic-fit/AnalysisLifecycle";
import StrategicOverview, {
  type StrategicOverviewItemId,
} from "./strategic-fit/StrategicOverview";
import FindingQueue from "./strategic-fit/FindingQueue";
import ReviewSummary from "./strategic-fit/ReviewSummary";
import EvidencePanel from "./strategic-fit/EvidencePanel";
import ResolutionActions from "./strategic-fit/ResolutionActions";
import CohortEditor from "./strategic-fit/CohortEditor";
import TrainException from "./strategic-fit/TrainException";
import { strategicFitMetadataStatus } from "../store/strategic-fit-metadata";
import { strategicFitProfile } from "../store/strategic-fit-profile";
import { strategicFitProfileSetupRequired } from "../store/strategic-fit-profile-setup";
import { strategicFitLifecycle } from "../store/strategic-fit";
import { strategicFitFindingQueue } from "../store/strategic-fit-finding-queue";
import {
  displayStrategicFitFindingResolution,
  strategicFitFindingResolutionReview,
  strategicFitFindingResolutionUnresolvedCount,
  synchronizeStrategicFitFindingResolutionReview,
} from "../store/strategic-fit-finding-resolutions";
import {
  strategicFitCohortDisplayName,
  synchronizeStrategicFitCohortAdjustment,
} from "../store/strategic-fit-cohort-adjustments";
import { actions, color, currentTree, documentId, version } from "../store/game";
import {
  openStrategicFitFindingQueue,
  setStrategicFitWorkspaceOpen,
  setStrategicFitWorkspaceStage,
  strategicFitFindingQueueFilterKey,
  strategicFitFindingQueueIntent,
  strategicFitWorkspaceRegions,
  strategicFitWorkspaceStage,
  type StrategicFitFindingQueueFilter,
  type StrategicFitWorkspaceRegionState,
  type StrategicFitWorkspaceStage,
} from "../store/ui";

const STAGES: readonly { id: StrategicFitWorkspaceStage; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "findings", label: "Findings" },
  { id: "evidence", label: "Evidence" },
  { id: "resolution", label: "Resolution" },
];

const EMPTY_COPY: Record<StrategicFitWorkspaceStage, { title: string; detail: string }> = {
  overview: {
    title: "No strategic map yet",
    detail: "Opening this workspace does not start an analysis.",
  },
  findings: {
    title: "No findings to review",
    detail: "Findings will appear here only after a Strategic Fit analysis is requested.",
  },
  evidence: {
    title: "No evidence selected",
    detail: "Select a future finding to compare its branch with the cohort baseline.",
  },
  resolution: {
    title: "No resolution selected",
    detail: "Resolution choices will become available when a finding is under review.",
  },
};

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function RegionState(props: {
  region: StrategicFitWorkspaceStage;
  state: StrategicFitWorkspaceRegionState;
}) {
  const copy = () => EMPTY_COPY[props.region];
  return (
    <div
      class={`strategic-fit-region-state strategic-fit-region-${props.state.status}`}
      data-region-state={props.state.status}
      role={props.state.status === "error" ? "alert" : props.state.status === "loading" ? "status" : undefined}
    >
      <Show when={props.state.status === "empty"}>
        <strong>{copy().title}</strong>
        <p>{props.state.message ?? copy().detail}</p>
      </Show>
      <Show when={props.state.status === "loading"}>
        <span class="strategic-fit-region-spinner" aria-hidden="true" />
        <div>
          <strong>Loading workspace data</strong>
          <p>{props.state.message ?? "This region is waiting for Strategic Fit data."}</p>
        </div>
      </Show>
      <Show when={props.state.status === "error"}>
        <strong>Workspace data unavailable</strong>
        <p>{props.state.message ?? "This region could not be displayed."}</p>
      </Show>
    </div>
  );
}

export default function StrategicFitWorkspace() {
  let dialog!: HTMLElement;
  let closeButton!: HTMLButtonElement;
  let returnFocus: HTMLElement | null = null;
  const [usesStageTabs, setUsesStageTabs] = createSignal(false);

  const close = () => setStrategicFitWorkspaceOpen(false);
  const profileReady = () => strategicFitMetadataStatus() === "ready";
  const setupRequired = () => profileReady() && strategicFitProfileSetupRequired();
  const profileSummary = () => {
    const profile = strategicFitProfile();
    const intent = profile.source === "inferred" && profile.provisional
      ? "Inferred · provisional"
      : "Explicit";
    return `${STRATEGIC_FIT_PROFILE_LABELS[profile.mode]} · ${intent}`;
  };
  const currentOverview = () => {
    const lifecycle = strategicFitLifecycle();
    return lifecycle.status === "completed" && lifecycle.current_result &&
      strategicFitWorkspaceRegions().overview.status === "empty"
      ? lifecycle.current_result
      : null;
  };
  createEffect(() => {
    const lifecycle = strategicFitLifecycle();
    synchronizeStrategicFitFindingResolutionReview(
      lifecycle.status === "completed" ? lifecycle.current_result?.report_id ?? null : null,
    );
    synchronizeStrategicFitCohortAdjustment(
      lifecycle.status === "completed" ? lifecycle.current_result?.report_id ?? null : null,
    );
  });
  const currentFindings = () => {
    const lifecycle = strategicFitLifecycle();
    return lifecycle.status === "completed" && lifecycle.current_result &&
      strategicFitWorkspaceRegions().findings.status === "empty"
      ? lifecycle.current_result.result
      : null;
  };
  const currentQueueIntent = () => {
    const lifecycle = strategicFitLifecycle();
    const intent = strategicFitFindingQueueIntent();
    return lifecycle.current_result && intent?.report_id === lifecycle.current_result.report_id
      ? intent
      : null;
  };
  const currentEvidence = () => {
    const lifecycle = strategicFitLifecycle();
    const current = lifecycle.current_result;
    const queue = strategicFitFindingQueue.snapshot();
    if (
      lifecycle.status !== "completed" ||
      current === null ||
      strategicFitWorkspaceRegions().evidence.status !== "empty" ||
      queue.report_id !== current.report_id ||
      queue.selected_finding_id === null
    ) return null;
    const finding = queue.findings.find((candidate) =>
      candidate.finding_id === queue.selected_finding_id
    );
    return finding === undefined ? null : {
      reportId: current.report_id,
      finding,
      trajectories: current.result.trajectories,
      preflightIssues: current.result.preflight.issues,
      repertoireColor: current.request_snapshot.repertoire_color,
      cohortName: strategicFitCohortDisplayName(
        finding.evidence.cohort_id,
        finding.evidence.cohort_id,
      ),
    };
  };
  const currentResolution = () => {
    const lifecycle = strategicFitLifecycle();
    const current = lifecycle.current_result;
    const queue = strategicFitFindingQueue.snapshot();
    if (
      lifecycle.status !== "completed" ||
      current === null ||
      strategicFitWorkspaceRegions().resolution.status !== "empty" ||
      queue.report_id !== current.report_id
    ) return null;
    const findingId = queue.selected_finding_id ??
      (strategicFitFindingResolutionReview().report_id === current.report_id
        ? strategicFitFindingResolutionReview().finding_id
        : null);
    if (findingId === null) return null;
    const finding = queue.findings.find((candidate) =>
      candidate.finding_id === findingId
    );
    return finding === undefined ? null : {
      reportId: current.report_id,
      report: current.result,
      finding,
    };
  };
  const resolutionFallbackState = (): StrategicFitWorkspaceRegionState => {
    const lifecycle = strategicFitLifecycle();
    if (lifecycle.status === "stale") {
      return {
        status: "error",
        message: "Resolution actions are blocked while this report is stale. Cohort adjustment actions are also blocked. Analyze again before recording a decision.",
      };
    }
    return strategicFitWorkspaceRegions().resolution;
  };
  const resolveCurrentEvidenceLine = (
    reportId: string,
    findingId: string,
    path: readonly string[],
  ) => {
    const lifecycle = strategicFitLifecycle();
    const current = lifecycle.current_result;
    const queue = strategicFitFindingQueue.snapshot();
    if (
      lifecycle.status !== "completed" ||
      current === null ||
      current.report_id !== reportId ||
      current.request_snapshot.document_id !== documentId() ||
      current.request_snapshot.repertoire_revision !== version() ||
      current.request_snapshot.repertoire_pgn !== actions.toPgn() ||
      current.request_snapshot.repertoire_color !== color() ||
      queue.report_id !== reportId ||
      queue.selected_finding_id !== findingId
    ) return null;
    try {
      return currentTree().indexPathOfSan([...path]) ?? null;
    } catch {
      return null;
    }
  };
  const reviewOverviewItem = (
    source: StrategicOverviewItemId,
    label: string,
    filter: StrategicFitFindingQueueFilter,
  ) => {
    const report = currentOverview();
    if (!report) return;
    openStrategicFitFindingQueue({
      report_id: report.report_id,
      source,
      label,
      filter,
    });
    queueMicrotask(() => dialog.querySelector<HTMLElement>("#strategic-fit-pane-findings")?.focus());
  };
  const focusable = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");
  const selectStageFromKeyboard = (
    event: KeyboardEvent,
    currentStage: StrategicFitWorkspaceStage,
  ) => {
    if (!usesStageTabs() || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = STAGES.findIndex((stage) => stage.id === currentStage);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? STAGES.length - 1
        : event.key === "ArrowRight"
          ? (currentIndex + 1) % STAGES.length
          : (currentIndex - 1 + STAGES.length) % STAGES.length;
    const nextStage = STAGES[nextIndex]!;
    setStrategicFitWorkspaceStage(nextStage.id);
    queueMicrotask(() => dialog.querySelector<HTMLElement>(`#strategic-fit-stage-${nextStage.id}`)?.focus());
  };
  const focusAnalysisAction = () => queueMicrotask(() =>
    dialog.querySelector<HTMLElement>("[data-strategic-fit-analysis-action]")?.focus()
  );

  onMount(() => {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const compactQuery = window.matchMedia("(max-width: 820px)");
    const updateStageSemantics = () => setUsesStageTabs(compactQuery.matches);
    updateStageSemantics();
    compactQuery.addEventListener("change", updateStageSemantics);

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const candidates = focusable();
      if (candidates.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = candidates[0]!;
      const last = candidates[candidates.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", trapFocus, true);
    closeButton.focus();
    onCleanup(() => {
      document.removeEventListener("keydown", trapFocus, true);
      compactQuery.removeEventListener("change", updateStageSemantics);
      queueMicrotask(() => returnFocus?.isConnected && returnFocus.focus());
    });
  });

  return (
    <div class="strategic-fit-workspace-backdrop">
      <section
        ref={dialog}
        class="strategic-fit-workspace"
        role="dialog"
        aria-modal="true"
        aria-labelledby="strategic-fit-workspace-title"
        aria-describedby="strategic-fit-workspace-description"
        tabIndex={-1}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <header class="strategic-fit-workspace-header">
          <div>
            <div class="strategic-fit-workspace-kicker">Repertoire review</div>
            <h1 id="strategic-fit-workspace-title">Strategic Fit</h1>
            <p id="strategic-fit-workspace-description">
              Review strategic workload without changing the working repertoire.
            </p>
            <p class="strategic-fit-workspace-profile" aria-live="polite">
              <span>Profile</span> {profileSummary()}
            </p>
          </div>
          <div class="strategic-fit-workspace-header-actions">
            <span class="strategic-fit-workspace-status">
              {STRATEGIC_FIT_LIFECYCLE_LABELS[strategicFitLifecycle().status]}
            </span>
            <button ref={closeButton} type="button" onClick={close}>Return to repertoire</button>
          </div>
        </header>

        <Show when={profileReady()} fallback={(
          <main class="strategic-fit-profile-loading" role="status">
            <span class="strategic-fit-region-spinner" aria-hidden="true" />
            <div>
              <strong>Loading profile settings</strong>
              <p>Waiting for this repertoire's saved Strategic Fit preferences.</p>
            </div>
          </main>
        )}>
          <Show when={setupRequired()} fallback={(
            <>
              <AnalysisLifecycle />
              <nav
                class="strategic-fit-stage-nav"
                aria-label="Strategic Fit stages"
                role={usesStageTabs() ? "tablist" : undefined}
              >
                <For each={STAGES}>{(stage) => (
                  <button
                    id={`strategic-fit-stage-${stage.id}`}
                    type="button"
                    role={usesStageTabs() ? "tab" : undefined}
                    aria-controls={`strategic-fit-pane-${stage.id}`}
                    aria-selected={usesStageTabs()
                      ? strategicFitWorkspaceStage() === stage.id
                      : undefined}
                    tabIndex={usesStageTabs()
                      ? strategicFitWorkspaceStage() === stage.id ? 0 : -1
                      : 0}
                    class={strategicFitWorkspaceStage() === stage.id ? "active" : ""}
                    onClick={() => setStrategicFitWorkspaceStage(stage.id)}
                    onKeyDown={(event) => selectStageFromKeyboard(event, stage.id)}
                  >{stage.label}</button>
                )}</For>
              </nav>

              <main class="strategic-fit-workspace-body" data-stage={strategicFitWorkspaceStage()}>
          <section
            id="strategic-fit-pane-overview"
            class="strategic-fit-workspace-pane strategic-fit-overview-pane"
            role={usesStageTabs() ? "tabpanel" : "region"}
            aria-labelledby={usesStageTabs()
              ? "strategic-fit-stage-overview"
              : "strategic-fit-pane-overview-title"}
            tabIndex={0}
          >
            <div class="strategic-fit-pane-heading">
              <span>Overview</span>
              <h2 id="strategic-fit-pane-overview-title">Strategic map</h2>
            </div>
            <Show
              when={currentOverview()}
              fallback={<RegionState region="overview" state={strategicFitWorkspaceRegions().overview} />}
            >
              {(report) => (
                <StrategicOverview
                  report={report().result}
                  unresolvedFindingCount={strategicFitFindingResolutionUnresolvedCount(report().result)}
                  onReview={reviewOverviewItem}
                />
              )}
            </Show>
            <ReviewSummary />
          </section>

          <section
            id="strategic-fit-pane-findings"
            class="strategic-fit-workspace-pane strategic-fit-findings-pane"
            role={usesStageTabs() ? "tabpanel" : "region"}
            aria-labelledby={usesStageTabs()
              ? "strategic-fit-stage-findings"
              : "strategic-fit-pane-findings-title"}
            data-queue-filter={currentQueueIntent()
              ? strategicFitFindingQueueFilterKey(currentQueueIntent()!.filter)
              : "none"}
            tabIndex={0}
          >
            <div class="strategic-fit-pane-heading">
              <span>Review queue</span>
              <h2 id="strategic-fit-pane-findings-title">Findings</h2>
            </div>
            <Show
              when={currentFindings()}
              fallback={<RegionState region="findings" state={strategicFitWorkspaceRegions().findings} />}
            >
              {(report) => (
                <FindingQueue
                  report={report()}
                  intent={currentQueueIntent()}
                  resolutionState={displayStrategicFitFindingResolution}
                  changedEvidenceSemanticIds={strategicFitLifecycle().current_result?.reanalysis
                    ?.changed_evidence_semantic_finding_ids ?? []}
                  cohortName={(finding) => strategicFitCohortDisplayName(
                    finding.evidence.cohort_id,
                    finding.evidence.cohort_id,
                  )}
                />
              )}
            </Show>
          </section>

          <section
            id="strategic-fit-pane-evidence"
            class="strategic-fit-workspace-pane strategic-fit-evidence-pane"
            role={usesStageTabs() ? "tabpanel" : "region"}
            aria-labelledby={usesStageTabs()
              ? "strategic-fit-stage-evidence"
              : "strategic-fit-pane-evidence-title"}
            tabIndex={0}
          >
            <div class="strategic-fit-pane-heading">
              <span>Branch review</span>
              <h2 id="strategic-fit-pane-evidence-title">Evidence / comparison</h2>
            </div>
            <Show
              when={currentEvidence()}
              fallback={<RegionState region="evidence" state={strategicFitWorkspaceRegions().evidence} />}
            >
              {(evidence) => (
                <EvidencePanel
                  reportId={evidence().reportId}
                  finding={evidence().finding}
                  cohortName={evidence().cohortName}
                  trajectories={evidence().trajectories}
                  preflightIssues={evidence().preflightIssues}
                  repertoireColor={evidence().repertoireColor}
                  canNavigateToLine={(path) => resolveCurrentEvidenceLine(
                    evidence().reportId,
                    evidence().finding.finding_id,
                    path,
                  ) !== null}
                  onGoToLine={(path) => {
                    const target = resolveCurrentEvidenceLine(
                      evidence().reportId,
                      evidence().finding.finding_id,
                      path,
                    );
                    if (target === null) return false;
                    actions.goto(target);
                    return true;
                  }}
                />
              )}
            </Show>
            <Show when={!usesStageTabs() && currentResolution()}>
              {(resolution) => (
                <div class="strategic-fit-review-actions">
                  <ResolutionActions
                    reportId={resolution().reportId}
                    finding={resolution().finding}
                  />
                  <TrainException
                    reportId={resolution().reportId}
                    report={resolution().report}
                    finding={resolution().finding}
                  />
                  <CohortEditor
                    reportId={resolution().reportId}
                    report={resolution().report}
                    finding={resolution().finding}
                  />
                </div>
              )}
            </Show>
            <Show when={!usesStageTabs() && strategicFitLifecycle().status === "stale"}>
              <div class="strategic-fit-resolution-blocked" role="alert" data-resolution-blocked>
                Resolution actions are blocked while this report is stale. Cohort adjustment actions are also blocked. Analyze again before recording a decision.
              </div>
            </Show>
          </section>

          <section
            id="strategic-fit-pane-resolution"
            class="strategic-fit-workspace-pane strategic-fit-resolution-pane"
            role={usesStageTabs() ? "tabpanel" : "region"}
            aria-labelledby={usesStageTabs()
              ? "strategic-fit-stage-resolution"
              : "strategic-fit-pane-resolution-title"}
            tabIndex={0}
          >
            <div class="strategic-fit-pane-heading">
              <span>Next step</span>
              <h2 id="strategic-fit-pane-resolution-title">Resolution</h2>
            </div>
            <Show
              when={usesStageTabs() && currentResolution()}
              fallback={<RegionState region="resolution" state={resolutionFallbackState()} />}
            >
              {(resolution) => (
                <div class="strategic-fit-review-actions">
                  <ResolutionActions
                    reportId={resolution().reportId}
                    finding={resolution().finding}
                  />
                  <TrainException
                    reportId={resolution().reportId}
                    report={resolution().report}
                    finding={resolution().finding}
                  />
                  <CohortEditor
                    reportId={resolution().reportId}
                    report={resolution().report}
                    finding={resolution().finding}
                  />
                </div>
              )}
            </Show>
          </section>
              </main>
            </>
          )}>
            <ProfileSetup onComplete={focusAnalysisAction} />
          </Show>
        </Show>
      </section>
    </div>
  );
}
