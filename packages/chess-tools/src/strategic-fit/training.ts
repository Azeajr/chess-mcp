/**
 * Versioned Strategic Fit training-performance evidence.
 *
 * Training attempts are portable document data, not analyzer state. They are keyed by semantic
 * positions and decisions, retain their original provenance when a repertoire changes, and only
 * project mastery for targets that still exist in the current repertoire graph.
 */
import type { RepertoireGraph } from "./graph.js";
import type {
  StrategicFitSourceProvenance,
} from "./types.js";
import {
  STRATEGIC_FIT_SOURCE_KINDS,
  STRATEGIC_FIT_SOURCE_STATES,
} from "./types.js";
import type {
  StrategicConceptMasteryInput,
  StrategicTrainingMetricEvidence,
} from "./metrics.js";

export const STRATEGIC_FIT_TRAINING_PERFORMANCE_KIND =
  "chess-mcp/strategic-fit-training-performance";
export const STRATEGIC_FIT_TRAINING_PERFORMANCE_VERSION = "1.0.0";

export interface StrategicFitTrainingTarget {
  readonly target_id: string;
  readonly training_id: string;
  readonly position_id: string;
  readonly decision_id: string;
  readonly concept_ids: readonly string[];
  readonly created_at: string;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface StrategicFitTrainingAttempt {
  readonly attempt_id: string;
  readonly target_id: string;
  readonly attempted_at: string;
  readonly recalled: boolean;
  /** Null means the trainer did not measure response time. */
  readonly response_time_ms: number | null;
  /** A lapse is explicit trainer/user evidence, not inferred from a missing or slow response. */
  readonly lapse: boolean;
  /** Optional self-reported confidence in the range 0–1. */
  readonly confidence: number | null;
  /** Optional scheduler timestamps. They remain UTC instants and do not depend on local time. */
  readonly scheduled_at: string | null;
  readonly next_due_at: string | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface StrategicFitTrainingPerformanceData {
  readonly training_performance_kind: typeof STRATEGIC_FIT_TRAINING_PERFORMANCE_KIND;
  readonly training_performance_version: typeof STRATEGIC_FIT_TRAINING_PERFORMANCE_VERSION;
  readonly document_id: string;
  readonly targets: readonly StrategicFitTrainingTarget[];
  readonly attempts: readonly StrategicFitTrainingAttempt[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface StrategicFitTrainingPerformanceError {
  readonly error: "strategic_fit_training_performance_error";
  readonly code:
    | "invalid-json"
    | "invalid-root"
    | "unsupported-version"
    | "invalid-field"
    | "duplicate-id"
    | "unknown-target";
  readonly path: string;
  readonly reason: string;
}

export interface ParsedStrategicFitTrainingPerformance {
  readonly ok: true;
  readonly data: StrategicFitTrainingPerformanceData;
}

export interface StrategicFitTrainingTargetInput {
  readonly training_id: string;
  readonly position_id: string;
  readonly decision_id: string;
  readonly concept_ids?: readonly string[];
  readonly created_at: string;
  readonly provenance?: readonly StrategicFitSourceProvenance[];
}

export interface StrategicFitTrainingAttemptInput {
  readonly target_id: string;
  readonly attempted_at: string;
  readonly recalled: boolean;
  readonly response_time_ms?: number | null;
  readonly lapse?: boolean;
  readonly confidence?: number | null;
  readonly scheduled_at?: string | null;
  readonly next_due_at?: string | null;
  readonly provenance?: readonly StrategicFitSourceProvenance[];
}

export type StrategicFitTrainingMasteryState = "untrained" | "observed" | "stale";

export interface StrategicFitTrainingMasteryStatistic {
  readonly identity_kind: "decision" | "concept";
  readonly identity_id: string;
  readonly target_ids: readonly string[];
  readonly state: StrategicFitTrainingMasteryState;
  readonly attempt_count: number;
  readonly successful_recall_count: number;
  readonly recall_rate: number | null;
  readonly average_response_time_ms: number | null;
  readonly lapse_count: number;
  readonly lapse_rate: number | null;
  readonly average_confidence: number | null;
  readonly first_attempt_at: string | null;
  readonly last_attempt_at: string | null;
  readonly next_due_at: string | null;
  /** Null means untrained; it never means failed. */
  readonly mastery: number | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface StrategicFitTrainingMasteryReport {
  readonly training_performance_version: typeof STRATEGIC_FIT_TRAINING_PERFORMANCE_VERSION;
  readonly document_id: string;
  readonly generated_at: string;
  readonly decision_mastery: readonly StrategicFitTrainingMasteryStatistic[];
  readonly concept_mastery: readonly StrategicFitTrainingMasteryStatistic[];
  readonly stale_target_ids: readonly string[];
  /** Only observed, current concepts are supplied to metrics. */
  readonly metric_evidence: StrategicTrainingMetricEvidence;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

type RecordLike = Record<string, unknown>;
const SOURCE_KINDS = new Set<string>(STRATEGIC_FIT_SOURCE_KINDS);
const SOURCE_STATES = new Set<string>(STRATEGIC_FIT_SOURCE_STATES);

const isRecord = (value: unknown): value is RecordLike =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortedUnique = (values: readonly string[]): string[] =>
  [...new Set(values.filter((value) => value.length > 0))].sort(compareStrings);

const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const normalized = value.trim();
  // Local/zone-less timestamps are intentionally rejected so persistence and mastery are stable
  // across browsers, machines, daylight-saving transitions, and imports.
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) return null;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function unitInterval(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function responseTime(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function error(
  code: StrategicFitTrainingPerformanceError["code"],
  path: string,
  reason: string,
): StrategicFitTrainingPerformanceError {
  return { error: "strategic_fit_training_performance_error", code, path, reason };
}

function provenance(
  value: unknown,
  path: string,
): readonly StrategicFitSourceProvenance[] | StrategicFitTrainingPerformanceError {
  if (!Array.isArray(value)) return error("invalid-field", path, "Expected a provenance array.");
  const result: StrategicFitSourceProvenance[] = [];
  for (let index = 0; index < value.length; index++) {
    const entry = value[index];
    if (!isRecord(entry)) return error("invalid-field", `${path}[${index}]`, "Expected a provenance object.");
    const allowed = new Set(["source_id", "kind", "state", "version", "snapshot", "reason"]);
    const unknown = Object.keys(entry).find((key) => !allowed.has(key));
    const sourceId = nonEmpty(entry.source_id);
    if (
      unknown !== undefined || sourceId === null || !SOURCE_KINDS.has(String(entry.kind)) ||
      !SOURCE_STATES.has(String(entry.state)) ||
      !(entry.version === null || typeof entry.version === "string") ||
      !(entry.snapshot === null || typeof entry.snapshot === "string") ||
      !(entry.reason === null || typeof entry.reason === "string")
    ) {
      return error("invalid-field", `${path}[${index}]`, "Provenance fields do not match the current contract.");
    }
    result.push({
      source_id: sourceId,
      kind: entry.kind as StrategicFitSourceProvenance["kind"],
      state: entry.state as StrategicFitSourceProvenance["state"],
      version: entry.version as string | null,
      snapshot: entry.snapshot as string | null,
      reason: entry.reason as string | null,
    });
  }
  return result.sort((left, right) =>
    compareStrings(left.source_id, right.source_id) ||
    compareStrings(left.snapshot ?? "", right.snapshot ?? "")
  );
}

const DEFAULT_PROVENANCE: readonly StrategicFitSourceProvenance[] = Object.freeze([{
  source_id: "strategic-fit:training-performance",
  kind: "training-metadata",
  state: "available",
  version: STRATEGIC_FIT_TRAINING_PERFORMANCE_VERSION,
  snapshot: null,
  reason: "Deterministic training-performance evidence recorded by the user or trainer.",
}]);

export function createStrategicFitTrainingPerformanceData(
  documentId: string,
): StrategicFitTrainingPerformanceData {
  const normalized = documentId.trim();
  if (normalized.length === 0) throw new Error("strategic_fit_training_invalid_document_id");
  return {
    training_performance_kind: STRATEGIC_FIT_TRAINING_PERFORMANCE_KIND,
    training_performance_version: STRATEGIC_FIT_TRAINING_PERFORMANCE_VERSION,
    document_id: normalized,
    targets: [],
    attempts: [],
    provenance: [],
  };
}

export function parseStrategicFitTrainingPerformance(
  input: string | unknown,
): ParsedStrategicFitTrainingPerformance | StrategicFitTrainingPerformanceError {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return error("invalid-json", "$", "Training performance is not valid JSON.");
    }
  }
  if (!isRecord(value)) return error("invalid-root", "$", "Training performance must be an object.");
  const allowedRoot = new Set([
    "training_performance_kind", "training_performance_version", "document_id",
    "targets", "attempts", "provenance",
  ]);
  const unknownRoot = Object.keys(value).find((key) => !allowedRoot.has(key));
  if (unknownRoot !== undefined) {
    return error("invalid-field", `$.${unknownRoot}`, "Unknown training-performance field.");
  }
  if (value.training_performance_kind !== STRATEGIC_FIT_TRAINING_PERFORMANCE_KIND) {
    return error("invalid-field", "$.training_performance_kind", "Training-performance kind is incompatible.");
  }
  if (value.training_performance_version !== STRATEGIC_FIT_TRAINING_PERFORMANCE_VERSION) {
    return error(
      "unsupported-version",
      "$.training_performance_version",
      `Unsupported training-performance version: ${String(value.training_performance_version)}`,
    );
  }
  const documentId = nonEmpty(value.document_id);
  if (documentId === null) return error("invalid-field", "$.document_id", "Document ID is required.");
  if (!Array.isArray(value.targets)) return error("invalid-field", "$.targets", "Expected a target array.");
  if (!Array.isArray(value.attempts)) return error("invalid-field", "$.attempts", "Expected an attempt array.");
  const rootProvenance = provenance(value.provenance, "$.provenance");
  if ("error" in rootProvenance) return rootProvenance;

  const targets: StrategicFitTrainingTarget[] = [];
  const targetIds = new Set<string>();
  for (let index = 0; index < value.targets.length; index++) {
    const entry = value.targets[index];
    const path = `$.targets[${index}]`;
    if (!isRecord(entry)) return error("invalid-field", path, "Expected a training target object.");
    const allowed = new Set([
      "target_id", "training_id", "position_id", "decision_id", "concept_ids",
      "created_at", "provenance",
    ]);
    const unknown = Object.keys(entry).find((key) => !allowed.has(key));
    const targetId = nonEmpty(entry.target_id);
    const trainingId = nonEmpty(entry.training_id);
    const positionId = nonEmpty(entry.position_id);
    const decisionId = nonEmpty(entry.decision_id);
    const createdAt = timestamp(entry.created_at);
    if (
      unknown !== undefined || targetId === null || trainingId === null || positionId === null ||
      decisionId === null || createdAt === null || !Array.isArray(entry.concept_ids) ||
      entry.concept_ids.some((concept) => nonEmpty(concept) === null)
    ) return error("invalid-field", path, "Training target fields do not match the current contract.");
    if (targetIds.has(targetId)) return error("duplicate-id", `${path}.target_id`, `Duplicate target ID: ${targetId}`);
    const targetProvenance = provenance(entry.provenance, `${path}.provenance`);
    if ("error" in targetProvenance) return targetProvenance;
    const expectedTargetId = `strategic-fit-training-target:${stableHash(`${trainingId}\u001f${positionId}\u001f${decisionId}`)}`;
    if (targetId !== expectedTargetId) {
      return error("invalid-field", `${path}.target_id`, "Training target ID does not match its semantic identity.");
    }
    targetIds.add(targetId);
    targets.push({
      target_id: targetId,
      training_id: trainingId,
      position_id: positionId,
      decision_id: decisionId,
      concept_ids: sortedUnique(entry.concept_ids as string[]),
      created_at: createdAt,
      provenance: targetProvenance,
    });
  }

  const attempts: StrategicFitTrainingAttempt[] = [];
  const attemptIds = new Set<string>();
  for (let index = 0; index < value.attempts.length; index++) {
    const entry = value.attempts[index];
    const path = `$.attempts[${index}]`;
    if (!isRecord(entry)) return error("invalid-field", path, "Expected a training attempt object.");
    const allowed = new Set([
      "attempt_id", "target_id", "attempted_at", "recalled", "response_time_ms", "lapse",
      "confidence", "scheduled_at", "next_due_at", "provenance",
    ]);
    const unknown = Object.keys(entry).find((key) => !allowed.has(key));
    const attemptId = nonEmpty(entry.attempt_id);
    const targetId = nonEmpty(entry.target_id);
    const attemptedAt = timestamp(entry.attempted_at);
    const measuredResponse = responseTime(entry.response_time_ms);
    const confidence = entry.confidence === null ? null : unitInterval(entry.confidence);
    const scheduledAt = entry.scheduled_at === null ? null : timestamp(entry.scheduled_at);
    const nextDueAt = entry.next_due_at === null ? null : timestamp(entry.next_due_at);
    if (
      unknown !== undefined || attemptId === null || targetId === null || attemptedAt === null ||
      typeof entry.recalled !== "boolean" || measuredResponse === undefined ||
      typeof entry.lapse !== "boolean" || confidence === null && entry.confidence !== null ||
      scheduledAt === null && entry.scheduled_at !== null ||
      nextDueAt === null && entry.next_due_at !== null
    ) return error("invalid-field", path, "Training attempt fields do not match the current contract.");
    if (!targetIds.has(targetId)) return error("unknown-target", `${path}.target_id`, `Unknown target ID: ${targetId}`);
    if (attemptIds.has(attemptId)) return error("duplicate-id", `${path}.attempt_id`, `Duplicate attempt ID: ${attemptId}`);
    const attemptProvenance = provenance(entry.provenance, `${path}.provenance`);
    if ("error" in attemptProvenance) return attemptProvenance;
    const expectedAttemptId = `strategic-fit-training-attempt:${stableHash(JSON.stringify({
      target_id: targetId,
      attempted_at: attemptedAt,
      recalled: entry.recalled,
      response_time_ms: measuredResponse,
      lapse: entry.lapse,
      confidence,
      scheduled_at: scheduledAt,
      next_due_at: nextDueAt,
    }))}`;
    if (attemptId !== expectedAttemptId) {
      return error("invalid-field", `${path}.attempt_id`, "Training attempt ID does not match its recorded evidence.");
    }
    attemptIds.add(attemptId);
    attempts.push({
      attempt_id: attemptId,
      target_id: targetId,
      attempted_at: attemptedAt,
      recalled: entry.recalled,
      response_time_ms: measuredResponse,
      lapse: entry.lapse,
      confidence,
      scheduled_at: scheduledAt,
      next_due_at: nextDueAt,
      provenance: attemptProvenance,
    });
  }
  targets.sort((left, right) => compareStrings(left.target_id, right.target_id));
  attempts.sort((left, right) =>
    compareStrings(left.attempted_at, right.attempted_at) || compareStrings(left.attempt_id, right.attempt_id)
  );
  return {
    ok: true,
    data: {
      training_performance_kind: STRATEGIC_FIT_TRAINING_PERFORMANCE_KIND,
      training_performance_version: STRATEGIC_FIT_TRAINING_PERFORMANCE_VERSION,
      document_id: documentId,
      targets,
      attempts,
      provenance: rootProvenance,
    },
  };
}

function canonical(data: StrategicFitTrainingPerformanceData): StrategicFitTrainingPerformanceData {
  const parsed = parseStrategicFitTrainingPerformance(data);
  if (!("ok" in parsed)) throw new Error(`${parsed.code}: ${parsed.path}`);
  return parsed.data;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as RecordLike)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

export function serializeStrategicFitTrainingPerformance(
  data: StrategicFitTrainingPerformanceData,
): string {
  return `${stableJson(canonical(data))}\n`;
}

export function upsertStrategicFitTrainingTarget(
  data: StrategicFitTrainingPerformanceData,
  input: StrategicFitTrainingTargetInput,
): StrategicFitTrainingPerformanceData {
  const createdAt = timestamp(input.created_at);
  const trainingId = nonEmpty(input.training_id);
  const positionId = nonEmpty(input.position_id);
  const decisionId = nonEmpty(input.decision_id);
  if (createdAt === null || trainingId === null || positionId === null || decisionId === null) {
    throw new Error("strategic_fit_training_invalid_target");
  }
  const targetId = `strategic-fit-training-target:${stableHash(`${trainingId}\u001f${positionId}\u001f${decisionId}`)}`;
  const next: StrategicFitTrainingTarget = {
    target_id: targetId,
    training_id: trainingId,
    position_id: positionId,
    decision_id: decisionId,
    concept_ids: sortedUnique(input.concept_ids ?? []),
    created_at: createdAt,
    provenance: input.provenance ?? DEFAULT_PROVENANCE,
  };
  return canonical({
    ...data,
    targets: [...data.targets.filter((target) => target.target_id !== targetId), next],
  });
}

export function recordStrategicFitTrainingAttempt(
  data: StrategicFitTrainingPerformanceData,
  input: StrategicFitTrainingAttemptInput,
): StrategicFitTrainingPerformanceData {
  if (!data.targets.some((target) => target.target_id === input.target_id)) {
    throw new Error("strategic_fit_training_unknown_target");
  }
  const attemptedAt = timestamp(input.attempted_at);
  const measuredResponse = responseTime(input.response_time_ms ?? null);
  const confidence = input.confidence === undefined || input.confidence === null
    ? null
    : unitInterval(input.confidence);
  const scheduledAt = input.scheduled_at === undefined || input.scheduled_at === null
    ? null
    : timestamp(input.scheduled_at);
  const nextDueAt = input.next_due_at === undefined || input.next_due_at === null
    ? null
    : timestamp(input.next_due_at);
  if (
    attemptedAt === null || measuredResponse === undefined ||
    input.confidence !== undefined && input.confidence !== null && confidence === null ||
    input.scheduled_at !== undefined && input.scheduled_at !== null && scheduledAt === null ||
    input.next_due_at !== undefined && input.next_due_at !== null && nextDueAt === null
  ) throw new Error("strategic_fit_training_invalid_attempt");
  const identity = JSON.stringify({
    target_id: input.target_id,
    attempted_at: attemptedAt,
    recalled: input.recalled,
    response_time_ms: measuredResponse,
    lapse: input.lapse ?? false,
    confidence,
    scheduled_at: scheduledAt,
    next_due_at: nextDueAt,
  });
  const attemptId = `strategic-fit-training-attempt:${stableHash(identity)}`;
  if (data.attempts.some((attempt) => attempt.attempt_id === attemptId)) return data;
  return canonical({
    ...data,
    attempts: [...data.attempts, {
      attempt_id: attemptId,
      target_id: input.target_id,
      attempted_at: attemptedAt,
      recalled: input.recalled,
      response_time_ms: measuredResponse,
      lapse: input.lapse ?? false,
      confidence,
      scheduled_at: scheduledAt,
      next_due_at: nextDueAt,
      provenance: input.provenance ?? DEFAULT_PROVENANCE,
    }],
  });
}

function mergedProvenance(
  values: readonly (readonly StrategicFitSourceProvenance[])[],
): StrategicFitSourceProvenance[] {
  const entries = new Map<string, StrategicFitSourceProvenance>();
  for (const value of values.flat()) {
    const key = JSON.stringify(value);
    entries.set(key, value);
  }
  return [...entries.values()].sort((left, right) =>
    compareStrings(left.source_id, right.source_id) || compareStrings(left.snapshot ?? "", right.snapshot ?? "")
  );
}

function masteryStatistic(
  identityKind: "decision" | "concept",
  identityId: string,
  targets: readonly StrategicFitTrainingTarget[],
  attempts: readonly StrategicFitTrainingAttempt[],
  stale: boolean,
): StrategicFitTrainingMasteryStatistic {
  const sortedAttempts = [...attempts].sort((left, right) =>
    compareStrings(left.attempted_at, right.attempted_at) || compareStrings(left.attempt_id, right.attempt_id)
  );
  const successful = sortedAttempts.filter((attempt) => attempt.recalled).length;
  const lapses = sortedAttempts.filter((attempt) => attempt.lapse).length;
  const responseTimes = sortedAttempts.flatMap((attempt) =>
    attempt.response_time_ms === null ? [] : [attempt.response_time_ms]
  );
  const confidences = sortedAttempts.flatMap((attempt) =>
    attempt.confidence === null ? [] : [attempt.confidence]
  );
  const count = sortedAttempts.length;
  let mastery: number | null = null;
  if (count > 0) {
    // A Beta(1,1) recall prior prevents one attempt from looking conclusive. Optional response and
    // confidence components are normalized away when absent, so missing measurements are not
    // invented. A declared lapse then applies a bounded retention penalty.
    const posteriorRecall = (successful + 1) / (count + 2);
    let weightedScore = posteriorRecall * 0.75;
    let suppliedWeight = 0.75;
    if (responseTimes.length > 0) {
      const responseQuality = responseTimes.reduce((sum, ms) => sum + 1 / (1 + ms / 15_000), 0) /
        responseTimes.length;
      weightedScore += responseQuality * 0.15;
      suppliedWeight += 0.15;
    }
    if (confidences.length > 0) {
      const attemptsWithConfidence = sortedAttempts.filter((attempt) => attempt.confidence !== null);
      const calibratedConfidence = attemptsWithConfidence.reduce((sum, attempt) =>
        sum + (attempt.recalled ? attempt.confidence! : 1 - attempt.confidence!), 0) /
        attemptsWithConfidence.length;
      weightedScore += calibratedConfidence * 0.10;
      suppliedWeight += 0.10;
    }
    const lapseRate = lapses / count;
    mastery = round((weightedScore / suppliedWeight) * (1 - 0.5 * lapseRate));
  }
  const nextDueAt = [...sortedAttempts].reverse()
    .find((attempt) => attempt.next_due_at !== null)?.next_due_at ?? null;
  const staleProvenance: readonly StrategicFitSourceProvenance[] = stale ? [{
    source_id: `strategic-fit:training-stale:${identityKind}:${identityId}`,
    kind: "training-metadata",
    state: "stale",
    version: STRATEGIC_FIT_TRAINING_PERFORMANCE_VERSION,
    snapshot: sortedAttempts.at(-1)?.attempted_at ?? null,
    reason: "The semantic training target no longer exists in the current repertoire graph.",
  }] : [];
  return {
    identity_kind: identityKind,
    identity_id: identityId,
    target_ids: targets.map((target) => target.target_id).sort(compareStrings),
    state: stale ? "stale" : count === 0 ? "untrained" : "observed",
    attempt_count: count,
    successful_recall_count: successful,
    recall_rate: count === 0 ? null : round(successful / count),
    average_response_time_ms: responseTimes.length === 0
      ? null
      : Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length),
    lapse_count: lapses,
    lapse_rate: count === 0 ? null : round(lapses / count),
    average_confidence: confidences.length === 0
      ? null
      : round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length),
    first_attempt_at: sortedAttempts[0]?.attempted_at ?? null,
    last_attempt_at: sortedAttempts.at(-1)?.attempted_at ?? null,
    next_due_at: nextDueAt,
    mastery,
    provenance: mergedProvenance([
      ...targets.map((target) => target.provenance),
      ...sortedAttempts.map((attempt) => attempt.provenance),
      staleProvenance,
    ]),
  };
}

export function deriveStrategicFitTrainingMastery(
  data: StrategicFitTrainingPerformanceData,
  graph: RepertoireGraph,
  generatedAt: string,
): StrategicFitTrainingMasteryReport {
  const canonicalData = canonical(data);
  const normalizedGeneratedAt = timestamp(generatedAt);
  if (normalizedGeneratedAt === null) throw new Error("strategic_fit_training_invalid_generated_at");
  const currentPositions = new Set(graph.positions.map((position) => position.position_id));
  const currentDecisions = new Map(graph.decisions.map((decision) => [decision.decision_id, decision]));
  const attemptsByTarget = new Map<string, StrategicFitTrainingAttempt[]>();
  for (const attempt of canonicalData.attempts) {
    if (Date.parse(attempt.attempted_at) > Date.parse(normalizedGeneratedAt)) continue;
    const current = attemptsByTarget.get(attempt.target_id) ?? [];
    current.push(attempt);
    attemptsByTarget.set(attempt.target_id, current);
  }
  const staleTargets = new Set(canonicalData.targets
    .filter((target) =>
      !currentPositions.has(target.position_id) ||
      currentDecisions.get(target.decision_id)?.from_position_id !== target.position_id
    )
    .map((target) => target.target_id));

  const decisionTargets = new Map<string, StrategicFitTrainingTarget[]>();
  for (const target of canonicalData.targets) {
    const current = decisionTargets.get(target.decision_id) ?? [];
    current.push(target);
    decisionTargets.set(target.decision_id, current);
  }
  const decisionMastery = [...decisionTargets.entries()].map(([decisionId, targets]) => {
    const allStale = targets.every((target) => staleTargets.has(target.target_id));
    const contributingTargets = allStale
      ? targets
      : targets.filter((target) => !staleTargets.has(target.target_id));
    const attempts = contributingTargets.flatMap((target) => attemptsByTarget.get(target.target_id) ?? []);
    return masteryStatistic("decision", decisionId, contributingTargets, attempts, allStale);
  }).sort((left, right) => compareStrings(left.identity_id, right.identity_id));

  const conceptTargets = new Map<string, StrategicFitTrainingTarget[]>();
  for (const target of canonicalData.targets) {
    for (const conceptId of target.concept_ids) {
      const current = conceptTargets.get(conceptId) ?? [];
      current.push(target);
      conceptTargets.set(conceptId, current);
    }
  }
  const conceptMastery = [...conceptTargets.entries()].map(([conceptId, targets]) => {
    const allStale = targets.every((target) => staleTargets.has(target.target_id));
    const contributingTargets = allStale
      ? targets
      : targets.filter((target) => !staleTargets.has(target.target_id));
    const attempts = contributingTargets.flatMap((target) => attemptsByTarget.get(target.target_id) ?? []);
    return masteryStatistic("concept", conceptId, contributingTargets, attempts, allStale);
  }).sort((left, right) => compareStrings(left.identity_id, right.identity_id));

  const metricConcepts: StrategicConceptMasteryInput[] = conceptMastery.flatMap((statistic) =>
    statistic.state === "observed" && statistic.mastery !== null
      ? [{
          concept_id: statistic.identity_id,
          mastery: statistic.mastery,
          provenance: statistic.provenance,
        }]
      : []
  );
  const reportProvenance = mergedProvenance([
    canonicalData.provenance,
    ...decisionMastery.map((statistic) => statistic.provenance),
    ...conceptMastery.map((statistic) => statistic.provenance),
  ]);
  return {
    training_performance_version: STRATEGIC_FIT_TRAINING_PERFORMANCE_VERSION,
    document_id: canonicalData.document_id,
    generated_at: normalizedGeneratedAt,
    decision_mastery: decisionMastery,
    concept_mastery: conceptMastery,
    stale_target_ids: [...staleTargets].sort(compareStrings),
    metric_evidence: { concept_mastery: metricConcepts, provenance: reportProvenance },
    provenance: reportProvenance,
  };
}

export function mergeStrategicFitTrainingPerformance(
  local: StrategicFitTrainingPerformanceData,
  incoming: StrategicFitTrainingPerformanceData,
): StrategicFitTrainingPerformanceData {
  const current = canonical(local);
  const imported = canonical(incoming);
  if (current.document_id !== imported.document_id) {
    throw new Error("strategic_fit_training_document_mismatch");
  }
  const targets = new Map(current.targets.map((target) => [target.target_id, target]));
  for (const target of imported.targets) targets.set(target.target_id, target);
  const attempts = new Map(current.attempts.map((attempt) => [attempt.attempt_id, attempt]));
  for (const attempt of imported.attempts) attempts.set(attempt.attempt_id, attempt);
  return canonical({
    ...current,
    targets: [...targets.values()],
    attempts: [...attempts.values()],
    provenance: mergedProvenance([current.provenance, imported.provenance]),
  });
}
