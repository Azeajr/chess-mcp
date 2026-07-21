import { For, Show } from "solid-js";
import {
  CONFIDENCE_COMPONENTS,
  type ConfidenceCapReason,
  type ConfidenceComponentKind,
  type FindingConfidence,
} from "@chess-mcp/chess-tools";

const COMPONENT_LABELS: Readonly<Record<ConfidenceComponentKind, string>> = {
  "classifier-confidence": "Strategic classification support",
  "checkpoint-completeness": "Matched-position completeness",
  "effective-sample-size": "Effective comparison sample",
  "temporal-persistence": "Persistence across the line",
  "cohort-coherence": "Typical-group coherence",
  "opening-data-quality": "Opening-data quality",
  "causal-attribution-quality": "Decision-ownership evidence",
};

const CAP_LABELS: Readonly<Record<ConfidenceCapReason, string>> = {
  "effective-sample-below-four": "Small comparison set",
  "substantial-incomplete-line-share": "Substantial incomplete-line evidence",
  "unresolved-classifier-conflict": "Unresolved strategic-classifier conflict",
  "missing-taxonomy-with-strong-structural-evidence": "Missing opening taxonomy",
};

const capitalized = (value: string): string => `${value[0]!.toUpperCase()}${value.slice(1)}`;
const formatPercent = (value: number): string => new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
}).format(value * 100) + "%";

export interface ConfidenceComponentPresentation {
  readonly component: ConfidenceComponentKind;
  readonly label: string;
  readonly state: "available" | "unavailable";
  readonly score: number | null;
  readonly score_label: string;
  readonly weight: number | null;
  readonly weight_label: string;
  readonly explanation: string;
}

export interface ConfidenceCapPresentation {
  readonly reason: ConfidenceCapReason;
  readonly label: string;
  readonly maximum_score: number;
  readonly explanation: string;
}

export interface StrategicFitConfidencePresentation {
  readonly label: string;
  readonly score: number;
  readonly summary: string;
  readonly components: readonly ConfidenceComponentPresentation[];
  readonly caps: readonly ConfidenceCapPresentation[];
  readonly missing_component_count: number;
  readonly available_weight: number;
}

export function buildConfidencePresentation(
  confidence: FindingConfidence,
): StrategicFitConfidencePresentation {
  const byKind = new Map(confidence.components.map((component) => [component.component, component]));
  const components = CONFIDENCE_COMPONENTS.map((component) => {
    const value = byKind.get(component);
    return value === undefined
      ? {
          component,
          label: COMPONENT_LABELS[component],
          state: "unavailable" as const,
          score: null,
          score_label: "Unavailable",
          weight: null,
          weight_label: "Unavailable",
          explanation: "This report did not provide this confidence component.",
        }
      : {
          component,
          label: COMPONENT_LABELS[component],
          state: "available" as const,
          score: value.score,
          score_label: formatPercent(value.score),
          weight: value.weight,
          weight_label: new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value.weight),
          explanation: value.explanation,
        };
  });
  return {
    label: `${capitalized(confidence.label)} confidence`,
    score: confidence.score,
    summary: confidence.explanation,
    components,
    caps: confidence.applied_caps.map((cap) => ({
      reason: cap.reason,
      label: CAP_LABELS[cap.reason],
      maximum_score: cap.maximum_score,
      explanation: cap.explanation,
    })),
    missing_component_count: components.filter((component) => component.state === "unavailable").length,
    available_weight: components.reduce((sum, component) => sum + (component.weight ?? 0), 0),
  };
}

export default function ConfidenceDetails(props: { confidence: FindingConfidence }) {
  const presentation = () => buildConfidencePresentation(props.confidence);
  return (
    <section class="strategic-fit-confidence" aria-labelledby="strategic-fit-confidence-title">
      <header>
        <div>
          <h4 id="strategic-fit-confidence-title">How reliable is this comparison?</h4>
          <strong data-confidence-label={props.confidence.label}>{presentation().label}</strong>
        </div>
        <span aria-label={`${presentation().score} out of 100`}>{presentation().score}/100</span>
      </header>
      <p>{presentation().summary}</p>
      <Show when={presentation().caps.length > 0} fallback={(
        <p class="strategic-fit-confidence-no-cap">
          No evidence limitation currently caps this confidence score.
        </p>
      )}>
        <div class="strategic-fit-confidence-caps" aria-label="Confidence limitations">
          <strong>What limits confidence</strong>
          <ul>
            <For each={presentation().caps}>{(cap) => (
              <li data-confidence-cap={cap.reason}>
                <strong>{cap.label}</strong>
                <span>{cap.explanation}</span>
              </li>
            )}</For>
          </ul>
        </div>
      </Show>
      <Show when={presentation().missing_component_count > 0}>
        <p class="strategic-fit-evidence-unavailable">
          {presentation().missing_component_count} of {CONFIDENCE_COMPONENTS.length} confidence components are unavailable in this report.
        </p>
      </Show>
    </section>
  );
}

export function ConfidenceExpertValues(props: { confidence: FindingConfidence }) {
  const presentation = () => buildConfidencePresentation(props.confidence);
  return (
    <section aria-labelledby="strategic-fit-confidence-expert-title">
      <h5 id="strategic-fit-confidence-expert-title">Confidence components</h5>
      <p>
        Available component weight: {new Intl.NumberFormat("en-US", {
          maximumFractionDigits: 3,
        }).format(presentation().available_weight)}. Overall reported score: {presentation().score}/100.
      </p>
      <div class="strategic-fit-expert-table-wrap">
        <table>
          <caption class="sr-only">Confidence components, weights, and report explanations</caption>
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col">Score</th>
              <th scope="col">Weight</th>
              <th scope="col">Report explanation</th>
            </tr>
          </thead>
          <tbody>
            <For each={presentation().components}>{(component) => (
              <tr data-confidence-component={component.component} data-component-state={component.state}>
                <th scope="row">{component.label}</th>
                <td>{component.score_label}</td>
                <td>{component.weight_label}</td>
                <td>{component.explanation}</td>
              </tr>
            )}</For>
          </tbody>
        </table>
      </div>
      <Show when={presentation().caps.length > 0}>
        <h5>Applied numerical caps</h5>
        <ul>
          <For each={presentation().caps}>{(cap) => (
            <li><strong>{cap.label}:</strong> maximum {cap.maximum_score}/100. {cap.explanation}</li>
          )}</For>
        </ul>
      </Show>
    </section>
  );
}
