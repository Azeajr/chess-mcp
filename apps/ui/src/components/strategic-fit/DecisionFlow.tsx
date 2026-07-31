import { For, Show, createMemo, createSignal } from "solid-js";
import {
  buildDecisionFlowProjection,
  type DecisionFlowCausalLabel,
  type DecisionFlowCohort,
  type DecisionFlowLink,
  type DecisionFlowNode,
  type DecisionFlowProjection,
  type RepertoireGraph,
  type StrategicFinding,
  type StrategicFitAnalysisResult,
} from "@chess-mcp/chess-tools";

export type DecisionFlowReport = Pick<
  StrategicFitAnalysisResult,
  "report_id" | "repertoire_revision" | "analysis_version" | "cohorts" | "findings"
>;

export const DECISION_FLOW_CAUSAL_LABELS_TEXT: Readonly<
  Record<DecisionFlowCausalLabel, string>
> = {
  "mostly-player-controlled": "You chose this",
  "mostly-opponent-forced": "The opponent forced this",
  "shared-or-uncertain": "Shared or uncertain",
  unknown: "Unknown",
  "not-referenced": "No causal claim",
};

/** Symbols carry actor and outcome without color, in the diagram and in the outline alike. */
export const DECISION_FLOW_SYMBOLS = {
  start: "◆",
  player: "▲",
  opponent: "○",
  mode: "■",
} as const;

const COLUMN_WIDTH = 62;
const NODE_WIDTH = 30;
const CHART_HEIGHT = 300;
const NODE_GAP = 6;
const MINIMUM_NODE_HEIGHT = 10;
const MINIMUM_LINK_THICKNESS = 1.5;
const MAXIMUM_LINK_THICKNESS = 34;

export interface DecisionFlowViewNode {
  readonly node: DecisionFlowNode;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly symbol: string;
  readonly actor_text: string;
  readonly move_text: string;
  readonly share_percent: number;
  readonly causality_text: string;
  readonly aria_label: string;
}

export interface DecisionFlowViewLink {
  readonly link: DecisionFlowLink;
  readonly path: string;
  readonly thickness: number;
  readonly share_percent: number;
  readonly aria_label: string;
}

export interface DecisionFlowCohortView {
  readonly cohort: DecisionFlowCohort;
  readonly name: string;
  readonly nodes: readonly DecisionFlowViewNode[];
  readonly links: readonly DecisionFlowViewLink[];
  readonly chart_width: number;
  readonly chart_height: number;
  readonly screen_reader_summary: string;
}

export interface DecisionFlowViewModel {
  readonly projection: DecisionFlowProjection;
  readonly cohorts: readonly DecisionFlowCohortView[];
  readonly screen_reader_summary: string;
}

function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function shortId(value: string): string {
  const separator = value.indexOf(":");
  const tail = separator === -1 ? value : value.slice(separator + 1);
  return tail.slice(0, 8);
}

function actorText(node: DecisionFlowNode): string {
  if (node.kind === "start") return "Start";
  if (node.kind === "mode") return "Strategic outcome";
  return node.actor === "player" ? "You play" : "Opponent plays";
}

function symbolFor(node: DecisionFlowNode): string {
  if (node.kind === "start") return DECISION_FLOW_SYMBOLS.start;
  if (node.kind === "mode") return DECISION_FLOW_SYMBOLS.mode;
  return node.actor === "player" ? DECISION_FLOW_SYMBOLS.player : DECISION_FLOW_SYMBOLS.opponent;
}

function moveText(node: DecisionFlowNode): string {
  if (node.kind === "start") return "Start";
  if (node.kind === "mode") {
    return node.mode_id === null ? "No shared mode" : `Mode ${shortId(node.mode_id)}`;
  }
  return node.san ?? shortId(node.decision_id ?? "");
}

/** Causal text always states the qualification, so a claim never reads more certain than it is. */
export function decisionFlowCausalityText(node: DecisionFlowNode): string {
  const label = DECISION_FLOW_CAUSAL_LABELS_TEXT[node.causality.label];
  if (node.causality.label === "not-referenced") return label;
  const control = node.causality.controllability === null
    ? "no controllability value"
    : `controllability ${Math.round(node.causality.controllability * 100)}%`;
  return node.causality.qualified
    ? `${label} — qualified (${control})`
    : `${label} (${control})`;
}

