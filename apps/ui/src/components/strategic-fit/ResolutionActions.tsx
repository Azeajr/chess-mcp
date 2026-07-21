import { For, Show, createEffect, createSignal } from "solid-js";
import {
  INTENTIONAL_RESOLUTION_REASONS,
  type IntentionalResolutionReason,
  type StrategicFinding,
} from "@chess-mcp/chess-tools";
import {
  displayStrategicFitFindingResolution,
  reopenStrategicFitFinding,
  strategicFitFindingResolutionAvailability,
  strategicFitFindingResolutionReview,
  transitionStrategicFitFindingResolution,
  type StrategicFitReviewResolutionState,
} from "../../store/strategic-fit-finding-resolutions";
import { strategicFitMetadata } from "../../store/strategic-fit-metadata";
import { STRATEGIC_FIT_DISPLAY_RESOLUTION_LABELS } from "./FindingCard";

const ACTIONS: readonly {
  state: Exclude<StrategicFitReviewResolutionState, "automatically-resolved-by-another-edit">;
  label: string;
  detail: string;
}[] = [
  {
    state: "keep-intentionally",
    label: "Keep intentionally",
    detail: "Retain this strategic exception as a deliberate repertoire choice.",
  },
  {
    state: "defer",
    label: "Defer",
    detail: "Leave the finding for a later review without changing the repertoire.",
  },
  {
    state: "exclude-from-analysis",
    label: "Exclude from analysis",
    detail: "Acknowledge this finding but omit it from unresolved analysis workload.",
  },
  {
    state: "invalid-comparison",
    label: "Mark invalid comparison",
    detail: "Record that this cohort comparison is not meaningful.",
  },
];

const REASON_LABELS: Readonly<Record<IntentionalResolutionReason, string>> = {
  "objectively-strongest": "Objectively strongest",
  "surprise-weapon": "Surprise weapon",
  "tournament-specific": "Tournament-specific",
  "strategically-desirable": "Strategically desirable",
  "opponent-forced": "Opponent-forced",
  "already-understood": "Already understood",
  custom: "Custom note",
};

export default function ResolutionActions(props: {
  reportId: string;
  finding: StrategicFinding;
}) {
  const [choice, setChoice] = createSignal<
    Exclude<StrategicFitReviewResolutionState, "automatically-resolved-by-another-edit">
  >("keep-intentionally");
  const [intentionalReason, setIntentionalReason] = createSignal<IntentionalResolutionReason | "">("");
  const [note, setNote] = createSignal("");

  createEffect(() => {
    props.finding.finding_id;
    setChoice("keep-intentionally");
    setIntentionalReason("");
    setNote("");
  });

  const availability = () => strategicFitFindingResolutionAvailability(
    props.reportId,
    props.finding.finding_id,
    props.finding.semantic_finding_id,
  );
  const resolution = () => displayStrategicFitFindingResolution(props.finding);
  const activeRecord = () => strategicFitMetadata().resolutions.find((record) =>
    record.record_state === "active" &&
    record.semantic_finding_id === props.finding.semantic_finding_id
  ) ?? null;
  const feedback = () => {
    const current = strategicFitFindingResolutionReview();
    return current.finding_id === props.finding.finding_id ? current : null;
  };
  const save = (event: SubmitEvent) => {
    event.preventDefault();
    transitionStrategicFitFindingResolution({
      report_id: props.reportId,
      finding_id: props.finding.finding_id,
      semantic_finding_id: props.finding.semantic_finding_id,
      state: choice(),
      intentional_reason: choice() === "keep-intentionally"
        ? intentionalReason() || null
        : null,
      note: note(),
    });
  };
  const reopen = () => reopenStrategicFitFinding({
    report_id: props.reportId,
    finding_id: props.finding.finding_id,
    semantic_finding_id: props.finding.semantic_finding_id,
  });

  return (
    <section
      class="strategic-fit-resolution-actions"
      aria-labelledby={`strategic-fit-resolution-heading-${props.finding.finding_id}`}
      data-resolution-finding-id={props.finding.finding_id}
      data-resolution-state={resolution()}
    >
      <header>
        <span>Finding resolution</span>
        <h3 id={`strategic-fit-resolution-heading-${props.finding.finding_id}`}>
          {props.finding.plain_language_category}
        </h3>
        <p>
          Current state: <strong>{STRATEGIC_FIT_DISPLAY_RESOLUTION_LABELS[resolution()]}</strong>
        </p>
      </header>

      <Show when={availability().available} fallback={(
        <div class="strategic-fit-resolution-blocked" role="alert" data-resolution-blocked>
          <strong>Resolution action blocked</strong>
          <p>{availability().message}</p>
        </div>
      )}>
        <Show when={resolution() === "unresolved"} fallback={(
          <div class="strategic-fit-resolution-current">
            <Show when={activeRecord()?.intentional_reason}>
              {(reason) => <p>Reason: {REASON_LABELS[reason()]}</p>}
            </Show>
            <Show when={activeRecord()?.note}>
              {(value) => <p class="strategic-fit-resolution-note">Note: {value()}</p>}
            </Show>
            <p>Resolved findings remain visible in this report and leave the unresolved queue.</p>
            <button type="button" onClick={reopen}>Reopen finding</button>
          </div>
        )}>
          <form onSubmit={save}>
            <fieldset>
              <legend>Choose a reversible resolution</legend>
              <For each={ACTIONS}>{(action) => (
                <label class="strategic-fit-resolution-choice">
                  <input
                    type="radio"
                    name={`strategic-fit-resolution-${props.finding.finding_id}`}
                    value={action.state}
                    checked={choice() === action.state}
                    onInput={() => setChoice(action.state)}
                  />
                  <span>
                    <strong>{action.label}</strong>
                    <small>{action.detail}</small>
                  </span>
                </label>
              )}</For>
            </fieldset>

            <Show when={choice() === "keep-intentionally"}>
              <label class="strategic-fit-resolution-field">
                Optional keep-intentionally reason
                <select
                  value={intentionalReason()}
                  onInput={(event) => setIntentionalReason(
                    event.currentTarget.value as IntentionalResolutionReason | "",
                  )}
                >
                  <option value="">No structured reason</option>
                  <For each={INTENTIONAL_RESOLUTION_REASONS}>{(reason) => (
                    <option value={reason}>{REASON_LABELS[reason]}</option>
                  )}</For>
                </select>
              </label>
            </Show>

            <label class="strategic-fit-resolution-field">
              Optional note
              <textarea
                rows={3}
                value={note()}
                aria-describedby={`strategic-fit-resolution-note-help-${props.finding.finding_id}`}
                onInput={(event) => setNote(event.currentTarget.value)}
              />
            </label>
            <p id={`strategic-fit-resolution-note-help-${props.finding.finding_id}`}>
              A custom keep-intentionally reason requires a note. Notes are saved only in document metadata.
            </p>

            <button type="submit">Save resolution</button>
          </form>
        </Show>
      </Show>

      <Show when={feedback()?.message}>
        {(message) => (
          <p
            class="strategic-fit-resolution-feedback"
            role={feedback()?.status === "blocked" ? "alert" : "status"}
          >{message()}</p>
        )}
      </Show>
    </section>
  );
}
