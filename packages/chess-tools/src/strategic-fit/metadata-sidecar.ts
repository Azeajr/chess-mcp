/**
 * Portable Strategic Fit sidecars and intent-PGN projections.
 *
 * Sidecars are a deterministic, strict, secret-free projection of the canonical document
 * metadata. Import is deliberately split into parse/preview/merge operations so hosts can bind a
 * preview to their own document identity and require explicit confirmation before persistence.
 */
import type { ChildNode, PgnNodeData } from "chessops/pgn";
import type { GameTree } from "../pgn.js";
import {
  STRATEGIC_FIT_DOCUMENT_METADATA_KIND,
  STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
  createDefaultStrategicFitDocumentMetadata,
  normalizeStrategicFitDocumentMetadata,
  type StrategicFitDocumentMetadata,
  type StrategicFitMetadataIssue,
  type StrategicFitPersistedResolution,
} from "./metadata.js";
import type { StrategicFinding, StrategicFitProfile } from "./types.js";

export const STRATEGIC_FIT_SIDECAR_KIND = "chess-mcp/strategic-fit-sidecar";
export const STRATEGIC_FIT_SIDECAR_VERSION = "1.0.0";

export interface StrategicFitSidecarEnvelope {
  readonly sidecar_kind: typeof STRATEGIC_FIT_SIDECAR_KIND;
  readonly sidecar_version: typeof STRATEGIC_FIT_SIDECAR_VERSION;
  readonly document_id: string;
  readonly metadata: StrategicFitDocumentMetadata;
}

export const STRATEGIC_FIT_SIDECAR_ERROR_CODES = [
  "malformed-json",
  "invalid-envelope",
  "unsupported-version",
  "invalid-document-id",
  "invalid-metadata",
] as const;
export type StrategicFitSidecarErrorCode = (typeof STRATEGIC_FIT_SIDECAR_ERROR_CODES)[number];

export interface StrategicFitSidecarError {
  readonly error: "strategic_fit_sidecar_import_error";
  readonly code: StrategicFitSidecarErrorCode;
  readonly path: string;
  readonly reason: string;
  readonly metadata_issues: readonly StrategicFitMetadataIssue[];
}

export interface StrategicFitSidecarMetadataPresence {
  readonly profile: boolean;
  readonly route_weights: boolean;
  readonly decision_weights: boolean;
  readonly cohort_overrides: boolean;
  readonly exclusions: boolean;
  readonly resolutions: boolean;
  readonly archive_references: boolean;
  readonly training_references: boolean;
  readonly provenance: boolean;
}

export interface ParsedStrategicFitSidecar {
  readonly ok: true;
  readonly sidecar: StrategicFitSidecarEnvelope;
  readonly presence: StrategicFitSidecarMetadataPresence;
  readonly metadata_state: "valid" | "migrated";
}

type RecordLike = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordLike =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const error = (
  code: StrategicFitSidecarErrorCode,
  path: string,
  reason: string,
  metadataIssues: readonly StrategicFitMetadataIssue[] = [],
): StrategicFitSidecarError => ({
  error: "strategic_fit_sidecar_import_error",
  code,
  path,
  reason,
  metadata_issues: metadataIssues,
});

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as RecordLike)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

function canonicalMetadata(input: unknown): StrategicFitDocumentMetadata {
  // Normalization reconstructs every nested object from an explicit whitelist. Even deliberately
  // malicious credential fields therefore cannot enter the exported envelope.
  return normalizeStrategicFitDocumentMetadata(input).metadata;
}

export function createStrategicFitSidecar(
  documentId: string,
  metadata: unknown,
): StrategicFitSidecarEnvelope {
  const normalizedId = documentId.trim();
  if (normalizedId.length === 0 || normalizedId.length > 256) {
    throw new Error("strategic_fit_sidecar_invalid_document_id");
  }
  return {
    sidecar_kind: STRATEGIC_FIT_SIDECAR_KIND,
    sidecar_version: STRATEGIC_FIT_SIDECAR_VERSION,
    document_id: normalizedId,
    metadata: canonicalMetadata(metadata),
  };
}

