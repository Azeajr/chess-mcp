import { For, Show, createMemo, createSignal } from "solid-js";
import {
  buildStrategicMapProjection,
  type StrategicFinding,
  type StrategicFitAnalysisResult,
  type StrategicMapPoint,
  type StrategicMapProjection,
  type StrategicMapResolutionState,
} from "@chess-mcp/chess-tools";
import { strategicFitPrintExportMode } from "../../store/ui";
import {
  VISUALIZATION_RENDER_LIMITS,
  boundedWindow,
  clusterStrategicMapEdges,
  clusterStrategicMapPoints,
} from "./visualization-limits";

export type StrategicMapReport = Pick<
  StrategicFitAnalysisResult,
  | "report_id"
  | "repertoire_revision"
  | "analysis_version"
  | "profile"
  | "trajectories"
  | "cohorts"
  | "findings"
  | "provenance"
>;

export interface StrategicMapViewPoint {
  readonly point: StrategicMapPoint;
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly opacity: number;
  readonly label: string;
  readonly cohort_name: string;
  readonly aria_label: string;
}

export interface StrategicMapViewEdge {
  readonly from_route_id: string;
  readonly to_route_id: string;
  readonly shared_position_count: number;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface StrategicMapViewModel {
  readonly projection: StrategicMapProjection;
  readonly points: readonly StrategicMapViewPoint[];
  readonly edges: readonly StrategicMapViewEdge[];
  readonly screen_reader_summary: string;
}

const VIEW_MARGIN = 8;
const VIEW_SPAN = 100 - VIEW_MARGIN * 2;
/** Points never fade out entirely: low confidence dims, it does not hide. */
const MINIMUM_OPACITY = 0.35;

export const STRATEGIC_MAP_RESOLUTION_LABELS: Readonly<Record<StrategicMapResolutionState, string>> = {
  "unresolved-finding": "Has an unresolved finding",
  "resolved-finding": "Findings resolved",
  "no-finding": "No findings",
};

function coordinate(value: number): number {
  return Math.round((VIEW_MARGIN + value * VIEW_SPAN) * 100) / 100;
}

function shortRouteId(routeId: string): string {
  const separator = routeId.indexOf(":");
  const hash = separator === -1 ? routeId : routeId.slice(separator + 1);
  return hash.slice(0, 8);
}

function pointLabel(point: StrategicMapPoint, findingsById: ReadonlyMap<string, StrategicFinding>): string {
  for (const findingId of point.finding_ids) {
    const summary = findingsById.get(findingId)?.affected_line_summary;
    if (summary) return summary;
  }
  return `Branch ${shortRouteId(point.route_id)}`;
}

export function buildStrategicMapViewModel(
  report: StrategicMapReport,
  options: {
    readonly cohortName?: (cohortId: string) => string;
    readonly findings?: readonly StrategicFinding[];
  } = {},
): StrategicMapViewModel {
  const projection = buildStrategicMapProjection(report, { findings: options.findings });
  const cohortName = options.cohortName ?? ((cohortId: string) => cohortId);
  const findingsById = new Map(
    (options.findings ?? report.findings).map((finding) => [finding.finding_id, finding]),
  );
  const maxWeight = projection.points.reduce(
    (maximum, point) => Math.max(maximum, point.normalized_weight),
    0,
  );
  const points = projection.points.map((point) => {
    const label = pointLabel(point, findingsById);
    const name = cohortName(point.cohort_id);
    const weightShare = maxWeight > 0 ? point.normalized_weight / maxWeight : 1;
    return {
      point,
      cx: coordinate(point.x),
      cy: coordinate(point.y),
      radius: Math.round((1.4 + 3.6 * Math.sqrt(weightShare)) * 100) / 100,
      opacity: Math.round((MINIMUM_OPACITY + (1 - MINIMUM_OPACITY) * point.confidence) * 100) / 100,
      label,
      cohort_name: name,
      aria_label: `${label}. Cohort ${name}. ${STRATEGIC_MAP_RESOLUTION_LABELS[point.resolution]}.` +
        ` Distance from first anchor ${point.x}; distance from second anchor ${point.y}.`,
    };
  });
  const pointByRoute = new Map(points.map((view) => [view.point.route_id, view]));
  const edges = projection.edges.flatMap((edge) => {
    const from = pointByRoute.get(edge.from_route_id);
    const to = pointByRoute.get(edge.to_route_id);
    if (from === undefined || to === undefined) return [];
    return [{
      from_route_id: edge.from_route_id,
      to_route_id: edge.to_route_id,
      shared_position_count: edge.shared_position_ids.length,
      x1: from.cx,
      y1: from.cy,
      x2: to.cx,
      y2: to.cy,
    }];
  });
  const unresolvedCount = points.filter((view) => view.point.resolution === "unresolved-finding").length;
  const summaryParts = [
    `Strategic map with ${points.length} plotted ${points.length === 1 ? "branch" : "branches"}`,
    `${projection.edges.length} transposition ${projection.edges.length === 1 ? "link" : "links"}`,
    `${unresolvedCount} with unresolved findings`,
    `${projection.exclusions.length} excluded without comparable evidence or coordinates`,
  ];
  return {
    projection,
    points,
    edges,
    screen_reader_summary: projection.state === "unavailable"
      ? `Strategic map unavailable. ${projection.reason ?? ""}`.trim()
      : `${summaryParts.join(", ")}.${projection.reason ? ` ${projection.reason}` : ""}`,
  };
}

export default function StrategicMap(props: {
  report: StrategicMapReport;
  cohortName: (cohortId: string) => string;
  completeFindings?: readonly StrategicFinding[];
  onOpenFinding: (findingId: string) => void;
}) {
  const [selectedRouteId, setSelectedRouteId] = createSignal<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = createSignal<string | null>(null);
  const [cohortFilter, setCohortFilter] = createSignal<string>("all");
  const [resolutionFilter, setResolutionFilter] = createSignal<"all" | StrategicMapResolutionState>("all");
  const [zoom, setZoom] = createSignal(1);
  const [listExpanded, setListExpanded] = createSignal(false);
  const [listOpen, setListOpen] = createSignal(true);

  const model = createMemo(() => buildStrategicMapViewModel(props.report, {
    cohortName: props.cohortName,
    findings: props.completeFindings,
  }));
  const visiblePoints = createMemo(() => model().points.filter((view) =>
    (cohortFilter() === "all" || view.point.cohort_id === cohortFilter()) &&
    (resolutionFilter() === "all" || view.point.resolution === resolutionFilter())
  ));
  const visibleEdges = createMemo(() => {
    const routeIds = new Set(visiblePoints().map((view) => view.point.route_id));
    return model().edges.filter((edge) =>
      routeIds.has(edge.from_route_id) && routeIds.has(edge.to_route_id)
    );
  });
  /**
   * Beyond the cap the drawing switches to deterministic grid clusters. Every branch stays in the
   * branch list below, so aggregation changes what is drawn and never what is reported.
   */
  const clustering = createMemo(() => clusterStrategicMapPoints(
    visiblePoints().map((view) => ({
      id: view.point.route_id,
      cx: view.cx,
      cy: view.cy,
      weight: view.point.normalized_weight,
      resolution: view.point.resolution,
      finding_ids: view.point.finding_ids,
    })),
    VISUALIZATION_RENDER_LIMITS.map_points,
  ));
  const clusteredEdges = createMemo(() =>
    clustering().mode === "clusters"
      ? clusterStrategicMapEdges(
        visibleEdges().map((edge) => ({
          from_route_id: edge.from_route_id,
          to_route_id: edge.to_route_id,
          shared_position_count: edge.shared_position_count,
        })),
        clustering().clusters,
      )
      : { edges: [], within_cluster_count: 0 }
  );
  const drawnEdges = createMemo(() =>
    boundedWindow(visibleEdges(), VISUALIZATION_RENDER_LIMITS.map_edges)
  );
  const listWindow = createMemo(() => boundedWindow(
    visiblePoints(),
    VISUALIZATION_RENDER_LIMITS.map_rows,
    listExpanded() || strategicFitPrintExportMode(),
  ));
  const selected = createMemo(() => {
    const routeId = selectedRouteId();
    if (routeId === null) return null;
    return visiblePoints().find((view) => view.point.route_id === routeId) ?? null;
  });
  const selectedCluster = createMemo(() => {
    const clusterId = selectedClusterId();
    if (clusterId === null) return null;
    return clustering().clusters.find((cluster) => cluster.cluster_id === clusterId) ?? null;
  });
  const clusterMembers = createMemo(() => {
    const cluster = selectedCluster();
    if (cluster === null) return [];
    const routeIds = new Set(cluster.route_ids);
    return visiblePoints().filter((view) => routeIds.has(view.point.route_id));
  });
  const viewBox = createMemo(() => {
    const size = 100 / zoom();
    const origin = 50 - size / 2;
    return `${origin} ${origin} ${size} ${size}`;
  });
  const selectPoint = (routeId: string) => {
    setSelectedRouteId((current) => current === routeId ? null : routeId);
  };
  const selectCluster = (clusterId: string) => {
    setSelectedRouteId(null);
    setSelectedClusterId((current) => current === clusterId ? null : clusterId);
  };

  return (
    <section
      class="strategic-map"
      aria-label="Strategic map"
      data-map-state={model().projection.state}
      data-map-projection-version={model().projection.projection_version}
      data-map-report={model().projection.report_id}
      data-map-point-count={model().points.length}
      data-map-edge-count={model().edges.length}
      data-map-render-mode={clustering().mode}
      data-map-drawn-marks={clustering().mode === "clusters"
        ? clustering().clusters.length
        : visiblePoints().length}
      data-map-print-export={strategicFitPrintExportMode() ? "true" : "false"}
    >
      <p class="sr-only" data-map-screen-reader-summary>{model().screen_reader_summary}</p>

      <Show
        when={model().projection.state !== "unavailable"}
        fallback={(
          <div class="strategic-map-unavailable" data-map-unavailable>
            <strong>Strategic map unavailable</strong>
            <p>{model().projection.reason}</p>
            <Show when={model().projection.exclusions.length > 0}>
              <details>
                <summary>Why branches are excluded ({model().projection.exclusions.length})</summary>
                <ul>
                  <For each={model().projection.exclusions}>{(exclusion) => (
                    <li data-map-exclusion={exclusion.route_id}>
                      <code>{shortRouteId(exclusion.route_id)}</code> — {exclusion.explanation}
                    </li>
                  )}</For>
                </ul>
              </details>
            </Show>
          </div>
        )}
      >
        <div class="strategic-map-controls">
          <label>
            Cohort
            <select
              value={cohortFilter()}
              onChange={(event) => {
                setCohortFilter(event.currentTarget.value);
                setSelectedRouteId(null);
                setSelectedClusterId(null);
              }}
              data-map-cohort-filter
            >
              <option value="all">All cohorts</option>
              <For each={model().projection.color_groups}>{(group) => (
                <option value={group.cohort_id}>
                  {props.cohortName(group.cohort_id)} ({group.route_count})
                </option>
              )}</For>
            </select>
          </label>
          <label>
            Findings
            <select
              value={resolutionFilter()}
              onChange={(event) => {
                setResolutionFilter(event.currentTarget.value as "all" | StrategicMapResolutionState);
                setSelectedRouteId(null);
                setSelectedClusterId(null);
              }}
              data-map-resolution-filter
            >
              <option value="all">All branches</option>
              <option value="unresolved-finding">Unresolved findings</option>
              <option value="resolved-finding">Resolved findings</option>
              <option value="no-finding">No findings</option>
            </select>
          </label>
          <label>
            Zoom
            <input
              type="range"
              min="1"
              max="4"
              step="0.5"
              value={zoom()}
              onInput={(event) => setZoom(Number(event.currentTarget.value))}
              data-map-zoom
              aria-valuetext={`${zoom()}x zoom`}
            />
          </label>
        </div>

        <Show when={model().projection.state === "single-axis"}>
          <p class="strategic-map-note" data-map-single-axis>{model().projection.reason}</p>
        </Show>

        <Show when={clustering().mode === "clusters"}>
          <p class="strategic-map-note" data-map-aggregation>
            {visiblePoints().length} branches are above the {VISUALIZATION_RENDER_LIMITS.map_points}
            {" "}point drawing limit, so the chart groups them into {clustering().clusters.length}
            {" "}position clusters. Every branch is still listed below, and selecting a cluster lists
            its own branches.
            <Show when={clusteredEdges().within_cluster_count > 0}>
              {" "}{clusteredEdges().within_cluster_count} transposition
              {clusteredEdges().within_cluster_count === 1 ? " link connects" : " links connect"}
              {" "}two branches inside one cluster and cannot be drawn as a line.
            </Show>
          </p>
        </Show>
        <Show when={clustering().mode === "points" && !drawnEdges().complete}>
          <p class="strategic-map-note" data-map-edge-limit>
            {drawnEdges().shown} of {drawnEdges().total} transposition links are drawn;
            {" "}{drawnEdges().withheld} more exist between the same plotted branches.
          </p>
        </Show>

        <svg
          class="strategic-map-chart"
          viewBox={viewBox()}
          role="group"
          aria-label={clustering().mode === "clusters"
            ? `Strategic map chart. ${visiblePoints().length} branches grouped into ${clustering().clusters.length} clusters.`
            : `Strategic map chart. ${visiblePoints().length} branches shown.`}
          data-map-chart
        >
          <Show
            when={clustering().mode === "clusters"}
            fallback={(
              <>
                <For each={drawnEdges().items}>{(edge) => (
                  <line
                    class="strategic-map-edge"
                    x1={edge.x1}
                    y1={edge.y1}
                    x2={edge.x2}
                    y2={edge.y2}
                    data-map-edge={`${edge.from_route_id}|${edge.to_route_id}`}
                  >
                    <title>
                      Transposition: {edge.shared_position_count} shared {edge.shared_position_count === 1 ? "position" : "positions"}
                    </title>
                  </line>
                )}</For>
                <For each={visiblePoints()}>{(view) => (
                  <circle
                    classList={{
                      "strategic-map-point": true,
                      [`strategic-map-color-${view.point.color_index % 10}`]: true,
                      "strategic-map-point-selected": selected()?.point.route_id === view.point.route_id,
                    }}
                    cx={view.cx}
                    cy={view.cy}
                    r={view.radius}
                    opacity={view.opacity}
                    tabindex="0"
                    role="button"
                    aria-label={view.aria_label}
                    aria-pressed={selected()?.point.route_id === view.point.route_id}
                    data-map-point={view.point.route_id}
                    data-map-resolution={view.point.resolution}
                    data-map-anchor={view.point.is_anchor ?? "none"}
                    onClick={() => selectPoint(view.point.route_id)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      selectPoint(view.point.route_id);
                    }}
                  />
                )}</For>
              </>
            )}
          >
            <For each={clusteredEdges().edges}>{(edge) => (
              <line
                class="strategic-map-edge"
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                data-map-cluster-edge={`${edge.from_cluster_id}|${edge.to_cluster_id}`}
              >
                <title>
                  {edge.edge_count} transposition {edge.edge_count === 1 ? "link" : "links"} between these clusters
                </title>
              </line>
            )}</For>
            <For each={clustering().clusters}>{(cluster) => (
              <g
                classList={{
                  "strategic-map-cluster": true,
                  "strategic-map-cluster-selected": selectedClusterId() === cluster.cluster_id,
                }}
                tabindex="0"
                role="button"
                aria-label={cluster.aria_label}
                aria-pressed={selectedClusterId() === cluster.cluster_id}
                data-map-cluster={cluster.cluster_id}
                data-map-cluster-size={cluster.point_count}
                data-map-cluster-unresolved={cluster.unresolved_count}
                onClick={() => selectCluster(cluster.cluster_id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  selectCluster(cluster.cluster_id);
                }}
              >
                <circle cx={cluster.cx} cy={cluster.cy} r={cluster.radius} />
                <text x={cluster.cx} y={cluster.cy} class="strategic-map-cluster-text">
                  {cluster.point_count}
                </text>
                <title>{cluster.aria_label}</title>
              </g>
            )}</For>
          </Show>
        </svg>

        <Show when={selectedCluster()}>
          {(cluster) => (
            <div class="strategic-map-cluster-detail" data-map-cluster-detail={cluster().cluster_id}>
              <h3>Cluster of {cluster().point_count} branches</h3>
              <p>{cluster().aria_label}</p>
              <ul>
                <For each={clusterMembers()}>{(view) => (
                  <li>
                    <button
                      type="button"
                      onClick={() => selectPoint(view.point.route_id)}
                      aria-pressed={selected()?.point.route_id === view.point.route_id}
                      data-map-cluster-member={view.point.route_id}
                    >
                      {view.label}
                    </button>
                  </li>
                )}</For>
              </ul>
            </div>
          )}
        </Show>

        <details class="strategic-map-axes" open={strategicFitPrintExportMode() || undefined}>
          <summary>How positions are calculated</summary>
          <ul>
            <Show when={model().projection.axes.x}>
              {(axis) => <li data-map-axis="x">{axis().explanation}</li>}
            </Show>
            <Show when={model().projection.axes.y}>
              {(axis) => <li data-map-axis="y">{axis().explanation}</li>}
            </Show>
            <For each={model().projection.axes.excluded_families}>{(family) => (
              <li data-map-excluded-family={family.family}>
                <strong>{family.family}</strong>: {family.reason}
              </li>
            )}</For>
          </ul>
        </details>

        <Show when={selected()}>
          {(view) => (
            <div class="strategic-map-detail" data-map-detail={view().point.route_id}>
              <h3>{view().label}</h3>
              <dl>
                <div>
                  <dt>Cohort</dt>
                  <dd>{view().cohort_name}</dd>
                </div>
                <div>
                  <dt>Expected weight</dt>
                  <dd>{view().point.normalized_weight}</dd>
                </div>
                <div>
                  <dt>Evidence confidence</dt>
                  <dd>{view().point.confidence}</dd>
                </div>
                <div>
                  <dt>Findings</dt>
                  <dd>{STRATEGIC_MAP_RESOLUTION_LABELS[view().point.resolution]}</dd>
                </div>
              </dl>
              <Show when={view().point.finding_ids.length > 0}>
                <div class="strategic-map-detail-findings">
                  <For each={view().point.finding_ids}>{(findingId) => (
                    <button
                      type="button"
                      onClick={() => props.onOpenFinding(findingId)}
                      data-map-open-finding={findingId}
                    >
                      Open finding {findingId.slice(-8)}
                    </button>
                  )}</For>
                </div>
              </Show>
              <h4>Why this branch sits here</h4>
              <For each={view().point.axis_breakdowns}>{(breakdown) => (
                <div data-map-breakdown={breakdown.axis}>
                  <p>
                    {breakdown.axis === "x" ? "Horizontal" : "Vertical"} distance {breakdown.distance}
                  </p>
                  <ul>
                    <For each={breakdown.top_feature_contributions}>{(feature) => (
                      <li data-map-feature={feature.feature_id}>
                        {feature.feature_id} ({feature.family}): contributes {feature.contribution}
                      </li>
                    )}</For>
                  </ul>
                </div>
              )}</For>
            </div>
          )}
        </Show>

        <details
          class="strategic-map-list"
          open={listOpen() || strategicFitPrintExportMode()}
          onToggle={(event) => setListOpen(event.currentTarget.open)}
        >
          <summary>Branch list ({visiblePoints().length})</summary>
          <Show when={!listWindow().complete}>
            <p class="strategic-map-note" data-map-list-window>
              Showing the first {listWindow().shown} of {listWindow().total} branches.
              <button
                type="button"
                onClick={() => setListExpanded(true)}
                data-map-show-all-rows
              >
                Show all {listWindow().total}
              </button>
            </p>
          </Show>
          <table
            data-map-list
            data-map-rows-shown={listWindow().shown}
            data-map-rows-total={listWindow().total}
          >
            <thead>
              <tr>
                <th scope="col">Branch</th>
                <th scope="col">Cohort</th>
                <th scope="col">Weight</th>
                <th scope="col">Findings</th>
                <th scope="col">Position</th>
              </tr>
            </thead>
            <tbody>
              <For each={listWindow().items}>{(view) => (
                <tr
                  data-map-row={view.point.route_id}
                  data-selected={selected()?.point.route_id === view.point.route_id ? "true" : "false"}
                >
                  <td>
                    <button
                      type="button"
                      onClick={() => selectPoint(view.point.route_id)}
                      aria-pressed={selected()?.point.route_id === view.point.route_id}
                    >
                      {view.label}
                    </button>
                  </td>
                  <td>{view.cohort_name}</td>
                  <td>{view.point.normalized_weight}</td>
                  <td>{STRATEGIC_MAP_RESOLUTION_LABELS[view.point.resolution]}</td>
                  <td>{view.point.x}, {view.point.y}</td>
                </tr>
              )}</For>
            </tbody>
          </table>
        </details>

        <Show when={model().projection.exclusions.length > 0}>
          <details class="strategic-map-exclusions" open={strategicFitPrintExportMode() || undefined}>
            <summary>Branches without a map position ({model().projection.exclusions.length})</summary>
            <ul>
              <For each={model().projection.exclusions}>{(exclusion) => (
                <li data-map-exclusion={exclusion.route_id}>
                  <code>{shortRouteId(exclusion.route_id)}</code> — {exclusion.explanation}
                </li>
              )}</For>
            </ul>
          </details>
        </Show>
      </Show>
    </section>
  );
}
