import { For, Show } from "solid-js";
import type {
  MetricState,
  StrategicFitAnalysisResult,
  StrategicFitMetric,
} from "@chess-mcp/chess-tools";
import type { StrategicFitFindingQueueFilter } from "../../store/ui";

export type StrategicOverviewItemId =
  | "strategic-workload"
  | "strategic-families"
  | "concept-reuse"
  | "forced-diversity-floor"
  | "intentional-exceptions"
  | "unresolved-findings"
  | "incomplete-branches"
  | "familiar-plan-coverage";

export type StrategicOverviewReport = Pick<
  StrategicFitAnalysisResult,
  "report_id" | "preflight" | "summary"
>;

export interface StrategicOverviewItemPresentation {
  readonly id: StrategicOverviewItemId;
  readonly label: string;
  readonly value: string;
  readonly report_value: string;
  readonly state: MetricState;
  readonly description: string;
  readonly reason: string | null;
  readonly review_filter: StrategicFitFindingQueueFilter | null;
  readonly review_label: string | null;
}

export interface StrategicOverviewPresentation {
  readonly report_id: string;
  readonly preflight_state: StrategicOverviewReport["preflight"]["state"];
  readonly items: readonly StrategicOverviewItemPresentation[];
  readonly entropy: {
    readonly value: string;
    readonly report_value: string;
    readonly state: MetricState;
    readonly reason: string | null;
  };
  readonly expected_concept_burden: {
    readonly value: string;
    readonly report_value: string;
    readonly reason: string | null;
  };
  readonly screen_reader_summary: string;
}

const BLOCKED_REASON = "Preflight blocked position analysis, so this report value is unavailable.";

const METRIC_STATE_LABELS: Readonly<Record<MetricState, string>> = {
  available: "Available",
  partial: "Partial evidence",
  unavailable: "Unavailable",
};

const WORKLOAD_LABELS: Readonly<Record<StrategicOverviewReport["summary"]["workload"], string>> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  unavailable: "Unavailable",
};

