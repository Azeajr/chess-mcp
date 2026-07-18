import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js";
import {
  type Color,
  type StrategicCheckpointKind,
  type StrategicFinding,
  type StrategicSnapshot,
  type StrategicTrajectory,
} from "@chess-mcp/chess-tools";
import ReadOnlyBoard from "./ReadOnlyBoard";

const CHECKPOINT_LABELS: Readonly<Record<StrategicCheckpointKind, string>> = {
  "opening-exit": "Opening exit",
  "central-resolution": "Center resolution",
  "irreversible-transformation": "Irreversible transformation",
  "configured-ply": "Configured checkpoint",
  "final-valid-position": "Final repertoire position",
};

const CHECKPOINT_ORDER: Readonly<Record<StrategicCheckpointKind, number>> = {
  "opening-exit": 0,
  "central-resolution": 1,
  "irreversible-transformation": 2,
  "configured-ply": 3,
  "final-valid-position": 4,
};

const TRAJECTORY_STATE_LABELS: Readonly<Record<StrategicTrajectory["state"], string>> = {
  complete: "Complete trajectory",
  incomplete: "Incomplete trajectory",
  unsupported: "Unsupported trajectory",
  terminal: "Terminal trajectory",
};

const COMPARABILITY_LABELS: Readonly<Record<StrategicSnapshot["checkpoint"]["comparability"], string>> = {
  comparable: "Comparable",
  incomplete: "Incomplete",
  "not-comparable": "Not comparable",
};

export type ComparisonMilestoneState =
  | "matched"
  | "mismatched"
  | "incomplete"
  | "not-comparable"
  | "unavailable";

export interface ComparisonRoutePresentation {
  readonly route_id: string;
  readonly label: string;
  readonly state: StrategicTrajectory["state"] | "unavailable";
  readonly state_label: string;
  readonly trajectory: StrategicTrajectory | null;
}

export interface ComparisonSourcePathPresentation {
  readonly index: number;
  readonly label: string;
  readonly path: readonly string[];
}

export interface ComparisonMilestonePresentation {
  readonly key: string;
  readonly kind: StrategicCheckpointKind | null;
  readonly label: string;
  readonly state: ComparisonMilestoneState;
  readonly status_label: string;
  readonly explanation: string;
  readonly affected_snapshot: StrategicSnapshot | null;
  readonly baseline_snapshot: StrategicSnapshot | null;
}

export interface ComparisonBoardsPresentation {
  readonly orientation: Color;
  readonly affected_routes: readonly ComparisonRoutePresentation[];
  readonly baseline_routes: readonly ComparisonRoutePresentation[];
  readonly source_paths: readonly ComparisonSourcePathPresentation[];
  readonly affected_route: ComparisonRoutePresentation | null;
  readonly baseline_route: ComparisonRoutePresentation | null;
  readonly milestones: readonly ComparisonMilestonePresentation[];
  readonly preferred_milestone_key: string | null;
}

export interface ComparisonFindingInput {
  readonly finding_id: string;
  readonly references: Pick<StrategicFinding["references"], "route_ids" | "source_san_paths">;
  readonly evidence: Pick<StrategicFinding["evidence"], "representative_route_ids">;
}

function checkpointKey(snapshot: StrategicSnapshot): string {
  return snapshot.checkpoint.kind === "configured-ply"
    ? `${snapshot.checkpoint.kind}:${snapshot.checkpoint.ply}`
    : snapshot.checkpoint.kind;
}

function kindFromKey(key: string): StrategicCheckpointKind | null {
  const kind = key.split(":", 1)[0] as StrategicCheckpointKind;
  return kind in CHECKPOINT_LABELS ? kind : null;
}

function milestoneLabel(key: string, snapshot: StrategicSnapshot | null): string {
  const kind = kindFromKey(key);
  if (kind === null) return "Unavailable milestone";
  if (kind !== "configured-ply") return CHECKPOINT_LABELS[kind];
  const ply = snapshot?.checkpoint.ply ?? Number(key.split(":")[1]);
  return Number.isFinite(ply) ? `${CHECKPOINT_LABELS[kind]} at ply ${ply}` : CHECKPOINT_LABELS[kind];
}

function compareMilestoneKeys(left: string, right: string): number {
  const leftKind = kindFromKey(left);
  const rightKind = kindFromKey(right);
  if (leftKind === null || rightKind === null) return left.localeCompare(right);
  return CHECKPOINT_ORDER[leftKind] - CHECKPOINT_ORDER[rightKind] ||
    (Number(left.split(":")[1]) || 0) - (Number(right.split(":")[1]) || 0) ||
    left.localeCompare(right);
}

