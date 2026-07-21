import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import type { StrategicFinding, StrategicFitAnalysisResult } from "@chess-mcp/chess-tools";
import {
  cancelStrategicFitCohortAdjustment,
  confirmStrategicFitCohortAdjustment,
  previewStrategicFitCohortAdjustment,
  strategicFitCohortAdjustment,
  strategicFitCohortDisplayName,
  type StrategicFitCohortAdjustmentDraft,
  type StrategicFitCohortAdjustmentImpactList,
} from "../../store/strategic-fit-cohort-adjustments";
import { strategicFitMetadata } from "../../store/strategic-fit-metadata";

type EditorMode = "merge" | "split" | "rename" | "exclude" | "reset";

const ACTIONS: readonly { mode: EditorMode; label: string; detail: string }[] = [
  {
    mode: "merge",
    label: "Merge cohorts",
    detail: "Combine selected routes that currently belong to distinct automatic cohorts.",
  },
  {
    mode: "split",
    label: "Split cohort",
    detail: "Extract a proper subset of routes from one automatic cohort.",
  },
  {
    mode: "rename",
    label: "Rename cohort",
    detail: "Change only the user-facing name; analyzer grouping remains unchanged.",
  },
  {
    mode: "exclude",
    label: "Exclude subtree",
    detail: "Remove routes below selected canonical decisions from cohort baselines.",
  },
  {
    mode: "reset",
    label: "Restore automatic cohorts",
    detail: "Remove one saved override or custom name and run the automatic analysis again.",
  },
];

function Impact(props: { label: string; value: StrategicFitCohortAdjustmentImpactList }) {
  return (
    <div data-impact-state={props.value.state}>
      <dt>{props.label}</dt>
      <dd>
        <Show when={props.value.state === "available"} fallback={props.value.reason}>
          <strong>{props.value.count}</strong>
          <Show when={props.value.ids.length > 0}>
            <ul>
              <For each={props.value.ids}>{(id) => <li><code>{id}</code></li>}</For>
            </ul>
          </Show>
        </Show>
      </dd>
    </div>
  );
}

