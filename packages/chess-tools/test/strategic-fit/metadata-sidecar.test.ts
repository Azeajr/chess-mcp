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
      route_weights: [
        {
          route_id: "route:shared",
          weight: label === "incoming" ? 9 : 2,
          record_state: "active",
          stale_reasons: [],
          reason: label,
          updated_at: "2026-07-17T12:00:00.000Z",
          provenance: [SOURCE],
        },
      ],
      decision_weights: [],
    },
    cohort_labels: [
      {
        label_id: "cohort-label:shared",
        cohort_id: "cohort:shared",
        display_name: label === "incoming" ? "Incoming name" : "Local name",
        record_state: "active",
        stale_reasons: [],
        reason: label,
        updated_at: "2026-07-17T12:00:00.000Z",
        provenance: [SOURCE],
      },
    ],
    resolutions: [resolution("semantic:shared", `resolution:${label}`)],
    comment_intents: [
      {
        decision_id: `comment-intent-decision:${label}`,
        suggestion_id: "comment-intent:shared",
        disposition: label === "incoming" ? ("confirmed" as const) : ("rejected" as const),
        kind: "tournament-weapon" as const,
        intent_value: "tournament-specific",
        detection: "phrase" as const,
        source_comment: "Tournament weapon for team events",
        source_match: "Tournament weapon",
        source_comment_index: 0,
        source_match_index: 0,
        source_san_path: ["e4", "e5"],
        references: resolution("semantic:intent", "resolution:intent").references,
        created_at: "2026-07-17T12:04:00.000Z",
        updated_at: "2026-07-17T12:04:00.000Z",
        provenance: [SOURCE],
      },
    ],
    provenance: [{ ...SOURCE, source_id: `sidecar:${label}` }],
  };
}

/**
 * F19: the deterministic ordering must be stable across *environments*, not just across repeated
 * calls in one process.
 *
 * The envelope's own key names are fixed ASCII, so `stableJson`'s key sort is not where this can
 * bite — the reachable surface is the sorts over caller-supplied identifiers (finding IDs,
 * resolution identities), which can hold any Unicode. `localeCompare` reads the runtime's default
 * collation, and locales genuinely disagree here: given "semantic:Alpha", "semantic:zulu",
 * "semantic:ärende", an sv-SE runtime emits ärende last while en-US emits it second. Two
 * installations would then produce different bytes for identical input.
 *
 * The three IDs below are chosen so that code-unit order and en-US collation order differ, which
 * is what makes this test fail if the sort regresses to localeCompare.
 */
test("finding comment order follows code units, not the runtime's locale collation", () => {
  const tree = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *");
  const report = completeStrategicFitReport(
    analyzeStrategicFit(
      parseStrategicFitFixture(SHALLOW_LINES_FIXTURE),
      strategicFitCompleteAnalysisOptions({
        repertoireColor: SHALLOW_LINES_FIXTURE.repertoireColor,
        repertoireRevision: "browser:7",
      }),
    ),
  );
  const base = report.findings[0];
  assert.ok(base);

  // Code-unit order: "Alpha" (U+0041) < "zulu" (U+007A) < "ärende" (U+00E4).
  // en-US collation instead groups "ä" with "a", yielding Alpha, ärende, zulu.
  const findings = ["finding:zulu", "finding:Alpha", "finding:ärende"].map((findingId) => ({
    ...base,
    finding_id: findingId,
    semantic_finding_id: `semantic:${findingId}`,
    references: { ...base.references, source_san_paths: [["e4", "e5"]] },
  }));

  const sourceMetadata = metadata("local");
  const exported = exportStrategicFitIntentPgn(
    tree,
    { ...sourceMetadata, resolutions: [] },
    { findings, max_findings: 3, max_resolutions: 0, max_comment_chars: 300 },
  );

  const emitted = [...exported.pgn.matchAll(/finding=(finding:[^;\]]+)/gu)].map(
    (match) => match[1] as string,
  );
  assert.deepEqual(
    emitted,
    ["finding:Alpha", "finding:zulu", "finding:ärende"],
    "identifiers are ordered by code unit; en-US collation would place ärende second",
  );
});

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
  assert.equal(parsed.presence.cohort_labels, true);
  assert.equal(parsed.presence.comment_intents, true);
});

