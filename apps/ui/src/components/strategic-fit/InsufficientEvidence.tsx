/**
 * WP-031 AC-1: the terminal state shown when no route reached the comparable-ply threshold.
 *
 * The analysis ran and its preflight payload is intact — this component does not hide it. It
 * replaces the findings, evidence, and resolution panes, which in this case would otherwise render
 * a wall of "Insufficient evidence" rows that say the same thing several dozen times without ever
 * naming the threshold or what to do about it.
 *
 * Every number here comes from the preflight payload rather than a constant, so the copy cannot
 * drift from the run it describes.
 */
import { For, Show } from "solid-js";
import type { StrategicFitPreflight } from "@chess-mcp/chess-tools";
import { STRATEGIC_FIT_EVIDENCE } from "../../content/strategicFit";
import Button from "../primitives/Button";

export interface InsufficientEvidenceProps {
  readonly preflight: StrategicFitPreflight;
  /** The comparable-ply threshold the run reported, or null when no issue carried one. */
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
