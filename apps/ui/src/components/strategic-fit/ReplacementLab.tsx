import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { ReplacementCandidateSourceKind } from "@chess-mcp/chess-tools";
import {
  REPLACEMENT_LAB_SUPPORTED_SOURCES,
  REPLACEMENT_LAB_UNAVAILABLE_SOURCES,
} from "../../application/strategic-fit-replacement";
import { replacementLab, replacementLabSnapshot } from "../../store/strategic-fit-replacement";
import CandidateTable, {
  CandidateDetails,
  buildCandidateComparisonRows,
  resolveCandidateSelection,
} from "./CandidateTable";
import ChangeSetPreview from "./ChangeSetPreview";
import ReplacementPareto from "./ReplacementPareto";

const SOURCE_LABELS: Readonly<Record<ReplacementCandidateSourceKind, string>> = {
  "existing-repertoire-transposition": "Existing preparation",
  "move-order-shortcut": "Move-order shortcuts",
  "opening-database": "Opening database",
  "engine-multipv": "Engine MultiPV",
  "user-defined": "User-defined lines",
  "structurally-similar-repertoire": "Structurally similar preparation",
};

const STATUS_LABELS = {
  closed: "Closed",
  "non-actionable": "No actionable pivot",
  "pivot-required": "Pivot selection required",
  "pivot-ready": "Pivot confirmation required",
  ready: "Ready to generate",
  running: "Generating candidates",
  complete: "Candidate previews staged",
  partial: "Partial candidates retained",
  cancelled: "Generation cancelled",
  failed: "Generation failed",
  stale: "Context became stale",
} as const;

const FOCUSABLE = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function sourceStateRows() {
  const result = replacementLabSnapshot().result;
  if (result === null) return [];
  const local = result.candidate_generation.source_results.map((entry) => ({
    id: entry.source_id,
    label: SOURCE_LABELS[entry.kind],
    state: entry.status,
    detail: entry.reason ?? `${entry.accepted_item_count} candidates retained`,
  }));
  const engine = result.engine_generation.source_results.map((entry) => ({
    id: entry.source_id,
    label: "Engine MultiPV",
    state: entry.status,
    detail: entry.reason ?? `${entry.accepted_item_count} candidates retained at depth ${entry.reached_depth ?? "unavailable"}`,
  }));
  const expansion = result.expansion.source_results.map((entry) => ({
    id: entry.source_id,
    label: entry.provider_kind === "engine" ? "Expansion engine" : "Expansion explorer",
    state: entry.state,
    detail: entry.reason ?? `${entry.accepted_item_count} continuation items retained`,
  }));
  return [...local, ...engine, ...expansion];
}

function itemErrors() {
  const result = replacementLabSnapshot().result;
  if (result === null) return [];
  return [
    ...result.candidate_generation.database_item_results
      .filter((item) => item.error_code !== null)
      .map((item) => ({
        id: `database:${item.evidence_id}:${item.item_index}`,
        source: "Opening database",
        status: item.status,
        code: item.error_code!,
        detail: item.explanation,
      })),
    ...result.engine_generation.engine_item_results
      .filter((item) => item.error_code !== null)
      .map((item) => ({
        id: `engine:${item.evidence_id ?? "none"}:${item.item_index}`,
        source: "Engine",
        status: item.status,
        code: item.error_code!,
        detail: item.explanation,
      })),
    ...result.expansion.evidence_item_results
      .filter((item) => item.error_code !== null)
      .map((item) => ({
        id: `expansion:${item.provider_kind}:${item.position.position_id}:${item.item_index}`,
        source: item.provider_kind === "engine" ? "Expansion engine" : "Expansion explorer",
        status: item.status,
        code: item.error_code!,
        detail: item.explanation,
      })),
    ...result.preview.items
      .filter((item) => item.error_code !== null)
      .map((item) => ({
        id: `preview:${item.candidate_id}`,
        source: "Browser staging",
        status: item.status,
        code: item.error_code!,
        detail: item.explanation,
      })),
  ];
}

