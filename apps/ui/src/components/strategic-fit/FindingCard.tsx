import { For, Show } from "solid-js";
import type {
  CausalControlLabel,
  FindingResolutionState,
  StrategicFinding,
  StrategicFitClassification,
} from "@chess-mcp/chess-tools";

export const STRATEGIC_FIT_CLASSIFICATION_LABELS: Readonly<
  Record<StrategicFitClassification, string>
> = {
  "genuine-inconsistency": "Avoidable inconsistency",
  "forced-diversity": "Opponent-forced diversity",
  "intentional-diversity": "Intentional diversity",
  "productive-diversity": "Productive diversity",
  "mixed-strategic-profile": "Mixed strategic profile",
  uncertain: "Uncertain",
  "data-quality-issue": "Data-quality limitation",
  "transpositional-equivalence": "Equivalent move orders",
};

export const STRATEGIC_FIT_CAUSAL_LABELS: Readonly<Record<CausalControlLabel, string>> = {
  "mostly-opponent-forced": "Mostly opponent-forced",
  "shared-or-uncertain": "Shared or uncertain ownership",
  "mostly-player-controlled": "Mostly player-controlled",
  unknown: "Causal ownership unknown",
};

export const STRATEGIC_FIT_RESOLUTION_LABELS: Readonly<Record<FindingResolutionState, string>> = {
  unresolved: "Unresolved",
  "change-repertoire": "Change repertoire",
  "keep-intentionally": "Kept intentionally",
  "train-as-exception": "Train as an exception",
  "reclassify-cohort": "Reclassified cohort",
  "exclude-from-analysis": "Excluded from analysis",
  defer: "Deferred",
  "insufficient-evidence": "Insufficient evidence",
  "automatically-resolved-by-another-edit": "Resolved by another edit",
};

const PRIORITY_LABELS = {
  "review-now": "Review now",
  "review-later": "Review later",
  informational: "Informational",
  "insufficient-evidence": "Insufficient evidence",
} as const;

const formatNumber = (value: number, maximumFractionDigits = 1): string =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);

export interface FindingCardPresentation {
  readonly classification: string;
  readonly baseline: string;
  readonly expected_frequency: string;
  readonly difference: string;
  readonly confidence: string;
  readonly causal_ownership: string;
  readonly objective_soundness: string;
  readonly objective_reason: string | null;
  readonly resolution: string;
  readonly replacement_priority: string;
  readonly training_priority: string;
  readonly source_paths: readonly string[];
}

export function buildFindingCardPresentation(
  finding: StrategicFinding,
): FindingCardPresentation {
  const objective = finding.objective_quality;
  let objectiveSoundness = "Objective soundness unavailable";
  if (objective.state !== "unavailable") {
    const verification = objective.state === "available" ? "Verified" : "Partly verified";
    const verdict = objective.verdict === "sound"
      ? "objectively sound"
      : objective.verdict === "dubious"
        ? "objectively dubious"
        : "objective verdict unknown";
    objectiveSoundness = `${verification}: ${verdict}`;
  }
  return {
    classification: STRATEGIC_FIT_CLASSIFICATION_LABELS[finding.classification],
    baseline: `${formatNumber(finding.weighted_baseline_percentage)}% weighted baseline`,
    expected_frequency: finding.expected_frequency === null
      ? "Expected frequency unavailable"
      : `${formatNumber(finding.expected_frequency * 100)}% expected frequency`,
    difference: `${finding.difference.magnitude[0]!.toUpperCase()}${finding.difference.magnitude.slice(1)} difference`,
    confidence: `${finding.confidence.label[0]!.toUpperCase()}${finding.confidence.label.slice(1)} confidence · ${formatNumber(finding.confidence.score, 0)}/100`,
    causal_ownership: STRATEGIC_FIT_CAUSAL_LABELS[finding.evidence.causality.label],
    objective_soundness: objectiveSoundness,
    objective_reason: objective.reason,
    resolution: STRATEGIC_FIT_RESOLUTION_LABELS[finding.resolution_state],
    replacement_priority: `Replacement: ${PRIORITY_LABELS[finding.replacement_priority.label]}`,
    training_priority: `Training: ${PRIORITY_LABELS[finding.training_priority.label]}`,
    source_paths: finding.references.source_san_paths.map((path) =>
      path.length === 0 ? "Start position" : path.join(" ")
    ),
  };
}

