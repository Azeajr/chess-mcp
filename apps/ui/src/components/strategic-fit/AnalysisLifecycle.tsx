import { Show } from "solid-js";
import {
  analyzeStrategicFit,
  cancelStrategicFitAnalysis,
  retryStrategicFitAnalysis,
  strategicFitLifecycle,
  strategicFitEvidenceState,
  type StrategicFitEvidenceState,
  type StrategicFitLifecycleStatus,
} from "../../store/strategic-fit";
import AnalysisProgress from "./AnalysisProgress";
import PreflightResults from "./PreflightResults";
import {
  strategicFitAnalysisPhasesExpanded,
  setStrategicFitAnalysisPhasesExpanded,
  strategicFitPreflightExpanded,
  setStrategicFitPreflightExpanded,
  strategicFitPrintExportMode,
} from "../../store/ui";

export const STRATEGIC_FIT_LIFECYCLE_LABELS: Readonly<Record<StrategicFitLifecycleStatus, string>> =
  {
    idle: "Analysis not started",
    running: "Analysis starting",
    provisional: "Analysis in progress",
    completed: "Analysis complete",
    cancelled: "Analysis cancelled",
    failed: "Analysis failed",
    stale: "Analysis out of date",
  };

const isActive = (status: StrategicFitLifecycleStatus) =>
  status === "running" || status === "provisional";

const STRATEGIC_FIT_LIMITED_EVIDENCE_LABEL = "Analysis finished — limited evidence";

export function lifecycleLabel(
  status: StrategicFitLifecycleStatus,
  evidence: StrategicFitEvidenceState | null,
): string {
  if (status === "completed" && (evidence === "limited" || evidence === "none")) {
    return STRATEGIC_FIT_LIMITED_EVIDENCE_LABEL;
  }
  return STRATEGIC_FIT_LIFECYCLE_LABELS[status];
}

function actionLabel(status: StrategicFitLifecycleStatus): string {
  if (status === "completed") return "Analyze again";
  if (status === "cancelled" || status === "failed" || status === "stale") return "Retry analysis";
  return "Analyze strategic fit";
}

export default function AnalysisLifecycle() {
  const state = strategicFitLifecycle;
  const run = () => {
    const status = state().status;
    setStrategicFitAnalysisPhasesExpanded(false);
    setStrategicFitPreflightExpanded(false);
    void (status === "cancelled" || status === "failed" || status === "stale"
      ? retryStrategicFitAnalysis()
      : analyzeStrategicFit());
  };

  return (
    <section
      class={`strategic-fit-analysis-lifecycle strategic-fit-analysis-${state().status}`}
      aria-label="Strategic Fit analysis"
      data-analysis-state={state().status}
      data-evidence-state={strategicFitEvidenceState() ?? "none-applicable"}
    >
      <div class="strategic-fit-analysis-lifecycle-main">
        <div class="strategic-fit-analysis-lifecycle-copy" aria-live="polite">
          <strong>{lifecycleLabel(state().status, strategicFitEvidenceState())}</strong>
          <Show when={state().status === "idle"}>
            <span>Run the engine-free structural review when you are ready.</span>
          </Show>
          <Show when={state().status === "running"}>
            <span>Preparing the current repertoire and profile.</span>
          </Show>
          <Show when={state().status === "provisional"}>
            <span>Work is underway. Nothing is current until the report completes.</span>
          </Show>
          {/*
            The report id is a support handle, not a fact about the repertoire. Printed inline as
            "Current report report:findings:browser:1:automatic" it was the widest, most technical
            string in the workspace's status line, sitting between the verdict and the controls
            that act on it. It stays present, selectable and copyable — and now labelled on hover
            rather than in the sentence — but it no longer competes with the verdict.
          */}
          <Show when={state().status === "completed" && state().current_result}>
            {(result) => (
              <span class="strategic-fit-analysis-report-id" title="Current report id">
                <code>{result().report_id}</code>
              </span>
            )}
          </Show>
          <Show when={state().status === "completed" && state().current_result?.reanalysis}>
            {(summary) => (
              <span
                class="strategic-fit-reanalysis-summary"
                data-reanalysis-scope={summary().scope.kind}
                data-resolving-revision={summary().resolving_revision}
              >
                Reconciled{" "}
                {summary().scope.kind === "full-scan"
                  ? "the full report"
                  : `${summary().scope.cohort_ids.length} affected cohort(s)`}{" "}
                at revision <code>{summary().resolving_revision}</code>:{" "}
                {summary().auto_resolved_semantic_finding_ids.length} disappeared finding(s)
                resolved, {summary().changed_evidence_semantic_finding_ids.length} changed-evidence
                finding(s) reopened, and {summary().reappeared_semantic_finding_ids.length}{" "}
                finding(s) reappeared.
              </span>
            )}
          </Show>
          <Show when={state().status === "cancelled"}>
            <span>Cancelled work was not published as a completed report.</span>
          </Show>
          <Show when={state().status === "failed" && state().error}>
            {(error) => <span role="alert">{error().message}</span>}
          </Show>
          <Show when={state().status === "stale"}>
            <span>
              {state().stale_reason ?? "The previous report no longer matches current inputs."}
            </span>
          </Show>

          <Show
            when={
              state().last_completed && state().current_result !== state().last_completed
                ? state().last_completed
                : null
            }
          >
            {(result) => (
              <span class="strategic-fit-previous-report" data-report-current="false">
                Previous report—not current: <code>{result().report_id}</code>
              </span>
            )}
          </Show>
        </div>

        <div class="strategic-fit-analysis-actions">
          <Show
            when={isActive(state().status)}
            fallback={
              <button type="button" data-strategic-fit-analysis-action onClick={run}>
                {actionLabel(state().status)}
              </button>
            }
          >
            <button
              type="button"
              class="secondary"
              data-strategic-fit-analysis-action
              onClick={cancelStrategicFitAnalysis}
            >
              Cancel analysis
            </button>
          </Show>
        </div>
      </div>

      <Show when={state().request_id !== null}>
        <AnalysisProgress
          state={state()}
          collapsed={
            state().status === "completed" &&
            !strategicFitAnalysisPhasesExpanded() &&
            !strategicFitPrintExportMode()
          }
          onToggle={() =>
            setStrategicFitAnalysisPhasesExpanded(!strategicFitAnalysisPhasesExpanded())
          }
        />
      </Show>
      <Show when={state().status === "completed" && state().current_result}>
        {(current) => (
          <PreflightResults
            preflight={current().result.preflight}
            collapsed={!strategicFitPreflightExpanded() && !strategicFitPrintExportMode()}
            onToggle={() => setStrategicFitPreflightExpanded(!strategicFitPreflightExpanded())}
          />
        )}
      </Show>
    </section>
  );
}
