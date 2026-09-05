import { For, Show } from "solid-js";
import type { StrategicFitPreflight } from "@chess-mcp/chess-tools";
import { STRATEGIC_FIT_EVIDENCE } from "../../content/strategicFit";
import Button from "../primitives/Button";

export interface InsufficientEvidenceProps {
  readonly preflight: StrategicFitPreflight;
  readonly comparablePly: number | null;
  readonly onAnalyzeAgain: () => void;
}

export default function InsufficientEvidence(props: InsufficientEvidenceProps) {
  return (
    <div class="strategic-fit-insufficient" data-strategic-fit-evidence-state="none">
      <h3 class="strategic-fit-insufficient-title">{STRATEGIC_FIT_EVIDENCE.noneTitle}</h3>
      <p class="strategic-fit-insufficient-body">
        {STRATEGIC_FIT_EVIDENCE.noneBody(
          props.preflight.route_count,
          props.preflight.comparable_route_count,
          props.comparablePly,
        )}
      </p>

      <h4 class="strategic-fit-insufficient-remedies-title">
        {STRATEGIC_FIT_EVIDENCE.noneRemediesTitle}
      </h4>
      <ul class="strategic-fit-insufficient-remedies">
        <For each={STRATEGIC_FIT_EVIDENCE.noneRemedies}>
          {(remedy) => (
            <li class="strategic-fit-insufficient-remedy" data-remedy={remedy.id}>
              <span class="strategic-fit-insufficient-remedy-title">{remedy.title}</span>
              <span class="strategic-fit-insufficient-remedy-body">{remedy.body}</span>
            </li>
          )}
        </For>
      </ul>

      <Show when={props.preflight.issues.length > 0}>
        <p class="strategic-fit-insufficient-footer">{STRATEGIC_FIT_EVIDENCE.noneFooter}</p>
      </Show>

      <Button
        class="strategic-fit-insufficient-action"
        onClick={() => {
          props.onAnalyzeAgain();
        }}
      >
        Analyze again
      </Button>
    </div>
  );
}