function routePresentations(
  ids: readonly string[],
  trajectories: ReadonlyMap<string, StrategicTrajectory>,
  role: "Affected" | "Typical",
): ComparisonRoutePresentation[] {
  return [...new Set(ids)].map((routeId, index) => {
    const trajectory = trajectories.get(routeId) ?? null;
    return {
      route_id: routeId,
      label: `${role} route ${index + 1}`,
      state: trajectory?.state ?? "unavailable",
      state_label: trajectory ? TRAJECTORY_STATE_LABELS[trajectory.state] : "Trajectory unavailable",
      trajectory,
    };
  });
}

function missingReason(trajectory: StrategicTrajectory | null, kind: StrategicCheckpointKind): string | null {
  return trajectory?.missing_checkpoints.find((checkpoint) => checkpoint.kind === kind)?.reason ?? null;
}

function buildMilestones(
  affected: StrategicTrajectory | null,
  baseline: StrategicTrajectory | null,
): ComparisonMilestonePresentation[] {
  if (affected === null && baseline === null) {
    return [{
      key: "unavailable",
      kind: null,
      label: "Comparison milestone unavailable",
      state: "unavailable",
      status_label: "Comparison unavailable",
      explanation: "Neither selected route has a trajectory in the current report.",
      affected_snapshot: null,
      baseline_snapshot: null,
    }];
  }
  const affectedSnapshots = new Map(
    (affected?.snapshots ?? []).map((snapshot) => [checkpointKey(snapshot), snapshot]),
  );
  const baselineSnapshots = new Map(
    (baseline?.snapshots ?? []).map((snapshot) => [checkpointKey(snapshot), snapshot]),
  );
  const keys = new Set([...affectedSnapshots.keys(), ...baselineSnapshots.keys()]);
  const missingKinds = [...(affected?.missing_checkpoints ?? []), ...(baseline?.missing_checkpoints ?? [])]
    .map((checkpoint) => checkpoint.kind);
  for (const kind of missingKinds) {
    if (kind === "configured-ply") {
      if (![...keys].some((key) => key.startsWith("configured-ply:"))) {
        keys.add("configured-ply:missing");
      }
    } else {
      keys.add(kind);
    }
  }
  if (keys.size === 0) keys.add("unavailable");

  return [...keys].sort(compareMilestoneKeys).map((key) => {
    const kind = kindFromKey(key);
    const affectedSnapshot = affectedSnapshots.get(key) ?? null;
    const baselineSnapshot = baselineSnapshots.get(key) ?? null;
    const label = milestoneLabel(key, affectedSnapshot ?? baselineSnapshot);
    if (kind === null) {
      return {
        key,
        kind,
        label,
        state: "unavailable",
        status_label: "Comparison unavailable",
        explanation: "No canonical checkpoint is available for the selected route pair.",
        affected_snapshot: affectedSnapshot,
        baseline_snapshot: baselineSnapshot,
      };
    }
    if (affectedSnapshot === null || baselineSnapshot === null) {
      const missingSide = affectedSnapshot === null ? "affected branch" : "typical cohort";
      const reason = affectedSnapshot === null
        ? missingReason(affected, kind)
        : missingReason(baseline, kind);
      const incomplete = reason !== null || affected?.state === "incomplete" || baseline?.state === "incomplete";
      return {
        key,
        kind,
        label,
        state: incomplete ? "incomplete" : "mismatched",
        status_label: incomplete
          ? `Incomplete checkpoint — ${missingSide} is missing`
          : `Checkpoint mismatch — ${missingSide} is missing`,
        explanation: reason ?? `The selected ${missingSide} has no ${label.toLowerCase()} snapshot.`,
        affected_snapshot: affectedSnapshot,
        baseline_snapshot: baselineSnapshot,
      };
    }
    const comparability = [
      affectedSnapshot.checkpoint.comparability,
      baselineSnapshot.checkpoint.comparability,
    ];
    if (comparability.includes("incomplete")) {
      return {
        key,
        kind,
        label,
        state: "incomplete",
        status_label: "Incomplete checkpoint evidence",
        explanation: [affectedSnapshot.checkpoint.reason, baselineSnapshot.checkpoint.reason].join(" "),
        affected_snapshot: affectedSnapshot,
        baseline_snapshot: baselineSnapshot,
      };
    }
    if (comparability.includes("not-comparable")) {
      return {
        key,
        kind,
        label,
        state: "not-comparable",
        status_label: "Checkpoint not comparable",
        explanation: [affectedSnapshot.checkpoint.reason, baselineSnapshot.checkpoint.reason].join(" "),
        affected_snapshot: affectedSnapshot,
        baseline_snapshot: baselineSnapshot,
      };
    }
    return {
      key,
      kind,
      label,
      state: "matched",
      status_label: "Matched strategic milestone",
      explanation: `Typical cohort ply ${baselineSnapshot.checkpoint.ply} is synchronized with affected branch ply ${affectedSnapshot.checkpoint.ply}.`,
      affected_snapshot: affectedSnapshot,
      baseline_snapshot: baselineSnapshot,
    };
  });
}

