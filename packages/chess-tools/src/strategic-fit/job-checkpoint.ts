import type { AnalyzeStrategicFitOptions } from "./analyze.js";
import type { RepertoireGraph } from "./graph.js";
import {
  strategicFitIndexGeneration,
  strategicFitIndexSettings,
  type StrategicFitIndexCache,
  type StrategicFitIndexNamespace,
  type StrategicFitJobCheckpointStage,
} from "./index-cache.js";
import { strategicFitReportCacheKey } from "./report-projection.js";
import type { StrategicTrajectoryReport } from "./trajectory.js";
import { STRATEGIC_FIT_PROGRESS_PHASES, type StrategicFitProgressPhase } from "./types.js";

export const STRATEGIC_FIT_JOB_CHECKPOINT_FORMAT_VERSION = 1;

export interface StrategicFitJobCompatibility {
  readonly content_key: string;
  readonly repertoire_revision: string;
  readonly report_cache_key: string;
  readonly index_generation: string;
}

export interface StrategicFitJobCheckpointStages {
  readonly graph_content_key: string;
  readonly graph: RepertoireGraph;
  readonly trajectories: StrategicTrajectoryReport | null;
}

export interface StrategicFitJobCheckpoint {
  readonly format_version: number;
  readonly job_id: string;
  readonly compatibility: StrategicFitJobCompatibility;
  readonly saved_at: string;
  readonly completed_phase: StrategicFitProgressPhase;
  readonly completed_phase_index: number;
  readonly provisional: true;
  readonly stages: StrategicFitJobCheckpointStages;
}

export type StrategicFitJobRecoveryState = "resumed" | "discarded" | "cold";

export interface StrategicFitJobRecovery {
  readonly state: StrategicFitJobRecoveryState;
  readonly job_id: string | null;
  readonly saved_at: string | null;
  readonly completed_phase: StrategicFitProgressPhase | null;
  readonly completed_phase_index: number | null;
  readonly restored_stages: readonly StrategicFitIndexNamespace[];
  readonly code: string | null;
  readonly reason: string;
}

export interface StrategicFitJobCheckpointRejection {
  readonly code: string;
  readonly reason: string;
}

const ID_SEPARATOR = "";

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function strategicFitJobCompatibility(
  contentKey: string,
  options: AnalyzeStrategicFitOptions,
): StrategicFitJobCompatibility {
  return {
    content_key: contentKey,
    repertoire_revision: options.repertoireRevision,
    report_cache_key: strategicFitReportCacheKey(contentKey, options),
    index_generation: strategicFitIndexGeneration(strategicFitIndexSettings(options)),
  };
}