function layoutCohort(
  cohort: DecisionFlowCohort,
  nodes: readonly DecisionFlowNode[],
  links: readonly DecisionFlowLink[],
  name: string,
): DecisionFlowCohortView {
  const total = cohort.total_weight;
  const byDepth = new Map<number, DecisionFlowNode[]>();
  for (const node of nodes) {
    const column = byDepth.get(node.depth) ?? [];
    column.push(node);
    byDepth.set(node.depth, column);
  }
  const placed = new Map<string, DecisionFlowViewNode>();
  for (const [depth, column] of [...byDepth.entries()].sort((left, right) => left[0] - right[0])) {
    const gaps = NODE_GAP * Math.max(column.length - 1, 0);
    const available = Math.max(CHART_HEIGHT - gaps, column.length * MINIMUM_NODE_HEIGHT);
    let offset = 0;
    for (const node of column) {
      const share = total > 0 ? node.weight / total : 1 / Math.max(column.length, 1);
      const height = Math.max(MINIMUM_NODE_HEIGHT, share * available);
      placed.set(node.node_id, {
        node,
        x: depth * COLUMN_WIDTH + (COLUMN_WIDTH - NODE_WIDTH) / 2,
        y: offset,
        width: NODE_WIDTH,
        height,
        symbol: symbolFor(node),
        actor_text: actorText(node),
        move_text: moveText(node),
        share_percent: percent(node.weight, total),
        causality_text: decisionFlowCausalityText(node),
        aria_label: `${actorText(node)} ${moveText(node)}. ${percent(node.weight, total)}% of this cohort's expected games.` +
          `${node.branching ? " Splits into several replies." : ""}` +
          `${node.transposition === null ? "" : " Reached by a transposition."}` +
          `${node.kind === "decision" ? ` ${decisionFlowCausalityText(node)}.` : ""}` +
          `${node.finding_ids.length === 0 ? " No findings." : ` ${node.finding_ids.length} ${node.finding_ids.length === 1 ? "finding" : "findings"}.`}`,
      });
      offset += height + NODE_GAP;
    }
  }

  const viewLinks: DecisionFlowViewLink[] = links.flatMap((link) => {
    const from = placed.get(link.from_node_id);
    const to = placed.get(link.to_node_id);
    if (from === undefined || to === undefined) return [];
    const share = total > 0 ? link.weight / total : 0;
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    const control = (x2 - x1) / 2;
    return [{
      link,
      path: `M ${x1} ${y1} C ${x1 + control} ${y1}, ${x2 - control} ${y2}, ${x2} ${y2}`,
      thickness: Math.max(MINIMUM_LINK_THICKNESS, share * MAXIMUM_LINK_THICKNESS),
      share_percent: percent(link.weight, total),
      aria_label: `${from.move_text} to ${to.move_text}: ${percent(link.weight, total)}% of expected games.` +
        `${link.truncated ? " Some moves are omitted at the depth limit." : ""}`,
    }];
  });

  const outcomes = nodes.filter((node) => node.kind === "mode");
  return {
    cohort,
    name,
    nodes: [...placed.values()].sort((left, right) =>
      left.node.depth - right.node.depth ||
      (left.node.node_id < right.node.node_id ? -1 : left.node.node_id > right.node.node_id ? 1 : 0)
    ),
    links: viewLinks,
    chart_width: (cohort.max_depth + 1) * COLUMN_WIDTH,
    chart_height: CHART_HEIGHT,
    screen_reader_summary:
      `Decision flow for ${name}: ${nodes.filter((node) => node.kind === "decision").length} decisions,` +
      ` ${cohort.branch_point_count} branch ${cohort.branch_point_count === 1 ? "point" : "points"},` +
      ` and ${outcomes.length} strategic ${outcomes.length === 1 ? "outcome" : "outcomes"}` +
      ` covering ${cohort.route_count} ${cohort.route_count === 1 ? "branch" : "branches"}.`,
  };
}

export function buildDecisionFlowViewModel(
  report: DecisionFlowReport,
  options: {
    readonly graph?: RepertoireGraph | null;
    readonly graphRevision?: string | null;
    readonly cohortName?: (cohortId: string) => string;
    readonly findings?: readonly StrategicFinding[];
    readonly maxDepth?: number;
  } = {},
): DecisionFlowViewModel {
  const projection = buildDecisionFlowProjection(report, {
    graph: options.graph ?? null,
    graph_revision: options.graphRevision ?? null,
    findings: options.findings,
    max_depth: options.maxDepth,
  });
  const cohortName = options.cohortName ?? ((cohortId: string) => cohortId);
  const cohorts = projection.cohorts.map((cohort) =>
    layoutCohort(
      cohort,
      projection.nodes.filter((node) => node.cohort_id === cohort.cohort_id),
      projection.links.filter((link) => link.cohort_id === cohort.cohort_id),
      cohortName(cohort.cohort_id),
    )
  );
  const qualified = projection.nodes.filter((node) => node.causality.qualified).length;
  return {
    projection,
    cohorts,
    screen_reader_summary: projection.state === "unavailable"
      ? `Decision flow unavailable. ${projection.reason ?? ""}`.trim()
      : `Decision flow across ${cohorts.length} ${cohorts.length === 1 ? "cohort" : "cohorts"}.` +
        ` ${qualified} ${qualified === 1 ? "decision has" : "decisions have"} qualified causal evidence.` +
        ` ${projection.exclusions.length} ${projection.exclusions.length === 1 ? "branch is" : "branches are"} excluded.`,
  };
}

