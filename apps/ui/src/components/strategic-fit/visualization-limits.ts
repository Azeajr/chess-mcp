/**
 * Task 10.4 — deterministic render bounds shared by every Strategic Fit visualization.
 *
 * A large report must not produce a page that cannot be interacted with, and it must not produce a
 * chart that silently drops evidence either. Every bound here withholds only from the drawn chart
 * or from the first table window, always reports exactly how much it withheld so the view can
 * disclose it, and always leaves the complete list reachable through an explicit control or the
 * print/export mode.
 */
import type { StrategicMapResolutionState } from "@chess-mcp/chess-tools";

/**
 * Caps are chosen so the heaviest supported report still renders a bounded DOM. They are exported
 * because the behavioral tests assert against them rather than against magic numbers.
 */
export const VISUALIZATION_RENDER_LIMITS = {
  /** Plotted map circles before the map switches to deterministic grid clusters. */
  map_points: 300,
  /** Transposition lines drawn at once; the rest stay disclosed as a count. */
  map_edges: 200,
  /** Branch-list rows in the first window. */
  map_rows: 100,
  /** Heatmap concept columns in the first window. */
  heatmap_columns: 40,
  /** Heatmap cohort rows in the first window. */
  heatmap_rows: 40,
  /** Flow nodes drawn per depth column before the lightest ones aggregate into one marker. */
  flow_nodes_per_column: 12,
  /** Flow outline rows in the first window. */
  flow_rows: 150,
  /** Pareto points drawn at once. */
  pareto_points: 120,
  /** Rows in a Replacement Lab change-review list window. */
  review_rows: 60,
  /**
   * Task 12.3 — rows a virtualized list may mount at once. This is not a second capping rule: the
   * caps above still decide what a first window *shows* and what it discloses as withheld, while
   * this one decides only how many of an already-complete list are in the DOM at a time.
   */
  virtual_rows: 60,
  /** Columns a virtualized grid may mount at once, so a wide grid bounds its cells too. */
  virtual_columns: 24,
  /** Rows a virtualized grid may mount at once; rows times columns bounds the mounted cells. */
  virtual_grid_rows: 24,
} as const;

export interface BoundedWindow<T> {
  readonly items: readonly T[];
  readonly shown: number;
  readonly total: number;
  readonly withheld: number;
  /** True when `items` is the whole list, so a view can honestly call itself complete. */
  readonly complete: boolean;
}

/** Bounded first window over a deterministic list; `expanded` lifts the cap without reordering. */
export function boundedWindow<T>(
  items: readonly T[],
  limit: number,
  expanded = false,
): BoundedWindow<T> {
  const safeLimit = Math.max(1, Math.floor(limit));
  if (expanded || items.length <= safeLimit) {
    return {
      items,
      shown: items.length,
      total: items.length,
      withheld: 0,
      complete: true,
    };
  }
  const shown = items.slice(0, safeLimit);
  return {
    items: shown,
    shown: shown.length,
    total: items.length,
    withheld: items.length - shown.length,
    complete: false,
  };
}

/** Rows kept mounted on each side of the scrolled viewport so scrolling does not flash blank rows. */
export const VIRTUAL_WINDOW_OVERSCAN = 6;

export interface VirtualWindow<T> {
  readonly items: readonly T[];
  /** Logical index of the first mounted item; the list itself is never reordered or filtered. */
  readonly start: number;
  readonly mounted: number;
  readonly total: number;
  /** Pixels of unmounted list before and after the mounted rows, so scroll geometry stays honest. */
  readonly lead: number;
  readonly trail: number;
  /** True when every item is mounted, so a view can honestly call itself complete. */
  readonly complete: boolean;
}

export interface VirtualWindowOptions {
  readonly rowSize: number;
  /** Measured viewport in the scrolling axis; `0` before measurement falls back to the mount cap. */
  readonly viewportSize: number;
  readonly scrollOffset: number;
  readonly maximumMounted?: number;
  readonly overscan?: number;
}

/**
 * Task 12.3 — deterministic mounted window over a complete, already-ordered list.
 *
 * The complete list stays reachable by scrolling: nothing is dropped, filtered, or reordered, and
 * the unmounted remainder is represented as exact leading and trailing space so the scrollbar
 * describes the logical total rather than the mounted subset. The mounted count is bounded by
 * `maximumMounted` regardless of how many items exist, which is what keeps a report with thousands
 * of routes or concepts from producing thousands of DOM rows.
 */