export function strategicFitJobId(compatibility: StrategicFitJobCompatibility): string {
  return `strategic-fit-job:${stableHash(
    [
      compatibility.content_key,
      compatibility.repertoire_revision,
      compatibility.report_cache_key,
      compatibility.index_generation,
    ].join(ID_SEPARATOR),
  )}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isGraph(value: unknown): value is RepertoireGraph {
  return (
    isObject(value) &&
    typeof value.graph_id === "string" &&
    value.graph_id.length > 0 &&
    typeof value.analysis_version === "string" &&
    typeof value.root_position_id === "string" &&
    Array.isArray(value.positions) &&
    Array.isArray(value.decisions) &&
    Array.isArray(value.move_orders) &&
    Array.isArray(value.transposition_links) &&
    Array.isArray(value.routes) &&
    value.routes.every(
      (route) =>
        isObject(route) && typeof route.route_id === "string" && isStringArray(route.position_ids),
    )
  );
}

function isTrajectoryReport(value: unknown): value is StrategicTrajectoryReport {
  return (
    isObject(value) &&
    typeof value.graph_id === "string" &&
    value.graph_id.length > 0 &&
    typeof value.analysis_version === "string" &&
    Array.isArray(value.trajectories) &&
    Array.isArray(value.provenance)
  );
}

function isCompatibility(value: unknown): value is StrategicFitJobCompatibility {
  return (
    isObject(value) &&
    typeof value.content_key === "string" &&
    typeof value.repertoire_revision === "string" &&
    typeof value.report_cache_key === "string" &&
    value.report_cache_key.length > 0 &&
    typeof value.index_generation === "string" &&
    value.index_generation.length > 0
  );
}

export function isStrategicFitJobCheckpoint(value: unknown): value is StrategicFitJobCheckpoint {
  if (!isObject(value)) return false;
  if (value.format_version !== STRATEGIC_FIT_JOB_CHECKPOINT_FORMAT_VERSION) return false;
  if (typeof value.job_id !== "string" || value.job_id.length === 0) return false;
  if (typeof value.saved_at !== "string" || Number.isNaN(Date.parse(value.saved_at))) return false;
  if (value.provisional !== true) return false;
  if (!isCompatibility(value.compatibility)) return false;
  if (
    typeof value.completed_phase_index !== "number" ||
    !Number.isSafeInteger(value.completed_phase_index) ||
    value.completed_phase_index < 0 ||
    value.completed_phase_index >= STRATEGIC_FIT_PROGRESS_PHASES.length ||
    value.completed_phase !== STRATEGIC_FIT_PROGRESS_PHASES[value.completed_phase_index]
  )
    return false;
  const stages = value.stages;
  if (!isObject(stages)) return false;
  if (typeof stages.graph_content_key !== "string" || stages.graph_content_key.length === 0) {
    return false;
  }
  if (!isGraph(stages.graph)) return false;
  if (stages.trajectories !== null && !isTrajectoryReport(stages.trajectories)) return false;
  return value.job_id === strategicFitJobId(value.compatibility);
}

export function strategicFitJobCheckpointRejection(
  candidate: unknown,
  expected: StrategicFitJobCompatibility,
): StrategicFitJobCheckpointRejection | null {
  if (!isObject(candidate)) {
    return {
      code: "strategic_fit_checkpoint_corrupt",
      reason: "The stored Strategic Fit checkpoint is not a record.",
    };
  }
  if (typeof candidate.format_version !== "number") {
    return {
      code: "strategic_fit_checkpoint_corrupt",
      reason: "The stored Strategic Fit checkpoint declares no format version.",
    };
  }
  if (candidate.format_version !== STRATEGIC_FIT_JOB_CHECKPOINT_FORMAT_VERSION) {
    return {
      code: "strategic_fit_checkpoint_format_version",
      reason: `The stored Strategic Fit checkpoint uses format version ${String(candidate.format_version)}; this build reads version ${STRATEGIC_FIT_JOB_CHECKPOINT_FORMAT_VERSION}.`,
    };
  }
  if (!isStrategicFitJobCheckpoint(candidate)) {
    return {
      code: "strategic_fit_checkpoint_corrupt",
      reason: "The stored Strategic Fit checkpoint is incomplete or internally inconsistent.",
    };
  }
  const stored = candidate.compatibility;
  if (stored.content_key !== expected.content_key) {
    return {
      code: "strategic_fit_checkpoint_stale_content",
      reason: "The repertoire content changed since the checkpoint was saved.",
    };
  }
  if (stored.repertoire_revision !== expected.repertoire_revision) {
    return {
      code: "strategic_fit_checkpoint_stale_revision",
      reason: "The repertoire revision changed since the checkpoint was saved.",
    };
  }
  if (stored.report_cache_key !== expected.report_cache_key) {
    return {
      code: "strategic_fit_checkpoint_stale_settings",
      reason:
        "The Strategic Fit profile, resolutions, or analysis settings changed since the checkpoint was saved.",
    };
  }
  if (stored.index_generation !== expected.index_generation) {
    return {
      code: "strategic_fit_checkpoint_retired_generation",
      reason:
        "The analysis manifest or indexed analysis settings changed since the checkpoint was saved.",
    };
  }
  return null;
}

export function strategicFitColdJobRecovery(reason: string): StrategicFitJobRecovery {
  return {
    state: "cold",
    job_id: null,
    saved_at: null,
    completed_phase: null,
    completed_phase_index: null,
    restored_stages: [],
    code: null,
    reason,
  };
}

function discardedRecovery(
  candidate: unknown,
  rejection: StrategicFitJobCheckpointRejection,
): StrategicFitJobRecovery {
  const record = isObject(candidate) ? candidate : {};
  return {
    state: "discarded",
    job_id: typeof record.job_id === "string" ? record.job_id : null,
    saved_at: typeof record.saved_at === "string" ? record.saved_at : null,
    completed_phase: null,
    completed_phase_index: null,
    restored_stages: [],
    code: rejection.code,
    reason: rejection.reason,
  };
}

export function restoreStrategicFitJobCheckpoint(
  index: StrategicFitIndexCache,
  candidate: unknown,
  expected: StrategicFitJobCompatibility,
): StrategicFitJobRecovery {
  const rejection = strategicFitJobCheckpointRejection(candidate, expected);
  if (rejection !== null) return discardedRecovery(candidate, rejection);
  const checkpoint = candidate as StrategicFitJobCheckpoint;
  const restored = index.restoreStages({
    generation: checkpoint.compatibility.index_generation,
    graph_content_key: checkpoint.stages.graph_content_key,
    graph: checkpoint.stages.graph,
    trajectories: checkpoint.stages.trajectories,
  });
  return {
    state: "resumed",
    job_id: checkpoint.job_id,
    saved_at: checkpoint.saved_at,
    completed_phase: checkpoint.completed_phase,
    completed_phase_index: checkpoint.completed_phase_index,
    restored_stages: restored,
    code: null,
    reason: `Resumed the interrupted analysis from the checkpoint saved after ${checkpoint.completed_phase} at ${checkpoint.saved_at}.`,
  };
}

export interface StrategicFitJobRecorderOptions {
  readonly compatibility: StrategicFitJobCompatibility;
  readonly save: (checkpoint: StrategicFitJobCheckpoint) => void;
  readonly now?: () => string;
}

export function createStrategicFitJobRecorder(
  options: StrategicFitJobRecorderOptions,
): (stage: StrategicFitJobCheckpointStage) => void {
  const jobId = strategicFitJobId(options.compatibility);
  const now = options.now ?? (() => new Date().toISOString());
  return (stage) => {
    if (stage.generation !== options.compatibility.index_generation) return;
    options.save({
      format_version: STRATEGIC_FIT_JOB_CHECKPOINT_FORMAT_VERSION,
      job_id: jobId,
      compatibility: options.compatibility,
      saved_at: now(),
      completed_phase: stage.completed_phase,
      completed_phase_index: stage.completed_phase_index,
      provisional: true,
      stages: {
        graph_content_key: stage.graph_content_key,
        graph: stage.graph,
        trajectories: stage.trajectories,
      },
    });
  };
}
