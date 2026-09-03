import { For, Show, createMemo, createSignal } from "solid-js";
import {
  buildConceptHeatmapProjection,
  type ConceptHeatmapCell,
  type ConceptHeatmapColumn,
  type ConceptHeatmapIntentState,
  type ConceptHeatmapMasteryState,
  type ConceptHeatmapProjection,
  type StrategicFinding,
  type StrategicFitAnalysisResult,
  type StrategicFitTrainingMasteryReport,
} from "@chess-mcp/chess-tools";
import { strategicFitPrintExportMode } from "../../store/ui";
import { VISUALIZATION_RENDER_LIMITS, boundedWindow } from "./visualization-limits";
import {
  VIRTUAL_TABLE_COLUMN_WIDTH,
  VIRTUAL_TABLE_ROW_HEIGHT,
  createVirtualRows,
} from "./virtual-rows";

export type ConceptHeatmapReport = Pick<
  StrategicFitAnalysisResult,
  | "report_id"
  | "repertoire_revision"
  | "analysis_version"
  | "profile"
  | "trajectories"
  | "cohorts"
  | "findings"
>;

export const CONCEPT_HEATMAP_MASTERY_LABELS: Readonly<Record<ConceptHeatmapMasteryState, string>> =
  {
    observed: "Observed",
    stale: "Stale",
    untrained: "Untrained",
    unavailable: "No training data",
  };

export const CONCEPT_HEATMAP_INTENT_LABELS: Readonly<Record<ConceptHeatmapIntentState, string>> = {
  preferred: "Preferred",
  avoided: "Avoided",
  "not-declared": "Not declared",
};

export const CONCEPT_HEATMAP_SORT_MODES = ["concept", "frequency", "mastery"] as const;
export type ConceptHeatmapSortMode = (typeof CONCEPT_HEATMAP_SORT_MODES)[number];

interface ConceptHeatmapViewCell {
  readonly cell: ConceptHeatmapCell;
  /** Cell shading strength 0-1; the visible percentage text carries the same value. */
  readonly intensity: number;
  readonly frequency_percent: number;
  readonly confidence_percent: number;
  readonly aria_label: string;
}

export interface ConceptHeatmapViewColumn {
  readonly column: ConceptHeatmapColumn;
  readonly mastery_text: string;
  readonly intent_text: string;
  readonly header_label: string;
}

export interface ConceptHeatmapViewModel {
  readonly projection: ConceptHeatmapProjection;
  readonly columns: readonly ConceptHeatmapViewColumn[];
  readonly cells: ReadonlyMap<string, ConceptHeatmapViewCell>;
  readonly cohort_names: ReadonlyMap<string, string>;
  readonly screen_reader_summary: string;
}

function percent(value: number): number {
  return Math.round(value * 100);
}

function shortRouteId(routeId: string): string {
  const separator = routeId.indexOf(":");
  const hash = separator === -1 ? routeId : routeId.slice(separator + 1);
  return hash.slice(0, 8);
}

export function conceptHeatmapCellKey(cohortId: string, conceptId: string): string {
  return `${cohortId}|${conceptId}`;
}

function masteryText(column: ConceptHeatmapColumn): string {
  if (column.mastery.value === null) return CONCEPT_HEATMAP_MASTERY_LABELS[column.mastery.state];
  const label =
    column.mastery.state === "observed"
      ? `${percent(column.mastery.value)}%`
      : `${percent(column.mastery.value)}% (${CONCEPT_HEATMAP_MASTERY_LABELS[column.mastery.state]})`;
  return label;
}

/** Deterministic column order for the requested sort; ties fall back to the concept identity. */
export function sortConceptHeatmapColumns(
  columns: readonly ConceptHeatmapViewColumn[],
  mode: ConceptHeatmapSortMode,
): readonly ConceptHeatmapViewColumn[] {
  const byConcept = (left: ConceptHeatmapViewColumn, right: ConceptHeatmapViewColumn) =>
    left.column.concept_id < right.column.concept_id
      ? -1
      : left.column.concept_id > right.column.concept_id
        ? 1
        : 0;
  const sorted = [...columns];
  if (mode === "frequency") {
    sorted.sort(
      (left, right) =>
        right.column.max_expected_frequency - left.column.max_expected_frequency ||
        byConcept(left, right),
    );
  } else if (mode === "mastery") {
    sorted.sort(
      (left, right) =>
        (right.column.mastery.value ?? -1) - (left.column.mastery.value ?? -1) ||
        byConcept(left, right),
    );
  } else {
    sorted.sort(byConcept);
  }
  return sorted;
}

