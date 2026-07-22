import assert from "node:assert/strict";
import test from "node:test";

import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import {
  GameTree,
  buildRepertoireGraph,
  createDefaultStrategicFitDocumentMetadata,
  normalizeStrategicFitDocumentMetadata,
  type StrategicFinding,
  type StrategicFitAnalysisResult,
  type StrategicFitDocumentMetadata,
} from "@chess-mcp/chess-tools";
import {
  createStrategicFitResolutionState,
  type StrategicFitResolutionStateBoundary,
} from "../src/store/strategic-fit-resolutions.ts";
import {
  STRATEGIC_FIT_TRAINING_ARTIFACT_KIND,
  createStrategicFitTrainingState,
  type StrategicFitTrainingArtifact,
  type StrategicFitTrainingBoundary,
} from "../src/store/strategic-fit-training.ts";
import type { StrategicFitCompletedResult } from "../src/store/strategic-fit.ts";

const PGN = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *";

function fixture(options: { staleRoute?: boolean } = {}) {
  const tree = GameTree.fromPgn(PGN);
  const graph = buildRepertoireGraph(tree, "white");
  const route = graph.routes[0]!;
  const opening = graph.positions.find((position) => position.position_id === route.position_ids[0])!;
  const second = graph.positions.find((position) => position.position_id === route.position_ids[2])!;
  const causalDecision = graph.decisions.find((decision) => decision.decision_id === route.decision_ids[2])!;
  const finding = {
    schema_version: "1.0.0",
    analysis_version: "2.0.0",
    finding_id: "finding:training",
    semantic_finding_id: "semantic:finding:training",
    repertoire_revision: "browser:4",
    references: {
      position_ids: [opening.position_id, second.position_id],
      decision_ids: [causalDecision.decision_id],
      route_ids: options.staleRoute ? ["route:removed"] : [route.route_id],
      source_san_paths: route.source_san_paths,
    },
    evidence: {
      cohort_id: "cohort:training",
      causality: {
        likely_causal_decision_ids: [causalDecision.decision_id],
        timeline: [{
          event_id: "event:causal",
          kind: "player-decision",
          ply: 2,
          position_id: second.position_id,
          decision_id: causalDecision.decision_id,
          san: causalDecision.san,
          explanation: "The player decision creates the exception.",
        }],
      },
    },
    resolution_state: "unresolved",
  } as unknown as StrategicFinding;
  const report = {
    schema_version: "1.0.0",
    analysis_version: "2.0.0",
    report_id: "report:training",
    repertoire_revision: "browser:4",
    trajectories: [{
      analysis_version: "2.0.0",
      trajectory_id: `trajectory:${route.route_id}`,
      route_id: route.route_id,
      state: "complete",
      snapshots: [{
        analysis_version: "2.0.0",
        snapshot_id: "snapshot:opening",
        route_id: route.route_id,
        position_id: opening.position_id,
        fen: opening.fen,
        checkpoint: {
          analysis_version: "2.0.0",
          checkpoint_id: "checkpoint:opening",
          kind: "opening-exit",
          ply: 0,
          reason: "Start with the first legal repertoire decision.",
          comparability: "comparable",
        },
        signals: [{
          analysis_version: "2.0.0",
          signal_id: "signal:concept",
          family: "learning-concepts",
          feature_id: "concept:center-control",
          kind: "derived-concept",
          value: true,
          confidence: 1,
          persistence: "stable",
          provenance: [],
        }],
        classifier_confidence: 1,
        provenance: [],
      }, {
        analysis_version: "2.0.0",
        snapshot_id: "snapshot:second",
        route_id: route.route_id,
        position_id: second.position_id,
        fen: second.fen,
        checkpoint: {
          analysis_version: "2.0.0",
          checkpoint_id: "checkpoint:second",
          kind: "configured-ply",
          ply: 2,
          reason: "Practice the causal player decision.",
          comparability: "comparable",
        },
        signals: [],
        classifier_confidence: 1,
        provenance: [],
      }],
      missing_checkpoints: [],
      evidence_coverage: 1,
      stable_signal_ids: ["signal:concept"],
      transient_signal_ids: [],
      provenance: [],
    }],
    cohorts: [{
      cohort_id: "cohort:training",
      modes: [{
        supporting_route_ids: [route.route_id],
        concept_ids: ["concept:causal-plan"],
      }],
    }],
    findings: [finding],
  } as unknown as StrategicFitAnalysisResult;
  const completed = {
    request_id: "request:training",
    report_id: report.report_id,
    request_snapshot: {
      document_id: "document:training",
      repertoire_revision: 4,
      repertoire_pgn: tree.toPgn(),
      repertoire_color: "white",
      profile_identity: "profile:balanced",
      settings_identity: "settings:training",
    },
    result: report,
    completed_at: "2026-07-21T14:00:00.000Z",
  } satisfies StrategicFitCompletedResult;
  let metadata: StrategicFitDocumentMetadata = createDefaultStrategicFitDocumentMetadata();
  let invalidations = 0;
  let tick = 0;
  const lowBoundary: StrategicFitResolutionStateBoundary = {
    currentMetadata: () => metadata,
    currentGraph: () => graph,
    currentProfile: () => metadata.profile,
    currentRepertoireRevision: () => "browser:4",
    replaceMetadata: (input) => {
      const normalized = normalizeStrategicFitDocumentMetadata(input);
      metadata = normalized.metadata;
      return normalized;
    },
    invalidateReports: () => { invalidations++; },
    now: () => `2026-07-21T14:00:${String(tick++).padStart(2, "0")}.000Z`,
  };
  const low = createStrategicFitResolutionState(lowBoundary);
  const artifacts: Array<{ content: string; name: string }> = [];
  const boundary: StrategicFitTrainingBoundary = {
    currentReport: () => completed,
    currentFinding: (reportId, findingId) =>
      reportId === report.report_id && findingId === finding.finding_id ? finding : null,
    currentMetadata: () => metadata,
    currentGraph: () => graph,
    resolutionAvailability: () => ({
      available: true,
      code: null,
      message: null,
      finding,
    }),
    upsertTrainingReference: (input) => low.upsertTrainingReference(input),
    removeTrainingReference: (id) => low.removeTrainingReference(id),
    transitionResolution: (input) => {
      const result = low.upsertResolution({
        resolution_id: `strategic-fit-resolution:${input.semantic_finding_id}`,
        finding_id: input.finding_id,
        semantic_finding_id: input.semantic_finding_id,
        state: input.state,
        references: finding.references,
        note: input.note,
        linked_training_ids: input.linked_training_ids,
      });
      return {
        state: result.state === "unchanged" ? "unchanged" : "updated",
        code: null,
        message: "Training resolution saved.",
        resolution: "train-as-exception",
      };
    },
    createArtifact: (_format, content, name) => {
      artifacts.push({ content, name });
      return { artifact_id: `artifact:${artifacts.length}` };
    },
    now: lowBoundary.now,
  };
  return {
    tree,
    graph,
    route,
    finding,
    report,
    state: createStrategicFitTrainingState(boundary),
    metadata: () => metadata,
    artifacts,
    invalidations: () => invalidations,
  };
}