/** Deterministic bytes for download, cache identity, and round-trip tests. */
export function serializeStrategicFitSidecar(
  documentId: string,
  metadata: unknown,
): string {
  return `${stableJson(createStrategicFitSidecar(documentId, metadata))}\n`;
}

function completePartialMetadata(value: RecordLike): {
  readonly candidate: RecordLike;
  readonly presence: StrategicFitSidecarMetadataPresence;
} {
  const defaults = createDefaultStrategicFitDocumentMetadata();
  const manualSupplied = Object.hasOwn(value, "manual_weights");
  const manual = isRecord(value.manual_weights) ? value.manual_weights : null;
  const presence: StrategicFitSidecarMetadataPresence = {
    profile: Object.hasOwn(value, "profile"),
    route_weights: manual !== null && Object.hasOwn(manual, "route_weights"),
    decision_weights: manual !== null && Object.hasOwn(manual, "decision_weights"),
    cohort_overrides: Object.hasOwn(value, "cohort_overrides"),
    exclusions: Object.hasOwn(value, "exclusions"),
    resolutions: Object.hasOwn(value, "resolutions"),
    archive_references: Object.hasOwn(value, "archive_references"),
    training_references: Object.hasOwn(value, "training_references"),
    provenance: Object.hasOwn(value, "provenance"),
  };
  return {
    presence,
    candidate: {
      ...value,
      profile: presence.profile ? value.profile : defaults.profile,
      manual_weights: manualSupplied && manual === null
        ? value.manual_weights
        : {
            ...(manual ?? {}),
            route_weights: presence.route_weights ? manual!.route_weights : [],
            decision_weights: presence.decision_weights ? manual!.decision_weights : [],
          },
      cohort_overrides: presence.cohort_overrides ? value.cohort_overrides : [],
      exclusions: presence.exclusions ? value.exclusions : [],
      resolutions: presence.resolutions ? value.resolutions : [],
      archive_references: presence.archive_references ? value.archive_references : [],
      training_references: presence.training_references ? value.training_references : [],
      provenance: presence.provenance ? value.provenance : [],
    },
  };
}

