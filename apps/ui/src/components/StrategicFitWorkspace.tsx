import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import Status from "./primitives/Status";
import ProfileSetup from "./strategic-fit/ProfileSetup";
import AnalysisLifecycle from "./strategic-fit/AnalysisLifecycle";
import { STRATEGIC_FIT_PROFILE_LABELS, STRATEGIC_FIT_EVIDENCE } from "../content/strategicFit";
import StrategicOverview, { type StrategicOverviewItemId } from "./strategic-fit/StrategicOverview";
import StrategicMap from "./strategic-fit/StrategicMap";
import ConceptHeatmap from "./strategic-fit/ConceptHeatmap";
import DecisionFlow from "./strategic-fit/DecisionFlow";
import FindingQueue from "./strategic-fit/FindingQueue";
import InsufficientEvidence from "./strategic-fit/InsufficientEvidence";
import ReviewSummary from "./strategic-fit/ReviewSummary";
import EvidencePanel from "./strategic-fit/EvidencePanel";
import ResolutionActions from "./strategic-fit/ResolutionActions";
import CohortEditor from "./strategic-fit/CohortEditor";
import TrainException from "./strategic-fit/TrainException";
import IntentSuggestions from "./strategic-fit/IntentSuggestions";
import ProfileSettings from "./strategic-fit/ProfileSettings";
import ReplacementLab from "./strategic-fit/ReplacementLab";
import { strategicFitMetadataStatus } from "../store/strategic-fit-metadata";
import { strategicFitProfile } from "../store/strategic-fit-profile";
import { strategicFitProfileSetupRequired } from "../store/strategic-fit-profile-setup";
import {
  strategicFitLifecycle,
  strategicFitEvidenceState,
  strategicFitComparablePlyThreshold,
  analyzeStrategicFit,
} from "../store/strategic-fit";
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
import { buildRepertoireGraph } from "@chess-mcp/chess-tools";
import { actions, color, currentTree, documentId, version } from "../store/game";
import {
  openStrategicFitFindingQueue,
  setStrategicFitPrintExportMode,
  setStrategicFitWorkspaceOpen,
  setStrategicFitWorkspaceStage,
  strategicFitFindingQueueFilterKey,
  strategicFitFindingQueueIntent,
  strategicFitPrintExportMode,
  strategicFitWorkspaceRegions,
  strategicFitWorkspaceStage,
  type StrategicFitFindingQueueFilter,
  type StrategicFitWorkspaceRegionState,
  type StrategicFitWorkspaceStage,
} from "../store/ui";
import { replacementLab, replacementLabSnapshot } from "../store/strategic-fit-replacement";
import { strategicFitTrainingMastery } from "../store/strategic-fit-training";
import Dialog from "./primitives/Dialog";
import PanelHeader from "./primitives/PanelHeader";
import RegionState from "./primitives/RegionState";

const STAGES: readonly { id: StrategicFitWorkspaceStage; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "findings", label: "Findings" },
  { id: "evidence", label: "Evidence" },
  { id: "resolution", label: "Resolution" },
];

