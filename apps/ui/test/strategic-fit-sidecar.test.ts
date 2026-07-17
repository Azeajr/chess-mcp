import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_FIT_SCHEMA_VERSION,
  analyzeStrategicFit,
  completeStrategicFitReport,
  createDefaultStrategicFitDocumentMetadata,
  normalizeStrategicFitDocumentMetadata,
  serializeStrategicFitSidecar,
  strategicFitCompleteAnalysisOptions,
  type StrategicFitDocumentMetadata,
} from "@chess-mcp/chess-tools";
import { executeDirectBrowserCommand } from "../src/store/commands.ts";
import { artifactById, createArtifact } from "../src/store/artifacts.ts";
import { defaultBrowserCommandDependencies } from "../src/application/browser-commands/default-context.ts";
import { createStrategicFitSidecarImportState } from "../src/store/strategic-fit-sidecar.ts";
import { runTool } from "../src/llm/tools.ts";

const CURRENT_ID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_ID = "123e4567-e89b-42d3-a456-426614174001";
const SOURCE = {
  source_id: "sidecar:test",
  kind: "user-profile" as const,
  state: "available" as const,
  version: STRATEGIC_FIT_SCHEMA_VERSION,
  snapshot: "browser:4",
  reason: "Test fixture.",
};

function metadata(label: string): StrategicFitDocumentMetadata {
  const base = createDefaultStrategicFitDocumentMetadata();
  return {
    ...base,
    profile: {
      ...base.profile,
      mode: "custom",
      source: "explicit",
      provisional: false,
      preferences: {
        ...base.profile.preferences,
        preferred_concept_ids: [`concept:${label}`],
      },
    },
    manual_weights: {
      route_weights: [{
        route_id: "route:shared",
        weight: label === "incoming" ? 8 : 2,
        record_state: "active",
        stale_reasons: [],
        reason: label,
        updated_at: "2026-07-17T12:00:00.000Z",
        provenance: [SOURCE],
      }],
      decision_weights: [],
    },
  };
}

function harness() {
  let documentId = CURRENT_ID;
  let revision = 4;
  let current = metadata("local");
  let writes = 0;
  let invalidations = 0;
  let flushes = 0;
  const state = createStrategicFitSidecarImportState({
    currentDocumentId: () => documentId,
    currentRevision: () => revision,
    currentMetadata: () => current,
    reconcile: (value) => value,
    replaceMetadata: (value) => {
      writes++;
      const result = normalizeStrategicFitDocumentMetadata(value);
      current = result.metadata;
      return result;
    },
    invalidateReports: () => { invalidations++; },
    flush: async () => { flushes++; },
  });
  return {
    state,
    current: () => current,
    writes: () => writes,
    invalidations: () => invalidations,
    flushes: () => flushes,
    changeDocument: () => { documentId = OTHER_ID; },
    changeRevision: () => { revision++; },
    changeMetadata: () => { current = metadata("changed-after-preview"); },
  };
}

test("sidecar workflow previews conflicts without mutation and cancel is non-mutating", () => {
  const h = harness();
  const before = structuredClone(h.current());
  const preview = h.state.prepare(serializeStrategicFitSidecar(OTHER_ID, metadata("incoming")));
  assert.ok("preview_id" in preview);
  if (!("preview_id" in preview)) return;
  assert.equal(preview.document_id_mismatch, true);
  assert.equal(preview.profile.changed, true);
  assert.deepEqual(preview.collections.route_weights.replaced, ["route:shared"]);
  assert.deepEqual(h.current(), before);
  assert.equal(h.writes(), 0);
  h.state.cancel();
  assert.equal(h.state.preview(), null);
  assert.deepEqual(h.current(), before);
});

test("sidecar confirmation requires mismatch acknowledgement, then persists exactly the visible preview", async () => {
  const h = harness();
  const preview = h.state.prepare(serializeStrategicFitSidecar(OTHER_ID, metadata("incoming")));
  assert.ok("preview_id" in preview);
  if (!("preview_id" in preview)) return;
  const rejected = await h.state.confirm({ preview_id: preview.preview_id });
  assert.deepEqual(rejected, {
    error: "strategic_fit_sidecar_confirmation_error",
    code: "document-id-acknowledgement-required",
    reason: "Confirm the source/target document mismatch before importing this sidecar.",
  });
  assert.equal(h.writes(), 0);

  const accepted = await h.state.confirm({
    preview_id: preview.preview_id,
    acknowledge_document_mismatch: true,
  });
  assert.equal("ok" in accepted && accepted.ok, true);
  assert.equal(h.current().profile.preferences.preferred_concept_ids[0], "concept:incoming");
  assert.equal(h.current().manual_weights.route_weights[0]?.weight, 8);
  assert.equal(h.writes(), 1);
  assert.equal(h.invalidations(), 1);
  assert.equal(h.flushes(), 1);
  assert.equal(h.state.preview(), null);
});

