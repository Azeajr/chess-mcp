import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import Status from "./primitives/Status";
import ProfileSetup from "./strategic-fit/ProfileSetup";
import AnalysisLifecycle from "./strategic-fit/AnalysisLifecycle";
import { STRATEGIC_FIT_PROFILE_LABELS } from "../content/strategicFit";
import StrategicOverview, { type StrategicOverviewItemId } from "./strategic-fit/StrategicOverview";
import StrategicAssessment from "./strategic-fit/StrategicAssessment";
import StrategicMap from "./strategic-fit/StrategicMap";
import ConceptHeatmap from "./strategic-fit/ConceptHeatmap";
import DecisionFlow from "./strategic-fit/DecisionFlow";
import FindingQueue from "./strategic-fit/FindingQueue";
import { selectStrategicFitFinding } from "./strategic-fit/finding-navigation";
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
  strategicFitLastResolutionAction,
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
  setStrategicFitFindingQueueIntent,
  setStrategicFitPrintExportMode,
  setStrategicFitSettingsAnnouncement,
  setStrategicFitWorkspaceOpen,
  setStrategicFitWorkspaceStage,
  strategicFitFindingQueueFilterKey,
  strategicFitFindingQueueIntent,
  strategicFitPrintExportMode,
  strategicFitWorkspaceRegions,
  strategicFitWorkspaceStage,
  type StrategicFitFindingQueueFilter,
  type StrategicFitWorkspaceStage,
} from "../store/ui";
import { replacementLab, replacementLabSnapshot } from "../store/strategic-fit-replacement";
import { strategicFitTrainingMastery } from "../store/strategic-fit-training";
import Dialog from "./primitives/Dialog";
import PanelHeader from "./primitives/PanelHeader";
import RegionState from "./primitives/RegionState";
import { buildStrategicFindingStory } from "./strategic-fit/finding-story";

const STAGES: readonly { id: StrategicFitWorkspaceStage; label: string }[] = [
  { id: "overview", label: "Assessment" },
  { id: "findings", label: "Review" },
  { id: "evidence", label: "Branch" },
];