export default function StrategicFitWorkspace() {
  let dialog!: HTMLDivElement;
  let closeButton!: HTMLButtonElement;
  const [usesStageTabs, setUsesStageTabs] = createSignal(false);

  const close = () => {
    if (replacementLabSnapshot().open) replacementLab.close();
    setStrategicFitWorkspaceOpen(false);
  };
  const profileReady = () => strategicFitMetadataStatus() === "ready";
  const setupRequired = () => profileReady() && strategicFitProfileSetupRequired();
  const profileSummary = () => {
    const profile = strategicFitProfile();
    const intent =
      profile.source === "inferred" && profile.provisional ? "Inferred · provisional" : "Explicit";
    return `${STRATEGIC_FIT_PROFILE_LABELS[profile.mode]} · ${intent}`;
  };
  const currentOverview = () => {
    const lifecycle = strategicFitLifecycle();
    return lifecycle.status === "completed" &&
      lifecycle.current_result &&
      strategicFitWorkspaceRegions().overview.status === "empty"
      ? lifecycle.current_result
      : null;
  };
  createEffect(() => {
    const lifecycle = strategicFitLifecycle();
    synchronizeStrategicFitFindingResolutionReview(
      lifecycle.status === "completed" ? (lifecycle.current_result?.report_id ?? null) : null,
    );
    synchronizeStrategicFitCohortAdjustment(
      lifecycle.status === "completed" ? (lifecycle.current_result?.report_id ?? null) : null,
    );
  });
  /** Unresolved work left in the current report, shown on the Findings stage so the queue's size
   * is legible from any stage. Null while there is no completed report to count. */
  const unresolvedCount = () => {
    const lifecycle = strategicFitLifecycle();
    const result = lifecycle.status === "completed" ? lifecycle.current_result : null;
    return result ? strategicFitFindingResolutionUnresolvedCount(result.result) : null;
  };
  const currentFindings = () => {
    const lifecycle = strategicFitLifecycle();
    return lifecycle.status === "completed" &&
      lifecycle.current_result &&
      strategicFitWorkspaceRegions().findings.status === "empty"
      ? lifecycle.current_result.result
      : null;
  };
  /**
   * WP-031 AC-1/AC-4: the preflight payload behind the terminal state. Sourced from the completed
   * result rather than re-derived, so the counts the terminal state prints are the same ones
   * `PreflightResults` shows above it.
   */
  const insufficientEvidencePreflight = () =>
    strategicFitLifecycle().current_result?.result.preflight ?? null;
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
    )
      return null;
    const finding = queue.findings.find(
      (candidate) => candidate.finding_id === queue.selected_finding_id,
    );
    return finding === undefined
      ? null
      : {
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
    )
      return null;
    const findingId =
      queue.selected_finding_id ??
      (strategicFitFindingResolutionReview().report_id === current.report_id
        ? strategicFitFindingResolutionReview().finding_id
        : null);
    if (findingId === null) return null;
    const finding = queue.findings.find((candidate) => candidate.finding_id === findingId);
    return finding === undefined
      ? null
      : {
          completed: current,
          reportId: current.report_id,
          report: current.result,
          finding,
        };
  };
  /**
   * WP-033 AC-3: the stale case is rendered once, by the dedicated blocked alert in the resolution
   * pane. This fallback therefore reports the ordinary region state and does not restate it.
   */
  const resolutionFallbackState = (): StrategicFitWorkspaceRegionState =>
    strategicFitWorkspaceRegions().resolution;
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
      current?.report_id !== reportId ||
      current.request_snapshot.document_id !== documentId() ||
      current.request_snapshot.repertoire_revision !== version() ||
      current.request_snapshot.repertoire_pgn !== actions.toPgn() ||
      current.request_snapshot.repertoire_color !== color() ||
      queue.report_id !== reportId ||
      queue.selected_finding_id !== findingId
    )
      return null;
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
    queueMicrotask(() =>
      dialog.querySelector<HTMLElement>("#strategic-fit-pane-findings")?.focus(),
    );
  };
  const openMapFinding = (reportId: string, findingId: string) => {
    openStrategicFitFindingQueue({
      report_id: reportId,
      source: "strategic-map",
      label: "Findings for the selected map branch",
      filter: { kind: "all" },
    });
    queueMicrotask(() => {
      strategicFitFindingQueue.selectFinding(findingId);
      dialog.querySelector<HTMLElement>("#strategic-fit-pane-findings")?.focus();
    });
  };
  /**
   * The report retains route identities but not the decisions between them, so the flow needs the
   * canonical graph of the working tree. It is built only while a completed report is displayed,
   * and the flow itself rejects it whenever the revisions disagree.
   */
  const decisionFlowGraph = createMemo(() => {
    if (!currentOverview()) return null;
    try {
      return buildRepertoireGraph(currentTree(), color());
    } catch {
      return null;
    }
  });
  const openFlowFinding = (reportId: string, findingId: string) => {
    openStrategicFitFindingQueue({
      report_id: reportId,
      source: "decision-flow",
      label: "Findings for the selected flow step",
      filter: { kind: "all" },
    });
    queueMicrotask(() => {
      strategicFitFindingQueue.selectFinding(findingId);
      dialog.querySelector<HTMLElement>("#strategic-fit-pane-findings")?.focus();
    });
  };
  const openHeatmapFinding = (reportId: string, findingId: string) => {
    openStrategicFitFindingQueue({
      report_id: reportId,
      source: "concept-heatmap",
      label: "Findings for the selected heatmap cell",
      filter: { kind: "all" },
    });
    queueMicrotask(() => {
      strategicFitFindingQueue.selectFinding(findingId);
      dialog.querySelector<HTMLElement>("#strategic-fit-pane-findings")?.focus();
    });
  };
  const selectStageFromKeyboard = (
    event: KeyboardEvent,
    currentStage: StrategicFitWorkspaceStage,
  ) => {
    if (!usesStageTabs() || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = STAGES.findIndex((stage) => stage.id === currentStage);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? STAGES.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % STAGES.length
            : (currentIndex - 1 + STAGES.length) % STAGES.length;
    const nextStage = STAGES.at(nextIndex);
    if (nextStage === undefined) return;
    setStrategicFitWorkspaceStage(nextStage.id);
    queueMicrotask(() =>
      dialog.querySelector<HTMLElement>(`#strategic-fit-stage-${nextStage.id}`)?.focus(),
    );
  };
  const focusAnalysisAction = () => {
    queueMicrotask(() =>
      dialog.querySelector<HTMLElement>("[data-strategic-fit-analysis-action]")?.focus(),
    );
  };

  onMount(() => {
    const compactQuery = window.matchMedia("(max-width: 820px)");
    const updateStageSemantics = () => setUsesStageTabs(compactQuery.matches);
    updateStageSemantics();
    compactQuery.addEventListener("change", updateStageSemantics);

    /**
     * Task 10.4 print/export. Printing must not silently drop the rows a render cap withheld, so
     * the browser's own print flow turns on the same complete-list mode the button exposes.
     */
    const beforePrint = () => setStrategicFitPrintExportMode(true);
    const afterPrint = () => setStrategicFitPrintExportMode(false);
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);

    onCleanup(() => {
      compactQuery.removeEventListener("change", updateStageSemantics);
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
      setStrategicFitPrintExportMode(false);
    });
  });

  return (
    <>
      <Dialog
        title="Strategic Fit"
        labelledBy="strategic-fit-workspace-title"
        describedBy="strategic-fit-workspace-description"
        backdropClass="strategic-fit-workspace-backdrop"
        class="strategic-fit-workspace"
        unstyled
        inert={replacementLabSnapshot().open}
        onClose={close}
      >
        <div
          ref={dialog}
          class="strategic-fit-workspace-inner"
          onKeyDown={(event) => {
            event.stopPropagation();
          }}
        >
          {/*
            The header carried a kicker, a title, a description, a profile line and a status chip
            that repeated, word for word, the lifecycle sentence rendered directly beneath it. The
            duplicate chip is gone and the rest shares one baseline: the status has one home, one
            row below, where the control that changes it also lives.
          */}
          <PanelHeader class="strategic-fit-workspace-header">
            <div class="strategic-fit-workspace-identity">
              <h1 id="strategic-fit-workspace-title">Strategic Fit</h1>
              <p id="strategic-fit-workspace-description">
                Review strategic workload without changing the working repertoire.
              </p>
              <p class="strategic-fit-workspace-profile" aria-live="polite">
                <span>Profile</span> {profileSummary()}
              </p>
            </div>
            <div class="strategic-fit-workspace-header-actions">
              <button ref={closeButton} type="button" onClick={close}>
                Return to repertoire
              </button>
            </div>
          </PanelHeader>

          <Show
            when={profileReady()}
            fallback={
              <main class="strategic-fit-profile-loading">
                <RegionState
                  status="loading"
                  title="Loading profile settings"
                  message="Waiting for this repertoire's saved Strategic Fit preferences."
                />
              </main>
            }
          >
            <Show
              when={setupRequired()}
              fallback={
                <>
                  <AnalysisLifecycle />
                  {/*
                  WP-031 AC-2: a persistent banner while findings still render on partial evidence.
                  The `none` state never reaches here — it is replaced wholesale below.
                */}
                  <Show when={strategicFitEvidenceState() === "limited"}>
                    <p
                      class="strategic-fit-limited-evidence-banner"
                      data-limited-evidence-banner
                      role="note"
                    >
                      <strong>{STRATEGIC_FIT_EVIDENCE.limitedBannerTitle}</strong>{" "}
                      {STRATEGIC_FIT_EVIDENCE.limitedBanner}
                    </p>
                  </Show>
                  <nav
                    class="strategic-fit-stage-nav"
                    aria-label="Strategic Fit stages"
                    role={usesStageTabs() ? "tablist" : undefined}
                  >
                    <For each={STAGES}>
                      {(stage, index) => (
                        <button
                          id={`strategic-fit-stage-${stage.id}`}
                          type="button"
                          role={usesStageTabs() ? "tab" : undefined}
                          aria-controls={`strategic-fit-pane-${stage.id}`}
                          aria-current={
                            strategicFitWorkspaceStage() === stage.id ? "step" : undefined
                          }
                          data-stage-state={
                            index() <
                            STAGES.findIndex((item) => item.id === strategicFitWorkspaceStage())
                              ? "completed"
                              : strategicFitWorkspaceStage() === stage.id
                                ? "current"
                                : "upcoming"
                          }
                          aria-selected={
                            usesStageTabs() ? strategicFitWorkspaceStage() === stage.id : undefined
                          }
                          tabIndex={
                            usesStageTabs()
                              ? strategicFitWorkspaceStage() === stage.id
                                ? 0
                                : -1
                              : 0
                          }
                          class={strategicFitWorkspaceStage() === stage.id ? "active" : ""}
                          onClick={() => setStrategicFitWorkspaceStage(stage.id)}
                          onKeyDown={(event) => {
                            selectStageFromKeyboard(event, stage.id);
                          }}
                        >
                          {stage.label}
                          {/*
                            aria-hidden keeps the tab's accessible name exactly "Findings"; the
                            count is a fact about the queue, announced by the queue's own live
                            region rather than by the tab that leads to it.
                          */}
                          <Show when={stage.id === "findings" && unresolvedCount() !== null}>
                            <Status
                              tone="neutral"
                              class="strategic-fit-stage-count"
                              aria-hidden="true"
                            >
                              {unresolvedCount()}
                            </Status>
                          </Show>
                        </button>
                      )}
                    </For>
                  </nav>

                  <main
                    class="strategic-fit-workspace-body"
                    data-stage={strategicFitWorkspaceStage()}
                  >
                    <section
                      id="strategic-fit-pane-overview"
                      class="strategic-fit-workspace-pane strategic-fit-overview-pane"
                      role={usesStageTabs() ? "tabpanel" : "region"}
                      aria-labelledby={
                        usesStageTabs()
                          ? "strategic-fit-stage-overview"
                          : "strategic-fit-pane-overview-title"
                      }
                      tabIndex={0}
                    >
                      <PanelHeader
                        class="strategic-fit-pane-heading"
                        /* Not "Overview": the stage nav directly above already says that, and a
                           heading that repeats its own tab teaches the reader nothing. */
                        kicker="Report"
                        title="Strategic map"
                        titleId="strategic-fit-pane-overview-title"
                      />
                      <Show
                        when={currentOverview()}
                        fallback={
                          <RegionState
                            region="overview"
                            state={strategicFitWorkspaceRegions().overview}
                          />
                        }
                      >
                        {(report) => (
                          <>
                            <div class="strategic-fit-print-controls">
                              <button
                                type="button"
                                aria-pressed={strategicFitPrintExportMode()}
                                onClick={() =>
                                  setStrategicFitPrintExportMode((current) => !current)
                                }
                                data-strategic-fit-print-export-toggle
                              >
                                {strategicFitPrintExportMode()
                                  ? "Leave print and export view"
                                  : "Prepare for print or export"}
                              </button>
                              <Show when={strategicFitPrintExportMode()}>
                                <p
                                  class="strategic-fit-print-note"
                                  role="status"
                                  data-strategic-fit-print-note
                                >
                                  Every table equivalent lists its complete contents and every
                                  disclosure is open. Charts still group large sets, and each one
                                  says how many branches it grouped.
                                </p>
                              </Show>
                            </div>
                            <StrategicMap
                              report={report().result}
                              cohortName={(cohortId) =>
                                strategicFitCohortDisplayName(cohortId, cohortId)
                              }
                              completeFindings={
                                report().findings_snapshot ?? report().result.findings
                              }
                              onOpenFinding={(findingId) => {
                                openMapFinding(report().report_id, findingId);
                              }}
                            />
                            <ConceptHeatmap
                              report={report().result}
                              cohortName={(cohortId) =>
                                strategicFitCohortDisplayName(cohortId, cohortId)
                              }
                              completeFindings={
                                report().findings_snapshot ?? report().result.findings
                              }
                              mastery={strategicFitTrainingMastery()}
                              onOpenFinding={(findingId) => {
                                openHeatmapFinding(report().report_id, findingId);
                              }}
                            />
                            <DecisionFlow
                              report={report().result}
                              graph={decisionFlowGraph()}
                              graphRevision={`browser:${version()}`}
                              cohortName={(cohortId) =>
                                strategicFitCohortDisplayName(cohortId, cohortId)
                              }
                              completeFindings={
                                report().findings_snapshot ?? report().result.findings
                              }
                              onOpenFinding={(findingId) => {
                                openFlowFinding(report().report_id, findingId);
                              }}
                            />
                            <StrategicOverview
                              report={report().result}
                              unresolvedFindingCount={strategicFitFindingResolutionUnresolvedCount(
                                report().result,
                              )}
                              onReview={reviewOverviewItem}
                            />
                          </>
                        )}
                      </Show>
                      <IntentSuggestions />
                      <ReviewSummary />
                      <ProfileSettings />
                    </section>

                    {/*
                    WP-031 AC-1: with no comparable route there is nothing to show in these three
                    panes but a wall of "Insufficient evidence" rows. One terminal state replaces
                    them, naming the counts and what would change them. The overview pane and the
                    preflight results above are untouched, so the payload stays visible.
                  */}
                    <Show
                      when={strategicFitEvidenceState() !== "none"}
                      fallback={
                        <section
                          id="strategic-fit-pane-findings"
                          class="strategic-fit-workspace-pane strategic-fit-findings-pane"
                          role={usesStageTabs() ? "tabpanel" : "region"}
                          aria-labelledby={
                            usesStageTabs()
                              ? "strategic-fit-stage-findings"
                              : "strategic-fit-pane-findings-title"
                          }
                          tabIndex={0}
                        >
                          <PanelHeader
                            class="strategic-fit-pane-heading"
                            kicker="Review queue"
                            title="Findings"
                            titleId="strategic-fit-pane-findings-title"
                          />
                          <Show when={insufficientEvidencePreflight()}>
                            {(preflight) => (
                              <InsufficientEvidence
                                preflight={preflight()}
                                comparablePly={strategicFitComparablePlyThreshold()}
                                onAnalyzeAgain={() => {
                                  void analyzeStrategicFit();
                                }}
                              />
                            )}
                          </Show>
                        </section>
                      }
                    >
                      <section
                        id="strategic-fit-pane-findings"
                        class="strategic-fit-workspace-pane strategic-fit-findings-pane"
                        role={usesStageTabs() ? "tabpanel" : "region"}
                        aria-labelledby={
                          usesStageTabs()
                            ? "strategic-fit-stage-findings"
                            : "strategic-fit-pane-findings-title"
                        }
                        data-queue-filter={(() => {
                          const queueIntent = currentQueueIntent();
                          return queueIntent
                            ? strategicFitFindingQueueFilterKey(queueIntent.filter)
                            : "none";
                        })()}
                        tabIndex={0}
                      >
                        <PanelHeader
                          class="strategic-fit-pane-heading"
                          kicker="Review queue"
                          title="Findings"
                          titleId="strategic-fit-pane-findings-title"
                        />
                        <Show
                          when={currentFindings()}
                          fallback={
                            <RegionState
                              region="findings"
                              state={strategicFitWorkspaceRegions().findings}
                            />
                          }
                        >
                          {(report) => (
                            <FindingQueue
                              report={report()}
                              intent={currentQueueIntent()}
                              resolutionState={displayStrategicFitFindingResolution}
                              changedEvidenceSemanticIds={
                                strategicFitLifecycle().current_result?.reanalysis
                                  ?.changed_evidence_semantic_finding_ids ?? []
                              }
                              cohortName={(finding) =>
                                strategicFitCohortDisplayName(
                                  finding.evidence.cohort_id,
                                  finding.evidence.cohort_id,
                                )
                              }
                            />
                          )}
                        </Show>
                      </section>

                      <section
                        id="strategic-fit-pane-evidence"
                        class="strategic-fit-workspace-pane strategic-fit-evidence-pane"
                        role={usesStageTabs() ? "tabpanel" : "region"}
                        aria-labelledby={
                          usesStageTabs()
                            ? "strategic-fit-stage-evidence"
                            : "strategic-fit-pane-evidence-title"
                        }
                        tabIndex={0}
                      >
                        <PanelHeader
                          class="strategic-fit-pane-heading"
                          kicker="Branch review"
                          title="Evidence / comparison"
                          titleId="strategic-fit-pane-evidence-title"
                        />
                        <Show
                          when={currentEvidence()}
                          fallback={
                            <RegionState
                              region="evidence"
                              state={strategicFitWorkspaceRegions().evidence}
                            />
                          }
                        >
                          {(evidence) => (
                            <EvidencePanel
                              reportId={evidence().reportId}
                              finding={evidence().finding}
                              cohortName={evidence().cohortName}
                              trajectories={evidence().trajectories}
                              preflightIssues={evidence().preflightIssues}
                              repertoireColor={evidence().repertoireColor}
                              canNavigateToLine={(path) =>
                                resolveCurrentEvidenceLine(
                                  evidence().reportId,
                                  evidence().finding.finding_id,
                                  path,
                                ) !== null
                              }
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
                      </section>

                      <section
                        id="strategic-fit-pane-resolution"
                        class="strategic-fit-workspace-pane strategic-fit-resolution-pane"
                        role={usesStageTabs() ? "tabpanel" : "region"}
                        aria-labelledby={
                          usesStageTabs()
                            ? "strategic-fit-stage-resolution"
                            : "strategic-fit-pane-resolution-title"
                        }
                        tabIndex={0}
                      >
                        <PanelHeader
                          class="strategic-fit-pane-heading"
                          kicker="Next step"
                          title="Resolution"
                          titleId="strategic-fit-pane-resolution-title"
                        />
                        {/*
                        WP-033 AC-3: the stale-report block is a property of the report, not of the
                        viewport tier, so it renders here at every width rather than only in the
                        wide-tier copy that AC-2 removed.
                      */}
                        <Show when={strategicFitLifecycle().status === "stale"}>
                          <div
                            class="strategic-fit-resolution-blocked"
                            role="alert"
                            data-resolution-blocked
                          >
                            Resolution actions are blocked while this report is stale. Cohort
                            adjustment actions are also blocked. Analyze again before recording a
                            decision.
                          </div>
                        </Show>
                        <Show
                          when={currentResolution()}
                          fallback={
                            <RegionState region="resolution" state={resolutionFallbackState()} />
                          }
                        >
                          {(resolution) => (
                            <div class="strategic-fit-review-actions">
                              <ResolutionActions
                                completed={resolution().completed}
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
                    </Show>
                  </main>
                </>
              }
            >
              <ProfileSetup onComplete={focusAnalysisAction} />
            </Show>
          </Show>
        </div>
      </Dialog>
      {/*
        AC-5: the lab is a sibling of the workspace dialog, not a descendant. The workspace goes
        inert while the lab is open, and an inert subtree leaves the accessibility tree entirely —
        so a lab rendered inside it would have no accessible name to find.
      */}
      <Show when={replacementLabSnapshot().open}>
        <ReplacementLab />
      </Show>
    </>
  );
}