export function virtualWindow<T>(
  items: readonly T[],
  options: VirtualWindowOptions,
): VirtualWindow<T> {
  const total = items.length;
  const rowSize = Math.max(1, options.rowSize);
  const maximumMounted = Math.max(
    1,
    Math.floor(options.maximumMounted ?? VISUALIZATION_RENDER_LIMITS.virtual_rows),
  );
  const overscan = Math.max(0, Math.floor(options.overscan ?? VIRTUAL_WINDOW_OVERSCAN));
  const viewportSize = Math.max(0, options.viewportSize);
  const visible = viewportSize > 0 ? Math.ceil(viewportSize / rowSize) + 1 : maximumMounted;
  const mounted = Math.min(total, maximumMounted, visible + overscan * 2);
  const first = Math.floor(Math.max(0, options.scrollOffset) / rowSize) - overscan;
  const start = Math.min(Math.max(0, first), Math.max(0, total - mounted));
  return {
    items: mounted === total && start === 0 ? items : items.slice(start, start + mounted),
    start,
    mounted,
    total,
    lead: start * rowSize,
    trail: Math.max(0, total - start - mounted) * rowSize,
    complete: mounted === total,
  };
}

export interface ClusterablePoint {
  readonly id: string;
  readonly cx: number;
  readonly cy: number;
  readonly weight: number;
  readonly resolution: StrategicMapResolutionState;
  readonly finding_ids: readonly string[];
}

export interface StrategicMapCluster {
  readonly cluster_id: string;
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly point_count: number;
  readonly total_weight: number;
  readonly unresolved_count: number;
  readonly resolved_count: number;
  readonly no_finding_count: number;
  readonly route_ids: readonly string[];
  readonly finding_ids: readonly string[];
  readonly aria_label: string;
}