test("training creation deterministically links checkpoints, concepts, causal move, notes, and semantic metadata", () => {
  const subject = fixture();
  const before = subject.tree.toPgn();
  const created = subject.state.create({
    report_id: subject.report.report_id,
    finding_id: subject.finding.finding_id,
    semantic_finding_id: subject.finding.semantic_finding_id,
    user_notes: "Review the central break before each session.",
  });

  assert.equal(created.state, "created");
  assert.match(created.record?.training_id ?? "", /^strategic-fit-training:/);
  assert.deepEqual(created.record?.concept_ids, ["concept:causal-plan", "concept:center-control"]);
  assert.equal(created.record?.causal_move?.san, "Nf3");
  assert.deepEqual(created.record?.checkpoints.map((checkpoint) => checkpoint.position_id), [
    subject.route.position_ids[0],
    subject.route.position_ids[2],
  ]);
  assert.equal(created.record?.user_notes, "Review the central break before each session.");
  assert.deepEqual(subject.metadata().training_references[0]?.references.position_ids, [
    subject.route.position_ids[0],
    subject.route.position_ids[2],
  ].sort());
  assert.equal(subject.metadata().resolutions[0]?.state, "train-as-exception");
  assert.deepEqual(subject.metadata().resolutions[0]?.linked_training_ids, [created.record?.training_id]);
  assert.equal(subject.report.findings.length, 1, "accepted training keeps the immutable finding visible");
  assert.equal(subject.tree.toPgn(), before, "training must not edit repertoire lines");
  assert.equal(subject.invalidations(), 1, "the training reference alone is not an analysis setting");
});

