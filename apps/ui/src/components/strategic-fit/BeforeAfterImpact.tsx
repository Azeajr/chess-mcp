import { For, Show } from "solid-js";
import type {
  ReplacementCandidateSafetySimulation,
  ReplacementChangeSetPreview,
  ReplacementMetricEffect,
  ReplacementObjectiveQuality,
  ReplacementStrategicScore,
} from "@chess-mcp/chess-tools";

const number = (value: number | null, unit = "") => value === null
  ? "Unavailable"
  : `${Number.isInteger(value) ? value : value.toFixed(3)}${unit}`;

const percent = (value: number | null) => value === null ? "Unavailable" : `${(value * 100).toFixed(1)}%`;

const delta = (before: number | null, after: number | null, unit = "") =>
  before === null || after === null ? "Unavailable" : number(after - before, unit);

const evaluation = (quality: ReplacementObjectiveQuality, repertoireColor: "white" | "black") => ({
  repertoire: quality.repertoire_pov_mate_in !== null
    ? `Mate ${quality.repertoire_pov_mate_in}`
    : quality.repertoire_pov_evaluation_cp === null ? "Unavailable" : `${quality.repertoire_pov_evaluation_cp} cp`,
  white: quality.white_pov_mate_in !== null
    ? `Mate ${quality.white_pov_mate_in}`
    : quality.white_pov_evaluation_cp === null ? "Unavailable" : `${quality.white_pov_evaluation_cp} cp`,
  owner: repertoireColor === "black" ? "Black" : "White",
});

const treeRows = (preview: ReplacementChangeSetPreview) => ([
  ["Positions", preview.before.position_count, preview.after.position_count],
  ["Decisions", preview.before.decision_count, preview.after.decision_count],
  ["Canonical routes", preview.before.route_count, preview.after.route_count],
  ["Source routes", preview.before.source_route_count, preview.after.source_route_count],
  ["Transpositions", preview.before.transposition_count, preview.after.transposition_count],
] as const);

export function buildBeforeAfterImpact(preview: ReplacementChangeSetPreview) {
  const score = preview.strategic_score_after;
  return {
    tree: treeRows(preview).map(([label, before, after]) => ({ label, before, after, delta: after - before })),
    coverage: {
      state: preview.coverage_effects.state,
      before: preview.coverage_effects.popularity_weighted_before,
      after: preview.coverage_effects.popularity_weighted_after,
      delta: preview.coverage_effects.popularity_weighted_delta,
      newly_covered: preview.coverage_effects.newly_covered_replies,
      newly_uncovered: preview.coverage_effects.newly_uncovered_replies,
    },
    objective: {
      before: preview.objective_quality_before,
      after: preview.objective_quality_after,
    },
    theory: {
      before: score.theory_nodes_before,
      after: score.theory_nodes_after,
      added: score.theory_nodes_added,
      removed: score.theory_nodes_removed,
    },
    training: {
      before: preview.strategic_score_before.training_cost,
      after: preview.strategic_score_after.training_cost,
      delta: preview.strategic_score_before.training_cost === null || preview.strategic_score_after.training_cost === null
        ? null
        : preview.strategic_score_after.training_cost - preview.strategic_score_before.training_cost,
    },
    affected_paths: preview.affected_paths,
    affected_metrics: preview.coverage_effects.affected_metrics,
  } as const;
}

