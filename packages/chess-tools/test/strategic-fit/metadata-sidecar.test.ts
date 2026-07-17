import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_FIT_DOCUMENT_METADATA_KIND,
  STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
  analyzeStrategicFit,
  completeStrategicFitReport,
  createDefaultStrategicFitDocumentMetadata,
  exportStrategicFitIntentPgn,
  parseStrategicFitSidecar,
  previewStrategicFitSidecarMerge,
  serializeStrategicFitSidecar,
  strategicFitCompleteAnalysisOptions,
  strategicFitProfileSnapshot,
  type StrategicFitDocumentMetadata,
  type StrategicFitPersistedResolution,
} from "../../src/index.ts";
import { SHALLOW_LINES_FIXTURE, parseStrategicFitFixture } from "./fixtures.ts";

const SOURCE = {
  source_id: "sidecar:user",
  kind: "user-profile" as const,
  state: "available" as const,
  version: STRATEGIC_FIT_SCHEMA_VERSION,
  snapshot: "browser:7",
  reason: "Confirmed by the user.",
};

function resolution(
  semanticId: string,
  resolutionId: string,
  state: "active" | "stale" = "active",
  note = "Keep this {sharp} idea.\nNo surprise.",
): StrategicFitPersistedResolution {
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    resolution_id: resolutionId,
    finding_id: `finding:${semanticId}`,
    semantic_finding_id: semanticId,
    repertoire_revision: "browser:7",
    state: "keep-intentionally",
    intentional_reason: "strategically-desirable",
    note,
    references: {
      position_ids: ["position:semantic"],
      decision_ids: ["decision:semantic"],
      route_ids: ["route:semantic"],
      source_san_paths: [["e4", "e5"]],
    },
    invalidation_rules: ["referenced-position-changed"],
    expires_at: null,
    linked_training_ids: [],
    linked_staged_edit_ids: [],
    created_at: "2026-07-17T12:00:00.000Z",
    profile_snapshot: null,
    record_state: state,
    stale_reasons: state === "stale" ? ["referenced-position-missing"] : [],
    reason: "Tournament {intent}",
    updated_at: "2026-07-17T12:00:00.000Z",
    provenance: [SOURCE],
  };
}

function metadata(label: string): StrategicFitDocumentMetadata {
  const base = createDefaultStrategicFitDocumentMetadata();
  const profile = {
    ...base.profile,
    mode: "custom" as const,
    source: "explicit" as const,
    provisional: false,
    preferences: {
      ...base.profile.preferences,
      preferred_concept_ids: [`concept:${label}`],
      manual_weight_importance: 0.75,
    },
  };
  return {
    ...base,
    profile,
    manual_weights: {
      route_weights: [{
        route_id: "route:shared",
        weight: label === "incoming" ? 9 : 2,
        record_state: "active",
        stale_reasons: [],
        reason: label,
        updated_at: "2026-07-17T12:00:00.000Z",
        provenance: [SOURCE],
      }],
      decision_weights: [],
    },
    resolutions: [resolution("semantic:shared", `resolution:${label}`)],
    provenance: [{ ...SOURCE, source_id: `sidecar:${label}` }],
  };
}

test("sidecar export is deterministic, round-trips, and strips malicious secrets recursively", () => {
  const source = metadata("local") as unknown as Record<string, unknown>;
  source.lichess_token = "top-secret";
  (source.profile as unknown as Record<string, unknown>).api_key = "top-secret";
  const first = serializeStrategicFitSidecar("123e4567-e89b-42d3-a456-426614174000", source);
  const second = serializeStrategicFitSidecar("123e4567-e89b-42d3-a456-426614174000", source);

  assert.equal(first, second);
  assert.doesNotMatch(first, /top-secret|lichess_token|api_key/);
  const parsed = parseStrategicFitSidecar(first);
  assert.equal("ok" in parsed && parsed.ok, true);
  if (!("ok" in parsed)) return;
  assert.deepEqual(parsed.sidecar.metadata, metadata("local"));
  assert.equal(parsed.presence.resolutions, true);
});