export default function StrategicFitWorkspace() {
  let dialog!: HTMLDivElement;
  let closeButton!: HTMLButtonElement;
  const [usesStageTabs, setUsesStageTabs] = createSignal(false);

  const close = () => {
    if (replacementLabSnapshot().open) replacementLab.close();
    setStrategicFitSettingsAnnouncement("");
    setStrategicFitWorkspaceOpen(false);
  };
  const profileReady = () => strategicFitMetadataStatus() === "ready";
  const setupRequired = () => profileReady() && strategicFitProfileSetupRequired();
  const profileSummary = () => {
    const profile = strategicFitProfile();
    return STRATEGIC_FIT_PROFILE_LABELS[profile.mode];
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
  const unresolvedCount = () => {
    const lifecycle = strategicFitLifecycle();
    const result = lifecycle.status === "completed" ? lifecycle.current_result : null;
    return result ? strategicFitFindingResolutionUnresolvedCount(result.result) : null;
  };
  const remainingUnresolved = () => {
    const selected = strategicFitFindingQueue.snapshot().selected_finding_id;
    return strategicFitFindingQueue
      .view(displayStrategicFitFindingResolution)
      .filtered_findings.filter(
        (finding) =>
          finding.finding_id !== selected &&
          displayStrategicFitFindingResolution(finding) === "unresolved",
      );
  };
  const currentFindings = () => {
    const lifecycle = strategicFitLifecycle();
    return lifecycle.status === "completed" &&
      lifecycle.current_result &&
      strategicFitWorkspaceRegions().findings.status === "empty"
      ? lifecycle.current_result.result
      : null;
  };
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
  // Recording a resolution takes the finding out of review, which unmounts the card that reports
  // what was recorded: the pane emptied to "No resolution selected" the instant a decision was
  // saved, and the only trace was the analyzer's reconcile line at the top of the workspace.
  const lastResolutionAction = () => strategicFitLastResolutionAction();
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

  const openAssessmentQueue = () => {
    if (!currentOverview()) return;
    setStrategicFitFindingQueueIntent(null);
    setStrategicFitWorkspaceStage("findings");
  };

  createEffect(() => {
    const stage = strategicFitWorkspaceStage();
    const queue = strategicFitFindingQueue.snapshot();
    if (stage !== "evidence" || queue.status !== "ready") return;
    if (queue.selected_finding_id === null) {
      const next = strategicFitFindingQueue
        .view(displayStrategicFitFindingResolution)
        .filtered_findings.find(
          (finding) => displayStrategicFitFindingResolution(finding) === "unresolved",
        );
      if (next) strategicFitFindingQueue.selectFinding(next.finding_id);
    }
  });

  createEffect(() => {
    const stage = strategicFitWorkspaceStage();
    const selected = strategicFitFindingQueue.snapshot().selected_finding_id;
    if (stage !== "evidence" || selected === null) return;
    queueMicrotask(() => {
      dialog
        ?.querySelector<HTMLElement>("#strategic-fit-pane-evidence")
        ?.scrollTo({ top: 0, behavior: "auto" });
    });
  });

  onMount(() => {
    const compactQuery = window.matchMedia("(max-width: 820px)");
    const updateStageSemantics = () => setUsesStageTabs(compactQuery.matches);
    updateStageSemantics();
    compactQuery.addEventListener("change", updateStageSemantics);

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
                <span>Review preference</span> {profileSummary()}
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
                        kicker={currentOverview() ? "Recognize" : "Report"}
                        title="Your repertoire"
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
                            <StrategicAssessment
                              report={report().result}
                              findings={report().findings_snapshot ?? report().result.findings}
                              resolutionState={displayStrategicFitFindingResolution}
                              onReviewAll={openAssessmentQueue}
                              onOpenFinding={(findingId) =>
                                selectStrategicFitFinding(findingId, true)
                              }
                            />
                            <details class="strategic-fit-advanced-report">
                              <summary>Explore the full analysis</summary>
                              <p>
                                Open the maps, metrics, and analysis settings when you need to audit
                                how this assessment was produced.
                              </p>
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
                              <StrategicOverview
                                report={report().result}
                                unresolvedFindingCount={strategicFitFindingResolutionUnresolvedCount(
                                  report().result,
                                )}
                                onReview={reviewOverviewItem}
                              />
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
                              <IntentSuggestions />
                              <ReviewSummary />
                              <ProfileSettings />
                            </details>
                          </>
                        )}
                      </Show>
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
                          kicker="Review"
                          title="What deserves attention"
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
                          kicker={currentEvidence() ? "Understand" : "Branch review"}
                          title={
                            currentEvidence() ? "Understand this branch" : "Evidence / comparison"
                          }
                          titleId="strategic-fit-pane-evidence-title"
                        >
                          <Show when={currentEvidence()}>
                            <nav
                              class="strategic-fit-detail-navigation"
                              aria-label="Branch review navigation"
                            >
                              <button
                                type="button"
                                onClick={() => setStrategicFitWorkspaceStage("findings")}
                              >
                                All results
                              </button>
                              <Show when={remainingUnresolved()[0]}>
                                {(next) => (
                                  <button
                                    type="button"
                                    data-evidence-next-finding
                                    onClick={() =>
                                      selectStrategicFitFinding(next().finding_id, true)
                                    }
                                  >
                                    Next result
                                  </button>
                                )}
                              </Show>
                            </nav>
                          </Show>
                        </PanelHeader>
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
                            <>
                              <Show when={lastResolutionAction()}>
                                {(action) => (
                                  <p
                                    class="strategic-fit-resolution-feedback"
                                    role={action().state === "blocked" ? "alert" : "status"}
                                    data-resolution-last-action={action().state}
                                  >
                                    {action().message}
                                  </p>
                                )}
                              </Show>
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
                                  close();
                                  requestAnimationFrame(() => {
                                    document
                                      .querySelector<HTMLElement>(".workspace")
                                      ?.scrollTo({ top: 0, behavior: "auto" });
                                  });
                                  return true;
                                }}
                              />
                              <Show
                                when={
                                  buildStrategicFindingStory(evidence().finding).kind !== "gap" &&
                                  evidence().finding.classification !==
                                    "transpositional-equivalence" &&
                                  currentResolution()
                                }
                              >
                                {(resolution) => (
                                  <section
                                    id="strategic-fit-inline-actions"
                                    class="strategic-fit-inline-actions"
                                    aria-labelledby="strategic-fit-inline-actions-title"
                                  >
                                    <PanelHeader
                                      kicker="Decide"
                                      title="What do you want to do?"
                                      titleId="strategic-fit-inline-actions-title"
                                    />
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
                                    <details class="strategic-fit-inline-adjustment">
                                      <summary>Change how this branch is grouped</summary>
                                      <CohortEditor
                                        reportId={resolution().reportId}
                                        report={resolution().report}
                                        finding={resolution().finding}
                                      />
                                    </details>
                                  </section>
                                )}
                              </Show>
                            </>
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