/** Strictly parse untrusted JSON/structured data without mutating or falling back silently. */
export function parseStrategicFitSidecar(
  input: string | unknown,
): ParsedStrategicFitSidecar | StrategicFitSidecarError {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return error("malformed-json", "$", "The Strategic Fit sidecar is not valid JSON.");
    }
  }
  if (!isRecord(value)) {
    return error("invalid-envelope", "$", "The Strategic Fit sidecar must be an object.");
  }
  const allowed = new Set(["sidecar_kind", "sidecar_version", "document_id", "metadata"]);
  const unknown = Object.keys(value).sort().find((key) => !allowed.has(key));
  if (unknown !== undefined) {
    return error("invalid-envelope", `$.${unknown}`, "The sidecar contains a non-whitelisted field.");
  }
  if (value.sidecar_kind !== STRATEGIC_FIT_SIDECAR_KIND) {
    return error("invalid-envelope", "$.sidecar_kind", "The sidecar kind is missing or incompatible.");
  }
  if (value.sidecar_version !== STRATEGIC_FIT_SIDECAR_VERSION) {
    return error(
      "unsupported-version",
      "$.sidecar_version",
      `Unsupported Strategic Fit sidecar version: ${String(value.sidecar_version)}`,
    );
  }
  if (typeof value.document_id !== "string" || value.document_id.trim().length === 0 ||
    value.document_id.length > 256) {
    return error("invalid-document-id", "$.document_id", "The sidecar document ID is invalid.");
  }
  if (!isRecord(value.metadata)) {
    return error("invalid-metadata", "$.metadata", "The sidecar metadata must be an object.");
  }
  const allowedMetadata = new Set([
    "metadata_kind", "metadata_version", "profile", "manual_weights", "cohort_overrides",
    "exclusions", "resolutions", "archive_references", "training_references", "provenance",
  ]);
  const unknownMetadata = Object.keys(value.metadata).sort().find((key) => !allowedMetadata.has(key));
  if (unknownMetadata !== undefined) {
    return error(
      "invalid-metadata",
      `$.metadata.${unknownMetadata}`,
      "The sidecar metadata contains a non-whitelisted field.",
    );
  }
  if (value.metadata.metadata_kind !== STRATEGIC_FIT_DOCUMENT_METADATA_KIND) {
    return error("invalid-metadata", "$.metadata.metadata_kind", "The metadata kind is incompatible.");
  }
  const { candidate, presence } = completePartialMetadata(value.metadata);
  const normalized = normalizeStrategicFitDocumentMetadata(candidate);
  if (normalized.state === "fallback" || normalized.issues.length > 0) {
    const unsupported = normalized.issues.some((issue) => issue.code === "unsupported-version");
    return error(
      unsupported ? "unsupported-version" : "invalid-metadata",
      unsupported ? "$.metadata.metadata_version" : "$.metadata",
      unsupported
        ? `Unsupported Strategic Fit metadata version: ${String(value.metadata.metadata_version)}`
        : "The sidecar metadata is invalid or contains non-whitelisted nested fields.",
      normalized.issues,
    );
  }
  return {
    ok: true,
    presence,
    metadata_state: normalized.state,
    sidecar: {
      sidecar_kind: STRATEGIC_FIT_SIDECAR_KIND,
      sidecar_version: STRATEGIC_FIT_SIDECAR_VERSION,
      document_id: value.document_id.trim(),
      metadata: normalized.metadata,
    },
  };
}

export interface StrategicFitSidecarCollectionPreview {
  readonly added: readonly string[];
  readonly replaced: readonly string[];
  readonly preserved: readonly string[];
  readonly incoming_stale: readonly string[];
}

export interface StrategicFitSidecarMergePreview {
  readonly source_document_id: string;
  readonly target_document_id: string;
  readonly document_id_mismatch: boolean;
  readonly profile: {
    readonly supplied: boolean;
    readonly changed: boolean;
    readonly local: StrategicFitProfile;
    readonly incoming: StrategicFitProfile | null;
  };
  readonly collections: {
    readonly route_weights: StrategicFitSidecarCollectionPreview;
    readonly decision_weights: StrategicFitSidecarCollectionPreview;
    readonly overrides: StrategicFitSidecarCollectionPreview;
    readonly resolutions: StrategicFitSidecarCollectionPreview;
    readonly archive_references: StrategicFitSidecarCollectionPreview;
    readonly training_references: StrategicFitSidecarCollectionPreview;
    readonly provenance: StrategicFitSidecarCollectionPreview;
  };
  readonly merged_metadata: StrategicFitDocumentMetadata;
}

const recordState = (value: unknown): string | undefined =>
  isRecord(value) && value.record_state === "stale" ? "stale" : undefined;

function mergedRecords<T>(
  local: readonly T[],
  incoming: readonly T[],
  identity: (entry: T) => string,
): { records: T[]; preview: StrategicFitSidecarCollectionPreview } {
  const localById = new Map(local.map((entry) => [identity(entry), entry]));
  const incomingById = new Map(incoming.map((entry) => [identity(entry), entry]));
  const records = new Map(localById);
  for (const [id, entry] of incomingById) records.set(id, entry);
  const incomingIds = [...incomingById.keys()].sort();
  return {
    records: [...records.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, entry]) => entry),
    preview: {
      added: incomingIds.filter((id) => !localById.has(id)),
      replaced: incomingIds.filter((id) => localById.has(id)),
      preserved: [...localById.keys()].filter((id) => !incomingById.has(id)).sort(),
      incoming_stale: incomingIds.filter((id) => recordState(incomingById.get(id)) === "stale"),
    },
  };
}