export function buildConceptHeatmapViewModel(
  report: ConceptHeatmapReport,
  options: {
    readonly cohortName?: (cohortId: string) => string;
    readonly findings?: readonly StrategicFinding[];
    readonly mastery?: StrategicFitTrainingMasteryReport | null;
  } = {},
): ConceptHeatmapViewModel {
  const projection = buildConceptHeatmapProjection(report, {
    findings: options.findings,
    mastery: options.mastery,
  });
  const cohortName = options.cohortName ?? ((cohortId: string) => cohortId);
  const cohortNames = new Map(
    projection.rows.map((row) => [row.cohort_id, cohortName(row.cohort_id)]),
  );
  const columns: ConceptHeatmapViewColumn[] = projection.columns.map((column) => ({
    column,
    mastery_text: masteryText(column),
    intent_text: CONCEPT_HEATMAP_INTENT_LABELS[column.intent],
    header_label: `${column.label}. Mastery ${masteryText(column)}. Intent ${CONCEPT_HEATMAP_INTENT_LABELS[column.intent]}.`,
  }));
  const columnsById = new Map(columns.map((view) => [view.column.concept_id, view]));
  const cells = new Map(
    projection.cells.map((cell) => {
      const column = columnsById.get(cell.concept_id);
      if (!column) throw new Error(`Missing concept heatmap column ${cell.concept_id}`);
      const name = cohortNames.get(cell.cohort_id) ?? cell.cohort_id;
      const findingNote =
        cell.finding_ids.length === 0
          ? "No findings"
          : `${cell.finding_ids.length} ${cell.finding_ids.length === 1 ? "finding" : "findings"}`;
      return [
        conceptHeatmapCellKey(cell.cohort_id, cell.concept_id),
        {
          cell,
          intensity: cell.expected_frequency,
          frequency_percent: percent(cell.expected_frequency),
          confidence_percent: percent(cell.confidence),
          aria_label:
            `${column.column.label} in ${name}: expected in ${percent(cell.expected_frequency)}% of cohort games,` +
            ` classifier confidence ${percent(cell.confidence)}%, mastery ${column.mastery_text},` +
            ` intent ${column.intent_text}. ${findingNote}.`,
        } satisfies ConceptHeatmapViewCell,
      ];
    }),
  );
  const untrainedCount = projection.columns.filter(
    (column) => column.mastery.value === null,
  ).length;
  const summary =
    projection.state === "unavailable"
      ? `Concept heatmap unavailable. ${projection.reason ?? ""}`.trim()
      : `Concept heatmap with ${projection.rows.length} ${projection.rows.length === 1 ? "cohort" : "cohorts"}` +
        ` and ${projection.columns.length} ${projection.columns.length === 1 ? "concept" : "concepts"}.` +
        ` ${untrainedCount} ${untrainedCount === 1 ? "concept has" : "concepts have"} no observed mastery.` +
        ` ${projection.exclusions.length} ${projection.exclusions.length === 1 ? "branch is" : "branches are"} excluded.`;
  return {
    projection,
    columns,
    cells,
    cohort_names: cohortNames,
    screen_reader_summary: summary,
  };
}

