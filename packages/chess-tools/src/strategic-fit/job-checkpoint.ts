/**
 * Resumable Strategic Fit analysis jobs.
 *
 * A long scan can be interrupted by a browser reload, a terminated Worker, a dropped MCP handle, or
 * a process that simply goes away. A checkpoint is the record of the whole stages such a job had
 * already finished, expressed entirely in Task 12.1's identities: the analysis index generation for
 * the stage values and Task 3.4's report cache key for the job itself. It mints no third identity.
 *
 * Three properties are deliberate:
 *
 * - A checkpoint carries inputs, never findings. Restoring one seeds the incremental index with
 *   values a cold run would compute under the same content keys, so a resumed job returns exactly
 *   what a cold full scan returns; only the work still to do differs.
 * - Compatibility fails closed. Document content, repertoire revision, analysis settings, and the
 *   index generation must all match, and the stored format version must be the current one.
 *   Anything else is discarded with a stated reason rather than partially trusted.
 * - Discarding is observable. Every outcome — resumed, discarded, or cold — produces a recovery
 *   record naming what was resumed and from when, so a host can never silently restart a job the
 *   user cancelled or silently resume one it should have abandoned.
 */
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

/** Persisted-shape version. A stored checkpoint from any other version is discarded, not migrated. */
export const STRATEGIC_FIT_JOB_CHECKPOINT_FORMAT_VERSION = 1;

/** Every identity a resumed job must match exactly; all of it is reused, none of it is new. */
export interface StrategicFitJobCompatibility {
  /** Normalized document content: browser PGN or immutable MCP handle content key. */
  readonly content_key: string;
  readonly repertoire_revision: string;
  /** Task 3.4 report identity: content, revision, profile, and every analysis setting. */
  readonly report_cache_key: string;
  /** Task 12.1 index generation: the complete analysis manifest plus the indexed stage settings. */
  readonly index_generation: string;
}

export interface StrategicFitJobCheckpointStages {
  readonly graph_content_key: string;
  readonly graph: RepertoireGraph;
  readonly trajectories: StrategicTrajectoryReport | null;
}

export interface StrategicFitJobCheckpoint {
  readonly format_version: number;
  /** Stable across every checkpoint of one job, so recovery provenance names the job, not a write. */
  readonly job_id: string;
  readonly compatibility: StrategicFitJobCompatibility;
  readonly saved_at: string;
  readonly completed_phase: StrategicFitProgressPhase;
  readonly completed_phase_index: number;
  /** A checkpoint is never a complete report; partial work stays explicitly provisional. */
  readonly provisional: true;
  readonly stages: StrategicFitJobCheckpointStages;
}

export type StrategicFitJobRecoveryState = "resumed" | "discarded" | "cold";

/** Recovery provenance: what was resumed, from when, and why anything else was refused. */
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

/**
 * The compatibility identity of the job these options describe. Both hosts and the checkpoint reader
 * call this, so a checkpoint is always compared against a derivation of the same two keys.
 */
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
  return `strategic-fit-job:${stableHash([
    compatibility.content_key,
    compatibility.repertoire_revision,
    compatibility.report_cache_key,
    compatibility.index_generation,
  ].join(ID_SEPARATOR))}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isGraph(value: unknown): value is RepertoireGraph {
  return isObject(value) &&
    typeof value.graph_id === "string" && value.graph_id.length > 0 &&
    typeof value.analysis_version === "string" &&
    typeof value.root_position_id === "string" &&
    Array.isArray(value.positions) &&
    Array.isArray(value.decisions) &&
    Array.isArray(value.move_orders) &&
    Array.isArray(value.transposition_links) &&
    Array.isArray(value.routes) &&
    value.routes.every((route) => isObject(route) &&
      typeof route.route_id === "string" && isStringArray(route.position_ids));
}

function isTrajectoryReport(value: unknown): value is StrategicTrajectoryReport {
  return isObject(value) &&
    typeof value.graph_id === "string" && value.graph_id.length > 0 &&
    typeof value.analysis_version === "string" &&
    Array.isArray(value.trajectories) &&
    Array.isArray(value.provenance);
}

function isCompatibility(value: unknown): value is StrategicFitJobCompatibility {
  return isObject(value) &&
    typeof value.content_key === "string" &&
    typeof value.repertoire_revision === "string" &&
    typeof value.report_cache_key === "string" && value.report_cache_key.length > 0 &&
    typeof value.index_generation === "string" && value.index_generation.length > 0;
}

/** Structural validation of an untrusted stored record; a corrupt one is never partially read. */
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
  ) return false;
  const stages = value.stages;
  if (!isObject(stages)) return false;
  if (typeof stages.graph_content_key !== "string" || stages.graph_content_key.length === 0) {
    return false;
  }
  if (!isGraph(stages.graph)) return false;
  if (stages.trajectories !== null && !isTrajectoryReport(stages.trajectories)) return false;
  return value.job_id === strategicFitJobId(value.compatibility);
}

/**
 * Why this stored record cannot be resumed here, or `null` when it can. Identity is compared field
 * by field so the reason is specific: a user who edited the document is told that, not "incompatible".
 */
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
      reason: "The Strategic Fit profile, resolutions, or analysis settings changed since the checkpoint was saved.",
    };
  }
  if (stored.index_generation !== expected.index_generation) {
    return {
      code: "strategic_fit_checkpoint_retired_generation",
      reason: "The analysis manifest or indexed analysis settings changed since the checkpoint was saved.",
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

/**
 * Restore a compatible checkpoint into the host's index, or discard it with a stated reason.
 *
 * The index is only ever seeded with values keyed by the identity that determines them, so an
 * accepted checkpoint changes how much work the run does and nothing about what it returns.
 */
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
  /** Injected so a checkpoint's "from when" is a host clock rather than hidden module state. */
  readonly now?: () => string;
}

/**
 * Adapt analyzer stage events into stored checkpoints. Every checkpoint of one job shares its job
 * identity; only the completed phase, timestamp, and stage set advance.
 */
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