function ScoreImpact(props: {
  before: ReplacementStrategicScore;
  after: ReplacementStrategicScore;
}) {
  const rows = () => ([
    ["Strategic fit", props.before.strategic_fit_score, props.after.strategic_fit_score, ""],
    ["Familiarity", props.before.strategic_familiarity, props.after.strategic_familiarity, ""],
    ["Memory burden", props.before.memorization_burden, props.after.memorization_burden, ""],
    ["Expected coverage", props.before.expected_opponent_coverage, props.after.expected_opponent_coverage, ""],
    ["Popularity", props.before.popularity, props.after.popularity, ""],
    ["Homogenization cost", props.before.homogenization_cost, props.after.homogenization_cost, ""],
    ["Training burden", props.before.training_cost, props.after.training_cost, ""],
  ] as const);
  return (
    <section aria-labelledby="replacement-impact-scores-title">
      <h5 id="replacement-impact-scores-title">Strategic and training impact</h5>
      <div class="replacement-impact-table-wrap">
        <table class="replacement-impact-table">
          <caption>Canonical before, after, and display deltas. Missing Phase 8 evidence remains unavailable.</caption>
          <thead><tr><th scope="col">Measure</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Delta</th></tr></thead>
          <tbody>
            <For each={rows()}>{(row) => (
              <tr data-impact-state={row[1] === null || row[2] === null ? "unavailable" : "available"}>
                <th scope="row">{row[0]}</th><td>{number(row[1], row[3])}</td><td>{number(row[2], row[3])}</td><td>{delta(row[1], row[2], row[3])}</td>
              </tr>
            )}</For>
          </tbody>
        </table>
      </div>
      <dl class="replacement-impact-theory">
        <div><dt>Theory nodes before</dt><dd>{number(props.after.theory_nodes_before)}</dd></div>
        <div><dt>Theory nodes after</dt><dd>{number(props.after.theory_nodes_after)}</dd></div>
        <div><dt>Theory added</dt><dd>{number(props.after.theory_nodes_added)}</dd></div>
        <div><dt>Theory removed</dt><dd>{number(props.after.theory_nodes_removed)}</dd></div>
      </dl>
    </section>
  );
}

function MetricRow(props: { metric: ReplacementMetricEffect }) {
  return (
    <tr data-impact-state={props.metric.state}>
      <th scope="row"><code>{props.metric.metric_id}</code><small>{props.metric.reason ?? "Canonical Phase 8 metric evidence."}</small></th>
      <td>{number(props.metric.before, ` ${props.metric.unit}`)}</td>
      <td>{number(props.metric.after, ` ${props.metric.unit}`)}</td>
      <td>{number(props.metric.delta, ` ${props.metric.unit}`)}</td>
    </tr>
  );
}