test("stale, cross-document, and wrong-preview confirmations fail closed", async () => {
  for (const invalidate of ["document", "revision", "metadata"] as const) {
    const h = harness();
    const preview = h.state.prepare(serializeStrategicFitSidecar(CURRENT_ID, metadata("incoming")));
    assert.ok("preview_id" in preview);
    if (!("preview_id" in preview)) continue;
    if (invalidate === "document") h.changeDocument();
    if (invalidate === "revision") h.changeRevision();
    if (invalidate === "metadata") h.changeMetadata();
    const result = await h.state.confirm({ preview_id: preview.preview_id });
    assert.equal("code" in result ? result.code : null, "stale-preview");
    assert.equal(h.writes(), 0);
  }
  const h = harness();
  const preview = h.state.prepare(serializeStrategicFitSidecar(CURRENT_ID, metadata("incoming")));
  assert.ok("preview_id" in preview);
  const wrong = await h.state.confirm({ preview_id: "some-other-preview" });
  assert.equal("code" in wrong ? wrong.code : null, "preview-id-mismatch");
  assert.equal(h.writes(), 0);
});

test("malformed sidecars surface structured errors and never create a preview", () => {
  const h = harness();
  const result = h.state.prepare("{");
  assert.equal("code" in result ? result.code : null, "malformed-json");
  assert.equal(h.state.preview(), null);
  assert.equal(h.writes(), 0);
});

test("canonical browser exports create bounded JSON and legal PGN artifacts without exposing payloads", async () => {
  const tree = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 (2... Nf6) *");
  const before = tree.toPgn();
  const currentMetadata = metadata("artifact");
  const dependencies = {
    ...defaultBrowserCommandDependencies,
    currentTree: () => tree,
    currentPgn: () => tree.toPgn(),
    currentColor: () => "white" as const,
    currentRevision: () => 4,
    currentDocumentId: () => CURRENT_ID,
    currentFileName: () => "my-repertoire.pgn",
    currentStrategicFitMetadata: () => currentMetadata,
    currentStrategicFitProfile: () => currentMetadata.profile,
    currentStrategicFitAnalysisSettings: () => ({ identity: "{}", inputs: {} }),
    openings: async () => new Map(),
    strategicFitReport: async (pgn: string, options: Parameters<typeof analyzeStrategicFit>[1]) =>
      completeStrategicFitReport(analyzeStrategicFit(
        GameTree.fromPgn(pgn),
        strategicFitCompleteAnalysisOptions(options),
      )),
    createArtifact,
  };

  const jsonResult = await executeDirectBrowserCommand(
    "export_strategic_fit_metadata", {}, {}, dependencies,
  ) as Record<string, unknown>;
  assert.equal(jsonResult.format, "json");
  assert.equal(jsonResult.media_type, "application/json");
  assert.equal(jsonResult.name, "my-repertoire-strategic-fit.json");
  assert.equal("content" in jsonResult, false);
  const jsonArtifact = artifactById(String(jsonResult.artifact_id));
  assert.ok(jsonArtifact);
  assert.equal(jsonArtifact.bytes, new Blob([jsonArtifact.content]).size);
  assert.doesNotMatch(jsonArtifact.content, /token|credential|secret/i);
  const chatJson = await runTool("export_strategic_fit_metadata", {}, {}, dependencies) as Record<string, unknown>;
  assert.equal(chatJson.format, "json");
  assert.equal(chatJson.name, jsonResult.name);
  assert.equal("content" in chatJson, false);

  const pgnResult = await executeDirectBrowserCommand(
    "export_strategic_fit_intent_pgn", { max_findings: 2, max_resolutions: 2 }, {}, dependencies,
  ) as Record<string, unknown>;
  assert.equal(pgnResult.format, "pgn");
  assert.equal(pgnResult.media_type, "application/x-chess-pgn");
  assert.equal(pgnResult.name, "my-repertoire-strategic-fit-intent.pgn");
  assert.equal("content" in pgnResult, false);
  const pgnArtifact = artifactById(String(pgnResult.artifact_id));
  assert.ok(pgnArtifact);
  assert.doesNotThrow(() => GameTree.fromPgn(pgnArtifact.content));
  assert.equal(tree.toPgn(), before);
});