export default function CohortEditor(props: {
  reportId: string;
  report: StrategicFitAnalysisResult;
  finding: StrategicFinding;
}) {
  const [mode, setMode] = createSignal<EditorMode>("merge");
  const [routeIds, setRouteIds] = createSignal<string[]>([]);
  const [decisionIds, setDecisionIds] = createSignal<string[]>([]);
  const [cohortId, setCohortId] = createSignal(props.finding.evidence.cohort_id);
  const [displayName, setDisplayName] = createSignal("");
  const [resetTarget, setResetTarget] = createSignal("");
  const [reason, setReason] = createSignal("");

  createEffect(on(() => props.finding.finding_id, () => {
    setMode("merge");
    setRouteIds([]);
    setDecisionIds([]);
    setCohortId(props.finding.evidence.cohort_id);
    setDisplayName("");
    setResetTarget("");
    setReason("");
    cancelStrategicFitCohortAdjustment();
  }));
  onCleanup(cancelStrategicFitCohortAdjustment);

  const routeOptions = () => props.report.cohorts.flatMap((cohort) =>
    [...cohort.route_ids, ...cohort.excluded_route_ids].map((routeId) => ({
      routeId,
      cohortId: cohort.cohort_id,
    }))
  ).sort((left, right) => left.cohortId.localeCompare(right.cohortId) ||
    left.routeId.localeCompare(right.routeId));
  const decisionOptions = () => [...new Set([
    ...props.report.cohorts.flatMap((cohort) => cohort.decision_scope_ids),
    ...props.report.findings.flatMap((finding) => finding.references.decision_ids),
  ])].sort();
  const resetOptions = () => [
    ...strategicFitMetadata().cohort_overrides
      .filter((entry) => entry.record_state === "active")
      .map((entry) => ({
        value: `override:${entry.override_id}`,
        label: `${entry.kind === "merge" ? "Merge" : "Split"} · ${entry.route_ids.length} route(s)`,
      })),
    ...strategicFitMetadata().exclusions
      .filter((entry) => entry.record_state === "active")
      .map((entry) => ({
        value: `override:${entry.override_id}`,
        label: `Subtree exclusion · ${(entry.decision_ids?.length ?? 0)} decision(s), ${(entry.route_ids?.length ?? 0)} route(s)`,
      })),
    ...strategicFitMetadata().cohort_labels
      .filter((entry) => entry.record_state === "active")
      .map((entry) => ({ value: `rename:${entry.label_id}`, label: `Name · ${entry.display_name}` })),
  ].sort((left, right) => left.label.localeCompare(right.label));

  const toggle = (id: string, selected: boolean, setter: (value: string[]) => void, values: string[]) => {
    setter(selected ? [...new Set([...values, id])].sort() : values.filter((value) => value !== id));
    cancelStrategicFitCohortAdjustment();
  };
  const chooseMode = (next: EditorMode) => {
    setMode(next);
    cancelStrategicFitCohortAdjustment();
  };
  const draft = (): StrategicFitCohortAdjustmentDraft => {
    if (mode() === "merge") return { kind: "merge", route_ids: routeIds(), reason: reason() };
    if (mode() === "split") return { kind: "split", route_ids: routeIds(), reason: reason() };
    if (mode() === "rename") {
      return { kind: "rename", cohort_id: cohortId(), display_name: displayName() };
    }
    if (mode() === "exclude") {
      return { kind: "exclude", decision_ids: decisionIds(), reason: reason() };
    }
    const [target, ...idParts] = resetTarget().split(":");
    return {
      kind: "reset",
      target: target === "rename" ? "rename" : "override",
      target_id: idParts.join(":"),
    };
  };
  const requestPreview = (event: SubmitEvent) => {
    event.preventDefault();
    void previewStrategicFitCohortAdjustment(props.reportId, draft());
  };
  const confirm = () => {
    const preview = strategicFitCohortAdjustment().preview;
    if (preview !== null) void confirmStrategicFitCohortAdjustment(preview.preview_id);
  };

  return (
    <section
      class="strategic-fit-cohort-editor"
      aria-labelledby={`strategic-fit-cohort-editor-${props.finding.finding_id}`}
      data-cohort-editor
    >
      <header>
        <span>Adjust analysis</span>
        <h3 id={`strategic-fit-cohort-editor-${props.finding.finding_id}`}>Cohort adjustment</h3>
        <p>
          Current cohort: <strong>{strategicFitCohortDisplayName(
            props.finding.evidence.cohort_id,
            props.finding.evidence.cohort_id,
          )}</strong>
        </p>
        <p>Every change is metadata-only, reversible, and previewed before confirmation.</p>
      </header>

      <form onSubmit={requestPreview}>
        <fieldset>
          <legend>Choose an adjustment</legend>
          <For each={ACTIONS}>{(action) => (
            <label class="strategic-fit-cohort-choice">
              <input
                type="radio"
                name={`cohort-adjustment-${props.finding.finding_id}`}
                value={action.mode}
                checked={mode() === action.mode}
                onInput={() => chooseMode(action.mode)}
              />
              <span><strong>{action.label}</strong><small>{action.detail}</small></span>
            </label>
          )}</For>
        </fieldset>

        <Show when={mode() === "merge" || mode() === "split"}>
          <fieldset class="strategic-fit-cohort-options">
            <legend>Canonical routes</legend>
            <For each={routeOptions()}>{(option) => (
              <label>
                <input
                  type="checkbox"
                  value={option.routeId}
                  checked={routeIds().includes(option.routeId)}
                  onInput={(event) => toggle(
                    option.routeId,
                    event.currentTarget.checked,
                    setRouteIds,
                    routeIds(),
                  )}
                />
                <span><code>{option.routeId}</code><small>Cohort {option.cohortId}</small></span>
              </label>
            )}</For>
          </fieldset>
        </Show>

        <Show when={mode() === "exclude"}>
          <fieldset class="strategic-fit-cohort-options">
            <legend>Canonical decision subtrees</legend>
            <Show when={decisionOptions().length > 0} fallback={(
              <p data-impact-state="unavailable">Decision references are unavailable for this report.</p>
            )}>
              <For each={decisionOptions()}>{(decisionId) => (
                <label>
                  <input
                    type="checkbox"
                    value={decisionId}
                    checked={decisionIds().includes(decisionId)}
                    onInput={(event) => toggle(
                      decisionId,
                      event.currentTarget.checked,
                      setDecisionIds,
                      decisionIds(),
                    )}
                  />
                  <code>{decisionId}</code>
                </label>
              )}</For>
            </Show>
          </fieldset>
        </Show>

        <Show when={mode() === "rename"}>
          <label class="strategic-fit-cohort-field">
            Canonical cohort
            <select value={cohortId()} onInput={(event) => {
              setCohortId(event.currentTarget.value);
              cancelStrategicFitCohortAdjustment();
            }}>
              <For each={props.report.cohorts}>{(cohort) => (
                <option value={cohort.cohort_id}>{cohort.cohort_id}</option>
              )}</For>
            </select>
          </label>
          <label class="strategic-fit-cohort-field">
            User-facing name
            <input
              type="text"
              maxlength={120}
              value={displayName()}
              onInput={(event) => {
                setDisplayName(event.currentTarget.value);
                cancelStrategicFitCohortAdjustment();
              }}
            />
          </label>
        </Show>

        <Show when={mode() === "reset"}>
          <label class="strategic-fit-cohort-field">
            Saved adjustment to remove
            <select value={resetTarget()} onInput={(event) => {
              setResetTarget(event.currentTarget.value);
              cancelStrategicFitCohortAdjustment();
            }}>
              <option value="">Choose a saved adjustment</option>
              <For each={resetOptions()}>{(option) => (
                <option value={option.value}>{option.label}</option>
              )}</For>
            </select>
          </label>
        </Show>

        <Show when={mode() === "merge" || mode() === "split" || mode() === "exclude"}>
          <label class="strategic-fit-cohort-field">
            Optional reason
            <textarea rows={2} value={reason()} onInput={(event) => {
              setReason(event.currentTarget.value);
              cancelStrategicFitCohortAdjustment();
            }} />
          </label>
        </Show>

        <button type="submit" disabled={strategicFitCohortAdjustment().status === "previewing"}>
          {strategicFitCohortAdjustment().status === "previewing" ? "Calculating preview…" : "Preview adjustment"}
        </button>
      </form>

      <Show when={strategicFitCohortAdjustment().preview}>
        {(preview) => (
          <section class="strategic-fit-cohort-preview" aria-labelledby={`cohort-preview-${preview().preview_id}`}>
            <h4 id={`cohort-preview-${preview().preview_id}`}>Exact impact before confirmation</h4>
            <p>{preview().summary}</p>
            <dl>
              <Impact label="Current cohorts" value={preview().current_cohorts} />
              <Impact label="Proposed cohorts" value={preview().proposed_cohorts} />
              <Impact label="Affected routes" value={preview().affected_routes} />
              <Impact label="Current baselines" value={preview().current_baselines} />
              <Impact label="Proposed baselines" value={preview().proposed_baselines} />
              <Impact label="Current findings" value={preview().current_findings} />
              <Impact label="Proposed findings" value={preview().proposed_findings} />
            </dl>
            <p>No repertoire content, navigation, or document state changes until confirmation.</p>
            <div class="strategic-fit-cohort-preview-actions">
              <button type="button" onClick={confirm}>Confirm and analyze again</button>
              <button type="button" onClick={cancelStrategicFitCohortAdjustment}>Cancel preview</button>
            </div>
          </section>
        )}
      </Show>

      <Show when={strategicFitCohortAdjustment().message}>
        {(message) => (
          <p
            class="strategic-fit-cohort-feedback"
            role={strategicFitCohortAdjustment().status === "blocked" ? "alert" : "status"}
            data-cohort-adjustment-status={strategicFitCohortAdjustment().status}
          >{message()}</p>
        )}
      </Show>
    </section>
  );
}
