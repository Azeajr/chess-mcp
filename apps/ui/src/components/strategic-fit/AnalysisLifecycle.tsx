import { Show } from "solid-js";
import {
  analyzeStrategicFit,
  cancelStrategicFitAnalysis,
  retryStrategicFitAnalysis,
  strategicFitLifecycle,
  type StrategicFitLifecycleStatus,
} from "../../store/strategic-fit";
import AnalysisProgress from "./AnalysisProgress";
import PreflightResults from "./PreflightResults";

export const STRATEGIC_FIT_LIFECYCLE_LABELS: Readonly<Record<StrategicFitLifecycleStatus, string>> = {
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

function actionLabel(status: StrategicFitLifecycleStatus): string {
  if (status === "completed") return "Analyze again";
  if (status === "cancelled" || status === "failed" || status === "stale") return "Retry analysis";
  return "Analyze strategic fit";
}

export default function AnalysisLifecycle() {
  const state = strategicFitLifecycle;
  const run = () => {
    const status = state().status;
    void (status === "cancelled" || status === "failed" || status === "stale"
      ? retryStrategicFitAnalysis()
      : analyzeStrategicFit());
  };

  return (
    <section
      class={`strategic-fit-analysis-lifecycle strategic-fit-analysis-${state().status}`}
      aria-label="Strategic Fit analysis"
      data-analysis-state={state().status}
    >
      <div class="strategic-fit-analysis-lifecycle-main">
        <div class="strategic-fit-analysis-lifecycle-copy" aria-live="polite">
          <strong>{STRATEGIC_FIT_LIFECYCLE_LABELS[state().status]}</strong>
          <Show when={state().status === "idle"}>
            <span>Run the engine-free structural review when you are ready.</span>
          </Show>
          <Show when={state().status === "running"}>
            <span>Preparing the current repertoire and profile.</span>
          </Show>
          <Show when={state().status === "provisional"}>
            <span>Work is underway. Nothing is current until the report completes.</span>
          </Show>
          <Show when={state().status === "completed" && state().current_result}>
            <span class="strategic-fit-analysis-report-id">
              Current report <code>{state().current_result!.report_id}</code>
            </span>
          </Show>
          <Show when={state().status === "cancelled"}>
            <span>Cancelled work was not published as a completed report.</span>
          </Show>
          <Show when={state().status === "failed" && state().error}>
            <span role="alert">{state().error!.message}</span>
          </Show>
          <Show when={state().status === "stale"}>
            <span>{state().stale_reason ?? "The previous report no longer matches current inputs."}</span>
          </Show>

          <Show when={state().last_completed && state().current_result !== state().last_completed}>
            <span class="strategic-fit-previous-report" data-report-current="false">
              Previous report—not current: <code>{state().last_completed!.report_id}</code>
            </span>
          </Show>
        </div>

        <div class="strategic-fit-analysis-actions">
          <Show when={isActive(state().status)} fallback={(
            <button type="button" data-strategic-fit-analysis-action onClick={run}>
              {actionLabel(state().status)}
            </button>
          )}>
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
        <AnalysisProgress state={state()} />
      </Show>
      <Show when={state().status === "completed" && state().current_result}>
        {(current) => <PreflightResults preflight={current().result.preflight} />}
      </Show>
    </section>
  );
}