test("untrusted sidecars return stable structured errors for malformed, malicious, and incompatible data", () => {
  assert.deepEqual(parseStrategicFitSidecar("{"), {
    error: "strategic_fit_sidecar_import_error",
    code: "malformed-json",
    path: "$",
    reason: "The Strategic Fit sidecar is not valid JSON.",
    metadata_issues: [],
  });
  const valid = JSON.parse(serializeStrategicFitSidecar("document:one", metadata("local"))) as Record<string, unknown>;
  assert.equal(parseStrategicFitSidecar({ ...valid, bearer: "secret" }).code, "invalid-envelope");
  assert.equal(parseStrategicFitSidecar({ ...valid, sidecar_version: "99.0.0" }).code, "unsupported-version");
  assert.equal(parseStrategicFitSidecar({ ...valid, document_id: "" }).code, "invalid-document-id");
  const nested = structuredClone(valid) as { metadata: Record<string, unknown> };
  (nested.metadata.profile as Record<string, unknown>).credentials = { token: "secret" };
  const nestedResult = parseStrategicFitSidecar(nested);
  assert.equal(nestedResult.code, "invalid-metadata");
  assert.ok(nestedResult.metadata_issues.some((entry) => entry.code === "unknown-field-ignored"));
  const incompatible = structuredClone(valid) as { metadata: Record<string, unknown> };
  incompatible.metadata.metadata_version = "8.0.0";
  assert.equal(parseStrategicFitSidecar(incompatible).code, "unsupported-version");
  const invalidCollection = structuredClone(valid) as { metadata: Record<string, unknown> };
  invalidCollection.metadata.manual_weights = "not-an-object";
  assert.equal(parseStrategicFitSidecar(invalidCollection).code, "invalid-metadata");
});

test("merge preview replaces durable identities, preserves unmatched records, and never reactivates stale imports", () => {
  const lifecycle = {
    record_state: "active" as const,
    stale_reasons: [],
    reason: null,
    updated_at: "2026-07-17T12:00:00.000Z",
    provenance: [SOURCE],
  };
  const local = {
    ...metadata("local"),
    manual_weights: {
      ...metadata("local").manual_weights,
      decision_weights: [{ decision_id: "decision:shared", weight: 1, ...lifecycle }],
    },
    cohort_overrides: [{ override_id: "override:shared", kind: "merge" as const, route_ids: ["route:shared"], ...lifecycle }],
    archive_references: [{
      archive_id: "archive:shared",
      repertoire_revision: "browser:7",
      references: resolution("semantic:x", "resolution:x").references,
      linked_staged_edit_id: null,
      created_at: "2026-07-17T12:00:00.000Z",
      provenance: [SOURCE],
    }],
    training_references: [{
      training_id: "training:shared",
      finding_id: "finding:shared",
      repertoire_revision: "browser:7",
      references: resolution("semantic:x", "resolution:x").references,
      created_at: "2026-07-17T12:00:00.000Z",
      provenance: [SOURCE],
    }],
  };
  const incoming = {
    ...metadata("incoming"),
    manual_weights: {
      ...metadata("incoming").manual_weights,
      decision_weights: [{ decision_id: "decision:shared", weight: 7, ...lifecycle }],
    },
    exclusions: [{
      override_id: "override:shared",
      kind: "exclude" as const,
      route_ids: ["route:shared"],
      decision_ids: [],
      ...lifecycle,
    }],
    archive_references: [{
      ...local.archive_references[0]!,
      linked_staged_edit_id: "edit:incoming",
    }],
    training_references: [{
      ...local.training_references[0]!,
      finding_id: "finding:incoming",
    }],
  };
  const incomingStale = resolution("semantic:stale", "resolution:stale", "stale");
  const text = serializeStrategicFitSidecar("document:other", {
    ...incoming,
    resolutions: [...incoming.resolutions, incomingStale],
    manual_weights: {
      ...incoming.manual_weights,
      route_weights: [
        ...incoming.manual_weights.route_weights,
        { ...incoming.manual_weights.route_weights[0]!, route_id: "route:added" },
      ],
    },
  });
  const parsed = parseStrategicFitSidecar(text);
  assert.ok("ok" in parsed);
  if (!("ok" in parsed)) return;
  const preview = previewStrategicFitSidecarMerge("document:current", local, parsed);

  assert.equal(preview.document_id_mismatch, true);
  assert.equal(preview.profile.changed, true);
  assert.deepEqual(preview.collections.route_weights.replaced, ["route:shared"]);
  assert.deepEqual(preview.collections.route_weights.added, ["route:added"]);
  assert.deepEqual(preview.collections.decision_weights.replaced, ["decision:shared"]);
  assert.deepEqual(preview.collections.overrides.replaced, ["override:shared"]);
  assert.deepEqual(preview.collections.resolutions.replaced, ["semantic-finding:semantic:shared"]);
  assert.deepEqual(preview.collections.archive_references.replaced, ["archive:shared"]);
  assert.deepEqual(preview.collections.training_references.replaced, ["training:shared"]);
  assert.deepEqual(preview.collections.resolutions.incoming_stale, ["semantic-finding:semantic:stale"]);
  assert.equal(preview.merged_metadata.manual_weights.route_weights.find((entry) => entry.route_id === "route:shared")?.weight, 9);
  assert.equal(preview.merged_metadata.resolutions.find((entry) => entry.semantic_finding_id === "semantic:shared")?.resolution_id, "resolution:incoming");
  assert.equal(preview.merged_metadata.resolutions.find((entry) => entry.semantic_finding_id === "semantic:stale")?.record_state, "stale");
  assert.equal(preview.merged_metadata.exclusions[0]?.override_id, "override:shared");
  assert.equal(preview.merged_metadata.cohort_overrides.length, 0);
  assert.equal(preview.merged_metadata.training_references[0]?.finding_id, "finding:incoming");
});

