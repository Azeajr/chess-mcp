import { For, Show } from "solid-js";
import {
  REPLACEMENT_STRATEGIC_SCORE_AXES,
  type ReplacementCandidateSafetySimulation,
  type ReplacementCandidateScoringResult,
  type ReplacementScoredCandidate,
  type ReplacementStrategicScoreAxis,
  type ReplacementStrategicScoreContribution,
  type StrategicFitSourceProvenance,
} from "@chess-mcp/chess-tools";

const AXIS_LABELS: Readonly<Record<ReplacementStrategicScoreAxis, string>> = {
  "strategic-fit": "Strategic fit",
  "strategic-familiarity": "Familiarity",
  "memorization-burden": "Memory burden",
  "expected-coverage": "Coverage",
  "new-concepts": "New concepts",
  "theory-size": "Theory size",
  popularity: "Popularity",
  "homogenization-cost": "Homogenization risk",
  "training-cost": "Training cost",
};

export interface CandidateAxisPresentation {
  readonly axis: ReplacementStrategicScoreAxis;
  readonly label: string;
  readonly state: "available" | "partial" | "unavailable";
  readonly value: string;
  readonly raw_value: number | null;
  readonly normalized_score: number | null;
  readonly unit: string;
  readonly higher_is_better: boolean;
  readonly reason: string;
  readonly provenance_source_ids: readonly string[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface CandidateComparisonRow {
  readonly candidate_id: string;
  readonly request_id: string;
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly cohort_id: string;
  readonly repertoire_revision: string;
  readonly pivot_id: string | null;
  readonly schema_version: string;
  readonly analysis_version: string;
  readonly replacement_schema_version: string;
  readonly san: string;
  readonly status: string;
  readonly preview_status: string;
  readonly preview_error_code: string | null;
  readonly preview_explanation: string | null;
  readonly pareto_status: "unscored" | "pareto-optimal" | "dominated";
  readonly pareto_reason: string;
  readonly dominated_by_candidate_ids: readonly string[];
  readonly active_pareto_axes: readonly string[];
  readonly repertoire_pov_evaluation: string;
  readonly white_pov_transport: string;
  readonly loss_from_best: string;
  readonly engine_detail: string;
  readonly axes: readonly CandidateAxisPresentation[];
  readonly concept_ids: readonly string[];
  readonly transposition_position_ids: readonly string[];
  readonly safety: ReplacementCandidateSafetySimulation | null;
  readonly candidate: ReplacementScoredCandidate;
}

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1_000) / 1_000);
}

export function formatCanonicalAxisValue(
  contribution: Pick<ReplacementStrategicScoreContribution, "state" | "raw_value" | "unit">,
): string {
  if (contribution.raw_value === null) {
    return contribution.state === "partial" ? "Unavailable (partial evidence)" : "Unavailable";
  }
  const raw = number(contribution.raw_value);
  const formatted =
    contribution.unit === "fraction" || contribution.unit === "score"
      ? `${number(contribution.raw_value * 100)}%`
      : contribution.unit === "centipawns"
        ? `${raw} cp`
        : contribution.unit === "nodes" || contribution.unit === "concepts"
          ? `${raw} ${contribution.unit}`
          : `${raw}${contribution.unit ? ` ${contribution.unit}` : ""}`;
  return contribution.state === "partial" ? `${formatted} (partial)` : formatted;
}

function evaluation(cp: number | null, mate: number | null): string {
  if (mate !== null) return `Mate ${mate > 0 ? "+" : ""}${mate}`;
  return cp === null ? "Unavailable" : `${cp > 0 ? "+" : ""}${number(cp)} cp`;
}

