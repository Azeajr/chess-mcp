import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultStrategicFitDocumentMetadata,
  type StrategicFinding,
  type StrategicFitDocumentMetadata,
  type StrategicFitPersistedResolution,
} from "@chess-mcp/chess-tools";
import {
  STRATEGIC_FIT_REVIEW_SUMMARY_KIND,
  createStrategicFitReviewState,
  type StrategicFitReviewBoundary,
} from "../src/store/strategic-fit-review.ts";
import type { StrategicFitCompletedResult } from "../src/store/strategic-fit.ts";

function finding(
  id: string,
  resolutionState: StrategicFinding["resolution_state"] = "unresolved",
  classification: StrategicFinding["classification"] = "genuine-inconsistency",
): StrategicFinding {
  return {
    finding_id: `finding:${id}`,
    semantic_finding_id: `semantic:${id}`,
    resolution_state: resolutionState,
    classification,
  } as StrategicFinding;
}

function resolution(
  id: string,
  state: StrategicFitPersistedResolution["state"],
  links: { training?: string[]; edits?: string[] } = {},
): StrategicFitPersistedResolution {
  return {
    resolution_id: `resolution:${id}`,
    finding_id: `finding:${id}`,
    semantic_finding_id: `semantic:${id}`,
    state,
    note: `Review note ${id}`,
    linked_training_ids: links.training ?? [],
    linked_staged_edit_ids: links.edits ?? [],
    record_state: "active",
  } as StrategicFitPersistedResolution;
}

function report(
  requestId: string,
  reportId: string,
  findings: readonly StrategicFinding[],
  metrics: { coverage: number | null; regret: number | null; burden: number | null },
): StrategicFitCompletedResult {
  const metric = (metricId: string, value: number | null, unit: string) => ({
    analysis_version: "2.0.0",
    metric_id: metricId,
    state: value === null ? "unavailable" : "available",
    value,
    unit,
    reason: value === null ? `${metricId} unavailable` : null,
    provenance: [{ source_id: `source:${metricId}`, kind: "deterministic-core", state: "available" }],
  });
  return {
    request_id: requestId,
    report_id: reportId,
    request_snapshot: {
      document_id: "document:a",
      repertoire_revision: 2,
      repertoire_pgn: "1. e4 e5 *",
      repertoire_color: "white",
      profile_identity: "profile:balanced",
      settings_identity: "settings:mixed",
    },
    completed_at: "2026-07-21T12:00:00.000Z",
    findings_snapshot: findings,
    reanalysis: null,
    result: {
      analysis_version: "2.0.0",
      report_id: reportId,
      repertoire_revision: "browser:2",
      findings,
      finding_page: {
        offset: 0,
        limit: Math.max(1, findings.length),
        total_count: findings.length,
        returned_count: findings.length,
        has_more: false,
      },
      summary: {
        expected_concept_burden: metrics.burden,
        metrics: {
          familiarity_adjusted_coverage: metric("familiarity-adjusted-coverage", metrics.coverage, "fraction"),
          repertoire_regret: metric("repertoire-regret", metrics.regret, "score"),
        },
      },
      provenance: {
        generated_at: "2026-07-21T12:00:00.000Z",
        sources: [{ source_id: "source:report", kind: "deterministic-core", state: "available" }],
      },
    },
  } as StrategicFitCompletedResult;
}

function fixture(
  current: StrategicFitCompletedResult,
  metadata: StrategicFitDocumentMetadata = createDefaultStrategicFitDocumentMetadata(),
) {
  let lifecycle: ReturnType<StrategicFitReviewBoundary["currentLifecycle"]> = {
    status: "completed",
    current_result: current,
  };
  let currentMetadata = metadata;
  let clock = 0;
  const artifacts: Array<{ content: string; name: string }> = [];
  const boundary: StrategicFitReviewBoundary = {
    currentDocumentId: () => "document:a",
    currentLifecycle: () => lifecycle,
    currentMetadata: () => currentMetadata,
    reopen: ({ semantic_finding_id }) => {
      currentMetadata = {
        ...currentMetadata,
        resolutions: currentMetadata.resolutions.filter((entry) =>
          entry.semantic_finding_id !== semantic_finding_id
        ),
      };
      return { state: "reopened", code: null, message: "Reopened" };
    },
    createArtifact: (_format, content, name) => {
      artifacts.push({ content, name });
      return { artifact_id: `artifact:${artifacts.length}` };
    },
    now: () => `2026-07-21T13:00:0${clock++}.000Z`,
  };
  return {
    state: createStrategicFitReviewState(boundary),
    artifacts,
    setCurrent: (next: StrategicFitCompletedResult) => {
      lifecycle = { status: "completed", current_result: next };
    },
    stale: () => {
      lifecycle = { status: "stale", current_result: null };
    },
  };
}