export function buildComparisonBoardsPresentation(
  finding: ComparisonFindingInput,
  trajectories: readonly StrategicTrajectory[],
  orientation: Color,
  selectedAffectedRouteId?: string | null,
  selectedBaselineRouteId?: string | null,
): ComparisonBoardsPresentation {
  const trajectoriesById = new Map(trajectories.map((trajectory) => [trajectory.route_id, trajectory]));
  const affectedRoutes = routePresentations(
    finding.references.route_ids,
    trajectoriesById,
    "Affected",
  );
  const baselineRoutes = routePresentations(
    finding.evidence.representative_route_ids,
    trajectoriesById,
    "Typical",
  );
  const affectedRoute = affectedRoutes.find((route) => route.route_id === selectedAffectedRouteId) ??
    affectedRoutes[0] ?? null;
  const baselineRoute = baselineRoutes.find((route) => route.route_id === selectedBaselineRouteId) ??
    baselineRoutes[0] ?? null;
  const milestones = buildMilestones(affectedRoute?.trajectory ?? null, baselineRoute?.trajectory ?? null);
  return {
    orientation,
    affected_routes: affectedRoutes,
    baseline_routes: baselineRoutes,
    source_paths: finding.references.source_san_paths.map((path, index) => ({
      index,
      label: path.length === 0 ? `Source line ${index + 1} · Start position` :
        `Source line ${index + 1} · ${path.join(" ")}`,
      path,
    })),
    affected_route: affectedRoute,
    baseline_route: baselineRoute,
    milestones,
    preferred_milestone_key: milestones.find((milestone) => milestone.state === "matched")?.key ??
      milestones[0]?.key ?? null,
  };
}

function BoardCard(props: {
  title: string;
  route: ComparisonRoutePresentation | null;
  snapshot: StrategicSnapshot | null;
  orientation: Color;
  missing: string;
}) {
  return (
    <article
      class="strategic-fit-comparison-board-card"
      data-board-role={props.title === "Typical cohort" ? "baseline" : "affected"}
    >
      <header>
        <strong>{props.title}</strong>
        <span>{props.route?.label ?? "Route unavailable"}</span>
      </header>
      <Show when={props.snapshot} fallback={(
        <div class="strategic-fit-comparison-board-missing" role="status">
          <strong>Board unavailable at this milestone</strong>
          <p>{props.missing}</p>
        </div>
      )}>
        {(snapshot) => (
          <>
            <ReadOnlyBoard
              fen={snapshot().fen}
              orientation={props.orientation}
              label={`${props.title} at ${CHECKPOINT_LABELS[snapshot().checkpoint.kind]}, ply ${snapshot().checkpoint.ply}`}
            />
            <dl>
              <div><dt>Ply</dt><dd>{snapshot().checkpoint.ply}</dd></div>
              <div>
                <dt>Evidence</dt>
                <dd>{COMPARABILITY_LABELS[snapshot().checkpoint.comparability]}</dd>
              </div>
            </dl>
            <p>{snapshot().checkpoint.reason}</p>
          </>
        )}
      </Show>
    </article>
  );
}

