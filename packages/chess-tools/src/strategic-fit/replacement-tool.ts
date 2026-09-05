import type { GameTree } from "../pgn.js";
import {
  applyReplacementChangeSet,
  constructReplacementChangeSet,
  type ReplacementChangeSetErrorCode,
} from "./change-set.js";
import type {
  ReplacementSafetyCandidateAction,
  ReplacementSafetySimulationResult,
} from "./replacement-safety.js";
import {
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  type ReplacementCandidateSourceKind,
  type ReplacementChangeSet,
  type ReplacementChangeSetPreviewSuccess,
  type ReplacementGenerationBudget,
  type ReplacementPivotSelection,
  type ReplacementRequest,
  type StrategicFitReplacementVersioned,
} from "./replacement-types.js";
import type { StrategicFitProfile, StrategicFitSourceProvenance } from "./types.js";
import { STRATEGIC_FIT_ANALYSIS_VERSION, STRATEGIC_FIT_SCHEMA_VERSION } from "./version.js";

export const REPLACEMENT_TOOL_V2_CONTRACT = "strategic-fit-replacement-v2";

export const REPLACEMENT_TOOL_V2_ITEM_STATUSES = [
  "previewed",
  "stale",
  "invalid",
  "blocked",
  "cancelled",
] as const;
export type ReplacementToolV2ItemStatus = (typeof REPLACEMENT_TOOL_V2_ITEM_STATUSES)[number];

export const REPLACEMENT_TOOL_V2_RESULT_STATUSES = [
  "complete",
  "partial",
  "stale",
  "invalid",
  "cancelled",
] as const;
export type ReplacementToolV2ResultStatus = (typeof REPLACEMENT_TOOL_V2_RESULT_STATUSES)[number];

export const REPLACEMENT_TOOL_V2_ERROR_CODES = [
  "cancelled",
  "invalid-request",
  "version-mismatch",
  "finding-mismatch",
  "pivot-mismatch",
  "profile-mismatch",
  "source-mismatch",
  "budget-mismatch",
  "engine-mismatch",
  "coverage-mismatch",
  "retention-mismatch",
  "safety-mismatch",
  "candidate-not-found",
  "duplicate-candidate",
  "change-set-rejected",
  "preview-failed",
] as const;
export type ReplacementToolV2ErrorCode = (typeof REPLACEMENT_TOOL_V2_ERROR_CODES)[number];

export interface ReplacementToolV2FindingInput {
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly cohort_id: string;
  readonly repertoire_revision: string;
}

export interface ReplacementToolV2EngineInput {
  readonly depth: number;
  readonly multipv: number;
  readonly allow_unavailable_evidence: boolean;
}

export interface ReplacementToolV2CoverageInput {
  readonly minimum_expected_opponent_coverage: number | null;
  readonly require_all_forcing_replies: boolean;
}

export type ReplacementToolV2RetentionInput = ReplacementSafetyCandidateAction & {
  readonly promote_candidate_to_mainline?: boolean;
};

export interface ReplacementToolV2Input {
  readonly contract: typeof REPLACEMENT_TOOL_V2_CONTRACT;
  readonly replacement_request: ReplacementRequest;
  readonly finding: ReplacementToolV2FindingInput;
  readonly pivot: ReplacementPivotSelection;
  readonly profile: StrategicFitProfile;
  readonly sources: readonly ReplacementCandidateSourceKind[];
  readonly budget: ReplacementGenerationBudget;
  readonly engine: ReplacementToolV2EngineInput;
  readonly coverage: ReplacementToolV2CoverageInput;
  readonly retention: readonly ReplacementToolV2RetentionInput[];
  readonly candidate_ids: readonly string[];
  readonly safety: ReplacementSafetySimulationResult;
}