const resolutionIdentity = (entry: StrategicFitPersistedResolution): string =>
  entry.semantic_finding_id === null
    ? `legacy-resolution:${entry.resolution_id}`
    : `semantic-finding:${entry.semantic_finding_id}`;

/** Apply the approved incoming-wins-by-identity merge policy without mutating either input. */
export function previewStrategicFitSidecarMerge(
  targetDocumentId: string,
  localInput: StrategicFitDocumentMetadata,
  parsed: ParsedStrategicFitSidecar,
): StrategicFitSidecarMergePreview {
  const local = canonicalMetadata(localInput);
  const incoming = parsed.sidecar.metadata;
  const routeWeights = mergedRecords(
    local.manual_weights.route_weights,
    parsed.presence.route_weights ? incoming.manual_weights.route_weights : [],
    (entry) => entry.route_id,
  );
  const decisionWeights = mergedRecords(
    local.manual_weights.decision_weights,
    parsed.presence.decision_weights ? incoming.manual_weights.decision_weights : [],
    (entry) => entry.decision_id,
  );
  const localOverrides = [...local.cohort_overrides, ...local.exclusions];
  const incomingOverrides = [
    ...(parsed.presence.cohort_overrides ? incoming.cohort_overrides : []),
    ...(parsed.presence.exclusions ? incoming.exclusions : []),
  ];
  const overrides = mergedRecords(localOverrides, incomingOverrides, (entry) => entry.override_id);
  const resolutions = mergedRecords(
    local.resolutions,
    parsed.presence.resolutions ? incoming.resolutions : [],
    resolutionIdentity,
  );
  const archives = mergedRecords(
    local.archive_references,
    parsed.presence.archive_references ? incoming.archive_references : [],
    (entry) => entry.archive_id,
  );
  const training = mergedRecords(
    local.training_references,
    parsed.presence.training_references ? incoming.training_references : [],
    (entry) => entry.training_id,
  );
  const provenance = mergedRecords(
    local.provenance,
    parsed.presence.provenance ? incoming.provenance : [],
    (entry) => entry.source_id,
  );
  const merged = canonicalMetadata({
    ...local,
    profile: parsed.presence.profile ? incoming.profile : local.profile,
    manual_weights: {
      route_weights: routeWeights.records,
      decision_weights: decisionWeights.records,
    },
    cohort_overrides: overrides.records.filter((entry) => entry.kind !== "exclude"),
    exclusions: overrides.records.filter((entry) => entry.kind === "exclude"),
    resolutions: resolutions.records,
    archive_references: archives.records,
    training_references: training.records,
    provenance: provenance.records,
  });
  return {
    source_document_id: parsed.sidecar.document_id,
    target_document_id: targetDocumentId,
    document_id_mismatch: parsed.sidecar.document_id !== targetDocumentId,
    profile: {
      supplied: parsed.presence.profile,
      changed: parsed.presence.profile && stableJson(incoming.profile) !== stableJson(local.profile),
      local: local.profile,
      incoming: parsed.presence.profile ? incoming.profile : null,
    },
    collections: {
      route_weights: routeWeights.preview,
      decision_weights: decisionWeights.preview,
      overrides: overrides.preview,
      resolutions: resolutions.preview,
      archive_references: archives.preview,
      training_references: training.preview,
      provenance: provenance.preview,
    },
    merged_metadata: merged,
  };
}

export interface StrategicFitIntentPgnExportOptions {
  readonly findings?: readonly StrategicFinding[];
  readonly max_findings?: number;
  readonly max_resolutions?: number;
  readonly max_comment_chars?: number;
}

export interface StrategicFitIntentPgnExport {
  readonly pgn: string;
  readonly profile_comments: number;
  readonly resolution_comments: number;
  readonly finding_comments: number;
  readonly skipped_paths: number;
}