export default function BeforeAfterImpact(props: {
  preview: ReplacementChangeSetPreview;
  safety: ReplacementCandidateSafetySimulation;
  repertoireColor: "white" | "black";
}) {
  const beforeEval = () => evaluation(props.preview.objective_quality_before, props.repertoireColor);
  const afterEval = () => evaluation(props.preview.objective_quality_after, props.repertoireColor);
  const coverage = () => props.preview.coverage_effects;
  return (
    <section class="replacement-before-after" aria-labelledby="replacement-before-after-title">
      <header>
        <h4 id="replacement-before-after-title">Before/after impact</h4>
        <p>Values come from immutable Phase 8 change-set and safety evidence. No score, safety check, or frontier is recalculated by this view.</p>
      </header>

      <section aria-labelledby="replacement-tree-impact-title">
        <h5 id="replacement-tree-impact-title">Tree and affected descendants</h5>
        <div class="replacement-impact-table-wrap">
          <table class="replacement-impact-table">
            <caption>Exact canonical tree statistics</caption>
            <thead><tr><th scope="col">Measure</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Delta</th></tr></thead>
            <tbody><For each={treeRows(props.preview)}>{(row) => (
              <tr><th scope="row">{row[0]}</th><td>{row[1]}</td><td>{row[2]}</td><td>{row[2] - row[1]}</td></tr>
            )}</For></tbody>
          </table>
        </div>
        <ul class="replacement-change-paths" aria-label="Affected descendant paths">
          <For each={props.preview.affected_paths} fallback={<li data-evidence-state="empty">No affected descendant paths.</li>}>
            {(path) => <li><code>{path.join(" ") || "root"}</code></li>}
          </For>
        </ul>
      </section>

      <section aria-labelledby="replacement-evaluation-impact-title">
        <h5 id="replacement-evaluation-impact-title">Objective quality and POV</h5>
        <dl class="replacement-impact-evaluation">
          <div><dt>{beforeEval().owner} repertoire POV before</dt><dd>{beforeEval().repertoire}</dd></div>
          <div><dt>{afterEval().owner} repertoire POV after</dt><dd>{afterEval().repertoire}</dd></div>
          <div><dt>{afterEval().owner} repertoire POV cp delta</dt><dd>{delta(props.preview.objective_quality_before.repertoire_pov_evaluation_cp, props.preview.objective_quality_after.repertoire_pov_evaluation_cp, " cp")}</dd></div>
          <div><dt>White-POV engine transport before</dt><dd>{beforeEval().white}</dd></div>
          <div><dt>White-POV engine transport after</dt><dd>{afterEval().white}</dd></div>
          <div><dt>White-POV transport cp delta</dt><dd>{delta(props.preview.objective_quality_before.white_pov_evaluation_cp, props.preview.objective_quality_after.white_pov_evaluation_cp, " cp")}</dd></div>
          <div><dt>Canonical verdict after</dt><dd>{props.preview.objective_quality_after.repertoire_pov_verdict}</dd></div>
          <div><dt>Engine evidence state</dt><dd>{props.preview.objective_quality_after.state}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="replacement-coverage-impact-title">
        <h5 id="replacement-coverage-impact-title">Coverage and gaps</h5>
        <dl class="replacement-impact-evaluation">
          <div><dt>Weighted coverage before</dt><dd>{percent(coverage().popularity_weighted_before)}</dd></div>
          <div><dt>Weighted coverage after</dt><dd>{percent(coverage().popularity_weighted_after)}</dd></div>
          <div><dt>Coverage delta</dt><dd>{percent(coverage().popularity_weighted_delta)}</dd></div>
          <div><dt>Required replies before</dt><dd>{coverage().required_reply_count_before}</dd></div>
          <div><dt>Required replies after</dt><dd>{coverage().required_reply_count_after}</dd></div>
          <div><dt>Evidence state</dt><dd>{coverage().state}{coverage().reason ? `: ${coverage().reason}` : ""}</dd></div>
        </dl>
        <div class="replacement-impact-replies">
          <section>
            <h6>Newly covered replies</h6>
            <ul><For each={coverage().newly_covered_replies} fallback={<li data-evidence-state="empty">None.</li>}>{(reply) => (
              <li data-evidence-state={reply.state}><strong>{reply.san ?? "SAN unavailable"}</strong><code>{reply.position_id} · {reply.decision_id ?? "decision unavailable"}</code><span>{reply.forcing ? "Forcing reply" : "Non-forcing reply"} · {percent(reply.expected_frequency)}</span><small>{reply.source_san_paths.map((path) => path.join(" ")).join(" | ") || reply.reason}</small></li>
            )}</For></ul>
          </section>
          <section>
            <h6>New gaps / uncovered replies</h6>
            <ul><For each={coverage().newly_uncovered_replies} fallback={<li data-evidence-state="empty">None.</li>}>{(reply) => (
              <li data-evidence-state={reply.state}><strong>{reply.san ?? "SAN unavailable"}</strong><code>{reply.position_id} · {reply.decision_id ?? "decision unavailable"}</code><span>{reply.forcing ? "Forcing reply" : "Non-forcing reply"} · {percent(reply.expected_frequency)}</span><small>{reply.reason}</small></li>
            )}</For></ul>
          </section>
        </div>
      </section>

      <ScoreImpact before={props.preview.strategic_score_before} after={props.preview.strategic_score_after} />

      <section aria-labelledby="replacement-metric-impact-title">
        <h5 id="replacement-metric-impact-title">Affected Strategic Fit metrics</h5>
        <div class="replacement-impact-table-wrap">
          <table class="replacement-impact-table">
            <caption>Exact metric deltas, including partial and unavailable evidence</caption>
            <thead><tr><th scope="col">Metric</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Delta</th></tr></thead>
            <tbody><For each={coverage().affected_metrics} fallback={<tr data-impact-state="unavailable"><th scope="row">Metrics unavailable</th><td colSpan={3}>No canonical affected-metric evidence.</td></tr>}>
              {(metric) => <MetricRow metric={metric} />}
            </For></tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="replacement-safety-checks-title">
        <h5 id="replacement-safety-checks-title">Canonical safety checks</h5>
        <ul class="replacement-safety-checks">
          <For each={props.safety.safety_checks} fallback={<li data-check-status="unavailable">Safety checks unavailable.</li>}>
            {(check) => <li data-check-status={check.status}><strong>{check.kind}: {check.status}</strong><p>{check.explanation}</p><Show when={check.risk_ids.length}><code>{check.risk_ids.join(", ")}</code></Show></li>}
          </For>
        </ul>
      </section>
    </section>
  );
}
