import { For, Show, createEffect, createSignal } from "solid-js";
import type {
  ReplacementChangeOperation,
  ReplacementOperationDiff,
  StrategicFitSourceProvenance,
} from "@chess-mcp/chess-tools";
import type { ReplacementLabChangeReviewAction } from "../../application/strategic-fit-replacement";
import {
  strategicFitChangeConfirmation,
  type StrategicFitStagedChange,
} from "../../store/strategic-fit-changes";
import type { ReplacementLabChangeReviewSnapshot } from "../../store/strategic-fit-replacement";
import { strategicFitPrintExportMode } from "../../store/ui";
import type { CandidateComparisonRow } from "./CandidateTable";
import BeforeAfterImpact from "./BeforeAfterImpact";
import { VISUALIZATION_RENDER_LIMITS, boundedWindow } from "./visualization-limits";
import { VIRTUAL_TABLE_ROW_HEIGHT, createVirtualRows } from "./virtual-rows";

const path = (value: readonly string[]) => value.join(" ") || "root";

function operationDiff(
  stage: StrategicFitStagedChange,
  operationId: string,
): ReplacementOperationDiff | null {
  return (
    stage.preview.result.preview.operation_diffs.find(
      (diff) => diff.operation_id === operationId,
    ) ?? null
  );
}

/**
 * Task 10.4 — a change set that touches a deep subtree can list thousands of descendant paths.
 * The first window is bounded and the remainder stays one explicit click away.
 */
function Paths(props: { label: string; paths: readonly (readonly string[])[] }) {
  const [expanded, setExpanded] = createSignal(false);
  const window = () =>
    boundedWindow(props.paths, VISUALIZATION_RENDER_LIMITS.review_rows, expanded());
  /** Task 12.3 — the window is mounted through a bounded scrolling viewport, expanded or not. */
  const rows = createVirtualRows({
    items: () => window().items,
    rowSize: VIRTUAL_TABLE_ROW_HEIGHT,
    enabled: () => !strategicFitPrintExportMode(),
  });
  return (
    <Show when={props.paths.length > 0}>
      <div>
        <strong>{props.label}</strong>
        <div
          class="strategic-fit-virtual-scroll"
          data-virtualized={rows.window().complete ? "false" : "true"}
          ref={rows.attach}
        >
          <ul
            data-review-paths-shown={window().shown}
            data-review-paths-total={window().total}
            data-review-paths-mounted={rows.window().mounted}
            aria-label={`${props.label} (${window().total})`}
            style={{
              "padding-top": `${rows.window().lead}px`,
              "padding-bottom": `${rows.window().trail}px`,
            }}
          >
            <For each={rows.window().items}>
              {(item, index) => (
                <li
                  aria-setsize={rows.window().total}
                  aria-posinset={rows.window().start + index() + 1}
                >
                  <code>{path(item)}</code>
                </li>
              )}
            </For>
          </ul>
        </div>
        <Show when={!window().complete}>
          <button type="button" onClick={() => setExpanded(true)} data-review-show-all-paths>
            Show all {window().total} paths
          </button>
        </Show>
      </div>
    </Show>
  );
}