export interface ReplacementToolV2Item extends StrategicFitReplacementVersioned {
  readonly candidate_id: string;
  readonly status: ReplacementToolV2ItemStatus;
  readonly error_code: ReplacementToolV2ErrorCode | ReplacementChangeSetErrorCode | null;
  readonly explanation: string;
  readonly change_set: ReplacementChangeSet | null;
  readonly preview: ReplacementChangeSetPreviewSuccess | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface ReplacementToolV2Result extends StrategicFitReplacementVersioned {
  readonly contract: typeof REPLACEMENT_TOOL_V2_CONTRACT;
  readonly status: ReplacementToolV2ResultStatus;
  readonly error_code: ReplacementToolV2ErrorCode | null;
  readonly explanation: string;
  readonly request_id: string;
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly cohort_id: string;
  readonly repertoire_revision: string;
  readonly repertoire_color: "white" | "black";
  readonly items: readonly ReplacementToolV2Item[];
  readonly safety: ReplacementSafetySimulationResult;
  readonly source_tree_unchanged: true;
  readonly inputs_unchanged: true;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

function versioned(): StrategicFitReplacementVersioned {
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    replacement_schema_version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`)
    .join(",")}}`;
}

function same(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function canonicalRequest(request: ReplacementRequest): ReplacementRequest {
  return {
    ...request,
    candidate_sources: [...request.candidate_sources].sort(),
    provenance: [...request.provenance].sort((left, right) =>
      left.source_id.localeCompare(right.source_id),
    ),
  };
}

function isPlainArray(value: unknown): boolean {
  return Array.isArray(value);
}

function validProvenance(values: readonly StrategicFitSourceProvenance[]): boolean {
  /* eslint-disable @typescript-eslint/no-unnecessary-condition */
  return (
    isPlainArray(values) &&
    values.every(
      (value) =>
        value !== null &&
        typeof value === "object" &&
        typeof value.source_id === "string" &&
        typeof value.kind === "string" &&
        typeof value.state === "string",
    )
  );
  /* eslint-enable @typescript-eslint/no-unnecessary-condition */
}

function item(
  candidateId: string,
  status: ReplacementToolV2ItemStatus,
  code: ReplacementToolV2Item["error_code"],
  explanation: string,
  provenance: readonly StrategicFitSourceProvenance[],
  changeSet: ReplacementChangeSet | null = null,
  preview: ReplacementChangeSetPreviewSuccess | null = null,
): ReplacementToolV2Item {
  return {
    ...versioned(),
    candidate_id: candidateId,
    status,
    error_code: code,
    explanation,
    change_set: changeSet,
    preview,
    provenance: structuredClone(provenance),
  };
}

function result(
  input: ReplacementToolV2Input,
  status: ReplacementToolV2ResultStatus,
  code: ReplacementToolV2ErrorCode | null,
  explanation: string,
  items: readonly ReplacementToolV2Item[],
): ReplacementToolV2Result {
  const request = input.replacement_request;
  return {
    ...versioned(),
    contract: REPLACEMENT_TOOL_V2_CONTRACT,
    status,
    error_code: code,
    explanation,
    request_id: request.request_id,
    report_id: request.report_id,
    finding_id: request.finding_id,
    semantic_finding_id: request.semantic_finding_id,
    cohort_id: request.cohort_id,
    repertoire_revision: request.repertoire_revision,
    repertoire_color: request.repertoire_color,
    items,
    safety: structuredClone(input.safety),
    source_tree_unchanged: true,
    inputs_unchanged: true,
    provenance: structuredClone(input.safety.provenance),
  };
}

function boundary(input: ReplacementToolV2Input): ReplacementToolV2ErrorCode | null {
  const request = input.replacement_request;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (input.contract !== REPLACEMENT_TOOL_V2_CONTRACT || input.candidate_ids.length === 0)
    return "invalid-request";
  if (
    !validProvenance(request.provenance) ||
    !validProvenance(input.safety.provenance) ||
    input.safety.candidates.some((candidate) => !validProvenance(candidate.provenance))
  )
    return "invalid-request";
  /* eslint-disable @typescript-eslint/no-unnecessary-condition */
  if (
    request.schema_version !== STRATEGIC_FIT_SCHEMA_VERSION ||
    request.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    request.replacement_schema_version !== STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION
  )
    return "version-mismatch";
  /* eslint-enable @typescript-eslint/no-unnecessary-condition */
  if (
    !same(input.finding, {
      report_id: request.report_id,
      finding_id: request.finding_id,
      semantic_finding_id: request.semantic_finding_id,
      cohort_id: request.cohort_id,
      repertoire_revision: request.repertoire_revision,
    })
  )
    return "finding-mismatch";
  if (!same(input.pivot, request.pivot_selection)) return "pivot-mismatch";
  if (!same(input.profile, request.profile)) return "profile-mismatch";
  if (!same([...input.sources].sort(), [...request.candidate_sources].sort()))
    return "source-mismatch";
  if (!same(input.budget, request.budget)) return "budget-mismatch";
  if (
    input.engine.depth !== request.budget.engine_depth ||
    input.engine.multipv !== request.budget.engine_multipv
  )
    return "engine-mismatch";
  if (
    input.coverage.minimum_expected_opponent_coverage !==
      request.minimum_expected_opponent_coverage ||
    input.coverage.require_all_forcing_replies !== request.budget.include_all_forcing_replies
  )
    return "coverage-mismatch";
  if (
    !same(canonicalRequest(input.safety.request), canonicalRequest(request)) ||
    input.safety.repertoire_revision !== request.repertoire_revision ||
    input.safety.request_id !== request.request_id ||
    input.safety.report_id !== request.report_id ||
    input.safety.finding_id !== request.finding_id ||
    input.safety.semantic_finding_id !== request.semantic_finding_id ||
    input.safety.cohort_id !== request.cohort_id ||
    input.safety.repertoire_color !== request.repertoire_color
  )
    return "safety-mismatch";
  const selected = new Set<string>();
  for (const candidateId of input.candidate_ids) {
    if (selected.has(candidateId)) return "duplicate-candidate";
    selected.add(candidateId);
  }
  const retention = new Map(input.retention.map((entry) => [entry.candidate_id, entry]));
  if (
    retention.size !== input.retention.length ||
    input.retention.some((entry) => !selected.has(entry.candidate_id))
  )
    return "retention-mismatch";
  for (const candidateId of input.candidate_ids) {
    const simulated = input.safety.candidates.find(
      (candidate) => candidate.candidate_id === candidateId,
    );
    if (simulated?.action === "replace" && !retention.has(candidateId)) return "retention-mismatch";
  }
  for (const entry of input.retention) {
    const simulated = input.safety.candidates.find(
      (candidate) => candidate.candidate_id === entry.candidate_id,
    );
    /* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unnecessary-boolean-literal-compare */
    if (
      simulated?.action !== entry.action ||
      (entry.action === "replace" && entry.prune_explicitly_confirmed !== true)
    )
      return "retention-mismatch";
    /* eslint-enable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unnecessary-boolean-literal-compare */
  }
  return null;
}

export function produceReplacementToolV2Previews(
  sourceTree: GameTree,
  input: ReplacementToolV2Input,
  options: {
    readonly signal?: AbortSignal;
    readonly shouldCancel?: () => boolean;
    readonly expected_repertoire_revision?: string;
    readonly expected_repertoire_color?: "white" | "black";
  } = {},
): ReplacementToolV2Result {
  if (
    (options.expected_repertoire_revision !== undefined &&
      input.replacement_request.repertoire_revision !== options.expected_repertoire_revision) ||
    (options.expected_repertoire_color !== undefined &&
      input.replacement_request.repertoire_color !== options.expected_repertoire_color)
  ) {
    return result(
      input,
      "stale",
      "safety-mismatch",
      "Replacement evidence does not belong to the injected host repertoire revision and ownership.",
      [],
    );
  }
  let boundaryError: ReplacementToolV2ErrorCode | null;
  try {
    boundaryError = boundary(input);
  } catch {
    return result(
      input,
      "invalid",
      "invalid-request",
      "Malformed retained replacement evidence could not be decoded.",
      [],
    );
  }
  if (boundaryError)
    return result(
      input,
      boundaryError.includes("mismatch") ? "stale" : "invalid",
      boundaryError,
      "Replacement request and retained evidence do not share one current canonical identity chain.",
      [],
    );
  const cancelled = () => options.signal?.aborted === true || options.shouldCancel?.() === true;
  if (cancelled())
    return result(
      input,
      "cancelled",
      "cancelled",
      "Replacement preview generation was cancelled.",
      [],
    );
  const retention = new Map(input.retention.map((entry) => [entry.candidate_id, entry]));
  const items: ReplacementToolV2Item[] = [];
  for (const candidateId of input.candidate_ids) {
    if (cancelled()) {
      items.push(
        item(
          candidateId,
          "cancelled",
          "cancelled",
          "Candidate preview was cancelled.",
          input.safety.provenance,
        ),
      );
      continue;
    }
    const candidate = input.safety.candidates.find((entry) => entry.candidate_id === candidateId);
    if (!candidate) {
      items.push(
        item(
          candidateId,
          "invalid",
          "candidate-not-found",
          "Candidate is absent from current safety evidence.",
          input.safety.provenance,
        ),
      );
      continue;
    }
    let constructed;
    try {
      constructed = constructReplacementChangeSet({
        source_tree: sourceTree,
        current_repertoire_revision: input.replacement_request.repertoire_revision,
        safety: input.safety,
        candidate_id: candidateId,
        promote_candidate_to_mainline:
          retention.get(candidateId)?.promote_candidate_to_mainline === true,
      });
    } catch {
      items.push(
        item(
          candidateId,
          "invalid",
          "preview-failed",
          "Malformed retained candidate evidence could not be decoded.",
          input.safety.provenance,
        ),
      );
      continue;
    }
    if (!constructed.change_set) {
      items.push(
        item(
          candidateId,
          constructed.status === "stale" ? "stale" : "blocked",
          constructed.error_code,
          constructed.explanation,
          candidate.provenance,
        ),
      );
      continue;
    }
    let preview;
    try {
      preview = applyReplacementChangeSet({
        source_tree: sourceTree,
        current_repertoire_revision: input.replacement_request.repertoire_revision,
        safety: input.safety,
        change_set: constructed.change_set,
      });
    } catch {
      items.push(
        item(
          candidateId,
          "invalid",
          "preview-failed",
          "Malformed retained change-set evidence could not be decoded.",
          candidate.provenance,
          constructed.change_set,
        ),
      );
      continue;
    }
    if (preview.status !== "success") {
      items.push(
        item(
          candidateId,
          preview.output.status === "stale" ? "stale" : "invalid",
          preview.output.failure.code as ReplacementChangeSetErrorCode,
          preview.output.failure.explanation,
          candidate.provenance,
          constructed.change_set,
        ),
      );
      continue;
    }
    items.push(
      item(
        candidateId,
        "previewed",
        null,
        "Complete atomic change-set preview is ready for explicit host staging.",
        candidate.provenance,
        constructed.change_set,
        preview.output,
      ),
    );
  }
  const previewed = items.filter((entry) => entry.status === "previewed").length;
  const stale = items.some((entry) => entry.status === "stale");
  const wasCancelled = items.some((entry) => entry.status === "cancelled");
  return result(
    input,
    wasCancelled && previewed === 0
      ? "cancelled"
      : stale && previewed === 0
        ? "stale"
        : previewed === items.length
          ? "complete"
          : "partial",
    wasCancelled && previewed === 0 ? "cancelled" : null,
    previewed === items.length
      ? "Every selected candidate produced a complete immutable change-set preview."
      : "Some selected candidates retained structured stale, blocked, invalid, or cancelled results.",
    items,
  );
}

export const composeReplacementToolV2 = produceReplacementToolV2Previews;