test("untrusted sidecars return stable structured errors for malformed, malicious, and incompatible data", () => {
  assert.deepEqual(parseStrategicFitSidecar("{"), {
    error: "strategic_fit_sidecar_import_error",
    code: "malformed-json",
    path: "$",
    reason: "The Strategic Fit sidecar is not valid JSON.",
    metadata_issues: [],
  });
  const valid = JSON.parse(
    serializeStrategicFitSidecar("document:one", metadata("local")),
  ) as Record<string, unknown>;
  assert.equal(parseStrategicFitSidecar({ ...valid, bearer: "secret" }).code, "invalid-envelope");
  assert.equal(
    parseStrategicFitSidecar({ ...valid, sidecar_version: "99.0.0" }).code,
    "unsupported-version",
  );
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

test("a legacy 1.3.0 sidecar migrates with an empty comment-intent collection", () => {
  const legacy = JSON.parse(serializeStrategicFitSidecar("document:legacy", metadata("local"))) as {
    metadata: Record<string, unknown>;
  };
  legacy.metadata.metadata_version = "1.3.0";
  delete legacy.metadata.comment_intents;

  const parsed = parseStrategicFitSidecar(legacy);
  assert.ok("ok" in parsed);
  if (!("ok" in parsed)) return;
  assert.equal(parsed.metadata_state, "migrated");
  assert.deepEqual(parsed.sidecar.metadata.comment_intents, []);
  assert.equal(parsed.presence.comment_intents, false);
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
    cohort_overrides: [
      {
        override_id: "override:shared",
        kind: "merge" as const,
        route_ids: ["route:shared"],
        ...lifecycle,
      },
    ],
    archive_references: [
      {
        archive_id: "archive:shared",
        repertoire_revision: "browser:7",
        references: resolution("semantic:x", "resolution:x").references,
        linked_staged_edit_id: null,
        created_at: "2026-07-17T12:00:00.000Z",
        provenance: [SOURCE],
      },
    ],
    training_references: [
      {
        training_id: "training:shared",
        finding_id: "finding:shared",
        repertoire_revision: "browser:7",
        references: resolution("semantic:x", "resolution:x").references,
        created_at: "2026-07-17T12:00:00.000Z",
        provenance: [SOURCE],
      },
    ],
  };
  const incoming = {
    ...metadata("incoming"),
    manual_weights: {
      ...metadata("incoming").manual_weights,
      decision_weights: [{ decision_id: "decision:shared", weight: 7, ...lifecycle }],
    },
    exclusions: [
      {
        override_id: "override:shared",
        kind: "exclude" as const,
        route_ids: ["route:shared"],
        decision_ids: [],
        ...lifecycle,
      },
    ],
    archive_references: [
      {
        ...local.archive_references[0]!,
        linked_staged_edit_id: "edit:incoming",
      },
    ],
    training_references: [
      {
        ...local.training_references[0]!,
        finding_id: "finding:incoming",
      },
    ],
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
  assert.deepEqual(preview.collections.cohort_labels.replaced, ["cohort-label:shared"]);
  assert.deepEqual(preview.collections.resolutions.replaced, ["semantic-finding:semantic:shared"]);
  assert.deepEqual(preview.collections.archive_references.replaced, ["archive:shared"]);
  assert.deepEqual(preview.collections.training_references.replaced, ["training:shared"]);
  assert.deepEqual(preview.collections.comment_intents.replaced, ["comment-intent:shared"]);
  assert.deepEqual(preview.collections.resolutions.incoming_stale, [
    "semantic-finding:semantic:stale",
  ]);
  assert.equal(
    preview.merged_metadata.manual_weights.route_weights.find(
      (entry) => entry.route_id === "route:shared",
    )?.weight,
    9,
  );
  assert.equal(
    preview.merged_metadata.resolutions.find(
      (entry) => entry.semantic_finding_id === "semantic:shared",
    )?.resolution_id,
    "resolution:incoming",
  );
  assert.equal(
    preview.merged_metadata.resolutions.find(
      (entry) => entry.semantic_finding_id === "semantic:stale",
    )?.record_state,
    "stale",
  );
  assert.equal(preview.merged_metadata.exclusions[0]?.override_id, "override:shared");
  assert.equal(preview.merged_metadata.cohort_overrides.length, 0);
  assert.equal(preview.merged_metadata.cohort_labels[0]?.display_name, "Incoming name");
  assert.equal(preview.merged_metadata.training_references[0]?.finding_id, "finding:incoming");
  assert.equal(preview.merged_metadata.comment_intents[0]?.disposition, "confirmed");
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
  assert.equal(
    preview.merged_metadata.profile.preferences.preferred_concept_ids[0],
    "concept:incoming",
  );
  assert.deepEqual(preview.merged_metadata.resolutions, local.resolutions);
  assert.deepEqual(preview.merged_metadata.cohort_labels, local.cohort_labels);
  assert.deepEqual(preview.collections.resolutions.preserved, ["semantic-finding:semantic:shared"]);
});

test("portable intent PGN is legal, escaped, bounded, semantic, and clone-only", () => {
  const tree = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *");
  const before = tree.toPgn();
  const report = completeStrategicFitReport(
    analyzeStrategicFit(
      parseStrategicFitFixture(SHALLOW_LINES_FIXTURE),
      strategicFitCompleteAnalysisOptions({
        repertoireColor: SHALLOW_LINES_FIXTURE.repertoireColor,
        repertoireRevision: "browser:7",
      }),
    ),
  );
  const finding = report.findings[0];
  assert.ok(finding);
  const projectedFinding = {
    ...finding,
    semantic_finding_id: "semantic:finding-with-{brace}",
    references: { ...finding.references, source_san_paths: [["e4", "e5"]] },
    explanation: `${finding.explanation} {unsafe}\nsecret-looking text is ordinary evidence`,
  };
  const sourceMetadata = metadata("local");
  const exported = exportStrategicFitIntentPgn(
    tree,
    {
      ...sourceMetadata,
      resolutions: [
        {
          ...sourceMetadata.resolutions[0]!,
          profile_snapshot: strategicFitProfileSnapshot(sourceMetadata.profile),
        },
      ],
    },
    { findings: [projectedFinding], max_findings: 1, max_resolutions: 1, max_comment_chars: 300 },
  );

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