export interface StrategicMapClustering {
  readonly mode: "points" | "clusters";
  readonly clusters: readonly StrategicMapCluster[];
  readonly grid_size: number;
  readonly clustered_point_count: number;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function cell(value: number, grid: number): number {
  const index = Math.floor((value / 100) * grid);
  return Math.min(grid - 1, Math.max(0, index));
}

/**
 * Deterministic square-grid aggregation over the plotted coordinate space. A cluster sits at the
 * weight-weighted centroid of its members, then is drawn entirely inside its own grid cell so two
 * clusters can never overlap: an overlapping marker is one a pointer cannot reach.
 */
export function clusterStrategicMapPoints(
  points: readonly ClusterablePoint[],
  limit: number = VISUALIZATION_RENDER_LIMITS.map_points,
): StrategicMapClustering {
  const safeLimit = Math.max(1, Math.floor(limit));
  if (points.length <= safeLimit) {
    return { mode: "points", clusters: [], grid_size: 0, clustered_point_count: 0 };
  }
  const grid = Math.max(1, Math.ceil(Math.sqrt(safeLimit)));
  const buckets = new Map<string, ClusterablePoint[]>();
  for (const point of points) {
    const column = cell(point.cx, grid);
    const row = cell(point.cy, grid);
    const key = `${String(row).padStart(4, "0")}:${String(column).padStart(4, "0")}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [point]);
    else bucket.push(point);
  }
  const ordered = [...buckets.entries()].sort((left, right) =>
    left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0,
  );
  const largest = ordered.reduce((maximum, [, members]) => Math.max(maximum, members.length), 0);
  const cellSize = 100 / grid;
  /** A marker never crosses its cell, so no two markers can cover each other's click target. */
  const maximumRadius = Math.max(0.5, (cellSize / 2) * 0.9);
  const clusters = ordered.map(([key, members]) => {
    const [row, column] = key.split(":").map((part) => Number(part)) as [number, number];
    const totalWeight = members.reduce((sum, member) => sum + member.weight, 0);
    const centroid = (pick: (member: ClusterablePoint) => number) =>
      totalWeight > 0
        ? members.reduce((sum, member) => sum + pick(member) * member.weight, 0) / totalWeight
        : members.reduce((sum, member) => sum + pick(member), 0) / members.length;
    const radius = Math.min(
      maximumRadius,
      2 + 4 * Math.sqrt(largest > 0 ? members.length / largest : 1),
    );
    const inCell = (value: number, index: number) =>
      Math.min((index + 1) * cellSize - radius, Math.max(index * cellSize + radius, value));
    const unresolved = members.filter(
      (member) => member.resolution === "unresolved-finding",
    ).length;
    const resolved = members.filter((member) => member.resolution === "resolved-finding").length;
    const findingIds = [...new Set(members.flatMap((member) => member.finding_ids))];
    return {
      cluster_id: key,
      cx: round(
        inCell(
          centroid((member) => member.cx),
          column,
        ),
      ),
      cy: round(
        inCell(
          centroid((member) => member.cy),
          row,
        ),
      ),
      radius: round(radius),
      point_count: members.length,
      total_weight: round(totalWeight),
      unresolved_count: unresolved,
      resolved_count: resolved,
      no_finding_count: members.length - unresolved - resolved,
      route_ids: members.map((member) => member.id),
      finding_ids: findingIds,
      aria_label:
        `Cluster of ${members.length} branches.` +
        ` ${unresolved} with unresolved findings, ${resolved} resolved,` +
        ` ${members.length - unresolved - resolved} without findings.` +
        ` Combined expected weight ${round(totalWeight)}.`,
    } satisfies StrategicMapCluster;
  });
  return {
    mode: "clusters",
    clusters,
    grid_size: grid,
    clustered_point_count: points.length,
  };
}

export interface ClusterableEdge {
  readonly from_route_id: string;
  readonly to_route_id: string;
  readonly shared_position_count: number;
}

export interface ClusteredMapEdge {
  readonly from_cluster_id: string;
  readonly to_cluster_id: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly edge_count: number;
  readonly shared_position_count: number;
}

export interface ClusteredMapEdges {
  readonly edges: readonly ClusteredMapEdge[];
  /** Transpositions whose two branches landed in the same cluster and cannot be drawn as a line. */
  readonly within_cluster_count: number;
}

/**
 * Remap transposition lines onto clusters. Lines inside one cluster have no length to draw, so they
 * are counted and disclosed instead of being dropped without a word.
 */
export function clusterStrategicMapEdges(
  edges: readonly ClusterableEdge[],
  clusters: readonly StrategicMapCluster[],
): ClusteredMapEdges {
  const clusterByRoute = new Map<string, StrategicMapCluster>();
  for (const cluster of clusters) {
    for (const routeId of cluster.route_ids) clusterByRoute.set(routeId, cluster);
  }
  const merged = new Map<
    string,
    {
      from: StrategicMapCluster;
      to: StrategicMapCluster;
      edge_count: number;
      shared_position_count: number;
    }
  >();
  let withinCluster = 0;
  for (const edge of edges) {
    const from = clusterByRoute.get(edge.from_route_id);
    const to = clusterByRoute.get(edge.to_route_id);
    if (from === undefined || to === undefined) continue;
    if (from.cluster_id === to.cluster_id) {
      withinCluster += 1;
      continue;
    }
    const [left, right] = from.cluster_id < to.cluster_id ? [from, to] : [to, from];
    const key = `${left.cluster_id}|${right.cluster_id}`;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, {
        from: left,
        to: right,
        edge_count: 1,
        shared_position_count: edge.shared_position_count,
      });
    } else {
      existing.edge_count += 1;
      existing.shared_position_count += edge.shared_position_count;
    }
  }
  const ordered = [...merged.entries()]
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(
      ([, value]) =>
        ({
          from_cluster_id: value.from.cluster_id,
          to_cluster_id: value.to.cluster_id,
          x1: value.from.cx,
          y1: value.from.cy,
          x2: value.to.cx,
          y2: value.to.cy,
          edge_count: value.edge_count,
          shared_position_count: value.shared_position_count,
        }) satisfies ClusteredMapEdge,
    );
  return { edges: ordered, within_cluster_count: withinCluster };
}

export interface DecisionFlowColumnSplit<TNode> {
  readonly rendered: readonly TNode[];
  readonly aggregated: readonly TNode[];
}

/**
 * Keep the heaviest steps of a depth column drawable and fold the remaining lighter ones into one
 * marker. The aggregate always represents at least two steps, so a single extra step is drawn
 * rather than hidden behind a marker that would say the same thing in more words.
 */
export function splitDecisionFlowColumn<TNode>(
  column: readonly TNode[],
  limit: number,
  weightOf: (node: TNode) => number,
  idOf: (node: TNode) => string,
): DecisionFlowColumnSplit<TNode> {
  const safeLimit = Math.max(2, Math.floor(limit));
  if (column.length <= safeLimit) return { rendered: column, aggregated: [] };
  const byWeight = [...column].sort(
    (left, right) =>
      weightOf(right) - weightOf(left) ||
      (idOf(left) < idOf(right) ? -1 : idOf(left) > idOf(right) ? 1 : 0),
  );
  const keep = new Set(byWeight.slice(0, safeLimit - 1).map(idOf));
  return {
    rendered: column.filter((node) => keep.has(idOf(node))),
    aggregated: column.filter((node) => !keep.has(idOf(node))),
  };
}

export interface MergeableFlowLink {
  readonly link_id: string;
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly weight: number;
  readonly route_ids: readonly string[];
  readonly finding_ids: readonly string[];
  readonly truncated: boolean;
}

export interface MergedFlowLink extends MergeableFlowLink {
  readonly merged_link_ids: readonly string[];
}

function unionIds(values: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(values.flat())];
}

/**
 * Re-point links at the aggregate markers that replaced their endpoints and merge the duplicates
 * that result. Weight is summed rather than sampled, so every step's shares still add up exactly
 * after aggregation. Links whose two ends collapsed into the same marker have nothing left to show
 * and are dropped from the drawing only.
 */
export function mergeDecisionFlowLinks(
  links: readonly MergeableFlowLink[],
  replacementByNodeId: ReadonlyMap<string, string>,
): readonly MergedFlowLink[] {
  const merged = new Map<
    string,
    {
      from: string;
      to: string;
      weight: number;
      route_ids: string[][];
      finding_ids: string[][];
      truncated: boolean;
      link_ids: string[];
    }
  >();
  for (const link of links) {
    const from = replacementByNodeId.get(link.from_node_id) ?? link.from_node_id;
    const to = replacementByNodeId.get(link.to_node_id) ?? link.to_node_id;
    if (from === to) continue;
    const key = `${from}${to}`;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, {
        from,
        to,
        weight: link.weight,
        route_ids: [[...link.route_ids]],
        finding_ids: [[...link.finding_ids]],
        truncated: link.truncated,
        link_ids: [link.link_id],
      });
    } else {
      existing.weight += link.weight;
      existing.route_ids.push([...link.route_ids]);
      existing.finding_ids.push([...link.finding_ids]);
      existing.truncated = existing.truncated || link.truncated;
      existing.link_ids.push(link.link_id);
    }
  }
  return [...merged.values()].map(
    (value) =>
      ({
        link_id:
          value.link_ids.length === 1
            ? (value.link_ids[0] ?? `aggregate-link:${value.from}|${value.to}`)
            : `aggregate-link:${value.from}|${value.to}`,
        from_node_id: value.from,
        to_node_id: value.to,
        weight: value.weight,
        route_ids: unionIds(value.route_ids),
        finding_ids: unionIds(value.finding_ids),
        truncated: value.truncated,
        merged_link_ids: value.link_ids,
      }) satisfies MergedFlowLink,
  );
}

/** Below this the diagram stops shrinking and the scroll container takes over. */
export const DECISION_FLOW_MINIMUM_SCALE = 0.6;

/**
 * Fit a wide flow to the measured container down to a legibility floor. A chart that already fits
 * is never enlarged, and a chart that cannot fit at the floor keeps its horizontal scroll.
 */
export function decisionFlowScale(containerWidth: number | null, chartWidth: number): number {
  if (containerWidth === null || containerWidth <= 0 || chartWidth <= 0) return 1;
  if (chartWidth <= containerWidth) return 1;
  return Math.max(
    DECISION_FLOW_MINIMUM_SCALE,
    Math.round((containerWidth / chartWidth) * 100) / 100,
  );
}
