import { For, Show } from "solid-js";
import type {
  CausalControlLabel,
  FindingResolutionState,
  StrategicFinding,
  StrategicFitClassification,
} from "@chess-mcp/chess-tools";
import type { StrategicFitDisplayedResolutionState } from "../../store/strategic-fit-finding-resolutions";
import { buildStrategicFindingStory } from "./finding-story";

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

export const STRATEGIC_FIT_DISPLAY_RESOLUTION_LABELS: Readonly<
  Record<StrategicFitDisplayedResolutionState, string>
> = {
  ...STRATEGIC_FIT_RESOLUTION_LABELS,
  "invalid-comparison": "Invalid comparison",
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
  resolutionState: StrategicFitDisplayedResolutionState = finding.resolution_state,
): FindingCardPresentation {
  const objective = finding.objective_quality;
  let objectiveSoundness = "Objective soundness unavailable";
  if (objective.state !== "unavailable") {
    const verification = objective.state === "available" ? "Verified" : "Partly verified";
    const verdict =
      objective.verdict === "sound"
        ? "objectively sound"
        : objective.verdict === "dubious"
          ? "objectively dubious"
          : "objective verdict unknown";
    objectiveSoundness = `${verification}: ${verdict}`;
  }
  return {
    classification: STRATEGIC_FIT_CLASSIFICATION_LABELS[finding.classification],
    baseline: `${formatNumber(finding.weighted_baseline_percentage)}% weighted baseline`,
    expected_frequency:
      finding.expected_frequency === null
        ? "Expected frequency unavailable"
        : `${formatNumber(finding.expected_frequency * 100)}% expected frequency`,
    difference: `${finding.difference.magnitude.charAt(0).toUpperCase()}${finding.difference.magnitude.slice(1)} difference`,
    confidence: `${finding.confidence.label.charAt(0).toUpperCase()}${finding.confidence.label.slice(1)} confidence · ${formatNumber(finding.confidence.score, 0)}/100`,
    causal_ownership: STRATEGIC_FIT_CAUSAL_LABELS[finding.evidence.causality.label],
    objective_soundness: objectiveSoundness,
    objective_reason: objective.reason,
    resolution: STRATEGIC_FIT_DISPLAY_RESOLUTION_LABELS[resolutionState],
    replacement_priority: `Replacement: ${PRIORITY_LABELS[finding.replacement_priority.label]}`,
    training_priority: `Training: ${PRIORITY_LABELS[finding.training_priority.label]}`,
    source_paths: finding.references.source_san_paths.map((path) =>
      path.length === 0 ? "Start position" : path.join(" "),
    ),
  };
}

function selectWithKeyboard(
  event: KeyboardEvent,
  onSelect: (id: string, focusEvidence: boolean) => void,
) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const queue =
    event.currentTarget instanceof HTMLElement
      ? event.currentTarget.closest("[data-finding-list]")
      : null;
  if (!queue) return;
  const buttons = [...queue.querySelectorAll<HTMLButtonElement>("[data-finding-select]")];
  const currentIndex = buttons.indexOf(event.currentTarget as HTMLButtonElement);
  if (currentIndex < 0 || buttons.length === 0) return;
  event.preventDefault();
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : event.key === "ArrowDown"
          ? Math.min(buttons.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
  const target = buttons[nextIndex];
  if (!target) return;
  target.focus();
  const targetId = target.dataset.findingSelect;
  if (targetId) onSelect(targetId, false);
}

export default function FindingCard(props: {
  finding: StrategicFinding;
  resolutionState?: StrategicFitDisplayedResolutionState;
  cohortName?: string;
  changedEvidence?: boolean;
  selected: boolean;
  onSelect: (findingId: string, focusEvidence: boolean) => void;
}) {
  const resolutionState = () => props.resolutionState ?? props.finding.resolution_state;
  const presentation = () => buildFindingCardPresentation(props.finding, resolutionState());
  const story = () => buildStrategicFindingStory(props.finding);
  const titleId = () => `strategic-fit-finding-${props.finding.finding_id}`;
  // Distinct findings legitimately share a headline, so the scope labels the card too; without it a
  // screen reader — and any name-based locator — sees several identically named cards in one list.
  const scopeId = () => `strategic-fit-finding-scope-${props.finding.finding_id}`;
  return (
    <article
      class="strategic-fit-finding-card"
      data-finding-id={props.finding.finding_id}
      data-finding-classification={props.finding.classification}
      data-finding-selected={props.selected ? "true" : "false"}
      aria-labelledby={`${scopeId()} ${titleId()}`}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("details, [data-finding-select]")
        )
          return;
        props.onSelect(props.finding.finding_id, true);
      }}
    >
      <header>
        <div>
          <span class="strategic-fit-finding-classification" id={scopeId()}>
            {props.finding.opening_scope}
          </span>
          <h3 id={titleId()}>{story().title}</h3>
        </div>
        <span
          class="strategic-fit-finding-resolution"
          data-resolution={resolutionState()}
          data-finding-kind={story().kind}
        >
          {resolutionState() === "unresolved" ? story().action_label : presentation().resolution}
        </span>
      </header>

      <Show when={props.changedEvidence}>
        <p class="strategic-fit-finding-changed-evidence" data-finding-changed-evidence="true">
          Evidence changed after reanalysis. Review this finding again.
        </p>
      </Show>

      <p class="strategic-fit-finding-explanation">{story().situation}</p>
      <p class="strategic-fit-finding-control">{story().control}</p>

      <ul class="strategic-fit-finding-facts" aria-label="Finding summary">
        <Show when={story().frequency}>{(frequency) => <li>{frequency()}</li>}</Show>
        <li>{presentation().difference}</li>
        <li>{props.finding.affected_line_summary}</li>
      </ul>
      <Show when={story().uncertainty}>
        {(uncertainty) => <p class="strategic-fit-finding-objective-reason">{uncertainty()}</p>}
      </Show>

      <p class="strategic-fit-finding-next-step">
        <strong>What to do:</strong> {story().next_step}
      </p>

      <details class="strategic-fit-finding-paths">
        <summary>
          {presentation().source_paths.length === 0
            ? "No source lines available"
            : `${presentation().source_paths.length} source ${presentation().source_paths.length === 1 ? "line" : "lines"}`}
        </summary>
        <Show when={presentation().source_paths.length > 0}>
          <ol>
            <For each={presentation().source_paths}>
              {(path) => (
                <li>
                  <code>{path}</code>
                </li>
              )}
            </For>
          </ol>
        </Show>
      </details>

      <button
        type="button"
        class="strategic-fit-finding-select"
        data-finding-select={props.finding.finding_id}
        aria-pressed={props.selected}
        onClick={() => {
          props.onSelect(props.finding.finding_id, true);
        }}
        onKeyDown={(event) => {
          selectWithKeyboard(event, props.onSelect);
        }}
      >
        <span>
          {props.selected ? "Continue review" : "Review finding"}
          <span class="sr-only">: {story().title}</span>
        </span>
      </button>
    </article>
  );
}