export default function ConceptHeatmap(props: {
  report: ConceptHeatmapReport;
  cohortName: (cohortId: string) => string;
  completeFindings?: readonly StrategicFinding[];
  mastery?: StrategicFitTrainingMasteryReport | null;
  onOpenFinding: (findingId: string) => void;
}) {
  const [sortMode, setSortMode] = createSignal<ConceptHeatmapSortMode>("concept");
  const [selectedKey, setSelectedKey] = createSignal<string | null>(null);
  const [gridExpanded, setGridExpanded] = createSignal(false);

  const model = createMemo(() =>
    buildConceptHeatmapViewModel(props.report, {
      cohortName: props.cohortName,
      findings: props.completeFindings,
      mastery: props.mastery ?? null,
    }),
  );
  const allColumns = createMemo(() => sortConceptHeatmapColumns(model().columns, sortMode()));
  /**
   * The grid is cohorts times concepts, so both axes are capped. The cap follows the active sort,
   * which keeps the shown cells the ones the current sort says matter most, and the withheld
   * concepts are named rather than merely counted.
   */
  const expanded = createMemo(() => gridExpanded() || strategicFitPrintExportMode());
  const columnWindow = createMemo(() =>
    boundedWindow(allColumns(), VISUALIZATION_RENDER_LIMITS.heatmap_columns, expanded()),
  );
  const rowWindow = createMemo(() =>
    boundedWindow(model().projection.rows, VISUALIZATION_RENDER_LIMITS.heatmap_rows, expanded()),
  );
  /**
   * Task 12.3 — the grid keeps both Task 10.4 windows and their disclosure, and mounts them through
   * one bounded scrolling viewport. Rows and columns are windowed separately, so mounted cells stay
   * bounded by their product rather than by the concept or cohort count. Print and export render the
   * complete grid, which is what a printed page needs and what its own scrollless layout allows.
   */
  const gridRows = createVirtualRows({
    items: () => rowWindow().items,
    rowSize: VIRTUAL_TABLE_ROW_HEIGHT,
    maximumMounted: VISUALIZATION_RENDER_LIMITS.virtual_grid_rows,
    enabled: () => !strategicFitPrintExportMode(),
  });
  const gridColumns = createVirtualRows({
    items: () => columnWindow().items,
    rowSize: VIRTUAL_TABLE_COLUMN_WIDTH,
    axis: "horizontal",
    maximumMounted: VISUALIZATION_RENDER_LIMITS.virtual_columns,
    enabled: () => !strategicFitPrintExportMode(),
  });
  const sortedColumns = createMemo(() => gridColumns.window().items);
  const withheldColumns = createMemo(() => allColumns().slice(columnWindow().shown));
  const withheldRows = createVirtualRows({
    items: withheldColumns,
    rowSize: VIRTUAL_TABLE_ROW_HEIGHT,
    enabled: () => !strategicFitPrintExportMode(),
  });
  const selected = createMemo(() => {
    const key = selectedKey();
    if (key === null) return null;
    const view = model().cells.get(key);
    if (view === undefined) return null;
    const column = model().columns.find(
      (candidate) => candidate.column.concept_id === view.cell.concept_id,
    );
    if (!column) return null;
    return {
      view,
      column,
      cohort_name: model().cohort_names.get(view.cell.cohort_id) ?? view.cell.cohort_id,
    };
  });
  const selectCell = (key: string) => {
    setSelectedKey((current) => (current === key ? null : key));
  };

  return (
    <section
      class="concept-heatmap"
      aria-label="Concept heatmap"
      data-heatmap-state={model().projection.state}
      data-heatmap-projection-version={model().projection.projection_version}
      data-heatmap-report={model().projection.report_id}
      data-heatmap-concept-count={model().projection.columns.length}
      data-heatmap-cohort-count={model().projection.rows.length}
      data-heatmap-columns-shown={columnWindow().shown}
      data-heatmap-rows-shown={rowWindow().shown}
      data-heatmap-complete={columnWindow().complete && rowWindow().complete ? "true" : "false"}
      data-heatmap-print-export={strategicFitPrintExportMode() ? "true" : "false"}
    >
      <h3 class="concept-heatmap-title">Concept heatmap</h3>
      <p class="sr-only" data-heatmap-screen-reader-summary>
        {model().screen_reader_summary}
      </p>

      <Show
        when={model().projection.state !== "unavailable"}
        fallback={
          <div class="concept-heatmap-unavailable" data-heatmap-unavailable>
            {/*
              The section's own <h3> above already says "Concept heatmap"; restating the name here
              made the empty state two stacked headings — "Concept heatmap" over "Concept heatmap
              unavailable" — where the second line carried one new word. State the condition.
            */}
            <strong>Not available for this report</strong>
            <p>{model().projection.reason}</p>
            <Show when={model().projection.exclusions.length > 0}>
              <details>
                <summary>
                  Why branches are excluded ({model().projection.exclusions.length})
                </summary>
                <ul>
                  <For each={model().projection.exclusions}>
                    {(exclusion) => (
                      <li data-heatmap-exclusion={exclusion.route_id}>
                        <code>{shortRouteId(exclusion.route_id)}</code> — {exclusion.explanation}
                      </li>
                    )}
                  </For>
                </ul>
              </details>
            </Show>
          </div>
        }
      >
        <div class="concept-heatmap-controls">
          <label>
            Sort concepts by
            <select
              value={sortMode()}
              onChange={(event) => setSortMode(event.currentTarget.value as ConceptHeatmapSortMode)}
              data-heatmap-sort
            >
              <option value="concept">Concept name</option>
              <option value="frequency">Expected frequency</option>
              <option value="mastery">Mastery</option>
            </select>
          </label>
          <p class="concept-heatmap-legend">
            Cell shading and its percentage show how often the concept is expected inside the
            cohort. Mastery and intent are written in each concept header; untrained or unavailable
            mastery is shown as text, never as zero.
          </p>
        </div>

        <Show when={!columnWindow().complete || !rowWindow().complete}>
          <p class="concept-heatmap-note" data-heatmap-window>
            Showing {columnWindow().shown} of {columnWindow().total} concepts and{" "}
            {rowWindow().shown} of {rowWindow().total} cohorts, ordered by the sort above.
            <button type="button" onClick={() => setGridExpanded(true)} data-heatmap-show-all>
              Show the complete grid
            </button>
          </p>
          <details
            class="concept-heatmap-withheld"
            open={strategicFitPrintExportMode() || undefined}
          >
            <summary>Concepts not shown ({columnWindow().withheld})</summary>
            <div
              class="strategic-fit-virtual-scroll"
              data-virtualized={withheldRows.window().complete ? "false" : "true"}
              ref={withheldRows.attach}
            >
              <ul
                aria-label={`Concepts not shown (${withheldRows.window().total})`}
                data-heatmap-withheld-mounted={withheldRows.window().mounted}
                style={{
                  "padding-top": `${withheldRows.window().lead}px`,
                  "padding-bottom": `${withheldRows.window().trail}px`,
                }}
              >
                <For each={withheldRows.window().items}>
                  {(view, index) => (
                    <li
                      data-heatmap-withheld-concept={view.column.concept_id}
                      aria-setsize={withheldRows.window().total}
                      aria-posinset={withheldRows.window().start + index() + 1}
                    >
                      {view.column.label} — mastery {view.mastery_text}
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </details>
        </Show>

        <div
          class="concept-heatmap-scroll strategic-fit-virtual-scroll"
          data-virtualized={
            gridRows.window().complete && gridColumns.window().complete ? "false" : "true"
          }
          tabindex="0"
          role="group"
          aria-label="Concept heatmap table"
          ref={(element) => {
            gridRows.attach(element);
            gridColumns.attach(element);
          }}
        >
          <table
            class="concept-heatmap-table"
            data-heatmap-table
            data-heatmap-rows-mounted={gridRows.window().mounted}
            data-heatmap-columns-mounted={gridColumns.window().mounted}
            aria-rowcount={rowWindow().total}
            aria-colcount={columnWindow().total}
          >
            <thead>
              <tr>
                <th scope="col">Cohort</th>
                <Show when={gridColumns.window().lead > 0}>
                  <th
                    scope="col"
                    aria-hidden="true"
                    style={{ width: `${gridColumns.window().lead}px` }}
                  />
                </Show>
                <For each={sortedColumns()}>
                  {(view) => (
                    <th
                      scope="col"
                      data-heatmap-column={view.column.concept_id}
                      data-heatmap-mastery-state={view.column.mastery.state}
                      data-heatmap-intent={view.column.intent}
                    >
                      <span class="concept-heatmap-concept-label">{view.column.label}</span>
                      <span class="concept-heatmap-column-meta">
                        <span data-heatmap-mastery>{view.mastery_text}</span>
                        <Show when={view.column.intent !== "not-declared"}>
                          <span class="concept-heatmap-intent" data-heatmap-intent-label>
                            {view.intent_text}
                          </span>
                        </Show>
                      </span>
                    </th>
                  )}
                </For>
                <Show when={gridColumns.window().trail > 0}>
                  <th
                    scope="col"
                    aria-hidden="true"
                    style={{ width: `${gridColumns.window().trail}px` }}
                  />
                </Show>
              </tr>
            </thead>
            <tbody>
              <Show when={gridRows.window().lead > 0}>
                <tr class="strategic-fit-virtual-spacer" aria-hidden="true">
                  <td style={{ height: `${gridRows.window().lead}px` }} />
                </tr>
              </Show>
              <For each={gridRows.window().items}>
                {(row, rowIndex) => (
                  <tr
                    data-heatmap-row={row.cohort_id}
                    aria-rowindex={gridRows.window().start + rowIndex() + 1}
                  >
                    <th scope="row">
                      {model().cohort_names.get(row.cohort_id)}
                      <span class="concept-heatmap-route-count">
                        {row.route_count} {row.route_count === 1 ? "branch" : "branches"}
                      </span>
                    </th>
                    <Show when={gridColumns.window().lead > 0}>
                      <td aria-hidden="true" />
                    </Show>
                    <For each={sortedColumns()}>
                      {(columnView) => {
                        const key = conceptHeatmapCellKey(
                          row.cohort_id,
                          columnView.column.concept_id,
                        );
                        const cellView = () => model().cells.get(key);
                        return (
                          <td>
                            <Show
                              when={cellView()}
                              fallback={
                                <span class="concept-heatmap-empty-cell" data-heatmap-absent={key}>
                                  <span aria-hidden="true">—</span>
                                  <span class="sr-only">
                                    {columnView.column.label} not observed in this cohort.
                                  </span>
                                </span>
                              }
                            >
                              {(view) => (
                                <button
                                  type="button"
                                  class="concept-heatmap-cell"
                                  classList={{
                                    "concept-heatmap-cell-selected": selectedKey() === key,
                                  }}
                                  style={{ "--heatmap-alpha": `${0.08 + 0.62 * view().intensity}` }}
                                  aria-label={view().aria_label}
                                  aria-pressed={selectedKey() === key}
                                  data-heatmap-cell={key}
                                  data-heatmap-cell-findings={view().cell.finding_ids.length}
                                  onClick={() => {
                                    selectCell(key);
                                  }}
                                >
                                  {view().frequency_percent}%
                                </button>
                              )}
                            </Show>
                          </td>
                        );
                      }}
                    </For>
                    <Show when={gridColumns.window().trail > 0}>
                      <td aria-hidden="true" />
                    </Show>
                  </tr>
                )}
              </For>
              <Show when={gridRows.window().trail > 0}>
                <tr class="strategic-fit-virtual-spacer" aria-hidden="true">
                  <td style={{ height: `${gridRows.window().trail}px` }} />
                </tr>
              </Show>
            </tbody>
          </table>
        </div>

        <Show when={selected()}>
          {(selection) => (
            <div
              class="concept-heatmap-detail"
              data-heatmap-detail={conceptHeatmapCellKey(
                selection().view.cell.cohort_id,
                selection().view.cell.concept_id,
              )}
            >
              <h4>
                {selection().column.column.label} in {selection().cohort_name}
              </h4>
              <dl>
                <div>
                  <dt>Expected frequency</dt>
                  <dd>{selection().view.frequency_percent}% of cohort games</dd>
                </div>
                <div>
                  <dt>Classifier confidence</dt>
                  <dd>{selection().view.confidence_percent}%</dd>
                </div>
                <div>
                  <dt>Mastery</dt>
                  <dd data-heatmap-detail-mastery>{selection().column.mastery_text}</dd>
                </div>
                <div>
                  <dt>Intent</dt>
                  <dd>{selection().column.intent_text}</dd>
                </div>
                <div>
                  <dt>Supporting branches</dt>
                  <dd>
                    <For each={selection().view.cell.route_ids}>
                      {(routeId) => (
                        <code data-heatmap-detail-route={routeId}>{shortRouteId(routeId)}</code>
                      )}
                    </For>
                  </dd>
                </div>
              </dl>
              <Show
                when={selection().view.cell.finding_ids.length > 0}
                fallback={
                  <p data-heatmap-detail-no-findings>No findings reference these branches.</p>
                }
              >
                <div class="concept-heatmap-detail-findings">
                  <For each={selection().view.cell.finding_ids}>
                    {(findingId) => (
                      <button
                        type="button"
                        onClick={() => {
                          props.onOpenFinding(findingId);
                        }}
                        data-heatmap-open-finding={findingId}
                      >
                        Open finding {findingId.slice(-8)}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </Show>

        <Show when={model().projection.exclusions.length > 0}>
          <details
            class="concept-heatmap-exclusions"
            open={strategicFitPrintExportMode() || undefined}
          >
            <summary>
              Branches without heatmap cells ({model().projection.exclusions.length})
            </summary>
            <ul>
              <For each={model().projection.exclusions}>
                {(exclusion) => (
                  <li data-heatmap-exclusion={exclusion.route_id}>
                    <code>{shortRouteId(exclusion.route_id)}</code> — {exclusion.explanation}
                  </li>
                )}
              </For>
            </ul>
          </details>
        </Show>
      </Show>
    </section>
  );
}