function OperationDetails(props: {
  operation: ReplacementChangeOperation;
  stage: StrategicFitStagedChange;
}) {
  const diff = () => operationDiff(props.stage, props.operation.operation_id);
  return (
    <li data-operation-kind={props.operation.kind}>
      <header>
        <strong>
          {props.operation.sequence + 1}. {props.operation.kind}
        </strong>
        <code>{props.operation.operation_id}</code>
      </header>
      <Show when={props.operation.kind === "add-subtree"}>
        {(() => {
          const operation = props.operation.kind === "add-subtree" ? props.operation : null;
          return (
            <Show when={operation}>
              <p>
                Add exact subtree <code>{operation.subtree.subtree_id}</code> below{" "}
                <code>{operation.parent.position_id}</code> at{" "}
                <code>{path(operation.parent.source_san_path)}</code>.
              </p>
            </Show>
          );
        })()}
      </Show>
      <Show when={props.operation.kind === "link-transposition"}>
        {(() => {
          const operation = props.operation.kind === "link-transposition" ? props.operation : null;
          return (
            <Show when={operation}>
              <p>
                Link <code>{operation.source.position_id}</code> to canonical position{" "}
                <code>{operation.target_position_id}</code>.
              </p>
            </Show>
          );
        })()}
      </Show>
      <Show when={props.operation.kind === "preserve-annotation"}>
        {(() => {
          const operation = props.operation.kind === "preserve-annotation" ? props.operation : null;
          return (
            <Show when={operation}>
              <div>
                <p>
                  Preserve only semantically equivalent annotations:{" "}
                  <strong>{String(operation.semantic_equivalence_verified)}</strong>.
                </p>
                <p>
                  Comments: {operation.comments.join(" | ") || "None"}. NAGs:{" "}
                  {operation.nags.join(", ") || "None"}.
                </p>
                <code>
                  {path(operation.source.source_san_path)} to{" "}
                  {path(operation.target.source_san_path)}
                </code>
              </div>
            </Show>
          );
        })()}
      </Show>
      <Show when={props.operation.kind === "archive-subtree"}>
        {(() => {
          const operation = props.operation.kind === "archive-subtree" ? props.operation : null;
          return (
            <Show when={operation}>
              <div>
                <p>
                  Archive exact old subtree before any prune. Archive{" "}
                  <code>{operation.archive_id}</code>; target{" "}
                  <code>{path(operation.target.source_san_path)}</code>.
                </p>
                <details>
                  <summary>Exact archive PGN</summary>
                  <pre>{operation.archive_pgn}</pre>
                </details>
              </div>
            </Show>
          );
        })()}
      </Show>
      <Show when={props.operation.kind === "prune-subtree"}>
        {(() => {
          const operation = props.operation.kind === "prune-subtree" ? props.operation : null;
          return (
            <Show when={operation}>
              <p>
                Prune exact subtree <code>{path(operation.target.source_san_path)}</code> only after
                archive operation <code>{operation.archive_operation_id}</code>. Literal
                confirmation: <strong>{String(operation.explicitly_confirmed)}</strong>.
              </p>
            </Show>
          );
        })()}
      </Show>
      <Show when={props.operation.kind === "reorder-variations"}>
        {(() => {
          const operation = props.operation.kind === "reorder-variations" ? props.operation : null;
          return (
            <Show when={operation}>
              <p>
                Reorder canonical parent <code>{operation.parent_position_id}</code>:{" "}
                <code>{operation.ordered_decision_ids.join(", ")}</code>.
              </p>
            </Show>
          );
        })()}
      </Show>
      <Show
        when={
          props.operation.kind === "create-training-item" ||
          props.operation.kind === "update-intent-metadata"
        }
      >
        <p>
          Operation retained exactly from canonical change set; this review does not create
          later-task UI behavior.
        </p>
      </Show>
      <Show when={diff()}>
        {(value) => (
          <div class="replacement-operation-paths">
            <Paths label="Exact additions" paths={value().added_paths} />
            <Paths label="Exact links" paths={value().linked_paths} />
            <Paths label="Exact annotations" paths={value().annotated_paths} />
            <Paths label="Exact archives" paths={value().archived_paths} />
            <Paths label="Exact removals" paths={value().removed_paths} />
            <Paths label="Reordered parents" paths={value().reordered_parent_paths} />
            <Show when={value().linked_position_ids.length}>
              <p>
                Linked position IDs: <code>{value().linked_position_ids.join(", ")}</code>
              </p>
            </Show>
            <Show when={value().archive_ids.length}>
              <p>
                Archive IDs: <code>{value().archive_ids.join(", ")}</code>
              </p>
            </Show>
          </div>
        )}
      </Show>
    </li>
  );
}

function provenance(stage: StrategicFitStagedChange): readonly StrategicFitSourceProvenance[] {
  const byId = new Map<string, StrategicFitSourceProvenance>();
  const candidateEvidence = stage.safety.candidates.flatMap((candidate) => [
    ...candidate.provenance,
    ...candidate.safety_checks.flatMap((check) => check.provenance),
    ...candidate.coverage_effects.provenance,
    ...candidate.coverage_effects.affected_metrics.flatMap((metric) => metric.provenance),
    ...candidate.coverage_effects.newly_covered_replies.flatMap((reply) => reply.provenance),
    ...candidate.coverage_effects.newly_uncovered_replies.flatMap((reply) => reply.provenance),
  ]);
  for (const source of [
    ...stage.preview.provenance,
    ...stage.change_set.provenance,
    ...stage.change_set.operations.flatMap((operation) => operation.provenance),
    ...stage.change_set.safety_checks.flatMap((check) => check.provenance),
    ...stage.safety.provenance,
    ...candidateEvidence,
  ])
    byId.set(source.source_id, source);
  return [...byId.values()].sort((left, right) => left.source_id.localeCompare(right.source_id));
}

