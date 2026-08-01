import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
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
import { strategicFitPrintExportMode } from "../../store/ui";
import {
  VISUALIZATION_RENDER_LIMITS,
  boundedWindow,
  decisionFlowScale,
  mergeDecisionFlowLinks,
  splitDecisionFlowColumn,
} from "./visualization-limits";
import { VIRTUAL_TABLE_ROW_HEIGHT, createVirtualRows } from "./virtual-rows";

export type DecisionFlowReport = Pick<
  StrategicFitAnalysisResult,
  "report_id" | "repertoire_revision" | "analysis_version" | "cohorts" | "findings"
>;

export const DECISION_FLOW_CAUSAL_LABELS_TEXT: Readonly<Record<DecisionFlowCausalLabel, string>> = {
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

/**
 * Task 10.4 — one drawn marker standing in for the lightest steps of a crowded depth column. Its
 * weight is the exact sum of its members, so shares still add up at every step after aggregation.
 */
export interface DecisionFlowViewAggregate {
  readonly aggregate_id: string;
  readonly depth: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly weight: number;
  readonly share_percent: number;
  readonly member_node_ids: readonly string[];
  readonly finding_ids: readonly string[];
  readonly aria_label: string;
}

/** A link after aggregate re-pointing and duplicate merging; only these are drawn. */
export interface DecisionFlowRenderedLink {
  readonly link_id: string;
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly weight: number;
  readonly route_ids: readonly string[];
  readonly finding_ids: readonly string[];
  readonly truncated: boolean;
  readonly merged_link_ids: readonly string[];
  readonly path: string;
  readonly thickness: number;
  readonly share_percent: number;
  readonly aria_label: string;
}

export interface DecisionFlowCohortView {
  readonly cohort: DecisionFlowCohort;
  readonly name: string;
  /** Every step, in outline order; the accessible table below the chart never aggregates. */
  readonly nodes: readonly DecisionFlowViewNode[];
  readonly links: readonly DecisionFlowViewLink[];
  /** The subset of `nodes` drawn individually in the diagram. */
  readonly rendered_nodes: readonly DecisionFlowViewNode[];
  readonly aggregates: readonly DecisionFlowViewAggregate[];
  readonly rendered_links: readonly DecisionFlowRenderedLink[];
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
  const control =
    node.causality.controllability === null
      ? "no controllability value"
      : `controllability ${Math.round(node.causality.controllability * 100)}%`;
  return node.causality.qualified ? `${label} — qualified (${control})` : `${label} (${control})`;
}

interface FlowGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly move_text: string;
}