function axisPresentation(
  candidate: ReplacementScoredCandidate,
  axisId: ReplacementStrategicScoreAxis,
): CandidateAxisPresentation {
  const contribution = candidate.strategic_score.contributions.find((item) => item.axis === axisId);
  if (contribution === undefined) {
    return {
      axis: axisId,
      label: AXIS_LABELS[axisId],
      state: "unavailable",
      value: "Unavailable",
      raw_value: null,
      normalized_score: null,
      unit: "",
      higher_is_better: true,
      reason: "Canonical axis evidence is unavailable for this candidate.",
      provenance_source_ids: [],
      provenance: [],
    };
  }
  return {
    axis: axisId,
    label: AXIS_LABELS[axisId],
    state: contribution.state,
    value: formatCanonicalAxisValue(contribution),
    raw_value: contribution.raw_value,
    normalized_score: contribution.normalized_score,
    unit: contribution.unit,
    higher_is_better: contribution.higher_is_better,
    reason: contribution.reason ?? "No additional reason supplied.",
    provenance_source_ids: contribution.provenance.map((source) => source.source_id),
    provenance: contribution.provenance,
  };
}

export function buildCandidateComparisonRows(
  scoring: ReplacementCandidateScoringResult,
  safetyCandidates: readonly ReplacementCandidateSafetySimulation[] = [],
  previews: readonly {
    readonly candidate_id: string;
    readonly status: string;
    readonly error_code?: string | null;
    readonly explanation?: string;
  }[] = [],
): readonly CandidateComparisonRow[] {
  const safety = new Map(safetyCandidates.map((candidate) => [candidate.candidate_id, candidate]));
  const preview = new Map(previews.map((item) => [item.candidate_id, item]));
  return scoring.candidates.map((candidate) => {
    const candidatePreview = preview.get(candidate.candidate_id);
    return {
      candidate_id: candidate.candidate_id,
      request_id: candidate.request_id,
      report_id: candidate.report_id,
      finding_id: candidate.finding_id,
      semantic_finding_id: candidate.semantic_finding_id,
      cohort_id: candidate.cohort_id,
      repertoire_revision: candidate.repertoire_revision,
      pivot_id: scoring.pivot_id,
      schema_version: candidate.schema_version,
      analysis_version: candidate.analysis_version,
      replacement_schema_version: candidate.replacement_schema_version,
      san: candidate.expansion.seed.san,
      status: candidate.expansion.status,
      preview_status: candidatePreview?.status ?? "unavailable",
      preview_error_code: candidatePreview?.error_code ?? null,
      preview_explanation: candidatePreview?.explanation ?? null,
      pareto_status: candidate.pareto.status,
      pareto_reason: candidate.pareto.reason ?? "No Pareto explanation supplied.",
      dominated_by_candidate_ids: candidate.pareto.dominated_by_candidate_ids,
      active_pareto_axes: candidate.pareto.axis_ids,
      repertoire_pov_evaluation: evaluation(
        candidate.objective_quality.repertoire_pov_evaluation_cp,
        candidate.objective_quality.repertoire_pov_mate_in,
      ),
      white_pov_transport: evaluation(
        candidate.objective_quality.white_pov_evaluation_cp,
        candidate.objective_quality.white_pov_mate_in,
      ),
      loss_from_best:
        candidate.objective_quality.repertoire_pov_loss_from_best_cp === null
          ? "Unavailable"
          : `${number(candidate.objective_quality.repertoire_pov_loss_from_best_cp)} cp`,
      engine_detail:
        candidate.objective_quality.engine_depth === null
          ? "Engine depth unavailable"
          : `Depth ${candidate.objective_quality.engine_depth}, MultiPV ${candidate.objective_quality.engine_multipv ?? "unavailable"}`,
      axes: REPLACEMENT_STRATEGIC_SCORE_AXES.map((axisId) => axisPresentation(candidate, axisId)),
      concept_ids: candidate.strategic_score.new_concept_ids,
      transposition_position_ids: candidate.strategic_score.transposition_position_ids,
      safety: safety.get(candidate.candidate_id) ?? null,
      candidate,
    };
  });
}

function axis(row: CandidateComparisonRow, axisId: ReplacementStrategicScoreAxis) {
  return row.axes.find((item) => item.axis === axisId)!;
}

export interface CandidateTableProps {
  readonly rows: readonly CandidateComparisonRow[];
  readonly selectedCandidateId: string | null;
  readonly onSelect: (candidateId: string) => void;
}

export function resolveCandidateSelection(
  rows: readonly Pick<CandidateComparisonRow, "candidate_id">[],
  candidateId: string | null,
): string | null {
  return candidateId !== null && rows.some((row) => row.candidate_id === candidateId)
    ? candidateId
    : null;
}

