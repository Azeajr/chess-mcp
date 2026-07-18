import { For, Show } from "solid-js";
import {
  type CausalAttribution,
  type CausalControlLabel,
  type CausalEventKind,
} from "@chess-mcp/chess-tools";

const EVENT_PRESENTATION: Readonly<Record<CausalEventKind, {
  label: string;
  marker: string;
  pattern: string;
}>> = {
  "opponent-divergence": {
    label: "Opponent divergence",
    marker: "↪",
    pattern: "Dotted marker",
  },
  "player-decision": {
    label: "Player decision",
    marker: "◆",
    pattern: "Solid marker",
  },
  "irreversible-event": {
    label: "Irreversible event",
    marker: "◇",
    pattern: "Double marker",
  },
  "first-strategic-difference": {
    label: "First strategic difference",
    marker: "△",
    pattern: "Dashed marker",
  },
  "difference-stable": {
    label: "Difference becomes stable",
    marker: "✓",
    pattern: "Heavy marker",
  },
  transposition: {
    label: "Transposition",
    marker: "⇄",
    pattern: "Striped marker",
  },
};

const CONTROL_LABELS: Readonly<Record<CausalControlLabel, string>> = {
  "mostly-opponent-forced": "Mostly opponent-forced",
  "shared-or-uncertain": "Shared or uncertain ownership",
  "mostly-player-controlled": "Mostly player-controlled",
  unknown: "Causal ownership unavailable",
};

export interface CausalTimelineEventPresentation {
  readonly event_id: string;
  readonly kind: CausalEventKind;
  readonly label: string;
  readonly marker: string;
  readonly pattern: string;
  readonly ply: number;
  readonly move: string;
  readonly explanation: string;
  readonly position_id: string;
  readonly decision_id: string | null;
}

export interface CausalTimelinePresentation {
  readonly ownership: string;
  readonly explanation: string;
  readonly events: readonly CausalTimelineEventPresentation[];
}

export function buildCausalTimelinePresentation(
  causality: Pick<CausalAttribution, "label" | "explanation" | "timeline">,
): CausalTimelinePresentation {
  return {
    ownership: CONTROL_LABELS[causality.label],
    explanation: causality.explanation,
    events: causality.timeline.map((event) => ({
      event_id: event.event_id,
      kind: event.kind,
      ...EVENT_PRESENTATION[event.kind],
      ply: event.ply,
      move: event.san ?? "No SAN move recorded",
      explanation: event.explanation,
      position_id: event.position_id,
      decision_id: event.decision_id,
    })),
  };
}

export default function CausalTimeline(props: { causality: CausalAttribution }) {
  const presentation = () => buildCausalTimelinePresentation(props.causality);
  return (
    <section class="strategic-fit-causal-timeline" aria-labelledby="strategic-fit-causal-title">
      <header>
        <h4 id="strategic-fit-causal-title">How the lines diverged</h4>
        <strong>{presentation().ownership}</strong>
        <p>{presentation().explanation}</p>
      </header>
      <Show when={presentation().events.length > 0} fallback={(
        <p class="strategic-fit-evidence-unavailable">
          No causal timeline events are supported by this report.
        </p>
      )}>
        <ol aria-label="Causal timeline events">
          <For each={presentation().events}>{(event) => (
            <li data-causal-event={event.kind}>
              <span class="strategic-fit-causal-marker" aria-hidden="true">{event.marker}</span>
              <div>
                <strong>{event.label}</strong>
                <span>Ply {event.ply} · {event.move} · {event.pattern}</span>
                <p>{event.explanation}</p>
              </div>
            </li>
          )}</For>
        </ol>
      </Show>
    </section>
  );
}
