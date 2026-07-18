import { For } from "solid-js";
import {
  STRATEGIC_FIT_PHASE_LABELS,
  type StrategicFitLifecycleSnapshot,
  type StrategicFitLifecycleStatus,
} from "../../store/strategic-fit";

function completedCount(state: StrategicFitLifecycleSnapshot): number {
  return state.phase_history.filter((phase) => phase.state === "completed").length;
}

function blocked(state: StrategicFitLifecycleSnapshot): boolean {
  return state.current_result?.result.preflight.state === "blocked";
}

export function analysisProgressAnnouncement(state: StrategicFitLifecycleSnapshot): string {
  const completed = completedCount(state);
  const active = state.phase_history.find((phase) => phase.state === "running");
  const cancelled = state.phase_history.find((phase) => phase.state === "cancelled");
  if (state.status === "completed" && blocked(state)) {
    return "Preflight blocked analysis after normalization. One of six phases completed; five dependent phases were not run.";
  }
  if (state.status === "completed") return "All six analysis phases completed.";
  if (state.status === "cancelled") {
    return `Analysis cancelled${cancelled ? ` during ${STRATEGIC_FIT_PHASE_LABELS[cancelled.phase]}` : ""}. ${completed} of six phases completed.`;
  }
  if (state.status === "failed") {
    return `Analysis stopped${cancelled ? ` during ${STRATEGIC_FIT_PHASE_LABELS[cancelled.phase]}` : ""}. ${completed} of six phases completed.`;
  }
  if (state.status === "stale") {
    return cancelled
      ? `Analysis stopped because its inputs changed during ${STRATEGIC_FIT_PHASE_LABELS[cancelled.phase]}. ${completed} of six phases completed.`
      : `The completed phase history belongs to an out-of-date report. ${completed} of six phases completed.`;
  }
  if (active) {
    return `Current phase: ${STRATEGIC_FIT_PHASE_LABELS[active.phase]}. ${completed} of six phases completed.`;
  }
  return "Analysis is preparing the first of six phases.";
}

function phaseStatusLabel(
  phaseState: StrategicFitLifecycleSnapshot["phase_history"][number]["state"],
  lifecycleStatus: StrategicFitLifecycleStatus,
  isBlocked: boolean,
): string {
  if (phaseState === "completed") return "Completed";
  if (phaseState === "running") return "Current";
  if (phaseState === "cancelled") {
    if (lifecycleStatus === "failed") return "Stopped when analysis failed";
    if (lifecycleStatus === "stale") return "Cancelled when inputs changed";
    return "Cancelled";
  }
  if (isBlocked) return "Not run — blocked by preflight";
  if (lifecycleStatus === "cancelled") return "Not run after cancellation";
  if (lifecycleStatus === "failed") return "Not run after failure";
  return "Pending";
}

export default function AnalysisProgress(props: { state: StrategicFitLifecycleSnapshot }) {
  const completed = () => completedCount(props.state);
  const isBlocked = () => blocked(props.state);

  return (
    <section
      class="strategic-fit-analysis-progress-card"
      data-progress-status={props.state.status}
      aria-labelledby="strategic-fit-analysis-phases-title"
    >
      <header>
        <div>
          <span>Deterministic analysis</span>
          <h2 id="strategic-fit-analysis-phases-title">Analysis phases</h2>
        </div>
        <span class="strategic-fit-analysis-progress-count" aria-hidden="true">
          {completed()} of 6 complete
        </span>
      </header>
      <progress
        aria-label={`${completed()} of 6 Strategic Fit phases complete`}
        value={completed()}
        max={6}
      />
      <p class="strategic-fit-analysis-progress-live" role="status" aria-live="polite">
        {analysisProgressAnnouncement(props.state)}
      </p>
      <ol class="strategic-fit-analysis-phase-list">
        <For each={props.state.phase_history}>{(entry, index) => (
          <li data-phase={entry.phase} data-phase-state={entry.state}>
            <span class="strategic-fit-analysis-phase-marker" aria-hidden="true">{index() + 1}</span>
            <span class="strategic-fit-analysis-phase-name">{STRATEGIC_FIT_PHASE_LABELS[entry.phase]}</span>
            <span class="strategic-fit-analysis-phase-status">
              {phaseStatusLabel(entry.state, props.state.status, isBlocked())}
            </span>
          </li>
        )}</For>
      </ol>
    </section>
  );
}