export default function CandidateTable(props: CandidateTableProps) {
  return (
    <div class="replacement-candidate-table-wrap">
      <table class="replacement-candidate-table">
        <caption>
          Candidate comparison. Tradeoffs stay separate; Pareto status never means one aggregate
          best candidate.
        </caption>
        <thead>
          <tr>
            <th scope="col">Candidate</th>
            <th scope="col">Pareto status</th>
            <th scope="col">Repertoire evaluation</th>
            <th scope="col">Familiarity</th>
            <th scope="col">Memory burden</th>
            <th scope="col">Coverage</th>
            <th scope="col">Popularity</th>
            <th scope="col">Risk</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr
                data-candidate-id={row.candidate_id}
                data-candidate-status={row.status}
                data-pareto-status={row.pareto_status}
                data-selected={props.selectedCandidateId === row.candidate_id ? "true" : "false"}
              >
                <th scope="row" data-label="Candidate">
                  <button
                    type="button"
                    aria-pressed={props.selectedCandidateId === row.candidate_id}
                    aria-controls={
                      props.selectedCandidateId === row.candidate_id
                        ? `replacement-candidate-detail-${row.candidate_id}`
                        : undefined
                    }
                    onClick={() => props.onSelect(row.candidate_id)}
                  >
                    <strong>{row.san}</strong>
                    <code>{row.candidate_id}</code>
                    <span>{row.status}</span>
                    <span>Preview: {row.preview_status}</span>
                  </button>
                </th>
                <td data-label="Pareto status">
                  <strong>{row.pareto_status}</strong>
                  <Show when={row.dominated_by_candidate_ids.length > 0}>
                    <small>Dominated by {row.dominated_by_candidate_ids.join(", ")}</small>
                  </Show>
                </td>
                <td data-label="Repertoire evaluation">
                  <strong>{row.repertoire_pov_evaluation}</strong>
                  <small>
                    Loss {row.loss_from_best}; {row.engine_detail}
                  </small>
                </td>
                <td
                  data-label="Familiarity"
                  data-axis-state={axis(row, "strategic-familiarity").state}
                >
                  {axis(row, "strategic-familiarity").value}
                </td>
                <td
                  data-label="Memory burden"
                  data-axis-state={axis(row, "memorization-burden").state}
                >
                  {axis(row, "memorization-burden").value}
                </td>
                <td data-label="Coverage" data-axis-state={axis(row, "expected-coverage").state}>
                  {axis(row, "expected-coverage").value}
                </td>
                <td data-label="Popularity" data-axis-state={axis(row, "popularity").state}>
                  {axis(row, "popularity").value}
                </td>
                <td data-label="Risk">
                  <strong>{row.safety?.status ?? "Unavailable"}</strong>
                  <small>
                    {row.candidate.expansion.unresolved_risks.length} unresolved expansion risks
                  </small>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

export interface CandidateDetailsProps {
  readonly row: CandidateComparisonRow;
  readonly repertoireColor: "white" | "black";
}

function routeSan(row: CandidateComparisonRow, edgeIds: readonly string[]): string {
  const subtree = row.candidate.expansion.subtree;
  if (subtree === null) return "Unavailable";
  const edges = new Map(subtree.edges.map((edge) => [edge.edge_id, edge]));
  return edgeIds
    .map((edgeId) => edges.get(edgeId)?.san ?? `[Unavailable edge ${edgeId}]`)
    .join(" ");
}

export interface CandidateSubtreeRoutePresentation {
  readonly route_id: string;
  readonly san: string;
  readonly termination: string;
  readonly expected_frequency: string;
  readonly node_ids: readonly string[];
  readonly edge_ids: readonly string[];
}

export function buildCandidateSubtreeRoutes(
  row: CandidateComparisonRow,
): readonly CandidateSubtreeRoutePresentation[] {
  return (
    row.candidate.expansion.subtree?.routes.map((route) => ({
      route_id: route.route_id,
      san: routeSan(row, route.edge_ids) || "Root position",
      termination: route.termination,
      expected_frequency:
        route.expected_opponent_frequency === null
          ? "Unavailable"
          : `${number(route.expected_opponent_frequency * 100)}%`,
      node_ids: route.node_ids,
      edge_ids: route.edge_ids,
    })) ?? []
  );
}

export function CandidateDetails(props: CandidateDetailsProps) {
  const subtree = () => props.row.candidate.expansion.subtree;
  const provenance = () => props.row.candidate.expansion.seed.provenance;
  return (
    <article
      id={`replacement-candidate-detail-${props.row.candidate_id}`}
      class="replacement-candidate-detail"
      data-candidate-id={props.row.candidate_id}
      data-candidate-status={props.row.status}
      data-pareto-status={props.row.pareto_status}
      aria-labelledby={`replacement-candidate-detail-title-${props.row.candidate_id}`}
    >
      <header>
        <div>
          <span>Selected by stable candidate identity</span>
          <h4 id={`replacement-candidate-detail-title-${props.row.candidate_id}`}>
            {props.row.san} candidate evidence
          </h4>
          <code>{props.row.candidate_id}</code>
        </div>
        <strong>{props.row.pareto_status}</strong>
      </header>

      <section aria-labelledby={`replacement-candidate-identity-${props.row.candidate_id}`}>
        <h5 id={`replacement-candidate-identity-${props.row.candidate_id}`}>
          Immutable identity and versions
        </h5>
        <dl class="replacement-candidate-identity">
          <div>
            <dt>Request</dt>
            <dd>
              <code>{props.row.request_id}</code>
            </dd>
          </div>
          <div>
            <dt>Report</dt>
            <dd>
              <code>{props.row.report_id}</code>
            </dd>
          </div>
          <div>
            <dt>Finding</dt>
            <dd>
              <code>{props.row.finding_id}</code>
            </dd>
          </div>
          <div>
            <dt>Semantic finding</dt>
            <dd>
              <code>{props.row.semantic_finding_id}</code>
            </dd>
          </div>
          <div>
            <dt>Cohort</dt>
            <dd>
              <code>{props.row.cohort_id}</code>
            </dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd>
              <code>{props.row.repertoire_revision}</code>
            </dd>
          </div>
          <div>
            <dt>Pivot</dt>
            <dd>
              <code>{props.row.pivot_id ?? "Unavailable"}</code>
            </dd>
          </div>
          <div>
            <dt>Schema</dt>
            <dd>
              <code>{props.row.schema_version}</code>
            </dd>
          </div>
          <div>
            <dt>Analysis</dt>
            <dd>
              <code>{props.row.analysis_version}</code>
            </dd>
          </div>
          <div>
            <dt>Replacement schema</dt>
            <dd>
              <code>{props.row.replacement_schema_version}</code>
            </dd>
          </div>
          <div>
            <dt>Stage-only preview</dt>
            <dd>{props.row.preview_status}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby={`replacement-candidate-evaluation-${props.row.candidate_id}`}>
        <h5 id={`replacement-candidate-evaluation-${props.row.candidate_id}`}>
          Evaluation and Pareto evidence
        </h5>
        <p>
          <strong>{props.repertoireColor === "black" ? "Black" : "White"} repertoire POV:</strong>{" "}
          {props.row.repertoire_pov_evaluation}; loss from engine best {props.row.loss_from_best};{" "}
          {props.row.candidate.objective_quality.repertoire_pov_verdict}.
        </p>
        <p>
          <strong>White-POV engine transport:</strong> {props.row.white_pov_transport}.{" "}
          {props.row.engine_detail}.
        </p>
        <p>{props.row.pareto_reason}</p>
        <p>
          Active canonical axes:{" "}
          {props.row.active_pareto_axes.length > 0
            ? props.row.active_pareto_axes.join(", ")
            : "Unavailable"}
          .
        </p>
        <Show when={props.row.dominated_by_candidate_ids.length > 0}>
          <p>
            Exact dominators: <code>{props.row.dominated_by_candidate_ids.join(", ")}</code>.
          </p>
        </Show>
      </section>

      <section aria-labelledby={`replacement-candidate-axes-${props.row.candidate_id}`}>
        <h5 id={`replacement-candidate-axes-${props.row.candidate_id}`}>
          Canonical strategic axes
        </h5>
        <dl class="replacement-candidate-axes">
          <For each={props.row.axes}>
            {(item) => (
              <div data-axis={item.axis} data-axis-state={item.state}>
                <dt>{item.label}</dt>
                <dd>
                  <strong>{item.value}</strong>
                </dd>
                <dd>{item.reason}</dd>
                <dd>
                  Direction: {item.higher_is_better ? "higher is better" : "lower is better"};
                  provenance{" "}
                  {item.provenance_source_ids.length > 0
                    ? item.provenance_source_ids.join(", ")
                    : "Unavailable"}
                  .
                </dd>
                <For each={item.provenance}>
                  {(source) => (
                    <dd>
                      <code>{source.source_id}</code> · {source.kind} · {source.state} · version{" "}
                      {source.version ?? "Unavailable"} · snapshot{" "}
                      {source.snapshot ?? "Unavailable"}
                      <Show when={source.reason}>{(reason) => <> · {reason()}</>}</Show>
                    </dd>
                  )}
                </For>
              </div>
            )}
          </For>
        </dl>
      </section>

      <section aria-labelledby={`replacement-candidate-concepts-${props.row.candidate_id}`}>
        <h5 id={`replacement-candidate-concepts-${props.row.candidate_id}`}>
          Concepts, transpositions, and risk
        </h5>
        <dl class="replacement-candidate-identity">
          <div>
            <dt>New concepts</dt>
            <dd>
              {props.row.concept_ids.length > 0
                ? props.row.concept_ids.join(", ")
                : "None introduced in canonical evidence"}
            </dd>
          </div>
          <div>
            <dt>Transpositions</dt>
            <dd>
              {props.row.transposition_position_ids.length > 0
                ? props.row.transposition_position_ids.join(", ")
                : "None recorded in canonical evidence"}
            </dd>
          </div>
          <div>
            <dt>Safety state</dt>
            <dd>
              {props.row.safety === null
                ? "Unavailable"
                : `${props.row.safety.status}: ${props.row.safety.explanation}`}
            </dd>
          </div>
          <div>
            <dt>Unresolved risks</dt>
            <dd>{props.row.candidate.expansion.unresolved_risks.length}</dd>
          </div>
        </dl>
        <Show when={props.row.candidate.expansion.unresolved_risks.length > 0}>
          <ul class="replacement-candidate-risk-list">
            <For each={props.row.candidate.expansion.unresolved_risks}>
              {(risk) => (
                <li data-risk-status={risk.status}>
                  <strong>
                    {risk.kind} · {risk.status}
                  </strong>
                  <code>{risk.risk_id}</code>
                  <p>{risk.explanation}</p>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={props.row.safety?.safety_checks.length}>
          <ul class="replacement-candidate-risk-list" aria-label="Canonical safety checks">
            <For each={props.row.safety!.safety_checks}>
              {(check) => (
                <li data-risk-status={check.status}>
                  <strong>
                    {check.kind} · {check.status}
                  </strong>
                  <p>{check.explanation}</p>
                  <Show when={check.risk_ids.length > 0}>
                    <code>{check.risk_ids.join(", ")}</code>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <section aria-labelledby={`replacement-candidate-subtree-${props.row.candidate_id}`}>
        <h5 id={`replacement-candidate-subtree-${props.row.candidate_id}`}>
          Complete proposed subtree
        </h5>
        <Show
          when={subtree()}
          fallback={
            <div class="replacement-candidate-unavailable" role="status">
              <strong>Subtree unavailable</strong>
              <p>
                {props.row.candidate.reason ?? "Canonical expansion returned no proposed subtree."}
              </p>
            </div>
          }
        >
          {(tree) => (
            <>
              <p>
                <code>{tree().subtree_id}</code> · {tree().status} · {tree().nodes.length} nodes ·{" "}
                {tree().edges.length} edges · {tree().routes.length} routes · horizon ply{" "}
                {tree().strategic_horizon_ply}.
              </p>
              <p>
                Important replies {tree().covered_important_reply_count}/
                {tree().important_reply_count}; forcing replies {tree().covered_forcing_reply_count}
                /{tree().forcing_reply_count}.
              </p>
              <Show when={tree().truncation_reasons.length > 0}>
                <p>Truncation: {tree().truncation_reasons.join(", ")}.</p>
              </Show>
              <ol class="replacement-subtree-routes">
                <For each={buildCandidateSubtreeRoutes(props.row)}>
                  {(route) => (
                    <li data-route-termination={route.termination}>
                      <strong>{route.san}</strong>
                      <span>
                        {route.termination}; expected frequency {route.expected_frequency}
                      </span>
                      <code>{route.route_id}</code>
                    </li>
                  )}
                </For>
              </ol>
              <details class="replacement-subtree-expert">
                <summary>All subtree nodes and edges</summary>
                <h6>Nodes</h6>
                <ul>
                  <For each={tree().nodes}>
                    {(node) => (
                      <li>
                        <code>{node.node_id}</code> · {node.kind} · ply {node.ply} · position{" "}
                        <code>{node.position_id}</code>
                        <Show when={node.transposition_target_position_id}>
                          {(target) => (
                            <>
                              {" "}
                              · transposes to <code>{target()}</code>
                            </>
                          )}
                        </Show>
                        <small>{node.fen}</small>
                      </li>
                    )}
                  </For>
                </ul>
                <h6>Edges</h6>
                <ul>
                  <For each={tree().edges}>
                    {(edge) => (
                      <li>
                        <code>{edge.edge_id}</code> · {edge.san} ({edge.uci}) · {edge.owner} ·{" "}
                        {edge.forcing ? "forcing" : "not forcing"} · expected opponent frequency{" "}
                        {edge.expected_opponent_frequency === null
                          ? "Unavailable"
                          : `${number(edge.expected_opponent_frequency * 100)}%`}
                      </li>
                    )}
                  </For>
                </ul>
              </details>
            </>
          )}
        </Show>
      </section>

      <details class="replacement-candidate-provenance">
        <summary>Exact candidate provenance and structured partial evidence</summary>
        <h5>Candidate sources</h5>
        <Show when={provenance().length > 0} fallback={<p>Provenance unavailable.</p>}>
          <ul>
            <For each={provenance()}>
              {(source) => (
                <li>
                  <code>{source.source_id}</code> · {source.kind} · {source.status} · provider{" "}
                  {source.provider ?? "Unavailable"} · version {source.version ?? "Unavailable"} ·
                  snapshot {source.snapshot ?? "Unavailable"}
                  <Show when={source.reason}>{(reason) => <p>{reason()}</p>}</Show>
                  <For each={source.provenance}>
                    {(nested) => (
                      <small>
                        <code>{nested.source_id}</code> · {nested.kind} · {nested.state} · version{" "}
                        {nested.version ?? "Unavailable"} · snapshot{" "}
                        {nested.snapshot ?? "Unavailable"}
                        <Show when={nested.reason}>{(reason) => <> · {reason()}</>}</Show>
                      </small>
                    )}
                  </For>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <h5>Structured evidence errors and omissions</h5>
        <Show when={props.row.safety?.error_code}>
          {(errorCode) => (
            <p>
              <code>{errorCode()}</code>: {props.row.safety!.explanation}
            </p>
          )}
        </Show>
        <Show when={props.row.preview_error_code}>
          {(errorCode) => (
            <p>
              <code>{errorCode()}</code>: {props.row.preview_explanation ?? "Preview unavailable."}
            </p>
          )}
        </Show>
        <Show
          when={
            props.row.candidate.expansion.evidence_item_results.some(
              (item) => item.error_code !== null,
            ) || props.row.candidate.expansion.omissions.length > 0
          }
          fallback={<p>No candidate-specific structured errors or omissions.</p>}
        >
          <ul>
            <For
              each={props.row.candidate.expansion.evidence_item_results.filter(
                (item) => item.error_code !== null,
              )}
            >
              {(item) => (
                <li>
                  <code>{item.error_code}</code> · {item.status} · {item.explanation}
                </li>
              )}
            </For>
            <For each={props.row.candidate.expansion.omissions}>
              {(item) => (
                <li>
                  <code>{item.omission_id}</code> · {item.reason} · {item.explanation}
                </li>
              )}
            </For>
          </ul>
        </Show>
      </details>
    </article>
  );
}