function selectWithKeyboard(
  event: KeyboardEvent,
  onSelect: (id: string, focusEvidence: boolean) => void,
) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const queue = event.currentTarget instanceof HTMLElement
    ? event.currentTarget.closest("[data-finding-list]")
    : null;
  if (!queue) return;
  const buttons = [...queue.querySelectorAll<HTMLButtonElement>("[data-finding-select]")];
  const currentIndex = buttons.indexOf(event.currentTarget as HTMLButtonElement);
  if (currentIndex < 0 || buttons.length === 0) return;
  event.preventDefault();
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? buttons.length - 1
      : event.key === "ArrowDown"
        ? Math.min(buttons.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);
  const target = buttons[nextIndex]!;
  target.focus();
  const targetId = target.dataset.findingSelect;
  if (targetId) onSelect(targetId, false);
}

export default function FindingCard(props: {
  finding: StrategicFinding;
  selected: boolean;
  onSelect: (findingId: string, focusEvidence: boolean) => void;
}) {
  const presentation = () => buildFindingCardPresentation(props.finding);
  return (
    <article
      class="strategic-fit-finding-card"
      data-finding-id={props.finding.finding_id}
      data-finding-classification={props.finding.classification}
      data-finding-selected={props.selected ? "true" : "false"}
      aria-labelledby={`strategic-fit-finding-${props.finding.finding_id}`}
    >
      <header>
        <div>
          <span class="strategic-fit-finding-classification">{presentation().classification}</span>
          <h3 id={`strategic-fit-finding-${props.finding.finding_id}`}>
            {props.finding.plain_language_category}
          </h3>
        </div>
        <span class="strategic-fit-finding-resolution" data-resolution={props.finding.resolution_state}>
          {presentation().resolution}
        </span>
      </header>

      <dl class="strategic-fit-finding-scope">
        <div>
          <dt>Opening / system</dt>
          <dd>{props.finding.opening_scope}</dd>
        </div>
        <div>
          <dt>Affected line</dt>
          <dd>{props.finding.affected_line_summary}</dd>
        </div>
      </dl>
      <p class="strategic-fit-finding-explanation">{props.finding.explanation}</p>

      <ul class="strategic-fit-finding-facts" aria-label="Finding summary">
        <li>{presentation().baseline}</li>
        <li data-expected-frequency={props.finding.expected_frequency === null ? "unavailable" : "available"}>
          {presentation().expected_frequency}
        </li>
        <li>{presentation().difference}</li>
        <li>{presentation().confidence}</li>
        <li>{presentation().causal_ownership}</li>
        <li data-objective-state={props.finding.objective_quality.state}>
          {presentation().objective_soundness}
        </li>
      </ul>
      <Show when={presentation().objective_reason}>
        {(reason) => <p class="strategic-fit-finding-objective-reason">{reason()}</p>}
      </Show>

      <p class="strategic-fit-finding-priorities">
        <span>{presentation().replacement_priority}</span>
        <span>{presentation().training_priority}</span>
      </p>

      <details class="strategic-fit-finding-paths">
        <summary>
          {presentation().source_paths.length === 0
            ? "No source lines available"
            : `${presentation().source_paths.length} source ${presentation().source_paths.length === 1 ? "line" : "lines"}`}
        </summary>
        <Show when={presentation().source_paths.length > 0}>
          <ol>
            <For each={presentation().source_paths}>{(path) => <li><code>{path}</code></li>}</For>
          </ol>
        </Show>
      </details>

      <button
        type="button"
        class="strategic-fit-finding-select"
        data-finding-select={props.finding.finding_id}
        aria-pressed={props.selected}
        onClick={() => props.onSelect(props.finding.finding_id, true)}
        onKeyDown={(event) => selectWithKeyboard(event, props.onSelect)}
      >
        {props.selected ? "Selected for review" : "Select finding"}
        <span class="sr-only">: {props.finding.plain_language_category}</span>
      </button>
    </article>
  );
}