/** The heaviest cohort first; the flow never silently mixes cohort-normalized shares. */
export function defaultDecisionFlowCohortId(model: DecisionFlowViewModel): string | null {
  const sorted = [...model.cohorts].sort((left, right) =>
    right.cohort.total_weight - left.cohort.total_weight ||
    right.cohort.route_count - left.cohort.route_count ||
    (left.cohort.cohort_id < right.cohort.cohort_id ? -1 : 1)
  );
  return sorted[0]?.cohort.cohort_id ?? null;
}

export default function DecisionFlow(props: {
  report: DecisionFlowReport;
  graph: RepertoireGraph | null;
  graphRevision: string | null;
  cohortName: (cohortId: string) => string;
  completeFindings?: readonly StrategicFinding[];
  onOpenFinding: (findingId: string) => void;
}) {
  const [cohortChoice, setCohortChoice] = createSignal<string | null>(null);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  const model = createMemo(() => buildDecisionFlowViewModel(props.report, {
    graph: props.graph,
    graphRevision: props.graphRevision,
    cohortName: props.cohortName,
    findings: props.completeFindings,
  }));
  const activeCohort = createMemo(() => {
    const chosen = cohortChoice();
    const fallback = defaultDecisionFlowCohortId(model());
    return model().cohorts.find((view) => view.cohort.cohort_id === chosen) ??
      model().cohorts.find((view) => view.cohort.cohort_id === fallback) ??
      null;
  });
  const selectedNode = createMemo(() => {
    const id = selectedId();
    const cohort = activeCohort();
    if (id === null || cohort === null) return null;
    return cohort.nodes.find((view) => view.node.node_id === id) ?? null;
  });
  const selectedLink = createMemo(() => {
    const id = selectedId();
    const cohort = activeCohort();
    if (id === null || cohort === null || selectedNode() !== null) return null;
    return cohort.links.find((view) => view.link.link_id === id) ?? null;
  });
  const selectionFindings = createMemo(() =>
    selectedNode()?.node.finding_ids ?? selectedLink()?.link.finding_ids ?? []
  );
  const select = (id: string) => {
    setSelectedId((current) => current === id ? null : id);
  };

  return (
    <section
      class="decision-flow"
      aria-label="Decision flow"
      data-flow-state={model().projection.state}
      data-flow-projection-version={model().projection.projection_version}
      data-flow-report={model().projection.report_id}
      data-flow-cohort-count={model().cohorts.length}
      data-flow-node-count={model().projection.nodes.length}
    >
      <h3 class="decision-flow-title">Decision flow</h3>
      <p class="sr-only" data-flow-screen-reader-summary>{model().screen_reader_summary}</p>

      <Show
        when={model().projection.state !== "unavailable" && activeCohort()}
        fallback={(
          <div class="decision-flow-unavailable" data-flow-unavailable>
            <strong>Decision flow unavailable</strong>
            <p>{model().projection.reason}</p>
            <Show when={model().projection.exclusions.length > 0}>
              <details>
                <summary>Why branches are excluded ({model().projection.exclusions.length})</summary>
                <ul>
                  <For each={model().projection.exclusions}>{(exclusion) => (
                    <li data-flow-exclusion={exclusion.route_id}>
                      <code>{shortId(exclusion.route_id)}</code> — {exclusion.explanation}
                    </li>
                  )}</For>
                </ul>
              </details>
            </Show>
          </div>
        )}
      >
        {(cohort) => (
          <>
            <div class="decision-flow-controls">
              <label>
                Cohort
                <select
                  value={cohort().cohort.cohort_id}
                  onChange={(event) => {
                    setCohortChoice(event.currentTarget.value);
                    setSelectedId(null);
                  }}
                  data-flow-cohort-select
                >
                  <For each={model().cohorts}>{(view) => (
                    <option value={view.cohort.cohort_id}>
                      {view.name} ({view.cohort.route_count})
                    </option>
                  )}</For>
                </select>
              </label>
              <p class="decision-flow-legend" data-flow-legend>
                Shares are of this cohort's expected games and always add up at every step.
                {" "}{DECISION_FLOW_SYMBOLS.start} start,
                {" "}{DECISION_FLOW_SYMBOLS.player} you play,
                {" "}{DECISION_FLOW_SYMBOLS.opponent} opponent plays,
                {" "}{DECISION_FLOW_SYMBOLS.mode} strategic outcome. Cohorts are shown one at a time
                because route weights are normalized inside a cohort.
              </p>
            </div>

            <p class="sr-only" data-flow-cohort-summary>{cohort().screen_reader_summary}</p>

            <div class="decision-flow-scroll" tabindex="0" role="group" aria-label="Decision flow diagram">
              <svg
                class="decision-flow-chart"
                viewBox={`0 0 ${cohort().chart_width} ${cohort().chart_height}`}
                width={cohort().chart_width}
                height={cohort().chart_height}
                role="group"
                aria-label={`Decision flow for ${cohort().name}. ${cohort().nodes.length} steps.`}
                data-flow-chart
              >
                <For each={cohort().links}>{(view) => (
                  <path
                    class="decision-flow-link"
                    classList={{
                      "decision-flow-link-truncated": view.link.truncated,
                      "decision-flow-link-selected": selectedId() === view.link.link_id,
                    }}
                    d={view.path}
                    stroke-width={view.thickness}
                    tabindex="0"
                    role="button"
                    aria-label={view.aria_label}
                    aria-pressed={selectedId() === view.link.link_id}
                    data-flow-link={view.link.link_id}
                    data-flow-link-truncated={view.link.truncated ? "true" : "false"}
                    onClick={() => select(view.link.link_id)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      select(view.link.link_id);
                    }}
                  >
                    <title>{view.aria_label}</title>
                  </path>
                )}</For>
                <For each={cohort().nodes}>{(view) => (
                  <g
                    class="decision-flow-node"
                    classList={{ "decision-flow-node-selected": selectedId() === view.node.node_id }}
                    tabindex="0"
                    role="button"
                    aria-label={view.aria_label}
                    aria-pressed={selectedId() === view.node.node_id}
                    data-flow-node={view.node.node_id}
                    data-flow-node-kind={view.node.kind}
                    data-flow-actor={view.node.actor}
                    data-flow-branching={view.node.branching ? "true" : "false"}
                    data-flow-transposition={view.node.transposition === null ? "false" : "true"}
                    data-flow-causality={view.node.causality.label}
                    data-flow-qualified={view.node.causality.qualified ? "true" : "false"}
                    onClick={() => select(view.node.node_id)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      select(view.node.node_id);
                    }}
                  >
                    <rect x={view.x} y={view.y} width={view.width} height={view.height} rx="2" />
                    <text x={view.x + view.width / 2} y={view.y + view.height / 2} class="decision-flow-node-text">
                      {view.symbol} {view.move_text}
                    </text>
                    <title>{view.aria_label}</title>
                  </g>
                )}</For>
              </svg>
            </div>

            <Show when={selectedNode() !== null || selectedLink() !== null}>
              <div class="decision-flow-detail" data-flow-detail={selectedId()}>
                  <Show when={selectedLink()}>
                    {(view) => (
                      <>
                        <h4>Flow step</h4>
                        <dl>
                          <div>
                            <dt>Share of expected games</dt>
                            <dd data-flow-detail-share>{view().share_percent}%</dd>
                          </div>
                          <div>
                            <dt>Branches</dt>
                            <dd>{view().link.route_ids.length}</dd>
                          </div>
                          <Show when={view().link.truncated}>
                            <div>
                              <dt>Depth limit</dt>
                              <dd data-flow-detail-truncated>
                                Some moves on this step are omitted; the weight still reaches its outcome.
                              </dd>
                            </div>
                          </Show>
                        </dl>
                      </>
                    )}
                  </Show>
                  <Show when={selectedNode()}>
                    {(view) => (
                      <>
                        <h4>{view().actor_text} {view().move_text}</h4>
                        <dl>
                          <div>
                            <dt>Share of expected games</dt>
                            <dd data-flow-detail-share>{view().share_percent}%</dd>
                          </div>
                          <div>
                            <dt>Side</dt>
                            <dd data-flow-detail-actor>{view().symbol} {view().actor_text}</dd>
                          </div>
                          <Show when={view().node.kind === "decision"}>
                            <div>
                              <dt>Causal ownership</dt>
                              <dd data-flow-detail-causality={view().node.causality.label}>
                                {view().causality_text}
                                <Show when={view().node.causality.qualified}>
                                  <span class="decision-flow-qualified" data-flow-detail-qualified>
                                    Qualified
                                  </span>
                                </Show>
                                <Show when={view().node.causality.reason}>
                                  <span class="decision-flow-reason">{view().node.causality.reason}</span>
                                </Show>
                              </dd>
                            </div>
                          </Show>
                          <Show when={view().node.transposition}>
                            {(transposition) => (
                              <div>
                                <dt>Transposition</dt>
                                <dd data-flow-detail-transposition={transposition().position_id}>
                                  Reached from {transposition().incoming_node_ids.length} earlier steps.
                                </dd>
                              </div>
                            )}
                          </Show>
                          <Show when={view().node.reason}>
                            <div>
                              <dt>Outcome</dt>
                              <dd data-flow-detail-reason>{view().node.reason}</dd>
                            </div>
                          </Show>
                          <div>
                            <dt>Supporting branches</dt>
                            <dd>
                              <For each={view().node.route_ids}>{(routeId) => (
                                <code data-flow-detail-route={routeId}>{shortId(routeId)}</code>
                              )}</For>
                            </dd>
                          </div>
                        </dl>
                      </>
                    )}
                  </Show>
                  <Show
                    when={selectionFindings().length > 0}
                    fallback={<p data-flow-detail-no-findings>No findings reference these branches.</p>}
                  >
                    <div class="decision-flow-detail-findings">
                      <For each={selectionFindings()}>{(findingId) => (
                        <button
                          type="button"
                          onClick={() => props.onOpenFinding(findingId)}
                          data-flow-open-finding={findingId}
                        >
                          Open finding {findingId.slice(-8)}
                        </button>
                      )}</For>
                    </div>
                  </Show>
              </div>
            </Show>

            <details class="decision-flow-outline" open>
              <summary>Flow outline ({cohort().nodes.length})</summary>
              <table data-flow-outline>
                <thead>
                  <tr>
                    <th scope="col">Step</th>
                    <th scope="col">Side</th>
                    <th scope="col">Move</th>
                    <th scope="col">Share</th>
                    <th scope="col">Leads to</th>
                    <th scope="col">Causal ownership</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={cohort().nodes}>{(view) => (
                    <tr
                      data-flow-outline-row={view.node.node_id}
                      data-selected={selectedId() === view.node.node_id ? "true" : "false"}
                    >
                      <td>{view.node.depth}</td>
                      <td data-flow-outline-actor={view.node.actor}>
                        {view.symbol} {view.actor_text}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => select(view.node.node_id)}
                          aria-pressed={selectedId() === view.node.node_id}
                        >
                          {view.move_text}
                        </button>
                        <Show when={view.node.transposition}>
                          <span class="decision-flow-outline-tag" data-flow-outline-transposition>
                            transposition
                          </span>
                        </Show>
                      </td>
                      <td>{view.share_percent}%</td>
                      <td>
                        <For each={cohort().links.filter((link) =>
                          link.link.from_node_id === view.node.node_id
                        )}>{(link) => (
                          <span class="decision-flow-outline-next" data-flow-outline-next={link.link.link_id}>
                            {cohort().nodes.find((candidate) =>
                              candidate.node.node_id === link.link.to_node_id
                            )?.move_text} ({link.share_percent}%)
                          </span>
                        )}</For>
                      </td>
                      <td data-flow-outline-causality={view.node.causality.label}>
                        {view.node.kind === "decision" ? view.causality_text : "—"}
                      </td>
                    </tr>
                  )}</For>
                </tbody>
              </table>
            </details>

            <Show when={model().projection.truncations.length > 0}>
              <details class="decision-flow-truncations">
                <summary>Branches beyond the flow depth ({model().projection.truncations.length})</summary>
                <ul>
                  <For each={model().projection.truncations}>{(truncation) => (
                    <li data-flow-truncation={truncation.route_id}>
                      <code>{shortId(truncation.route_id)}</code> — {truncation.explanation}
                    </li>
                  )}</For>
                </ul>
              </details>
            </Show>

            <Show when={model().projection.exclusions.length > 0}>
              <details class="decision-flow-exclusions">
                <summary>Branches without a flow ({model().projection.exclusions.length})</summary>
                <ul>
                  <For each={model().projection.exclusions}>{(exclusion) => (
                    <li data-flow-exclusion={exclusion.route_id}>
                      <code>{shortId(exclusion.route_id)}</code> — {exclusion.explanation}
                    </li>
                  )}</For>
                </ul>
              </details>
            </Show>
          </>
        )}
      </Show>
    </section>
  );
}