test("incomplete reviews cannot create a completion record", () => {
  const unresolved = finding("unreviewed");
  const f = fixture(report("request:1", "report:1", [unresolved], {
    coverage: 0.6,
    regret: null,
    burden: 2,
  }));

  assert.equal(f.state.synchronize().status, "incomplete");
  assert.deepEqual(f.state.snapshot().unreviewed_semantic_finding_ids, ["semantic:unreviewed"]);
  const result = f.state.complete();
  assert.equal(result.state, "blocked");
  assert.equal(result.code, "strategic_fit_review_incomplete");
  assert.deepEqual(f.state.snapshot().history, []);
});

test("mixed terminal decisions produce revision-bound deltas, portable metadata, and reversible history", () => {
  const findings = [
    finding("keep"),
    finding("defer"),
    finding("uncertain", "insufficient-evidence", "uncertain"),
    finding("train"),
    finding("edit"),
  ];
  const metadata: StrategicFitDocumentMetadata = {
    ...createDefaultStrategicFitDocumentMetadata(),
    resolutions: [
      resolution("keep", "keep-intentionally"),
      resolution("defer", "defer"),
      resolution("train", "train-as-exception", { training: ["training:one"] }),
      resolution("edit", "change-repertoire", { edits: ["edit:one"] }),
    ],
  };
  const before = report("request:1", "report:before", findings, {
    coverage: 0.6,
    regret: 0.3,
    burden: 3,
  });
  const after = report("request:2", "report:after", findings, {
    coverage: 0.75,
    regret: 0.2,
    burden: 2.5,
  });
  const f = fixture(before, metadata);
  assert.equal(f.state.synchronize().status, "ready");
  f.setCurrent(after);
  assert.equal(f.state.synchronize().status, "ready");

  const completed = f.state.complete();
  assert.equal(completed.state, "completed");
  assert.equal(f.state.snapshot().status, "completed");
  assert.deepEqual(completed.summary?.edits_made_resolution_ids, ["resolution:edit"]);
  assert.deepEqual(completed.summary?.edits_made_semantic_finding_ids, ["semantic:edit"]);
  assert.deepEqual(completed.summary?.retained_exception_resolution_ids, ["resolution:keep"]);
  assert.deepEqual(completed.summary?.retained_exception_semantic_finding_ids, ["semantic:keep"]);
  assert.deepEqual(completed.summary?.training_item_ids, ["training:one"]);
  assert.deepEqual(completed.summary?.deferred_semantic_finding_ids, ["semantic:defer"]);
  assert.deepEqual(completed.summary?.uncertain_semantic_finding_ids, ["semantic:uncertain"]);
  assert.equal(completed.summary?.remaining_uncertainty_count, 2);
  assert.equal(completed.summary?.repertoire_revision, "browser:2");
  assert.equal(completed.summary?.source_report_provenance.generated_at, "2026-07-21T12:00:00.000Z");
  assert.deepEqual(
    completed.summary?.metric_deltas.map((entry) => [entry.metric_id, entry.delta]),
    [["coverage", 0.15000000000000002], ["objective-evaluation", -0.09999999999999998], ["strategic-workload", -0.5]],
  );

  const exported = f.state.exportSummary(completed.summary!.summary_id);
  assert.equal(exported.state, "exported");
  const artifact = JSON.parse(f.artifacts[0]!.content);
  assert.equal(artifact.artifact_kind, STRATEGIC_FIT_REVIEW_SUMMARY_KIND);
  assert.equal(artifact.summary.summary_id, completed.summary!.summary_id);
  assert.equal(artifact.summary.request_id, "request:2");

  f.stale();
  assert.equal(f.state.synchronize().status, "stale");
  assert.equal(f.state.snapshot().current_summary, null);
  assert.equal(f.state.snapshot().history[0]!.state, "completed");
  f.setCurrent(after);
  assert.equal(f.state.synchronize().status, "completed");

  const reopened = f.state.reopen(completed.summary!.summary_id, "semantic:keep");
  assert.equal(reopened.state, "reopened");
  assert.equal(f.state.snapshot().status, "incomplete");
  assert.deepEqual(f.state.snapshot().unreviewed_semantic_finding_ids, ["semantic:keep"]);
  assert.equal(f.state.snapshot().history[0]!.state, "reopened");
  assert.equal(f.state.complete().state, "blocked");
});