test("repeated creation deduplicates one durable training identity and survives metadata reload", () => {
  const subject = fixture();
  const input = {
    report_id: subject.report.report_id,
    finding_id: subject.finding.finding_id,
    semantic_finding_id: subject.finding.semantic_finding_id,
  };
  const first = subject.state.create({ ...input, user_notes: "First note" });
  const second = subject.state.create({ ...input, user_notes: "Updated note" });

  assert.equal(first.record?.training_id, second.record?.training_id);
  assert.equal(subject.metadata().training_references.length, 1);
  assert.equal(subject.metadata().resolutions.length, 1);
  assert.equal(subject.metadata().resolutions[0]?.note, "Updated note");
  assert.deepEqual(subject.metadata().resolutions[0]?.linked_training_ids, [first.record?.training_id]);

  const restored = normalizeStrategicFitDocumentMetadata(
    JSON.parse(JSON.stringify(subject.metadata())),
  );
  assert.equal(restored.state, "valid");
  assert.deepEqual(restored.metadata.training_references, subject.metadata().training_references);
  assert.deepEqual(restored.metadata.resolutions, subject.metadata().resolutions);
});

test("portable basic drill JSON contains only legal FEN and SAN pairs", () => {
  const subject = fixture();
  const created = subject.state.create({
    report_id: subject.report.report_id,
    finding_id: subject.finding.finding_id,
    semantic_finding_id: subject.finding.semantic_finding_id,
  });
  assert.equal(created.artifact_id, "artifact:1");
  const artifact = JSON.parse(subject.artifacts[0]!.content) as StrategicFitTrainingArtifact;
  assert.equal(artifact.artifact_kind, STRATEGIC_FIT_TRAINING_ARTIFACT_KIND);
  assert.equal(artifact.training_id, created.record?.training_id);
  assert.ok(artifact.drills.length >= 2);
  for (const drill of artifact.drills) {
    const position = Chess.fromSetup(parseFen(drill.fen).unwrap()).unwrap();
    assert.notEqual(parseSan(position, drill.expected_san), undefined, drill.drill_id);
    assert.deepEqual(
      drill.source_san_path,
      subject.route.san_moves.slice(0, drill.source_san_path.length),
    );
  }
});

test("a stale semantic route blocks training without metadata, artifact, or repertoire mutation", () => {
  const subject = fixture({ staleRoute: true });
  const before = subject.tree.toPgn();
  const result = subject.state.create({
    report_id: subject.report.report_id,
    finding_id: subject.finding.finding_id,
    semantic_finding_id: subject.finding.semantic_finding_id,
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.code, "strategic_fit_training_stale_route");
  assert.match(result.message, /semantic route/i);
  assert.deepEqual(subject.metadata().training_references, []);
  assert.deepEqual(subject.metadata().resolutions, []);
  assert.deepEqual(subject.artifacts, []);
  assert.equal(subject.tree.toPgn(), before);
});