export function buildChangeSetReviewEvidence(
  stage: StrategicFitStagedChange,
  safety: NonNullable<
    ReplacementLabChangeReviewSnapshot["evidence"]
  >["safety"]["candidates"][number],
) {
  const preview = stage.preview.result.preview;
  return {
    identities: strategicFitChangeConfirmation(stage),
    versions: {
      schema_version: stage.change_set.schema_version,
      analysis_version: stage.change_set.analysis_version,
      replacement_schema_version: stage.change_set.replacement_schema_version,
    },
    retention: stage.change_set.retention,
    operations: stage.change_set.operations.map((operation) => ({
      operation,
      diff: operationDiff(stage, operation.operation_id),
    })),
    affected_paths: preview.affected_paths,
    archive_payloads: preview.archive_payloads,
    preserved_annotation_count: preview.preserved_annotation_count,
    unresolved_risks: safety.scored_candidate.expansion.unresolved_risks,
    safety_checks: safety.safety_checks,
    provenance: provenance(stage),
    structured_operation_results: stage.preview.operation_results,
    finding_changes_state: preview.finding_changes_state,
  } as const;
}

export function blockedReviewCopy(action: ReplacementLabChangeReviewAction) {
  return action === "replace"
    ? {
        heading: "Pruning blocked by exact failed checks",
        fallback: "Canonical producer blocked pruning before a staged preview was available.",
      }
    : {
        heading: "Add-and-validate change blocked by exact failed checks",
        fallback:
          "Canonical producer blocked add-and-validate before a staged preview was available.",
      };
}