function layoutCohort(
  cohort: DecisionFlowCohort,
  nodes: readonly DecisionFlowNode[],
  links: readonly DecisionFlowLink[],
  name: string,
  nodesPerColumn: number = VISUALIZATION_RENDER_LIMITS.flow_nodes_per_column,
): DecisionFlowCohortView {
  const total = cohort.total_weight;
  const byDepth = new Map<number, DecisionFlowNode[]>();
  for (const node of nodes) {
    const column = byDepth.get(node.depth) ?? [];
    column.push(node);
    byDepth.set(node.depth, column);
  }

  const geometry = new Map<string, FlowGeometry>();
  const placed = new Map<string, DecisionFlowViewNode>();
  const renderedIds = new Set<string>();
  const aggregateIdByNodeId = new Map<string, string>();
  const aggregates: DecisionFlowViewAggregate[] = [];
  const columnDepths = [...byDepth.entries()].sort((left, right) => left[0] - right[0]);

  for (const [depth, column] of columnDepths) {
    /** A crowded column keeps its heaviest steps drawn and folds the rest into one marker. */
    const split = splitDecisionFlowColumn(
      column,
      nodesPerColumn,
      (node) => node.weight,
      (node) => node.node_id,
    );
    for (const node of split.rendered) renderedIds.add(node.node_id);
    const aggregateId =
      split.aggregated.length > 0 ? `aggregate:${cohort.cohort_id}:${depth}` : null;
    const aggregateWeight = split.aggregated.reduce((sum, node) => sum + node.weight, 0);
    const slotCount = split.rendered.length + (aggregateId === null ? 0 : 1);
    const gaps = NODE_GAP * Math.max(slotCount - 1, 0);
    const available = Math.max(CHART_HEIGHT - gaps, slotCount * MINIMUM_NODE_HEIGHT);
    const x = depth * COLUMN_WIDTH + (COLUMN_WIDTH - NODE_WIDTH) / 2;
    let offset = 0;
    for (const node of split.rendered) {
      const share = total > 0 ? node.weight / total : 1 / Math.max(slotCount, 1);
      const height = Math.max(MINIMUM_NODE_HEIGHT, share * available);
      geometry.set(node.node_id, {
        x,
        y: offset,
        width: NODE_WIDTH,
        height,
        move_text: moveText(node),
      });
      offset += height + NODE_GAP;
    }
    if (aggregateId !== null) {
      const share = total > 0 ? aggregateWeight / total : 1 / Math.max(slotCount, 1);
      const height = Math.max(MINIMUM_NODE_HEIGHT, share * available);
      const label =
        `${split.aggregated.length} lighter steps grouped together.` +
        ` ${percent(aggregateWeight, total)}% of this cohort's expected games combined.` +
        ` Select to list them; the flow outline below lists every step separately.`;
      geometry.set(aggregateId, {
        x,
        y: offset,
        width: NODE_WIDTH,
        height,
        move_text: `${split.aggregated.length} more`,
      });
      aggregates.push({
        aggregate_id: aggregateId,
        depth,
        x,
        y: offset,
        width: NODE_WIDTH,
        height,
        weight: aggregateWeight,
        share_percent: percent(aggregateWeight, total),
        member_node_ids: split.aggregated.map((node) => node.node_id),
        finding_ids: [...new Set(split.aggregated.flatMap((node) => node.finding_ids))],
        aria_label: label,
      });
      for (const node of split.aggregated) aggregateIdByNodeId.set(node.node_id, aggregateId);
    }
    /** Aggregated steps keep the marker's geometry: that is where the diagram actually shows them. */
    for (const node of column) {
      const own =
        geometry.get(node.node_id) ?? geometry.get(aggregateIdByNodeId.get(node.node_id) ?? "");
      if (!own) continue;
      placed.set(node.node_id, {
        node,
        x: own.x,
        y: own.y,
        width: own.width,
        height: own.height,
        symbol: symbolFor(node),
        actor_text: actorText(node),
        move_text: moveText(node),
        share_percent: percent(node.weight, total),
        causality_text: decisionFlowCausalityText(node),
        aria_label:
          `${actorText(node)} ${moveText(node)}. ${percent(node.weight, total)}% of this cohort's expected games.` +
          (node.branching ? " Splits into several replies." : "") +
          (node.transposition === null ? "" : " Reached by a transposition.") +
          (node.kind === "decision" ? ` ${decisionFlowCausalityText(node)}.` : "") +
          (node.finding_ids.length === 0
            ? " No findings."
            : ` ${node.finding_ids.length} ${node.finding_ids.length === 1 ? "finding" : "findings"}.`),
      });
    }
  }

  const curve = (from: FlowGeometry, to: FlowGeometry): string => {
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    const control = (x2 - x1) / 2;
    return `M ${x1} ${y1} C ${x1 + control} ${y1}, ${x2 - control} ${y2}, ${x2} ${y2}`;
  };

  const viewLinks: DecisionFlowViewLink[] = links.flatMap((link) => {
    const from = placed.get(link.from_node_id);
    const to = placed.get(link.to_node_id);
    if (from === undefined || to === undefined) return [];
    const share = total > 0 ? link.weight / total : 0;
    return [
      {
        link,
        path: curve(from, to),
        thickness: Math.max(MINIMUM_LINK_THICKNESS, share * MAXIMUM_LINK_THICKNESS),
        share_percent: percent(link.weight, total),
        aria_label:
          `${from.move_text} to ${to.move_text}: ${percent(link.weight, total)}% of expected games.` +
          (link.truncated ? " Some moves are omitted at the depth limit." : ""),
      },
    ];
  });

  const renderedLinks: DecisionFlowRenderedLink[] = mergeDecisionFlowLinks(
    links,
    aggregateIdByNodeId,
  ).flatMap((link) => {
    const from = geometry.get(link.from_node_id);
    const to = geometry.get(link.to_node_id);
    if (from === undefined || to === undefined) return [];
    const share = total > 0 ? link.weight / total : 0;
    return [
      {
        ...link,
        path: curve(from, to),
        thickness: Math.max(MINIMUM_LINK_THICKNESS, share * MAXIMUM_LINK_THICKNESS),
        share_percent: percent(link.weight, total),
        aria_label:
          `${from.move_text} to ${to.move_text}: ${percent(link.weight, total)}% of expected games.` +
          (link.merged_link_ids.length > 1
            ? ` Combines ${link.merged_link_ids.length} steps.`
            : "") +
          (link.truncated ? " Some moves are omitted at the depth limit." : ""),
      },
    ];
  });

  const outcomes = nodes.filter((node) => node.kind === "mode");
  const orderedNodes = [...placed.values()].sort(
    (left, right) =>
      left.node.depth - right.node.depth ||
      (left.node.node_id < right.node.node_id
        ? -1
        : left.node.node_id > right.node.node_id
          ? 1
          : 0),
  );
  const aggregatedCount = aggregates.reduce((sum, item) => sum + item.member_node_ids.length, 0);
  return {
    cohort,
    name,
    nodes: orderedNodes,
    links: viewLinks,
    rendered_nodes: orderedNodes.filter((view) => renderedIds.has(view.node.node_id)),
    aggregates,
    rendered_links: renderedLinks,
    chart_width: (cohort.max_depth + 1) * COLUMN_WIDTH,
    chart_height: CHART_HEIGHT,
    screen_reader_summary:
      `Decision flow for ${name}: ${nodes.filter((node) => node.kind === "decision").length} decisions,` +
      ` ${cohort.branch_point_count} branch ${cohort.branch_point_count === 1 ? "point" : "points"},` +
      ` and ${outcomes.length} strategic ${outcomes.length === 1 ? "outcome" : "outcomes"}` +
      ` covering ${cohort.route_count} ${cohort.route_count === 1 ? "branch" : "branches"}.` +
      (aggregatedCount === 0
        ? ""
        : ` ${aggregatedCount} lighter steps are grouped into ${aggregates.length}` +
          ` ${aggregates.length === 1 ? "marker" : "markers"} in the diagram and listed separately in the outline.`),
  };
}