function commentText(value: string, maximum: number): string {
  const safe = value.replace(/[{}]/g, (character) => character === "{" ? "(" : ")")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return safe.length <= maximum ? safe : `${safe.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function addComment(tree: GameTree, path: readonly string[], text: string): boolean {
  if (path.length === 0) {
    (tree.game.comments ??= []).push(text);
    return true;
  }
  const indexPath = tree.indexPathOfSan([...path]);
  if (indexPath === null) return false;
  const node = tree.nodeAt(indexPath) as ChildNode<PgnNodeData>;
  (node.data.comments ??= []).push(text);
  return true;
}

/** Create a legal clone-only PGN projection; comments are never read back as canonical metadata. */
export function exportStrategicFitIntentPgn(
  source: GameTree,
  metadataInput: StrategicFitDocumentMetadata,
  options: StrategicFitIntentPgnExportOptions = {},
): StrategicFitIntentPgnExport {
  const metadata = canonicalMetadata(metadataInput);
  const clone = source.clone();
  const maximum = Math.max(80, Math.min(2_000, options.max_comment_chars ?? 600));
  const maxResolutions = Math.max(0, Math.min(100, options.max_resolutions ?? 25));
  const maxFindings = Math.max(0, Math.min(100, options.max_findings ?? 25));
  let profileComments = 0;
  let resolutionComments = 0;
  let findingComments = 0;
  let skippedPaths = 0;

  if (metadata.profile.source === "explicit" && !metadata.profile.provisional) {
    const text = commentText(
      `Strategic Fit intent [metadata=${metadata.metadata_version}; semantic=profile; ` +
        `profile=${metadata.profile.mode}; status=confirmed]: explicit user profile.`,
      maximum,
    );
    addComment(clone, [], text);
    profileComments++;
  }

  const resolutions = metadata.resolutions
    .filter((entry) => entry.record_state === "active" && entry.semantic_finding_id !== null)
    .sort((left, right) => resolutionIdentity(left).localeCompare(resolutionIdentity(right)))
    .slice(0, maxResolutions);
  for (const resolution of resolutions) {
    const detail = [
      resolution.intentional_reason ? `intent=${resolution.intentional_reason}` : null,
      resolution.reason ? `reason=${resolution.reason}` : null,
      resolution.note ? `note=${resolution.note}` : null,
    ].filter((entry): entry is string => entry !== null).join("; ");
    const text = commentText(
      `Strategic Fit resolution [metadata=${metadata.metadata_version}; ` +
        `semantic_finding=${resolution.semantic_finding_id}; resolution=${resolution.resolution_id}; ` +
        `state=${resolution.state}; status=active]${detail ? `: ${detail}` : "."}`,
      maximum,
    );
    const paths = resolution.references.source_san_paths.length > 0
      ? resolution.references.source_san_paths
      : [[]];
    for (const path of paths) {
      if (addComment(clone, path, text)) resolutionComments++;
      else skippedPaths++;
    }
  }

  const findings = [...(options.findings ?? [])]
    .sort((left, right) => left.finding_id.localeCompare(right.finding_id))
    .slice(0, maxFindings);
  for (const finding of findings) {
    const text = commentText(
      `Strategic Fit finding [analysis=${finding.analysis_version}; ` +
        `semantic_finding=${finding.semantic_finding_id}; finding=${finding.finding_id}; ` +
        `classification=${finding.classification}; resolution=${finding.resolution_state}]: ` +
        `${finding.plain_language_category} — ${finding.explanation}`,
      maximum,
    );
    for (const path of finding.references.source_san_paths) {
      if (addComment(clone, path, text)) findingComments++;
      else skippedPaths++;
    }
  }

  return {
    pgn: clone.toPgn(),
    profile_comments: profileComments,
    resolution_comments: resolutionComments,
    finding_comments: findingComments,
    skipped_paths: skippedPaths,
  };
}
