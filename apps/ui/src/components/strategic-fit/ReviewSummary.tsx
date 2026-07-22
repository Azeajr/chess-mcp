import { For, Show, createEffect, createSignal } from "solid-js";
import { saveArtifact } from "../../store/artifacts";
import { strategicFitLifecycle } from "../../store/strategic-fit";
import { strategicFitMetadata } from "../../store/strategic-fit-metadata";
import {
  completeStrategicFitReview,
  exportStrategicFitReviewSummary,
  reopenCompletedStrategicFitReview,
  strategicFitReview,
  synchronizeStrategicFitReview,
  type StrategicFitReviewActionResult,
  type StrategicFitReviewMetricDelta,
} from "../../store/strategic-fit-review";
import { STRATEGIC_FIT_DISPLAY_RESOLUTION_LABELS } from "./FindingCard";

function metricValue(value: number | null, unit: string): string {
  if (value === null) return "Unavailable";
  if (unit === "fraction") return `${Math.round(value * 100)}%`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function MetricDelta(props: { metric: StrategicFitReviewMetricDelta }) {
  return (
    <div data-review-metric={props.metric.metric_id} data-metric-state={props.metric.state}>
      <dt>{props.metric.label}</dt>
      <dd>
        <Show when={props.metric.state === "available"} fallback={(
          <span>Unavailable · {props.metric.reason}</span>
        )}>
          {metricValue(props.metric.before, props.metric.unit)} →{" "}
          {metricValue(props.metric.after, props.metric.unit)} ({props.metric.delta! > 0 ? "+" : ""}
          {metricValue(props.metric.delta, props.metric.unit)})
        </Show>
      </dd>
    </div>
  );
}

export default function ReviewSummary() {
  const [feedback, setFeedback] = createSignal<StrategicFitReviewActionResult | null>(null);
  createEffect(() => {
    strategicFitLifecycle();
    strategicFitMetadata();
    synchronizeStrategicFitReview();
  });

  const complete = () => setFeedback(completeStrategicFitReview());
  const reopen = (summaryId: string, semanticFindingId: string) => {
    setFeedback(reopenCompletedStrategicFitReview(summaryId, semanticFindingId));
  };
  const exportSummary = (summaryId: string) => {
    const result = exportStrategicFitReviewSummary(summaryId);
    setFeedback(result);
    if (result.artifact_id !== null) saveArtifact(result.artifact_id);
  };

  return (
    <section
      class="strategic-fit-review-summary"
      aria-labelledby="strategic-fit-review-summary-heading"
      data-review-state={strategicFitReview().status}
    >
      <header>
        <span>Finish the review</span>
        <h3 id="strategic-fit-review-summary-heading">Review completion</h3>
      </header>
      <p aria-live="polite">{strategicFitReview().message}</p>

      <Show when={strategicFitReview().status === "incomplete"}>
        <p class="strategic-fit-review-incomplete" data-unreviewed-count={
          strategicFitReview().unreviewed_semantic_finding_ids.length
        }>
          No completion record will be created while a current finding is unreviewed.
        </p>
      </Show>
      <Show when={strategicFitReview().status === "ready"}>
        <button type="button" onClick={complete}>Complete review</button>
      </Show>

      <Show when={strategicFitReview().current_summary}>{(summary) => (
        <div class="strategic-fit-review-completed" data-review-summary-id={summary().summary_id}>
          <dl class="strategic-fit-review-counts">
            <div><dt>Edits made</dt><dd>{summary().edits_made_semantic_finding_ids.length}</dd></div>
            <div><dt>Exceptions retained</dt><dd>{summary().retained_exception_semantic_finding_ids.length}</dd></div>
            <div><dt>Training items</dt><dd>{summary().training_item_ids.length}</dd></div>
            <div><dt>Deferred</dt><dd>{summary().deferred_semantic_finding_ids.length}</dd></div>
            <div><dt>Uncertain</dt><dd>{summary().uncertain_semantic_finding_ids.length}</dd></div>
          </dl>

          <h4>Before / after metrics</h4>
          <dl class="strategic-fit-review-metrics">
            <For each={summary().metric_deltas}>{(metric) => <MetricDelta metric={metric} />}</For>
          </dl>

          <p class="strategic-fit-review-provenance">
            Bound to report <code>{summary().report_id}</code>, revision{" "}
            <code>{summary().repertoire_revision}</code>, analysis{" "}
            <code>{summary().analysis_version}</code>.
          </p>

          <Show when={summary().resolutions.length > 0}>
            <h4>Reopen a decision</h4>
            <ul class="strategic-fit-review-resolutions">
              <For each={summary().resolutions}>{(resolution) => (
                <li>
                  <span>{STRATEGIC_FIT_DISPLAY_RESOLUTION_LABELS[resolution.state]}</span>
                  <code>{resolution.semantic_finding_id}</code>
                  <button
                    type="button"
                    onClick={() => reopen(summary().summary_id, resolution.semantic_finding_id)}
                  >Reopen {resolution.semantic_finding_id}</button>
                </li>
              )}</For>
            </ul>
          </Show>
          <button type="button" onClick={() => exportSummary(summary().summary_id)}>
            Save review summary JSON
          </button>
        </div>
      )}</Show>

      <Show when={strategicFitReview().history.length > 0 && strategicFitReview().current_summary === null}>
        <details class="strategic-fit-review-history">
          <summary>Review history ({strategicFitReview().history.length})</summary>
          <ol>
            <For each={[...strategicFitReview().history].reverse()}>{(entry) => (
              <li data-history-state={entry.state}>
                <strong>{entry.state === "completed" ? "Completed" : "Reopened"}</strong>{" "}
                revision <code>{entry.repertoire_revision}</code> · {entry.completed_at}
                <button type="button" onClick={() => exportSummary(entry.summary_id)}>
                  Save history JSON
                </button>
              </li>
            )}</For>
          </ol>
        </details>
      </Show>

      <Show when={feedback()?.message}>{(message) => (
        <p class="strategic-fit-review-feedback" role={feedback()?.state === "blocked" ? "alert" : "status"}>
          {message()}
        </p>
      )}</Show>
    </section>
  );
}