export default function ComparisonBoards(props: {
  reportId: string;
  finding: StrategicFinding;
  trajectories: readonly StrategicTrajectory[];
  repertoireColor: Color;
  canNavigateToLine: (path: readonly string[]) => boolean;
  onGoToLine: (path: readonly string[]) => boolean;
}) {
  const [affectedRouteId, setAffectedRouteId] = createSignal<string | null>(null);
  const [baselineRouteId, setBaselineRouteId] = createSignal<string | null>(null);
  const [milestoneKey, setMilestoneKey] = createSignal<string | null>(null);
  const [sourcePathIndex, setSourcePathIndex] = createSignal(0);
  const [navigationMessage, setNavigationMessage] = createSignal<string | null>(null);
  const presentation = createMemo(() => buildComparisonBoardsPresentation(
    props.finding,
    props.trajectories,
    props.repertoireColor,
    affectedRouteId(),
    baselineRouteId(),
  ));

  createEffect(on(
    () => `${props.reportId}\u0000${props.finding.finding_id}`,
    () => {
      setAffectedRouteId(null);
      setBaselineRouteId(null);
      setMilestoneKey(null);
      setSourcePathIndex(0);
      setNavigationMessage(null);
    },
  ));
  createEffect(() => {
    const current = milestoneKey();
    const options = presentation().milestones;
    if (current === null || !options.some((milestone) => milestone.key === current)) {
      setMilestoneKey(presentation().preferred_milestone_key);
    }
  });
  createEffect(() => {
    if (sourcePathIndex() >= presentation().source_paths.length) setSourcePathIndex(0);
  });

  const milestone = () => presentation().milestones.find((item) => item.key === milestoneKey()) ??
    presentation().milestones[0] ?? null;
  const sourcePath = () => presentation().source_paths[sourcePathIndex()] ?? null;
  const pairLabel = () => {
    const affected = presentation().affected_route;
    const baseline = presentation().baseline_route;
    const currentMilestone = milestone();
    return `${affected?.label ?? "Affected route unavailable"} with ${baseline?.label ?? "typical route unavailable"} at ${currentMilestone?.label ?? "an unavailable milestone"}`;
  };
  const navigate = () => {
    const source = sourcePath();
    if (!source) return;
    const navigated = props.onGoToLine(source.path);
    setNavigationMessage(navigated
      ? `Navigated to ${source.path.length === 0 ? "the repertoire start" : source.path.join(" ")}.`
      : "This source line is no longer valid for the current report.");
  };

  return (
    <section class="strategic-fit-comparison-boards" aria-labelledby="strategic-fit-boards-title">
      <header>
        <h4 id="strategic-fit-boards-title">Matched position comparison</h4>
        <p>Both boards use report snapshots. Changing these controls does not navigate or edit the repertoire.</p>
      </header>
      <div class="strategic-fit-comparison-controls">
        <label>
          Affected branch route
          <select
            aria-label="Affected branch route"
            value={presentation().affected_route?.route_id ?? ""}
            onChange={(event) => {
              setAffectedRouteId(event.currentTarget.value || null);
              setNavigationMessage(null);
            }}
          >
            <For each={presentation().affected_routes}>{(route) => (
              <option value={route.route_id}>{route.label} · {route.state_label}</option>
            )}</For>
          </select>
        </label>
        <label>
          Typical cohort route
          <select
            aria-label="Typical cohort route"
            value={presentation().baseline_route?.route_id ?? ""}
            onChange={(event) => {
              setBaselineRouteId(event.currentTarget.value || null);
              setNavigationMessage(null);
            }}
          >
            <For each={presentation().baseline_routes}>{(route) => (
              <option value={route.route_id}>{route.label} · {route.state_label}</option>
            )}</For>
          </select>
        </label>
        <label>
          Strategic milestone
          <select
            aria-label="Strategic milestone"
            value={milestone()?.key ?? ""}
            onChange={(event) => {
              setMilestoneKey(event.currentTarget.value || null);
              setNavigationMessage(null);
            }}
          >
            <For each={presentation().milestones}>{(item) => (
              <option value={item.key}>{item.label} · {item.status_label}</option>
            )}</For>
          </select>
        </label>
      </div>

      <Show when={milestone()}>{(current) => (
        <div
          class="strategic-fit-comparison-sync-status"
          role="status"
          aria-live="polite"
          data-milestone-key={current().key}
          data-milestone-state={current().state}
        >
          <strong>{current().status_label}</strong>
          <span>{pairLabel()}</span>
          <p>{current().explanation}</p>
        </div>
      )}</Show>

      <div class="strategic-fit-comparison-board-grid">
        <BoardCard
          title="Typical cohort"
          route={presentation().baseline_route}
          snapshot={milestone()?.baseline_snapshot ?? null}
          orientation={props.repertoireColor}
          missing={milestone()?.explanation ?? "No baseline snapshot is available."}
        />
        <BoardCard
          title="This branch"
          route={presentation().affected_route}
          snapshot={milestone()?.affected_snapshot ?? null}
          orientation={props.repertoireColor}
          missing={milestone()?.explanation ?? "No affected-branch snapshot is available."}
        />
      </div>

      <div class="strategic-fit-line-navigation">
        <label>
          Affected source line
          <select
            aria-label="Affected source line"
            value={String(sourcePathIndex())}
            onChange={(event) => {
              setSourcePathIndex(Number(event.currentTarget.value));
              setNavigationMessage(null);
            }}
          >
            <For each={presentation().source_paths}>{(source) => (
              <option value={String(source.index)}>{source.label}</option>
            )}</For>
          </select>
        </label>
        <Show when={sourcePath()} fallback={(
          <p class="strategic-fit-evidence-unavailable">No source line is available for navigation.</p>
        )}>
          {(source) => (
            <>
              <code>{source().path.length === 0 ? "Start position" : source().path.join(" ")}</code>
              <button
                type="button"
                disabled={!props.canNavigateToLine(source().path)}
                onClick={navigate}
              >Go to line</button>
              <Show when={!props.canNavigateToLine(source().path)}>
                <p>This retained report path is not present in the current repertoire.</p>
              </Show>
            </>
          )}
        </Show>
        <Show when={navigationMessage()}>{(message) => <p role="status">{message()}</p>}</Show>
      </div>
    </section>
  );
}