export default function ReplacementLab() {
  let dialog!: HTMLElement;
  let closeButton!: HTMLButtonElement;
  let returnFocus: HTMLElement | null = null;
  const [selectedCandidateId, setSelectedCandidateId] = createSignal<string | null>(null);
  const state = replacementLabSnapshot;
  const pivotOptions = () => {
    const result = state().pivot_result;
    return result?.status === "alternatives-required"
      ? result.alternative_pivots
      : result?.status === "selected"
        ? [result.pivot, ...result.alternative_pivots]
        : [];
  };
  const comparisonRows = () => {
    const result = state().result;
    return result === null ? [] : buildCandidateComparisonRows(
      result.scoring,
      result.safety.candidates,
      result.preview.items,
    );
  };
  const selectedRow = () => comparisonRows().find((row) => row.candidate_id === selectedCandidateId()) ?? null;
  const selectCandidate = (candidateId: string) => {
    const next = resolveCandidateSelection(comparisonRows(), candidateId);
    if (state().review && state().review?.candidate_id !== next) void replacementLab.rejectReview();
    setSelectedCandidateId(next);
  };
  const nonActionablePivotReason = () => {
    const result = state().pivot_result;
    return result?.status === "non-actionable" ? result.non_actionable_reason : null;
  };
  const canGenerate = () => state().pivot_confirmed && state().status !== "running" &&
    state().actionability?.actionable === true;

  createEffect(() => replacementLab.synchronize());
  createEffect(() => {
    const selected = selectedCandidateId();
    if (selected !== null && !comparisonRows().some((row) => row.candidate_id === selected)) {
      setSelectedCandidateId(null);
    }
  });

  onMount(() => {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.focus();
    onCleanup(() => queueMicrotask(() => returnFocus?.isConnected && returnFocus.focus()));
  });

  const trapFocus = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      replacementLab.close();
      return;
    }
    if (event.key !== "Tab") return;
    event.stopPropagation();
    const elements = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter((element) => element.getClientRects().length > 0);
    if (elements.length === 0) return;
    const first = elements[0]!;
    const last = elements[elements.length - 1]!;
    if (event.shiftKey && (document.activeElement === first || event.target === closeButton)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div class="replacement-lab-backdrop" data-replacement-lab-status={state().status}>
      <section
        ref={dialog}
        class="replacement-lab"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replacement-lab-title"
        aria-describedby="replacement-lab-description"
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <header class="replacement-lab-header">
          <div>
            <span>Strategic Fit</span>
            <h2 id="replacement-lab-title">Replacement Lab</h2>
            <p id="replacement-lab-description">
              Generate full candidate subtrees and stage previews. Nothing is applied here.
            </p>
          </div>
          <div>
            <strong aria-live="polite">{STATUS_LABELS[state().status]}</strong>
            <button ref={closeButton} type="button" onClick={() => replacementLab.close()}>
              Close lab
            </button>
          </div>
        </header>

        <main class="replacement-lab-body">
          <section class="replacement-lab-context" aria-labelledby="replacement-lab-context-title">
            <h3 id="replacement-lab-context-title">Exact finding context</h3>
            <p><strong>{state().finding?.plain_language_category}</strong></p>
            <p>{state().finding?.affected_line_summary}</p>
            <dl>
              <div><dt>Document</dt><dd><code>{state().identity?.document_id}</code></dd></div>
              <div><dt>Request</dt><dd><code>{state().identity?.request_id}</code></dd></div>
              <div><dt>Report</dt><dd><code>{state().identity?.report_id}</code></dd></div>
              <div><dt>Finding</dt><dd><code>{state().identity?.finding_id}</code></dd></div>
              <div><dt>Semantic finding</dt><dd><code>{state().identity?.semantic_finding_id}</code></dd></div>
              <div><dt>Document revision</dt><dd>{state().identity?.repertoire_revision}</dd></div>
              <div><dt>Report revision</dt><dd><code>{state().identity?.report_repertoire_revision}</code></dd></div>
              <div><dt>Pivot</dt><dd><code>{state().selected_pivot_decision_id ?? "Not confirmed"}</code></dd></div>
              <div><dt>Profile</dt><dd><code>{state().identity?.profile_identity}</code></dd></div>
              <div><dt>Settings</dt><dd><code>{state().identity?.settings_identity}</code></dd></div>
              <div><dt>Repertoire owner</dt><dd>{state().identity?.repertoire_color === "black" ? "Black" : "White"}</dd></div>
            </dl>
            <p class="replacement-lab-pov" data-repertoire-color={state().identity?.repertoire_color}>
              User verdicts use {state().identity?.repertoire_color === "black" ? "Black" : "White"} repertoire POV.
              Engine cp/mate transport remains explicitly White POV.
            </p>
          </section>

          <Show when={state().status === "non-actionable" || state().status === "stale"}>
            <section class="replacement-lab-alert" role="alert" data-replacement-lab-unavailable>
              <h3>{state().status === "stale" ? "Replacement context is stale" : "No replacement action is supported"}</h3>
              <p>{state().actionability?.message ?? state().error?.message}</p>
              <Show when={nonActionablePivotReason()}>
                {(reason) => <p>Pivot reason: {reason()}</p>}
              </Show>
            </section>
          </Show>

          <Show when={state().actionability?.actionable === true}>
            <section class="replacement-lab-pivot" aria-labelledby="replacement-lab-pivot-title">
              <h3 id="replacement-lab-pivot-title">1. Confirm causal pivot</h3>
              <p>Select semantic repertoire decision. SAN paths remain navigation-only.</p>
              <Show when={pivotOptions().length > 0} fallback={(
                <div class="replacement-lab-alert" role="alert">
                  No supported repertoire-owned pivot is available. Candidate generation is blocked.
                </div>
              )}>
                <fieldset disabled={state().status === "running"}>
                  <legend>{pivotOptions().length === 1 ? "Confirm pivot" : "Select one supported pivot"}</legend>
                  <For each={pivotOptions()}>{(pivot) => (
                    <label>
                      <input
                        type="radio"
                        name="replacement-lab-pivot"
                        checked={state().selected_pivot_decision_id === pivot.decision_id}
                        onInput={() => replacementLab.selectPivot(pivot.decision_id)}
                      />
                      <span>
                        <strong>{pivot.san} · ply {pivot.ply}</strong>
                        <small><code>{pivot.decision_id}</code> · repertoire-owned</small>
                      </span>
                    </label>
                  )}</For>
                </fieldset>
                <button
                  type="button"
                  disabled={state().selected_pivot_decision_id === null || state().status === "running"}
                  onClick={() => replacementLab.confirmPivot()}
                >
                  {state().pivot_confirmed ? "Pivot confirmed" : "Confirm semantic pivot"}
                </button>
              </Show>
            </section>

            <section class="replacement-lab-controls" aria-labelledby="replacement-lab-controls-title">
              <h3 id="replacement-lab-controls-title">2. Candidate sources and engine</h3>
              <fieldset disabled={state().status === "running"}>
                <legend>Candidate sources</legend>
                <For each={REPLACEMENT_LAB_SUPPORTED_SOURCES}>{(kind) => (
                  <label>
                    <input
                      type="checkbox"
                      checked={state().controls.sources.includes(kind)}
                      onInput={(event) => replacementLab.setSource(kind, event.currentTarget.checked)}
                    />
                    <span><strong>{SOURCE_LABELS[kind]}</strong><small>Canonical Phase 8 producer</small></span>
                  </label>
                )}</For>
                <For each={REPLACEMENT_LAB_UNAVAILABLE_SOURCES}>{(kind) => (
                  <label data-source-unavailable="true">
                    <input type="checkbox" disabled />
                    <span><strong>{SOURCE_LABELS[kind]}</strong><small>Unavailable: no canonical Phase 8 seed producer</small></span>
                  </label>
                )}</For>
              </fieldset>
              <label class="replacement-lab-depth">
                Engine depth
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={state().controls.engine_depth}
                  disabled={state().status === "running" || !state().controls.sources.includes("engine-multipv")}
                  onInput={(event) => replacementLab.setDepth(event.currentTarget.valueAsNumber)}
                />
                <small>Depth is clamped to 1–30. Global Deep analysis keeps depth 30.</small>
              </label>
              <details>
                <summary>Generation budgets</summary>
                <dl>
                  <div><dt>Candidate limit</dt><dd>{state().controls.maximum_candidates}</dd></div>
                  <div><dt>Subtree nodes / candidate</dt><dd>{state().controls.maximum_subtree_nodes_per_candidate}</dd></div>
                  <div><dt>Engine positions</dt><dd>{state().controls.maximum_engine_positions}</dd></div>
                  <div><dt>Explorer queries</dt><dd>{state().controls.maximum_explorer_queries}</dd></div>
                  <div><dt>Strategic horizon</dt><dd>ply {state().controls.strategic_horizon_ply}</dd></div>
                </dl>
              </details>
              <div class="replacement-lab-run-actions">
                <button type="button" disabled={!canGenerate()} onClick={() => void replacementLab.generate()}>
                  Generate and stage previews
                </button>
                <Show when={state().status === "running"}>
                  <button type="button" onClick={() => replacementLab.cancel()}>Cancel generation</button>
                </Show>
                <Show when={["cancelled", "failed", "partial"].includes(state().status)}>
                  <button type="button" disabled={!state().pivot_confirmed} onClick={() => void replacementLab.retry()}>
                    Retry generation
                  </button>
                </Show>
              </div>
            </section>
          </Show>

          <Show when={state().status === "running" && state().progress}>
            {(progress) => (
              <section class="replacement-lab-progress" aria-labelledby="replacement-lab-progress-title" aria-live="polite">
                <h3 id="replacement-lab-progress-title">Generating candidates</h3>
                <progress max={Math.max(1, progress().total)} value={progress().completed} />
                <p>{progress().detail}</p>
                <span>{progress().completed} / {progress().total}</span>
              </section>
            )}
          </Show>

          <Show when={state().status !== "stale" ? state().error : null}>
            {(error) => (
              <section class="replacement-lab-alert" role="alert">
                <h3>Candidate generation failed</h3>
                <p><code>{error().code}</code>: {error().message}</p>
              </section>
            )}
          </Show>

          <Show when={state().result}>
            <section class="replacement-lab-results" aria-labelledby="replacement-lab-results-title">
              <header>
                <h3 id="replacement-lab-results-title">3. Generated candidate previews</h3>
                <p>
                  Compare canonical Phase 8 evidence. Selection inspects one stable candidate identity only;
                  it never recommends, accepts, applies, or mutates.
                </p>
              </header>
              <section aria-labelledby="replacement-lab-source-status-title">
                <h4 id="replacement-lab-source-status-title">Source status</h4>
                <ul class="replacement-lab-source-status">
                  <For each={sourceStateRows()}>{(source) => (
                    <li data-source-state={source.state}>
                      <strong>{source.label}</strong><span>{source.state}</span><p>{source.detail}</p>
                    </li>
                  )}</For>
                </ul>
              </section>
              <Show when={comparisonRows().length > 0} fallback={(
                <div class="replacement-lab-empty" role="status">
                  <strong>Candidate comparison unavailable</strong>
                  <p>
                    {state().result?.scoring.error_code === null
                      ? "No scored, partial, or unavailable candidate evidence was returned."
                      : `${state().result?.scoring.error_code}: ${state().result?.scoring.explanation}`}
                    {" "}Finding context remains unchanged.
                  </p>
                </div>
              )}>
                <ReplacementPareto
                  rows={comparisonRows()}
                  selectedCandidateId={selectedCandidateId()}
                  onSelect={selectCandidate}
                />
                <CandidateTable
                  rows={comparisonRows()}
                  selectedCandidateId={selectedCandidateId()}
                  onSelect={selectCandidate}
                />
                <Show when={selectedRow()} fallback={(
                  <div class="replacement-candidate-unavailable" role="status">
                    Select any chart point or candidate row to inspect exact subtree, axes, identities, provenance, and risks.
                    No candidate is preselected or labeled best.
                  </div>
                )}>
                  {(row) => (
                    <>
                      <CandidateDetails
                        row={row()}
                        repertoireColor={state().identity?.repertoire_color ?? state().result!.scoring.repertoire_color}
                      />
                      <ChangeSetPreview
                        row={row()}
                        review={state().review}
                        repertoireColor={state().identity?.repertoire_color ?? state().result!.scoring.repertoire_color}
                        onStage={(action) => void replacementLab.stageReview(row().candidate_id, action)}
                        onAccept={(confirmation) => void replacementLab.acceptReview(confirmation)}
                        onReject={() => void replacementLab.rejectReview()}
                      />
                    </>
                  )}
                </Show>
              </Show>
              <Show when={itemErrors().length > 0}>
                <details class="replacement-lab-errors">
                  <summary>{itemErrors().length} structured source or candidate errors</summary>
                  <ul>
                    <For each={itemErrors()}>{(item) => (
                      <li data-error-code={item.code}>
                        <strong>{item.source} · {item.status}</strong>
                        <code>{item.code}</code>
                        <p>{item.detail}</p>
                      </li>
                    )}</For>
                  </ul>
                </details>
              </Show>
            </section>
          </Show>
        </main>
      </section>
    </div>
  );
}
