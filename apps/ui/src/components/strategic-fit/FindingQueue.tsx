import { For, Show, createEffect } from "solid-js";
import {
  STRATEGIC_FIT_FINDING_SORTS,
  type FindingPriorityKind,
  type FindingPriorityLabel,
  type StrategicFitAnalysisResult,
  type StrategicFitFindingSort,
} from "@chess-mcp/chess-tools";
import {
  STRATEGIC_FIT_QUEUE_PAGE_SIZE,
  strategicFitFindingQueue,
  type StrategicFitQueuePriorityFilter,
} from "../../store/strategic-fit-finding-queue";
import {
  setStrategicFitFindingQueueIntent,
  type StrategicFitFindingQueueIntent,
} from "../../store/ui";
import FindingCard from "./FindingCard";

const SORT_LABELS: Readonly<Record<StrategicFitFindingSort, string>> = {
  "replacement-priority": "Replacement priority",
  "training-priority": "Training priority",
  "expected-frequency": "Expected frequency",
  "opening-scope": "Opening / system",
  "finding-id": "Finding identity",
};

const PRIORITY_KIND_LABELS: Readonly<Record<FindingPriorityKind, string>> = {
  replacement: "Replacement",
  training: "Training",
};

const PRIORITY_FILTER_LABELS: Readonly<Record<StrategicFitQueuePriorityFilter, string>> = {
  all: "All priorities",
  "review-now": "Review now",
  "review-later": "Review later",
  informational: "Informational",
  "insufficient-evidence": "Insufficient evidence",
};

const PRIORITY_FILTERS: readonly StrategicFitQueuePriorityFilter[] = [
  "all",
  "review-now",
  "review-later",
  "informational",
  "insufficient-evidence",
];