/**
 * Only the selected cohort is ever drawn, so its geometry is computed on first access. A report
 * with hundreds of cohorts would otherwise lay out every diagram it will never show.
 */
function createDecisionFlowCohortView(
  cohort: DecisionFlowCohort,
  nodes: readonly DecisionFlowNode[],
  links: readonly DecisionFlowLink[],
  name: string,
  nodesPerColumn: number,
): DecisionFlowCohortView {
  let computed: DecisionFlowCohortView | null = null;
  const layout = () => (computed ??= layoutCohort(cohort, nodes, links, name, nodesPerColumn));
  return {
    cohort,
    name,
    chart_width: (cohort.max_depth + 1) * COLUMN_WIDTH,
    chart_height: CHART_HEIGHT,
    get nodes() {
      return layout().nodes;
    },
    get links() {
      return layout().links;
    },
    get rendered_nodes() {
      return layout().rendered_nodes;
    },
    get aggregates() {
      return layout().aggregates;
    },
    get rendered_links() {
      return layout().rendered_links;
    },
    get screen_reader_summary() {
      return layout().screen_reader_summary;
    },
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
    /** Drawn steps per depth column before the lightest ones fold into one marker (Task 10.4). */
    readonly nodesPerColumn?: number;
  } = {},
): DecisionFlowViewModel {
  const projection = buildDecisionFlowProjection(report, {
    graph: options.graph ?? null,
    graph_revision: options.graphRevision ?? null,
    findings: options.findings,
    max_depth: options.maxDepth,
  });
  const cohortName = options.cohortName ?? ((cohortId: string) => cohortId);
  /**
   * Bucket once instead of scanning the projection per cohort: a report with hundreds of cohorts
   * otherwise pays a quadratic scan before anything is drawn.
   */
  const nodesByCohort = new Map<string, DecisionFlowNode[]>();
  for (const node of projection.nodes) {
    const bucket = nodesByCohort.get(node.cohort_id);
    if (bucket === undefined) nodesByCohort.set(node.cohort_id, [node]);
    else bucket.push(node);
  }
  const linksByCohort = new Map<string, DecisionFlowLink[]>();
  for (const link of projection.links) {
    const bucket = linksByCohort.get(link.cohort_id);
    if (bucket === undefined) linksByCohort.set(link.cohort_id, [link]);
    else bucket.push(link);
  }
  const cohorts = projection.cohorts.map((cohort) =>
    createDecisionFlowCohortView(
      cohort,
      nodesByCohort.get(cohort.cohort_id) ?? [],
      linksByCohort.get(cohort.cohort_id) ?? [],
      cohortName(cohort.cohort_id),
      options.nodesPerColumn ?? VISUALIZATION_RENDER_LIMITS.flow_nodes_per_column,
    ),
  );
  const qualified = projection.nodes.filter((node) => node.causality.qualified).length;
  return {
    projection,
    cohorts,
    screen_reader_summary:
      projection.state === "unavailable"
        ? `Decision flow unavailable. ${projection.reason ?? ""}`.trim()
        : `Decision flow across ${cohorts.length} ${cohorts.length === 1 ? "cohort" : "cohorts"}.` +
          ` ${qualified} ${qualified === 1 ? "decision has" : "decisions have"} qualified causal evidence.` +
          ` ${projection.exclusions.length} ${projection.exclusions.length === 1 ? "branch is" : "branches are"} excluded.`,
  };
}