export default function ChangeSetPreview(props: {
  row: CandidateComparisonRow;
  review: ReplacementLabChangeReviewSnapshot | null;
  repertoireColor: "white" | "black";
  onStage(action: ReplacementLabChangeReviewAction): void;
  onAccept(confirmation: ReturnType<typeof strategicFitChangeConfirmation>): void;
  onReject(): void;
}) {
  const [confirmed, setConfirmed] = createSignal(false);
  const current = () =>
    props.review?.candidate_id === props.row.candidate_id ? props.review : null;
  const stage = () => current()?.stage ?? null;
  const safety = () =>
    current()?.evidence?.safety.candidates.find(
      (item) => item.candidate_id === props.row.candidate_id,
    ) ?? null;
  createEffect(() => {
    stage()?.stage_id;
    current()?.action;
    setConfirmed(false);
  });
  return (
    <section
      class="replacement-change-review"
      aria-labelledby="replacement-change-review-title"
      data-review-status={current()?.status ?? "idle"}
    >
      <header>
        <div>
          <span>4. Revision-bound staged review</span>
          <h4 id="replacement-change-review-title">Review exact atomic change</h4>
        </div>
        <code>{props.row.candidate_id}</code>
      </header>
      <p>
        Preview and reject do not mutate repertoire. Default keeps old line active. Pruning requires
        fresh canonical safety simulation, archive first, and final revision confirmation.
      </p>

      <Show when={!current()}>
        <button
          type="button"
          class="replacement-review-start"
          onClick={() => {
            props.onStage("add-alternative");
          }}
        >
          Review add-and-validate change
        </button>
      </Show>

      <Show when={current()}>
        {(review) => (
          <>
            <fieldset
              class="replacement-retention-controls"
              disabled={
                review().status === "loading" ||
                review().status === "accepting" ||
                review().status === "accepted"
              }
            >
              <legend>Old-line retention</legend>
              <label>
                <input
                  type="radio"
                  name={`retention:${props.row.candidate_id}`}
                  checked={review().action === "add-alternative"}
                  onInput={() => {
                    props.onStage("add-alternative");
                  }}
                />
                <span>
                  <strong>Add and validate alternative (default)</strong>
                  <small>Keep old line active. No archive or prune operation.</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name={`retention:${props.row.candidate_id}`}
                  checked={review().action === "replace"}
                  onInput={() => {
                    props.onStage("replace");
                  }}
                />
                <span>
                  <strong>Archive then prune old line</strong>
                  <small>
                    Optional. Blocked unless every canonical coverage and gap check passes.
                  </small>
                </span>
              </label>
            </fieldset>

            <div
              class="replacement-review-status"
              role={
                review().status === "blocked" ||
                review().status === "stale" ||
                review().status === "error"
                  ? "alert"
                  : "status"
              }
              aria-live="polite"
            >
              <strong>{review().status}</strong>
              <Show when={review().status === "loading"}>
                <span> Running canonical safety, change-set, and staging boundaries…</span>
              </Show>
              <Show when={review().status === "accepting"}>
                <span> Confirming unchanged evidence and applying one atomic staged change…</span>
              </Show>
              <Show when={review().error}>
                {(error) => (
                  <span>
                    {" "}
                    <code>{error().code}</code>: {error().message}
                  </span>
                )}
              </Show>
              <Show when={review().status === "accepted"}>
                <span> Atomic change accepted. No rescan or resolution claim has been made.</span>
              </Show>
              <Show when={review().status === "rejected"}>
                <span> Preview rejected without mutation.</span>
              </Show>
            </div>

            <Show when={stage()} keyed>
              {(value) => (
                <Show when={safety()} keyed>
                  {(canonicalSafety) => {
                    const preview = value.preview.result.preview;
                    return (
                      <>
                        <dl class="replacement-review-identities">
                          <div>
                            <dt>Document</dt>
                            <dd>
                              <code>{value.document_id}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Document revision</dt>
                            <dd>{value.base_revision}</dd>
                          </div>
                          <div>
                            <dt>Repertoire revision</dt>
                            <dd>
                              <code>{value.base_repertoire_revision}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Request</dt>
                            <dd>
                              <code>{value.safety.request_id}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Report</dt>
                            <dd>
                              <code>{value.safety.report_id}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Finding</dt>
                            <dd>
                              <code>{value.safety.finding_id}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Semantic finding</dt>
                            <dd>
                              <code>{value.safety.semantic_finding_id}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Pivot</dt>
                            <dd>
                              <code>{value.safety.pivot_id}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Candidate</dt>
                            <dd>
                              <code>{value.change_set.candidate_id}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Change set</dt>
                            <dd>
                              <code>{value.change_set.change_set_id}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Stage</dt>
                            <dd>
                              <code>{value.stage_id}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Versions</dt>
                            <dd>
                              <code>
                                {value.change_set.schema_version} /{" "}
                                {value.change_set.analysis_version} /{" "}
                                {value.change_set.replacement_schema_version}
                              </code>
                            </dd>
                          </div>
                          <div>
                            <dt>Safety identity</dt>
                            <dd>
                              <code>{value.safety_identity}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Preview identity</dt>
                            <dd>
                              <code>{value.preview_identity}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Archive identity</dt>
                            <dd>
                              <code>{value.archive_identity}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Provenance identity</dt>
                            <dd>
                              <code>{value.provenance_identity}</code>
                            </dd>
                          </div>
                        </dl>

                        <section aria-labelledby="replacement-operations-title">
                          <h5 id="replacement-operations-title">Exact ordered operations</h5>
                          <p>
                            Retention: <strong>{value.change_set.retention.archive}</strong>,{" "}
                            <strong>{value.change_set.retention.prune}</strong>.
                            Archive-before-prune:{" "}
                            {String(value.change_set.retention.archive_before_prune)}.
                          </p>
                          <ol class="replacement-operation-list">
                            <For each={value.change_set.operations}>
                              {(operation) => (
                                <OperationDetails operation={operation} stage={value} />
                              )}
                            </For>
                          </ol>
                        </section>

                        <BeforeAfterImpact
                          preview={preview}
                          safety={canonicalSafety}
                          repertoireColor={props.repertoireColor}
                        />

                        <section aria-labelledby="replacement-risks-title">
                          <h5 id="replacement-risks-title">Unresolved risks and partial states</h5>
                          <ul class="replacement-review-risks">
                            <For
                              each={canonicalSafety.scored_candidate.expansion.unresolved_risks}
                              fallback={
                                <li data-risk-status="empty">
                                  No unresolved risks in canonical safety evidence.
                                </li>
                              }
                            >
                              {(risk) => (
                                <li data-risk-status={risk.status}>
                                  <strong>
                                    {risk.kind}: {risk.status}
                                  </strong>
                                  <code>{risk.risk_id}</code>
                                  <p>{risk.explanation}</p>
                                  <small>
                                    Positions {risk.affected_position_ids.join(", ") || "none"};
                                    routes {risk.affected_route_ids.join(", ") || "none"}
                                  </small>
                                </li>
                              )}
                            </For>
                          </ul>
                          <Show when={value.change_set.unresolved_risk_ids.length}>
                            <p>
                              Change-set unresolved IDs:{" "}
                              <code>{value.change_set.unresolved_risk_ids.join(", ")}</code>
                            </p>
                          </Show>
                        </section>

                        <section aria-labelledby="replacement-archives-title">
                          <h5 id="replacement-archives-title">Archive and annotation outcome</h5>
                          <p>
                            Preserved annotations: {preview.preserved_annotation_count}. Archive
                            IDs: {preview.archive_ids.join(", ") || "None; old line remains active"}
                            .
                          </p>
                          <For each={preview.archive_payloads}>
                            {(archive) => (
                              <details class="replacement-archive-payload">
                                <summary>
                                  Archive <code>{archive.archive_id}</code>
                                </summary>
                                <p>
                                  Operation <code>{archive.operation_id}</code>; target{" "}
                                  <code>{path(archive.target.source_san_path)}</code>.
                                </p>
                                <pre>{archive.pgn}</pre>
                              </details>
                            )}
                          </For>
                        </section>

                        <details class="replacement-review-provenance">
                          <summary>
                            Exact immutable provenance ({provenance(value).length} sources)
                          </summary>
                          <ul>
                            <For each={provenance(value)}>
                              {(source) => (
                                <li data-source-state={source.state}>
                                  <code>{source.source_id}</code>
                                  <strong>
                                    {source.kind} · {source.state}
                                  </strong>
                                  <span>
                                    version {source.version ?? "unavailable"}; snapshot{" "}
                                    {source.snapshot ?? "unavailable"}
                                  </span>
                                  <small>{source.reason ?? "No source warning."}</small>
                                </li>
                              )}
                            </For>
                          </ul>
                        </details>

                        <Show when={review().status === "ready"}>
                          <fieldset class="replacement-final-confirmation">
                            <legend>Final atomic acceptance</legend>
                            <label>
                              <input
                                type="checkbox"
                                checked={confirmed()}
                                onInput={(event) => setConfirmed(event.currentTarget.checked)}
                              />
                              <span>
                                I confirm document revision <strong>{value.base_revision}</strong> (
                                <code>{value.base_repertoire_revision}</code>) and exact preview
                                evidence <code>{value.preview_identity}</code>.
                              </span>
                            </label>
                            <p>
                              Acceptance rechecks document, tree, metadata, safety, change set,
                              preview, archive, versions, and provenance. Any changed evidence or
                              stale revision is rejected.
                            </p>
                            <div>
                              <button
                                type="button"
                                disabled={!confirmed()}
                                onClick={() => {
                                  props.onAccept(strategicFitChangeConfirmation(value));
                                }}
                              >
                                Accept one atomic change at revision {value.base_revision}
                              </button>
                              <button type="button" onClick={props.onReject}>
                                Reject preview
                              </button>
                            </div>
                          </fieldset>
                        </Show>
                      </>
                    );
                  }}
                </Show>
              )}
            </Show>

            <Show when={review().status === "blocked" && safety()}>
              {(candidate) => (
                <section class="replacement-prune-blocked" role="alert">
                  <h5>{blockedReviewCopy(review().action).heading}</h5>
                  <ul>
                    <For
                      each={candidate().safety_checks.filter(
                        (check) => check.status === "blocked" || check.status === "unavailable",
                      )}
                      fallback={
                        <li>
                          {blockedReviewCopy(review().action).fallback}{" "}
                          <code>{review().error?.code}</code>
                        </li>
                      }
                    >
                      {(check) => (
                        <li data-check-status={check.status}>
                          <strong>
                            {check.kind}: {check.status}
                          </strong>
                          <p>{check.explanation}</p>
                          <code>{check.risk_ids.join(", ") || "No risk ID"}</code>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              )}
            </Show>
          </>
        )}
      </Show>
    </section>
  );
}