function formatNumber(value: number, digits = 2): string {
  return value.toFixed(digits).replace(/\.?0+$/u, "");
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100, 1)}%`;
}

function metricValue(
  metric: StrategicFitMetric<number>,
  formatter: (value: number) => string,
): Pick<StrategicOverviewItemPresentation, "value" | "report_value" | "state" | "reason"> {
  if (metric.state === "unavailable" || metric.value === null) {
    return {
      value: "Unavailable",
      report_value: "",
      state: "unavailable",
      reason: metric.reason ?? "This metric is unavailable because its required evidence was not supplied.",
    };
  }
  return {
    value: formatter(metric.value),
    report_value: String(metric.value),
    state: metric.state,
    reason: metric.reason,
  };
}

function countValue(
  value: number,
  blocked: boolean,
): Pick<StrategicOverviewItemPresentation, "value" | "report_value" | "state" | "reason"> {
  return blocked
    ? { value: "Unavailable", report_value: "", state: "unavailable", reason: BLOCKED_REASON }
    : { value: String(value), report_value: String(value), state: "available", reason: null };
}

function itemSummary(item: StrategicOverviewItemPresentation): string {
  const state = item.state === "partial" ? "partial evidence" : item.state;
  return `${item.label}: ${item.value}${item.state === "available" ? "" : `, ${state}`}.${item.reason ? ` ${item.reason}` : ""}`;
}

export function buildStrategicOverviewPresentation(
  report: StrategicOverviewReport,
): StrategicOverviewPresentation {
  const summary = report.summary;
  const blocked = report.preflight.state === "blocked";
  const workload = summary.workload === "unavailable"
    ? { value: "Unavailable", report_value: "", state: "unavailable" as const, reason: BLOCKED_REASON }
    : {
        value: WORKLOAD_LABELS[summary.workload],
        report_value: summary.workload,
        state: "available" as const,
        reason: null,
      };
  const families = countValue(summary.strategic_family_count, blocked);
  const conceptReuse = metricValue(summary.metrics.concept_reuse, formatPercent);
  const forcedFloor = metricValue(summary.metrics.forced_diversity_floor, formatPercent);
  const intentional = countValue(summary.intentional_exception_count, blocked);
  const unresolved = countValue(summary.unresolved_finding_count, blocked);
  const incomplete = countValue(summary.insufficient_evidence_branch_count, false);
  const familiarCoverage = metricValue(summary.metrics.familiarity_adjusted_coverage, formatPercent);
  const items: StrategicOverviewItemPresentation[] = [
    {
      id: "strategic-workload",
      label: "Strategic workload",
      ...workload,
      description: "Expected learning burden from the report's weighted routes and findings.",
      review_filter: workload.state === "unavailable" ? null : { kind: "resolution", resolution: "unresolved" },
      review_label: workload.state === "unavailable" ? null : "Review unresolved workload findings",
    },
    {
      id: "strategic-families",
      label: "Strategic families",
      ...families,
      description: "Distinct expected-weight plan families, not raw PGN leaf count.",
      review_filter: families.state === "unavailable" ? null : { kind: "all" },
      review_label: families.state === "unavailable" ? null : "Review findings across strategic families",
    },
    {
      id: "concept-reuse",
      label: "Concept reuse",
      ...conceptReuse,
      description: "Expected concept exposure reused across canonical repertoire routes.",
      review_filter: conceptReuse.state === "unavailable" ? null : { kind: "all" },
      review_label: conceptReuse.state === "unavailable" ? null : "Review findings related to concept reuse",
    },
    {
      id: "forced-diversity-floor",
      label: "Forced-diversity floor",
      ...forcedFloor,
      description: "The minimum expected diversity currently attributable to opponent-forced branches.",
      review_filter: forcedFloor.state === "unavailable"
        ? null
        : { kind: "classification", classification: "forced-diversity" },
      review_label: forcedFloor.state === "unavailable" ? null : "Review opponent-forced findings",
    },
    {
      id: "intentional-exceptions",
      label: "Intentional exceptions",
      ...intentional,
      description: "Findings classified as intentional diversity; they remain visible in the strategic map.",
      review_filter: intentional.state === "unavailable"
        ? null
        : { kind: "classification", classification: "intentional-diversity" },
      review_label: intentional.state === "unavailable" ? null : "Review intentional exceptions",
    },
    {
      id: "unresolved-findings",
      label: "Unresolved findings",
      ...unresolved,
      description: "Findings whose canonical report resolution state is still unresolved.",
      review_filter: unresolved.state === "unavailable" ? null : { kind: "resolution", resolution: "unresolved" },
      review_label: unresolved.state === "unavailable" ? null : "Review unresolved findings",
    },
    {
      id: "incomplete-branches",
      label: "Incomplete branches",
      ...incomplete,
      description: "Branches that did not provide enough comparable strategic checkpoints.",
      review_filter: summary.insufficient_evidence_branch_count > 0
        ? { kind: "evidence", evidence: "insufficient" }
        : null,
      review_label: summary.insufficient_evidence_branch_count > 0
        ? "Review insufficient-evidence findings"
        : null,
    },
    {
      id: "familiar-plan-coverage",
      label: "Familiar-plan coverage",
      ...familiarCoverage,
      description: "Expected games covered by concepts supported by calibrated mastery evidence.",
      review_filter: familiarCoverage.state === "unavailable" ? null : { kind: "all" },
      review_label: familiarCoverage.state === "unavailable" ? null : "Review findings affecting familiar-plan coverage",
    },
  ];
  const entropy = metricValue(summary.metrics.strategic_entropy, (value) => `${formatNumber(value)} bits`);
  const expectedConceptBurden = summary.expected_concept_burden === null
    ? {
        value: "Unavailable",
        report_value: "",
        reason: summary.metrics.concept_reuse.reason ??
          "No supported concept evidence is available for expected concept burden.",
      }
    : {
        value: formatNumber(summary.expected_concept_burden),
        report_value: String(summary.expected_concept_burden),
        reason: null,
      };
  const screenReaderSummary = [
    "Strategic overview.",
    ...items.map(itemSummary),
    `Expected concept burden: ${expectedConceptBurden.value}${expectedConceptBurden.reason ? `. ${expectedConceptBurden.reason}` : ""}`,
    `Strategic entropy: ${entropy.value}${entropy.state === "partial" ? ", partial evidence" : ""}${entropy.reason ? `. ${entropy.reason}` : ""}. Lower entropy is not universally better; intentional variety, coverage, and move-order resilience can justify diversity.`,
  ].join(" ");
  return {
    report_id: report.report_id,
    preflight_state: report.preflight.state,
    items,
    entropy,
    expected_concept_burden: expectedConceptBurden,
    screen_reader_summary: screenReaderSummary,
  };
}

export default function StrategicOverview(props: {
  report: StrategicOverviewReport;
  onReview: (
    source: StrategicOverviewItemId,
    label: string,
    filter: StrategicFitFindingQueueFilter,
  ) => void;
}) {
  const presentation = () => buildStrategicOverviewPresentation(props.report);
  const summaryId = () => `strategic-fit-overview-summary-${presentation().report_id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <section
      class="strategic-fit-overview"
      data-overview-report-id={presentation().report_id}
      data-overview-preflight-state={presentation().preflight_state}
      aria-label="Strategic overview"
      aria-describedby={summaryId()}
    >
      <p id={summaryId()} class="sr-only" data-overview-screen-reader-summary>
        {presentation().screen_reader_summary}
      </p>
      <div class="strategic-fit-overview-grid">
        <For each={presentation().items}>{(item) => (
          <article
            class="strategic-fit-overview-item"
            data-overview-item={item.id}
            data-metric-state={item.state}
            data-report-value={item.report_value}
          >
            <header>
              <h3>{item.label}</h3>
              <span class="strategic-fit-overview-metric-state">{METRIC_STATE_LABELS[item.state]}</span>
            </header>
            <p class="strategic-fit-overview-value" data-overview-value>{item.value}</p>
            <Show when={item.id === "strategic-workload"}>
              <p
                class="strategic-fit-overview-concept-burden"
                data-report-value={presentation().expected_concept_burden.report_value}
              >
                Expected concept burden: {presentation().expected_concept_burden.value}
              </p>
              <Show when={presentation().expected_concept_burden.reason}>
                <p class="strategic-fit-overview-reason">
                  {presentation().expected_concept_burden.reason}
                </p>
              </Show>
            </Show>
            <p class="strategic-fit-overview-description">{item.description}</p>
            <Show when={item.reason}>
              <p class="strategic-fit-overview-reason">{item.reason}</p>
            </Show>
            <Show when={item.review_filter && item.review_label}>
              <button
                type="button"
                aria-controls="strategic-fit-pane-findings"
                onClick={() => props.onReview(item.id, item.review_label!, item.review_filter!)}
              >
                {item.review_label}
              </button>
            </Show>
          </article>
        )}</For>
      </div>

      <details class="strategic-fit-overview-entropy" data-metric-state={presentation().entropy.state}>
        <summary>How strategic workload is distributed</summary>
        <div data-overview-item="strategic-entropy" data-report-value={presentation().entropy.report_value}>
          <strong>Strategic entropy</strong>
          <span data-overview-value>{presentation().entropy.value}</span>
          <span>{METRIC_STATE_LABELS[presentation().entropy.state]}</span>
        </div>
        <p>
          Lower entropy is not universally better. Intentional variety, opponent coverage, and
          move-order resilience can justify a broader mix of plans.
        </p>
        <Show when={presentation().entropy.reason}>
          <p class="strategic-fit-overview-reason">{presentation().entropy.reason}</p>
        </Show>
      </details>
    </section>
  );
}
