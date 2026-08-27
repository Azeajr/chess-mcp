import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import ProfileSetup from "./strategic-fit/ProfileSetup";
import AnalysisLifecycle, { lifecycleLabel } from "./strategic-fit/AnalysisLifecycle";
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
import { pushShortcutScope } from "../store/shortcuts";
import { openerFallback } from "./primitives/Dialog";
import PanelHeader from "./primitives/PanelHeader";
import RegionState from "./primitives/RegionState";
import Status from "./primitives/Status";

const STAGES: readonly { id: StrategicFitWorkspaceStage; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "findings", label: "Findings" },
  { id: "evidence", label: "Evidence" },
  { id: "resolution", label: "Resolution" },
];

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

/**
 * A closed `<details>` still lays its content out: Chromium puts that content in a
 * `content-visibility: hidden` subtree whose descendants keep non-empty client rects, so a
 * rect-based visibility test alone leaves every collapsed "Advanced preferences" control in the
 * focus-trap candidate list. `.focus()` silently no-ops on them, which parked keyboard focus on
 * the summary permanently. Only the summary itself is reachable while its details is closed.
 */
const insideCollapsedDetails = (element: HTMLElement) => {
  const collapsed = element.closest("details:not([open])");
  if (collapsed === null) return false;
  return !(element.tagName === "SUMMARY" && element.parentElement === collapsed);
};

