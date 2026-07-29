import { For } from "solid-js";
import type { CandidateComparisonRow } from "./CandidateTable";

export interface ReplacementParetoPoint {
  readonly candidate_id: string;
  readonly san: string;
  readonly status: CandidateComparisonRow["pareto_status"];
  readonly familiarity: number | null;
  readonly coverage: number | null;
  readonly memory_burden: number | null;
  readonly objective_loss_cp: number | null;
  readonly memory: string;
  readonly objective: string;
  readonly available: boolean;
  readonly accessible_label: string;
  readonly coincident_index: number;
  readonly coincident_count: number;
}

function normalized(row: CandidateComparisonRow, axisId: string): number | null {
  const axis = row.axes.find((item) => item.axis === axisId);
  return axis?.state === "available" && axis.normalized_score !== null ? axis.normalized_score : null;
}

export function buildReplacementParetoPoints(
  rows: readonly CandidateComparisonRow[],
): readonly ReplacementParetoPoint[] {
  const points = rows.map((row) => {
    const familiarity = normalized(row, "strategic-familiarity");
    const coverage = normalized(row, "expected-coverage");
    const memoryAxis = row.axes.find((item) => item.axis === "memorization-burden")!;
    const memoryBurden = memoryAxis.state === "available" && memoryAxis.normalized_score !== null
      ? 1 - memoryAxis.normalized_score
      : null;
    const objectiveLoss = row.candidate.objective_quality.repertoire_pov_loss_from_best_cp;
    const memory = row.axes.find((item) => item.axis === "memorization-burden")!.value;
    const available = familiarity !== null && coverage !== null && memoryBurden !== null && objectiveLoss !== null;
    return {
      candidate_id: row.candidate_id,
      san: row.san,
      status: row.pareto_status,
      familiarity,
      coverage,
      memory_burden: memoryBurden,
      objective_loss_cp: objectiveLoss,
      memory,
      objective: `${row.repertoire_pov_evaluation}; loss ${row.loss_from_best}`,
      available,
      accessible_label: `${row.san}, ${row.pareto_status}; repertoire evaluation ${row.repertoire_pov_evaluation}, loss ${row.loss_from_best}; familiarity ${row.axes.find((item) => item.axis === "strategic-familiarity")!.value}; memory burden ${memory}; coverage ${row.axes.find((item) => item.axis === "expected-coverage")!.value}`,
      coincident_index: 0,
      coincident_count: 1,
    };
  });
  const key = (point: ReplacementParetoPoint) => point.available
    ? `${point.objective_loss_cp}\u001f${point.familiarity}`
    : `unavailable\u001f${point.candidate_id}`;
  const counts = new Map<string, number>();
  for (const point of points) counts.set(key(point), (counts.get(key(point)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return points.map((point) => {
    const pointKey = key(point);
    const coincidentIndex = seen.get(pointKey) ?? 0;
    const coincidentCount = counts.get(pointKey) ?? 1;
    seen.set(pointKey, coincidentIndex + 1);
    return {
      ...point,
      coincident_index: coincidentIndex,
      coincident_count: coincidentCount,
      accessible_label: coincidentCount > 1
        ? `${point.accessible_label}; exact coordinate tie ${coincidentIndex + 1} of ${coincidentCount}`
        : point.accessible_label,
    };
  });
}

function x(point: ReplacementParetoPoint, index: number): number {
  return point.objective_loss_cp === null
    ? 34 + index * 14
    : 38 + Math.min(300, Math.max(0, point.objective_loss_cp)) / 300 * 294;
}

function y(point: ReplacementParetoPoint): number {
  return point.familiarity === null ? 190 : 174 - point.familiarity * 142;
}

function radius(point: ReplacementParetoPoint): number {
  return point.coverage === null ? 9 : 8 + point.coverage * 5;
}

function memoryRadius(point: ReplacementParetoPoint): number {
  return point.memory_burden === null
    ? 0
    : 2 + Math.min(1, Math.max(0, point.memory_burden)) * 4;
}

export interface ReplacementParetoPosition {
  readonly anchor_x: number;
  readonly anchor_y: number;
  readonly display_x: number;
  readonly display_y: number;
}

export function replacementParetoPosition(
  point: ReplacementParetoPoint,
  index: number,
): ReplacementParetoPosition {
  const anchorX = x(point, index);
  const anchorY = y(point);
  if (point.coincident_count <= 1) {
    return { anchor_x: anchorX, anchor_y: anchorY, display_x: anchorX, display_y: anchorY };
  }
  const angle = -Math.PI / 2 + point.coincident_index * Math.PI * 2 / point.coincident_count;
  return {
    anchor_x: anchorX,
    anchor_y: anchorY,
    display_x: anchorX + Math.cos(angle) * 16,
    display_y: anchorY + Math.sin(angle) * 16,
  };
}

function symbol(status: ReplacementParetoPoint["status"]): string {
  return status === "pareto-optimal" ? "◇" : status === "dominated" ? "□" : "×";
}

export interface ReplacementParetoProps {
  readonly rows: readonly CandidateComparisonRow[];
  readonly selectedCandidateId: string | null;
  readonly onSelect: (candidateId: string) => void;
}

export default function ReplacementPareto(props: ReplacementParetoProps) {
  const points = () => buildReplacementParetoPoints(props.rows);
  const activate = (event: KeyboardEvent, candidateId: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    props.onSelect(candidateId);
  };
  return (
    <section class="replacement-pareto" aria-labelledby="replacement-pareto-title">
      <header>
        <h4 id="replacement-pareto-title">Canonical Pareto comparison</h4>
        <p>
          Horizontal position shows repertoire-POV loss from engine best; vertical position shows canonical familiarity.
          Point size shows coverage and inner ring shows memory burden. Symbols: ◇ Pareto tradeoff, □ dominated,
          × unscored. Frontier status comes directly from Phase 8; no aggregate best is calculated or implied.
        </p>
      </header>
      <svg
        class="replacement-pareto-plot"
        viewBox="0 0 360 215"
        role="group"
        aria-labelledby="replacement-pareto-title replacement-pareto-description"
      >
        <desc id="replacement-pareto-description">
          Candidate tradeoff chart with keyboard-selectable points. Candidate table below is complete accessible equivalent.
        </desc>
        <line x1="38" y1="174" x2="334" y2="174" />
        <line x1="38" y1="174" x2="38" y2="28" />
        <text x="185" y="210" text-anchor="middle">Repertoire loss from engine best (0–300+ cp)</text>
        <text x="12" y="104" text-anchor="middle" transform="rotate(-90 12 104)">Strategic familiarity</text>
        <text x="40" y="190">Unavailable coordinates</text>
        <For each={points()}>{(point, index) => {
          const position = () => replacementParetoPosition(point, index());
          return (
            <g
              class="replacement-pareto-point"
              role="button"
              tabIndex={0}
              aria-label={point.accessible_label}
              aria-pressed={props.selectedCandidateId === point.candidate_id}
              data-candidate-id={point.candidate_id}
              data-pareto-status={point.status}
              data-coordinate-state={point.available ? "available" : "unavailable"}
              data-selected={props.selectedCandidateId === point.candidate_id ? "true" : "false"}
              transform={`translate(${position().display_x} ${position().display_y})`}
              onClick={() => props.onSelect(point.candidate_id)}
              onKeyDown={(event) => activate(event, point.candidate_id)}
            >
              <line
                class="replacement-pareto-tie-anchor"
                x1={position().anchor_x - position().display_x}
                y1={position().anchor_y - position().display_y}
                x2="0"
                y2="0"
              />
              <circle class="replacement-pareto-coverage" r={radius(point)} />
              <circle class="replacement-pareto-memory" r={memoryRadius(point)} />
              <text text-anchor="middle" dominant-baseline="central">{symbol(point.status)}</text>
              <text class="replacement-pareto-point-label" x="15" y="-10">{point.san}</text>
            </g>
          );
        }}</For>
      </svg>
      <ul class="replacement-pareto-mobile" aria-label="Pareto chart mobile fallback">
        <For each={points()}>{(point) => (
          <li data-pareto-status={point.status}>
            <button
              type="button"
              aria-pressed={props.selectedCandidateId === point.candidate_id}
              onClick={() => props.onSelect(point.candidate_id)}
            >
              <strong>{symbol(point.status)} {point.san}</strong>
              <span>{point.status}; {point.objective}; memory {point.memory}</span>
            </button>
          </li>
        )}</For>
      </ul>
    </section>
  );
}