/** The heaviest cohort first; the flow never silently mixes cohort-normalized shares. */
export function defaultDecisionFlowCohortId(model: DecisionFlowViewModel): string | null {
  const sorted = [...model.cohorts].sort(
    (left, right) =>
      right.cohort.total_weight - left.cohort.total_weight ||
      right.cohort.route_count - left.cohort.route_count ||
      (left.cohort.cohort_id < right.cohort.cohort_id ? -1 : 1),
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
  const [selectedAggregateId, setSelectedAggregateId] = createSignal<string | null>(null);
  const [outlineExpanded, setOutlineExpanded] = createSignal(false);
  const [outlineOpen, setOutlineOpen] = createSignal(true);
  const [containerWidth, setContainerWidth] = createSignal<number | null>(null);
  let scrollRef: HTMLDivElement | undefined;

  /** Resize behavior: a wide flow shrinks to the measured container, then scrolls at the floor. */
  onMount(() => {
    if (scrollRef === undefined || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(width > 0 ? width : null);
    });
    observer.observe(scrollRef);
    onCleanup(() => {
      observer.disconnect();
    });
  });

  const model = createMemo(() =>
    buildDecisionFlowViewModel(props.report, {
      graph: props.graph,
      graphRevision: props.graphRevision,
      cohortName: props.cohortName,
      findings: props.completeFindings,
    }),
  );
  const activeCohort = createMemo(() => {
    const chosen = cohortChoice();
    const fallback = defaultDecisionFlowCohortId(model());
    return (
      model().cohorts.find((view) => view.cohort.cohort_id === chosen) ??
      model().cohorts.find((view) => view.cohort.cohort_id === fallback) ??
      null
    );
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
    return cohort.rendered_links.find((view) => view.link_id === id) ?? null;
  });
  const selectedAggregate = createMemo(() => {
    const id = selectedAggregateId();
    const cohort = activeCohort();
    if (id === null || cohort === null) return null;
    return cohort.aggregates.find((view) => view.aggregate_id === id) ?? null;
  });
  const aggregateMembers = createMemo(() => {
    const aggregate = selectedAggregate();
    const cohort = activeCohort();
    if (aggregate === null || cohort === null) return [];
    const ids = new Set(aggregate.member_node_ids);
    return cohort.nodes.filter((view) => ids.has(view.node.node_id));
  });
  const selectionFindings = createMemo(
    () => selectedNode()?.node.finding_ids ?? selectedLink()?.finding_ids ?? [],
  );
  const outlineWindow = createMemo(() =>
    boundedWindow(
      activeCohort()?.nodes ?? [],
      VISUALIZATION_RENDER_LIMITS.flow_rows,
      outlineExpanded() || strategicFitPrintExportMode(),
    ),
  );
  /** Task 12.3 — the outline mounts its Task 10.4 window through a bounded scrolling viewport. */
  const outlineRows = createVirtualRows({
    items: () => outlineWindow().items,
    rowSize: VIRTUAL_TABLE_ROW_HEIGHT,
    enabled: () => !strategicFitPrintExportMode(),
  });
  const chartScale = createMemo(() =>
    decisionFlowScale(containerWidth(), activeCohort()?.chart_width ?? 0),
  );
  /** Outgoing links per step, so a windowed outline stays linear instead of scanning every link. */
  const outgoingByNode = createMemo(() => {
    const cohort = activeCohort();
    const index = new Map<string, DecisionFlowViewLink[]>();
    if (cohort === null) return index;
    for (const view of cohort.links) {
      const bucket = index.get(view.link.from_node_id);
      if (bucket === undefined) index.set(view.link.from_node_id, [view]);
      else bucket.push(view);
    }
    return index;
  });
  const moveTextByNode = createMemo(() => {
    const cohort = activeCohort();
    const index = new Map<string, string>();
    if (cohort === null) return index;
    for (const view of cohort.nodes) index.set(view.node.node_id, view.move_text);
    return index;
  });
  const select = (id: string) => {
    setSelectedAggregateId(null);
    setSelectedId((current) => (current === id ? null : id));
  };
  const selectAggregate = (id: string) => {
    setSelectedId(null);
    setSelectedAggregateId((current) => (current === id ? null : id));
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
      data-flow-drawn-nodes={activeCohort()?.rendered_nodes.length ?? 0}
      data-flow-aggregate-count={activeCohort()?.aggregates.length ?? 0}
      data-flow-print-export={strategicFitPrintExportMode() ? "true" : "false"}
    >
      <h3 class="decision-flow-title">Decision flow</h3>
      <p class="sr-only" data-flow-screen-reader-summary>
        {model().screen_reader_summary}
      </p>

      <Show
        when={model().projection.state !== "unavailable" && activeCohort()}
        fallback={
          <div class="decision-flow-unavailable" data-flow-unavailable>
            <strong>Decision flow unavailable</strong>
            <p>{model().projection.reason}</p>
            <Show when={model().projection.exclusions.length > 0}>
              <details>
                <summary>
                  Why branches are excluded ({model().projection.exclusions.length})
                </summary>
                <ul>
                  <For each={model().projection.exclusions}>
                    {(exclusion) => (
                      <li data-flow-exclusion={exclusion.route_id}>
                        <code>{shortId(exclusion.route_id)}</code> — {exclusion.explanation}
                      </li>
                    )}
                  </For>
                </ul>
              </details>
            </Show>
          </div>
        }
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
                    setSelectedAggregateId(null);
                  }}
                  data-flow-cohort-select
                >
                  <For each={model().cohorts}>
                    {(view) => (
                      <option value={view.cohort.cohort_id}>
                        {view.name} ({view.cohort.route_count})
                      </option>
                    )}
                  </For>
                </select>
              </label>
              <p class="decision-flow-legend" data-flow-legend>
                Shares are of this cohort's expected games and always add up at every step.{" "}
                {DECISION_FLOW_SYMBOLS.start} start, {DECISION_FLOW_SYMBOLS.player} you play,{" "}
                {DECISION_FLOW_SYMBOLS.opponent} opponent plays, {DECISION_FLOW_SYMBOLS.mode}{" "}
                strategic outcome. Cohorts are shown one at a time because route weights are
                normalized inside a cohort.
              </p>
            </div>

            <p class="sr-only" data-flow-cohort-summary>
              {cohort().screen_reader_summary}
            </p>

            <Show when={cohort().aggregates.length > 0}>
              <p class="decision-flow-note" data-flow-aggregation>
                {cohort().nodes.length - cohort().rendered_nodes.length} lighter steps are grouped
                into {cohort().aggregates.length} markers so no column draws more than{" "}
                {VISUALIZATION_RENDER_LIMITS.flow_nodes_per_column} steps. Each marker carries the
                exact combined share, and the outline below still lists every step.
              </p>
            </Show>

            <div
              class="decision-flow-scroll"
              ref={scrollRef}
              tabindex="0"
              role="group"
              aria-label="Decision flow diagram"
              data-flow-scale={chartScale()}
            >
              <svg
                class="decision-flow-chart"
                viewBox={`0 0 ${cohort().chart_width} ${cohort().chart_height}`}
                width={Math.round(cohort().chart_width * chartScale())}
                height={Math.round(cohort().chart_height * chartScale())}
                role="group"
                aria-label={`Decision flow for ${cohort().name}. ${cohort().nodes.length} steps.`}
                data-flow-chart
              >
                <For each={cohort().rendered_links}>
                  {(view) => (
                    <path
                      class="decision-flow-link"
                      classList={{
                        "decision-flow-link-truncated": view.truncated,
                        "decision-flow-link-selected": selectedId() === view.link_id,
                      }}
                      d={view.path}
                      stroke-width={view.thickness}
                      tabindex="0"
                      role="button"
                      aria-label={view.aria_label}
                      aria-pressed={selectedId() === view.link_id}
                      data-flow-link={view.link_id}
                      data-flow-link-truncated={view.truncated ? "true" : "false"}
                      data-flow-link-merged={view.merged_link_ids.length}
                      onClick={() => {
                        select(view.link_id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        select(view.link_id);
                      }}
                    >
                      <title>{view.aria_label}</title>
                    </path>
                  )}
                </For>
                <For each={cohort().aggregates}>
                  {(view) => (
                    <g
                      class="decision-flow-aggregate"
                      classList={{
                        "decision-flow-node-selected": selectedAggregateId() === view.aggregate_id,
                      }}
                      tabindex="0"
                      role="button"
                      aria-label={view.aria_label}
                      aria-pressed={selectedAggregateId() === view.aggregate_id}
                      data-flow-aggregate={view.aggregate_id}
                      data-flow-aggregate-size={view.member_node_ids.length}
                      onClick={() => {
                        selectAggregate(view.aggregate_id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        selectAggregate(view.aggregate_id);
                      }}
                    >
                      <rect x={view.x} y={view.y} width={view.width} height={view.height} rx="2" />
                      <text
                        x={view.x + view.width / 2}
                        y={view.y + view.height / 2}
                        class="decision-flow-node-text"
                      >
                        +{view.member_node_ids.length}
                      </text>
                      <title>{view.aria_label}</title>
                    </g>
                  )}
                </For>
                <For each={cohort().rendered_nodes}>
                  {(view) => (
                    <g
                      class="decision-flow-node"
                      classList={{
                        "decision-flow-node-selected": selectedId() === view.node.node_id,
                      }}
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
                      onClick={() => {
                        select(view.node.node_id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        select(view.node.node_id);
                      }}
                    >
                      <rect x={view.x} y={view.y} width={view.width} height={view.height} rx="2" />
                      <text
                        x={view.x + view.width / 2}
                        y={view.y + view.height / 2}
                        class="decision-flow-node-text"
                      >
                        {view.symbol} {view.move_text}
                      </text>
                      <title>{view.aria_label}</title>
                    </g>
                  )}
                </For>
              </svg>
            </div>

            <Show when={selectedAggregate()}>
              {(view) => (
                <div class="decision-flow-detail" data-flow-aggregate-detail={view().aggregate_id}>
                  <h4>{view().member_node_ids.length} grouped steps</h4>
                  <p>{view().aria_label}</p>
                  <ul class="decision-flow-aggregate-members">
                    <For each={aggregateMembers()}>
                      {(member) => (
                        <li>
                          <button
                            type="button"
                            onClick={() => {
                              select(member.node.node_id);
                            }}
                            data-flow-aggregate-member={member.node.node_id}
                          >
                            {member.symbol} {member.move_text} ({member.share_percent}%)
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              )}
            </Show>

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
                          <dd>{view().route_ids.length}</dd>
                        </div>
                        <Show when={view().merged_link_ids.length > 1}>
                          <div>
                            <dt>Grouped steps</dt>
                            <dd data-flow-detail-merged={view().merged_link_ids.length}>
                              This line combines {view().merged_link_ids.length} steps that end at
                              the same grouped marker; the share is their exact total.
                            </dd>
                          </div>
                        </Show>
                        <Show when={view().truncated}>
                          <div>
                            <dt>Depth limit</dt>
                            <dd data-flow-detail-truncated>
                              Some moves on this step are omitted; the weight still reaches its
                              outcome.
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
                      <h4>
                        {view().actor_text} {view().move_text}
                      </h4>
                      <dl>
                        <div>
                          <dt>Share of expected games</dt>
                          <dd data-flow-detail-share>{view().share_percent}%</dd>
                        </div>
                        <div>
                          <dt>Side</dt>
                          <dd data-flow-detail-actor>
                            {view().symbol} {view().actor_text}
                          </dd>
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
                                <span class="decision-flow-reason">
                                  {view().node.causality.reason}
                                </span>
                              </Show>
                            </dd>
                          </div>
                        </Show>
                        <Show when={view().node.transposition}>
                          {(transposition) => (
                            <div>
                              <dt>Transposition</dt>
                              <dd data-flow-detail-transposition={transposition().position_id}>
                                Reached from {transposition().incoming_node_ids.length} earlier
                                steps.
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
                            <For each={view().node.route_ids}>
                              {(routeId) => (
                                <code data-flow-detail-route={routeId}>{shortId(routeId)}</code>
                              )}
                            </For>
                          </dd>
                        </div>
                      </dl>
                    </>
                  )}
                </Show>
                <Show
                  when={selectionFindings().length > 0}
                  fallback={
                    <p data-flow-detail-no-findings>No findings reference these branches.</p>
                  }
                >
                  <div class="decision-flow-detail-findings">
                    <For each={selectionFindings()}>
                      {(findingId) => (
                        <button
                          type="button"
                          onClick={() => {
                            props.onOpenFinding(findingId);
                          }}
                          data-flow-open-finding={findingId}
                        >
                          Open finding {findingId.slice(-8)}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>

            <details
              class="decision-flow-outline"
              open={outlineOpen() || strategicFitPrintExportMode()}
              onToggle={(event) => setOutlineOpen(event.currentTarget.open)}
            >
              <summary>Flow outline ({cohort().nodes.length})</summary>
              <Show when={!outlineWindow().complete}>
                <p class="decision-flow-note" data-flow-outline-window>
                  Showing the first {outlineWindow().shown} of {outlineWindow().total} steps.
                  <button
                    type="button"
                    onClick={() => setOutlineExpanded(true)}
                    data-flow-show-all-rows
                  >
                    Show all {outlineWindow().total}
                  </button>
                </p>
              </Show>
              <div
                class="strategic-fit-virtual-scroll"
                data-virtualized={outlineRows.window().complete ? "false" : "true"}
                ref={outlineRows.attach}
              >
                <table
                  data-flow-outline
                  data-flow-outline-shown={outlineWindow().shown}
                  data-flow-outline-total={outlineWindow().total}
                  data-flow-outline-mounted={outlineRows.window().mounted}
                  aria-rowcount={outlineWindow().total}
                >
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
                    <Show when={outlineRows.window().lead > 0}>
                      <tr class="strategic-fit-virtual-spacer" aria-hidden="true">
                        <td colspan="6" style={{ height: `${outlineRows.window().lead}px` }} />
                      </tr>
                    </Show>
                    <For each={outlineRows.window().items}>
                      {(view, index) => (
                        <tr
                          data-flow-outline-row={view.node.node_id}
                          aria-rowindex={outlineRows.window().start + index() + 1}
                          data-selected={selectedId() === view.node.node_id ? "true" : "false"}
                        >
                          <td>{view.node.depth}</td>
                          <td data-flow-outline-actor={view.node.actor}>
                            {view.symbol} {view.actor_text}
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => {
                                select(view.node.node_id);
                              }}
                              aria-pressed={selectedId() === view.node.node_id}
                            >
                              {view.move_text}
                            </button>
                            <Show when={view.node.transposition}>
                              <span
                                class="decision-flow-outline-tag"
                                data-flow-outline-transposition
                              >
                                transposition
                              </span>
                            </Show>
                          </td>
                          <td>{view.share_percent}%</td>
                          <td>
                            <For each={outgoingByNode().get(view.node.node_id) ?? []}>
                              {(link) => (
                                <span
                                  class="decision-flow-outline-next"
                                  data-flow-outline-next={link.link.link_id}
                                >
                                  {moveTextByNode().get(link.link.to_node_id)} ({link.share_percent}
                                  %)
                                </span>
                              )}
                            </For>
                          </td>
                          <td data-flow-outline-causality={view.node.causality.label}>
                            {view.node.kind === "decision" ? view.causality_text : "—"}
                          </td>
                        </tr>
                      )}
                    </For>
                    <Show when={outlineRows.window().trail > 0}>
                      <tr class="strategic-fit-virtual-spacer" aria-hidden="true">
                        <td colspan="6" style={{ height: `${outlineRows.window().trail}px` }} />
                      </tr>
                    </Show>
                  </tbody>
                </table>
              </div>
            </details>

            <Show when={model().projection.truncations.length > 0}>
              <details
                class="decision-flow-truncations"
                open={strategicFitPrintExportMode() || undefined}
              >
                <summary>
                  Branches beyond the flow depth ({model().projection.truncations.length})
                </summary>
                <ul>
                  <For each={model().projection.truncations}>
                    {(truncation) => (
                      <li data-flow-truncation={truncation.route_id}>
                        <code>{shortId(truncation.route_id)}</code> — {truncation.explanation}
                      </li>
                    )}
                  </For>
                </ul>
              </details>
            </Show>

            <Show when={model().projection.exclusions.length > 0}>
              <details
                class="decision-flow-exclusions"
                open={strategicFitPrintExportMode() || undefined}
              >
                <summary>Branches without a flow ({model().projection.exclusions.length})</summary>
                <ul>
                  <For each={model().projection.exclusions}>
                    {(exclusion) => (
                      <li data-flow-exclusion={exclusion.route_id}>
                        <code>{shortId(exclusion.route_id)}</code> — {exclusion.explanation}
                      </li>
                    )}
                  </For>
                </ul>
              </details>
            </Show>
          </>
        )}
      </Show>
    </section>
  );
}