export default function StrategicFitWorkspace() {
  let dialog!: HTMLElement;
  let closeButton!: HTMLButtonElement;
  let returnFocus: HTMLElement | null = null;
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
  const resolutionFallbackState = (): StrategicFitWorkspaceRegionState => {
    const lifecycle = strategicFitLifecycle();
    if (lifecycle.status === "stale") {
      return {
        status: "error",
        message:
          "Resolution actions are blocked while this report is stale. Cohort adjustment actions are also blocked. Analyze again before recording a decision.",
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
  const focusable = () => {
    const raw = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) =>
        element.getClientRects().length > 0 &&
        element.getAttribute("aria-hidden") !== "true" &&
        // Roving-tabindex members (the unselected stage tabs) match `button:not([disabled])` but
        // are deliberately not Tab stops — arrow keys move within the tablist instead.
        element.getAttribute("tabindex") !== "-1" &&
        !insideCollapsedDetails(element),
    );
    // Native radio-group semantics: same `name` is one Tab stop (the checked radio, or the first
    // if none checked) — arrow keys, not Tab, move the selection within the group. Explicitly
    // driving Tab over every individual radio broke this (Tab from the header close button
    // stopped landing on the checked "Balanced" radio) — the trap now has to preserve the same
    // grouping browsers already give it for free.
    const groupRepresentative = new Map<string, HTMLInputElement>();
    for (const element of raw) {
      if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.name)
        continue;
      if (element.checked || !groupRepresentative.has(element.name)) {
        groupRepresentative.set(element.name, element);
      }
    }
    return raw.filter((element) => {
      if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.name)
        return true;
      return groupRepresentative.get(element.name) === element;
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
    // document.body is not a focus target — restoring to it is indistinguishable from restoring
    // nothing, and accepting it here is what silently hid the missing opener focus above.
    const activeOnOpen = document.activeElement;
    const focusedOpener =
      activeOnOpen instanceof HTMLElement && activeOnOpen !== document.body ? activeOnOpen : null;
    returnFocus = focusedOpener ?? openerFallback();
    const compactQuery = window.matchMedia("(max-width: 820px)");
    const updateStageSemantics = () => setUsesStageTabs(compactQuery.matches);
    updateStageSemantics();
    compactQuery.addEventListener("change", updateStageSemantics);

    const trapFocus = (event: KeyboardEvent) => {
      if (replacementLabSnapshot().open) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          replacementLab.close();
        }
        return;
      }
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
      // Always move focus explicitly, not just at the wrap boundary. macOS Safari's default
      // "Full Keyboard Access" setting (off by default — most Mac users have it off) makes
      // native Tab skip every <button> entirely, jumping straight from the last text-like
      // control to nothing tabbable; only JS-driven .focus() calls bypass that restriction.
      // Real accessibility bug, not a test artifact: confirmed via real VoiceOver/macOS CI runs
      // (guidepup, real macOS runner) reproducing an identical Tab-loses-focus pattern every
      // time it ran on real macOS WebKit, never once on headless Linux WebKit — same dialog,
      // same DOM, only the OS's native Tab semantics differed.
      const active = document.activeElement;
      const activeIndex = candidates.findIndex((element) => element === active);
      event.preventDefault();
      if (event.shiftKey) {
        const prevIndex = activeIndex <= 0 ? candidates.length - 1 : activeIndex - 1;
        candidates[prevIndex]?.focus();
      } else {
        const nextIndex =
          activeIndex === -1 || activeIndex === candidates.length - 1 ? 0 : activeIndex + 1;
        candidates[nextIndex]?.focus();
      }
    };

    /**
     * Task 10.4 print/export. Printing must not silently drop the rows a render cap withheld, so
     * the browser's own print flow turns on the same complete-list mode the button exposes.
     */
    const beforePrint = () => setStrategicFitPrintExportMode(true);
    const afterPrint = () => setStrategicFitPrintExportMode(false);
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);

    // The workspace is not on the Dialog primitive yet (WP-033 migrates it), but it is an overlay,
    // so it declares itself one: the scope suspends global shortcuts and holds .app-main inert,
    // replacing App.tsx's former strategicFitWorkspaceOpen() early return.
    const disposeScope = pushShortcutScope("workspace");
    document.addEventListener("keydown", trapFocus, true);
    closeButton.focus();
    onCleanup(() => {
      disposeScope();
      document.removeEventListener("keydown", trapFocus, true);
      compactQuery.removeEventListener("change", updateStageSemantics);
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
      setStrategicFitPrintExportMode(false);
      // Re-assert across the next frames rather than restoring once. Real macOS WebKit resets the
      // document's focus to the body *after* this cleanup runs, because the element that had focus
      // (something inside the dialog) was just removed — so a single restore lands and is then
      // wiped, leaving the opener unfocused. Run 32226854386's probe ruled out every other
      // candidate: at that point the opener is connected, has no `inert` ancestor, the dialog is
      // gone, and an explicit focus() from the probe itself takes immediately. Only the timing was
      // ever wrong. Chromium and Firefox do that reset synchronously during removal, before this
      // callback, which is why they never needed more than one attempt.
      const restoreFocus = (attemptsLeft: number) => {
        const target = returnFocus;
        if (!target?.isConnected) return;
        if (document.activeElement !== target) target.focus();
        if (attemptsLeft > 0) {
          requestAnimationFrame(() => {
            restoreFocus(attemptsLeft - 1);
          });
        }
      };
      queueMicrotask(() => {
        restoreFocus(2);
      });
    });
  });

  return (
    <div class="strategic-fit-workspace-backdrop">
      <section
        ref={dialog}
        class="strategic-fit-workspace"
        role="dialog"
        aria-modal="true"
        inert={replacementLabSnapshot().open}
        aria-hidden={replacementLabSnapshot().open ? "true" : undefined}
        aria-labelledby="strategic-fit-workspace-title"
        aria-describedby="strategic-fit-workspace-description"
        tabIndex={-1}
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
      >
        <PanelHeader class="strategic-fit-workspace-header">
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
            <Status class="strategic-fit-workspace-status">
              {lifecycleLabel(strategicFitLifecycle().status, strategicFitEvidenceState())}
            </Status>
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
                    {(stage) => (
                      <button
                        id={`strategic-fit-stage-${stage.id}`}
                        type="button"
                        role={usesStageTabs() ? "tab" : undefined}
                        aria-controls={`strategic-fit-pane-${stage.id}`}
                        aria-selected={
                          usesStageTabs() ? strategicFitWorkspaceStage() === stage.id : undefined
                        }
                        tabIndex={
                          usesStageTabs() ? (strategicFitWorkspaceStage() === stage.id ? 0 : -1) : 0
                        }
                        class={strategicFitWorkspaceStage() === stage.id ? "active" : ""}
                        onClick={() => setStrategicFitWorkspaceStage(stage.id)}
                        onKeyDown={(event) => {
                          selectStageFromKeyboard(event, stage.id);
                        }}
                      >
                        {stage.label}
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
                      kicker="Overview"
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
                              onClick={() => setStrategicFitPrintExportMode((current) => !current)}
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
                                disclosure is open. Charts still group large sets, and each one says
                                how many branches it grouped.
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
                      <Show when={!usesStageTabs() && currentResolution()}>
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
                      <Show when={!usesStageTabs() && strategicFitLifecycle().status === "stale"}>
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
                      <Show
                        when={usesStageTabs() && currentResolution()}
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
      </section>
      <Show when={replacementLabSnapshot().open}>
        <ReplacementLab />
      </Show>
    </div>
  );
}