export default function FindingQueue(props: {
  report: StrategicFitAnalysisResult;
  intent: StrategicFitFindingQueueIntent | null;
}) {
  createEffect(() => {
    void strategicFitFindingQueue.synchronize(props.report, props.intent);
  });

  const state = () => strategicFitFindingQueue.snapshot();
  const view = () => strategicFitFindingQueue.view();
  const range = () => view().page.total_count === 0
    ? "0"
    : `${view().page.offset + 1}–${view().page.offset + view().page.returned_count}`;
  const clearFilters = () => {
    setStrategicFitFindingQueueIntent(null);
    strategicFitFindingQueue.setPriorityKind("replacement");
    strategicFitFindingQueue.setPriorityFilter("all");
    strategicFitFindingQueue.setOpeningFilter("");
  };
  const hasActiveFilters = () => state().intent !== null ||
    state().priority_filter !== "all" || state().opening_filter !== "";
  const selectedFindingLabel = () => state().findings.find((finding) =>
    finding.finding_id === state().selected_finding_id
  )?.plain_language_category ?? null;

  return (
    <section
      class="strategic-fit-finding-queue"
      aria-label="Strategic Fit finding queue"
      data-queue-report-id={state().report_id ?? ""}
      data-queue-status={state().status}
    >
      <Show when={state().status === "loading"}>
        <div class="strategic-fit-region-state" role="status" aria-live="polite">
          <span class="strategic-fit-region-spinner" aria-hidden="true" />
          <div>
            <strong>Loading the complete finding queue</strong>
            <p>Reading canonical report pages without starting a new analysis.</p>
          </div>
        </div>
      </Show>
      <Show when={state().status === "error"}>
        <div class="strategic-fit-region-state strategic-fit-region-error" role="alert">
          <div>
            <strong>Finding queue unavailable</strong>
            <p>{state().error ?? "The current report pages could not be read."}</p>
          </div>
        </div>
      </Show>

      <Show when={state().status === "ready"}>
        <Show when={state().intent}>
          {(intent) => (
            <div class="strategic-fit-queue-intent-banner" role="status">
              <div>
                <strong>{intent().label}</strong>
                <p>Focused from the overview for this report. No repertoire change was made.</p>
              </div>
              <button type="button" onClick={() => setStrategicFitFindingQueueIntent(null)}>
                Show all report findings
              </button>
            </div>
          )}
        </Show>

        <div class="strategic-fit-queue-controls" aria-label="Finding queue controls">
          <div>
            <label for="strategic-fit-finding-sort">Sort findings</label>
            <select
              id="strategic-fit-finding-sort"
              value={state().sort}
              onInput={(event) => strategicFitFindingQueue.setSort(
                event.currentTarget.value as StrategicFitFindingSort,
              )}
            >
              <For each={STRATEGIC_FIT_FINDING_SORTS}>{(sort) => (
                <option value={sort}>{SORT_LABELS[sort]}</option>
              )}</For>
            </select>
          </div>
          <div>
            <label for="strategic-fit-priority-kind">Priority type</label>
            <select
              id="strategic-fit-priority-kind"
              value={state().priority_kind}
              onInput={(event) => strategicFitFindingQueue.setPriorityKind(
                event.currentTarget.value as FindingPriorityKind,
              )}
            >
              <For each={["replacement", "training"] as const}>{(kind) => (
                <option value={kind}>{PRIORITY_KIND_LABELS[kind]}</option>
              )}</For>
            </select>
          </div>
          <div>
            <label for="strategic-fit-priority-filter">Priority</label>
            <select
              id="strategic-fit-priority-filter"
              value={state().priority_filter}
              onInput={(event) => strategicFitFindingQueue.setPriorityFilter(
                event.currentTarget.value as FindingPriorityLabel | "all",
              )}
            >
              <For each={PRIORITY_FILTERS}>{(filter) => (
                <option value={filter}>{PRIORITY_FILTER_LABELS[filter]}</option>
              )}</For>
            </select>
          </div>
          <div>
            <label for="strategic-fit-opening-filter">Opening / system</label>
            <select
              id="strategic-fit-opening-filter"
              value={state().opening_filter}
              onInput={(event) => strategicFitFindingQueue.setOpeningFilter(event.currentTarget.value)}
            >
              <option value="">All openings / systems</option>
              <For each={view().opening_options}>{(opening) => (
                <option value={opening}>{opening}</option>
              )}</For>
            </select>
          </div>
        </div>

        <div class="strategic-fit-queue-summary">
          <p
            aria-live="polite"
            data-page-offset={view().page.offset}
            data-page-limit={view().page.limit}
            data-page-total={view().page.total_count}
            data-canonical-total={view().canonical_total_count}
          >
            Showing {range()} of {view().page.total_count} matching findings · {view().canonical_total_count} in this report
          </p>
          <Show when={hasActiveFilters()}>
            <button type="button" onClick={clearFilters}>Clear queue filters</button>
          </Show>
        </div>

        <Show when={view().page.total_count > 0} fallback={(
          <div class="strategic-fit-queue-empty">
            <strong>No findings match this queue view</strong>
            <p>Adjust the overview focus, priority, or opening filter.</p>
          </div>
        )}>
          <ol class="strategic-fit-finding-list" data-finding-list>
            <For each={view().findings}>{(finding) => (
              <li>
                <FindingCard
                  finding={finding}
                  selected={state().selected_finding_id === finding.finding_id}
                  onSelect={(findingId) => strategicFitFindingQueue.selectFinding(findingId)}
                />
              </li>
            )}</For>
          </ol>
        </Show>

        <nav class="strategic-fit-queue-pagination" aria-label="Finding pages">
          <button
            type="button"
            disabled={view().page.offset === 0}
            onClick={() => strategicFitFindingQueue.setPageOffset(
              view().page.offset - STRATEGIC_FIT_QUEUE_PAGE_SIZE,
            )}
          >Previous findings</button>
          <span>
            Page {view().page.total_count === 0
              ? 0
              : Math.floor(view().page.offset / STRATEGIC_FIT_QUEUE_PAGE_SIZE) + 1} of {Math.ceil(
                view().page.total_count / STRATEGIC_FIT_QUEUE_PAGE_SIZE,
              )}
          </span>
          <button
            type="button"
            disabled={!view().page.has_more}
            onClick={() => strategicFitFindingQueue.setPageOffset(
              view().page.offset + STRATEGIC_FIT_QUEUE_PAGE_SIZE,
            )}
          >Next findings</button>
        </nav>

        <p class="sr-only" aria-live="polite">
          {selectedFindingLabel() === null
            ? "No finding selected."
            : `Selected finding: ${selectedFindingLabel()}.`}
        </p>
      </Show>
    </section>
  );
}