test("missing incoming collections preserve local records while a supplied profile replaces only after preview", () => {
  const incoming = metadata("incoming");
  const partial = {
    sidecar_kind: "chess-mcp/strategic-fit-sidecar",
    sidecar_version: "1.0.0",
    document_id: "document:current",
    metadata: {
      metadata_kind: STRATEGIC_FIT_DOCUMENT_METADATA_KIND,
      metadata_version: STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
      profile: incoming.profile,
    },
  };
  const parsed = parseStrategicFitSidecar(partial);
  assert.ok("ok" in parsed);
  if (!("ok" in parsed)) return;
  const local = metadata("local");
  const preview = previewStrategicFitSidecarMerge("document:current", local, parsed);
  assert.equal(preview.document_id_mismatch, false);
  assert.equal(preview.profile.changed, true);
  assert.equal(preview.merged_metadata.profile.preferences.preferred_concept_ids[0], "concept:incoming");
  assert.deepEqual(preview.merged_metadata.resolutions, local.resolutions);
  assert.deepEqual(preview.collections.resolutions.preserved, ["semantic-finding:semantic:shared"]);
});

test("portable intent PGN is legal, escaped, bounded, semantic, and clone-only", () => {
  const tree = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *");
  const before = tree.toPgn();
  const report = completeStrategicFitReport(analyzeStrategicFit(
    parseStrategicFitFixture(SHALLOW_LINES_FIXTURE),
    strategicFitCompleteAnalysisOptions({
      repertoireColor: SHALLOW_LINES_FIXTURE.repertoireColor,
      repertoireRevision: "browser:7",
    }),
  ));
  const finding = report.findings[0];
  assert.ok(finding);
  const projectedFinding = {
    ...finding,
    semantic_finding_id: "semantic:finding-with-{brace}",
    references: { ...finding.references, source_san_paths: [["e4", "e5"]] },
    explanation: `${finding.explanation} {unsafe}\nsecret-looking text is ordinary evidence`,
  };
  const sourceMetadata = metadata("local");
  const exported = exportStrategicFitIntentPgn(tree, {
    ...sourceMetadata,
    resolutions: [{
      ...sourceMetadata.resolutions[0]!,
      profile_snapshot: strategicFitProfileSnapshot(sourceMetadata.profile),
    }],
  }, { findings: [projectedFinding], max_findings: 1, max_resolutions: 1, max_comment_chars: 300 });

  assert.equal(tree.toPgn(), before);
  assert.equal(exported.profile_comments, 1);
  assert.equal(exported.resolution_comments, 1);
  assert.equal(exported.finding_comments, 1);
  assert.match(exported.pgn, /semantic_finding=semantic:shared/);
  assert.match(exported.pgn, /semantic_finding=semantic:finding-with-\(brace\)/);
  assert.doesNotMatch(exported.pgn, /\{unsafe\}/);
  assert.doesNotThrow(() => GameTree.fromPgn(exported.pgn));
  assert.equal(GameTree.fromPgn(exported.pgn).stats().nodes, tree.stats().nodes);
});
