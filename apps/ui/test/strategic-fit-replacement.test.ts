import assert from "node:assert/strict";
import test from "node:test";

import type {
  ReplacementPivotSelectionResult,
  StrategicFinding,
  StrategicFitAnalysisResult,
} from "@chess-mcp/chess-tools";
import { GameTree } from "@chess-mcp/chess-tools";
import {
  prepareReplacementLab,
  replacementLabActionability,
  runReplacementLabGeneration,
  stageReplacementLabChangeReview,
  type ReplacementLabContext,
  type ReplacementLabGenerationResult,
  type ReplacementLabPreparedContext,
} from "../src/application/strategic-fit-replacement.ts";
import { defaultBrowserCommandDependencies } from "../src/application/browser-commands/default-context.ts";
import {
  createReplacementLabState,
  type ReplacementLabStateBoundary,
} from "../src/store/strategic-fit-replacement.ts";
import type {
  StrategicFitChangeConfirmation,
  StrategicFitChangeOperationResult,
  StrategicFitStagedChange,
} from "../src/store/strategic-fit-changes.ts";
import type {
  StrategicFitCompletedResult,
  StrategicFitRequestSnapshot,
} from "../src/store/strategic-fit.ts";
import {
  PGN as REPLACEMENT_PGN,
  contextFixture,
  input as scoringInput,
} from "../../../packages/chess-tools/test/strategic-fit/replacement-score.fixtures.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const SOURCE = {
  source_id: "fixture:replacement-lab",
  kind: "deterministic-core",
  state: "available",
  version: "2.0.0",
  snapshot: "browser:7",
  reason: null,
} as const;

const baseSnapshot = (color: "white" | "black" = "white"): StrategicFitRequestSnapshot => ({
  document_id: "document:replacement-lab",
  repertoire_revision: 7,
  repertoire_pgn: "1. e4 e5 2. Nf3 Nc6 *",
  repertoire_color: color,
  profile_identity: "profile:balanced",
  settings_identity: "settings:replacement-lab",
});

function finding(overrides: Record<string, unknown> = {}): StrategicFinding {
  return {
    schema_version: "1.0.0",
    analysis_version: "2.0.0",
    finding_id: "finding:replacement-lab",
    semantic_finding_id: "semantic:finding:replacement-lab",
    repertoire_revision: "browser:7",
    classification: "genuine-inconsistency",
    plain_language_category: "Different center plan",
    opening_scope: "Open Game",
    affected_line_summary: "Ruy Lopez branch",
    explanation: "A supported player-owned decision causes the difference.",
    references: {
      position_ids: ["position:pivot"],
      decision_ids: ["decision:pivot"],
      route_ids: ["route:affected"],
      source_san_paths: [["e4", "e5", "Nf3"]],
    },
    weighted_baseline_percentage: 0.8,
    expected_frequency: 0.2,
    learning_burden: 0.4,
    confidence: { label: "high" },
    difference: {},
    objective_quality: {},
    replacement_priority: { actionability: 0.9 },
    training_priority: {},
    evidence: {
      cohort_id: "cohort:replacement-lab",
      causality: {
        label: "mostly-player-controlled",
        controllability: 0.9,
        likely_causal_decision_ids: ["decision:pivot"],
      },
    },
    resolution_state: "unresolved",
    provisional: false,
    provenance: {
      schema_version: "1.0.0",
      analysis_version: "2.0.0",
      repertoire_revision: "browser:7",
      generated_at: "2026-07-29T12:00:00.000Z",
      deterministic: true,
      sources: [SOURCE],
    },
    ...overrides,
  } as unknown as StrategicFinding;
}

function completedFixture(
  options: {
    readonly color?: "white" | "black";
    readonly finding?: StrategicFinding;
    readonly reportOverrides?: Record<string, unknown>;
  } = {},
) {
  const snapshot = baseSnapshot(options.color);
  const currentFinding = options.finding ?? finding();
  const report = {
    schema_version: "1.0.0",
    analysis_version: "2.0.0",
    report_id: "report:replacement-lab",
    repertoire_revision: "browser:7",
    profile: {
      mode: "balanced",
      source: "explicit",
      provisional: false,
      preferences: { maximum_engine_loss_cp: 80, minimum_opponent_coverage: 0.8 },
    },
    preflight: { issues: [] },
    cohorts: [
      {
        cohort_id: "cohort:replacement-lab",
        state: "actionable",
        route_ids: ["route:affected"],
        route_weights: [{ route_id: "route:affected", normalized_weight: 1 }],
        transposition_position_ids: [],
        provenance: [SOURCE],
      },
    ],
    findings: [currentFinding],
    trajectories: [],
    summary: { metrics: {} },
    provenance: { sources: [SOURCE] },
    ...options.reportOverrides,
  } as unknown as StrategicFitAnalysisResult;
  const completed: StrategicFitCompletedResult = {
    request_id: "analysis-request:replacement-lab",
    report_id: report.report_id,
    request_snapshot: snapshot,
    result: report,
    completed_at: "2026-07-29T12:00:01.000Z",
  };
  const context: ReplacementLabContext = {
    completed,
    report,
    finding: currentFinding,
    cohort_id: currentFinding.evidence.cohort_id,
    request_snapshot: snapshot,
  };
  return { snapshot, currentFinding, report, completed, context };
}

const pivot = (decisionId = "decision:pivot") =>
  ({
    status: "selected",
    pivot: {
      status: "actionable",
      owner: "repertoire",
      decision_id: decisionId,
      position_id: "position:pivot",
      ply: 3,
      san: "Nf3",
      explanation: "Player-owned causal pivot.",
    },
    alternative_pivots: [],
  }) as unknown as ReplacementPivotSelectionResult;

function generationResult(
  options: {
    readonly partial?: boolean;
    readonly stageId?: string;
    readonly requestId?: string;
  } = {},
): ReplacementLabGenerationResult {
  const status = options.partial ? "partial" : "complete";
  return {
    request: {
      request_id: options.requestId ?? "replacement-request:fixture",
      report_id: "report:replacement-lab",
      finding_id: "finding:replacement-lab",
      semantic_finding_id: "semantic:finding:replacement-lab",
      repertoire_revision: "browser:7",
      repertoire_color: "black",
      provenance: [SOURCE],
    },
    pivot_result: pivot(),
    candidate_generation: {
      status,
      source_results: [
        {
          source_id: "source:local",
          kind: "existing-repertoire-transposition",
          status: "available",
          accepted_item_count: 1,
          reason: null,
        },
      ],
      database_item_results: [
        {
          evidence_id: "evidence:offline",
          item_index: 0,
          status: "illegal",
          error_code: "illegal-candidate-move",
          explanation: "Illegal database move retained as a structured item error.",
        },
      ],
    },
    engine_generation: {
      status,
      candidates: [
        {
          candidate_id: "candidate:usable-local",
          san: "Bc4",
          status: "complete",
          source_kinds: ["existing-repertoire-transposition"],
          existing_preparation: true,
        },
      ],
      source_results: [
        {
          source_id: "source:engine",
          status: "unavailable",
          accepted_item_count: 0,
          reached_depth: null,
          reason: "Engine unavailable; local candidate retained.",
        },
      ],
      engine_item_results: [],
    },
    expansion: {
      status,
      source_results: [
        {
          source_id: "source:explorer",
          provider_kind: "explorer",
          state: "unavailable",
          accepted_item_count: 0,
          reason: "Offline; local candidate retained.",
        },
      ],
      evidence_item_results: [],
    },
    scoring: { status, candidates: [{ candidate_id: "candidate:usable-local" }] },
    safety: { status },
    preview: {
      status,
      items: [
        {
          candidate_id: "candidate:usable-local",
          status: "previewed",
          error_code: null,
          explanation: "Staged only.",
          stage: options.stageId ? { ok: true, stage: { stage_id: options.stageId } } : null,
        },
      ],
      host: { preview_policy: "stage-only" },
    },
  } as unknown as ReplacementLabGenerationResult;
}

function stateFixture(selection: ReplacementPivotSelectionResult = pivot()) {
  const base = completedFixture({ color: "black" });
  let snapshot = base.snapshot;
  let completed: StrategicFitCompletedResult | null = base.completed;
  let resolution: "unresolved" | "defer" = "unresolved";
  const calls: Array<{
    readonly prepared: ReplacementLabPreparedContext;
    readonly pivotId: string;
    readonly attempt: number;
    readonly options: Parameters<ReplacementLabStateBoundary["run"]>[5];
    readonly pending: ReturnType<typeof deferred<ReplacementLabGenerationResult>>;
  }> = [];
  const reviewCalls: Array<{
    readonly candidateId: string;
    readonly action: "add-alternative" | "replace";
    readonly pending: ReturnType<
      typeof deferred<Awaited<ReturnType<ReplacementLabStateBoundary["stageReview"]>>>
    >;
  }> = [];
  const acceptCalls: Array<{
    readonly confirmation: StrategicFitChangeConfirmation;
    readonly pending: ReturnType<typeof deferred<StrategicFitChangeOperationResult>>;
  }> = [];
  const discarded: string[] = [];
  const acceptedHooks: StrategicFitStagedChange[] = [];
  let closedHooks = 0;
  let closeBlocked = false;
  const boundary: ReplacementLabStateBoundary = {
    dependencies: { ...defaultBrowserCommandDependencies, analysisDepth: () => 20 },
    currentSnapshot: () => ({ ...snapshot }),
    currentCompletedReport: () => completed,
    currentFindingResolution: () => resolution,
    prepare: (context, candidateBoundary, controls) => ({
      context,
      actionability: replacementLabActionability(
        context,
        candidateBoundary.currentSnapshot(),
        candidateBoundary.currentCompletedReport(),
      ),
      request: {
        request_id: "replacement-request:prepared",
        repertoire_color: context.request_snapshot.repertoire_color,
        candidate_sources: controls.sources,
      } as never,
      pivot_result: selection,
    }),
    run: (prepared, _controls, pivotId, attempt, _candidateBoundary, options) => {
      const pending = deferred<ReplacementLabGenerationResult>();
      calls.push({ prepared, pivotId, attempt, options, pending });
      return pending.promise;
    },
    stageReview: async (_result, candidateId, action) => {
      const pending = deferred<Awaited<ReturnType<ReplacementLabStateBoundary["stageReview"]>>>();
      reviewCalls.push({ candidateId, action, pending });
      return pending.promise;
    },
    acceptStage: async (confirmation) => {
      const pending = deferred<StrategicFitChangeOperationResult>();
      acceptCalls.push({ confirmation, pending });
      return pending.promise;
    },
    discardStage: async (stageId) => {
      discarded.push(stageId);
      return { ok: false, error: "not-staged", stage: null };
    },
    onReviewAccepted: (stage) => {
      acceptedHooks.push(stage);
    },
    onLabClosed: () => {
      closedHooks++;
    },
    labCloseBlocked: () => closeBlocked,
  };
  const state = createReplacementLabState(boundary);
  return {
    ...base,
    state,
    calls,
    reviewCalls,
    acceptCalls,
    discarded,
    acceptedHooks,
    closedHooks: () => closedHooks,
    setCloseBlocked: (value: boolean) => {
      closeBlocked = value;
    },
    patchSnapshot: (patch: Partial<StrategicFitRequestSnapshot>) => {
      snapshot = { ...snapshot, ...patch };
    },
    replaceCompleted: (next: StrategicFitCompletedResult | null) => {
      completed = next;
    },
    setResolution: (next: "unresolved" | "defer") => {
      resolution = next;
    },
  };
}

function reviewStage(stageId = "stage:review"): StrategicFitStagedChange {
  return {
    stage_id: stageId,
    status: "staged",
    result_status: "previewed",
  } as StrategicFitStagedChange;
}

function reviewEvidence(stage: StrategicFitStagedChange) {
  return {
    action: "add-alternative",
    safety: {},
    item: {
      candidate_id: "candidate:usable-local",
      status: "previewed",
      error_code: null,
      explanation: "Canonical preview staged.",
      stage: { ok: true, stage },
    },
  } as Awaited<ReturnType<ReplacementLabStateBoundary["stageReview"]>>;
}

function reviewConfirmation(stageId = "stage:review"): StrategicFitChangeConfirmation {
  return { stage_id: stageId } as StrategicFitChangeConfirmation;
}

test("actionability accepts only the exact current supported finding identity", () => {
  const base = completedFixture();
  assert.equal(
    replacementLabActionability(base.context, base.snapshot, base.completed).code,
    "actionable",
  );

  const cases: readonly [string, StrategicFinding, Record<string, unknown>?][] = [
    ["provisional-finding", finding({ provisional: true })],
    ["resolved-finding", finding({ resolution_state: "defer" })],
    ["uncertain-finding", finding({ classification: "uncertain" })],
    ["uncertain-finding", finding({ classification: "data-quality-issue" })],
    ["forced-finding", finding({ classification: "forced-diversity" })],
    [
      "opponent-owned-finding",
      finding({
        evidence: {
          ...finding().evidence,
          causality: {
            ...finding().evidence.causality,
            label: "mostly-opponent-forced",
          },
        },
      }),
    ],
    [
      "non-causal-finding",
      finding({
        evidence: {
          ...finding().evidence,
          causality: {
            ...finding().evidence.causality,
            likely_causal_decision_ids: [],
          },
        },
      }),
    ],
    ["non-replacement-classification", finding({ classification: "intentional-diversity" })],
    [
      "unsupported-cohort",
      finding(),
      { cohorts: [{ cohort_id: "cohort:replacement-lab", state: "insufficient-evidence" }] },
    ],
  ];
  for (const [code, candidate, reportOverrides] of cases) {
    const subject = completedFixture({ finding: candidate, reportOverrides });
    assert.equal(
      replacementLabActionability(subject.context, subject.snapshot, subject.completed).code,
      code,
      code,
    );
  }

  const staleSemantic = completedFixture();
  const changedFinding = finding({ semantic_finding_id: "semantic:finding:replacement-lab:new" });
  const changedReport = {
    ...staleSemantic.report,
    findings: [changedFinding],
  } as StrategicFitAnalysisResult;
  const changedCompleted = { ...staleSemantic.completed, result: changedReport };
  assert.equal(
    replacementLabActionability(staleSemantic.context, staleSemantic.snapshot, changedCompleted)
      .code,
    "stale-finding",
  );
  assert.equal(
    replacementLabActionability(
      staleSemantic.context,
      { ...staleSemantic.snapshot, repertoire_revision: 8 },
      staleSemantic.completed,
    ).code,
    "stale-document",
  );
});

test("open, pivot confirmation, source/depth controls, and close preserve the repertoire", async () => {
  const subject = stateFixture();
  const originalPgn = subject.snapshot.repertoire_pgn;
  assert.equal(subject.state.open(subject.completed, subject.currentFinding), true);
  assert.equal(subject.state.snapshot().status, "pivot-ready");
  assert.equal(subject.state.snapshot().selected_pivot_decision_id, "decision:pivot");
  assert.equal(subject.state.snapshot().pivot_confirmed, false);
  assert.equal(subject.state.snapshot().identity?.repertoire_color, "black");
  assert.equal(subject.state.confirmPivot(), true);
  assert.equal(subject.state.snapshot().status, "ready");
  assert.equal(subject.state.setSource("opening-database", false), true);
  assert.equal(subject.state.snapshot().controls.sources.includes("opening-database"), false);
  assert.equal(subject.state.setSource("structurally-similar-repertoire", true), false);
  assert.equal(subject.state.setDepth(31), false);
  assert.equal(subject.state.setDepth(12), true);
  assert.equal(subject.state.snapshot().controls.engine_depth, 12);

  const pending = subject.state.generate();
  subject.calls[0]!.pending.resolve(generationResult({ stageId: "stage:controls" }));
  assert.equal(await pending, true);
  assert.equal(subject.state.snapshot().status, "complete");
  assert.equal(subject.state.snapshot().result?.request.repertoire_color, "black");
  assert.equal(subject.state.snapshot().result?.preview.host?.preview_policy, "stage-only");
  assert.equal(subject.state.snapshot().result?.request.provenance[0]?.source_id, SOURCE.source_id);
  assert.equal(subject.state.setDepth(14), true);
  assert.equal(subject.state.snapshot().result, null);
  assert.deepEqual(subject.discarded, ["stage:controls"]);
  const regenerated = subject.state.generate();
  subject.calls[1]!.pending.resolve(generationResult({ stageId: "stage:close" }));
  assert.equal(await regenerated, true);
  subject.state.close();
  assert.equal(subject.state.snapshot().status, "closed");
  assert.deepEqual(subject.discarded, ["stage:controls", "stage:close"]);
  assert.equal(subject.snapshot.repertoire_pgn, originalPgn);
});

test("persisted resolution projection blocks launch until the finding is reopened", () => {
  const subject = stateFixture();
  subject.setResolution("defer");
  assert.equal(
    subject.state.availability(subject.completed, subject.currentFinding).code,
    "resolved-finding",
  );
  assert.equal(subject.state.open(subject.completed, subject.currentFinding), false);
  assert.equal(subject.state.snapshot().open, false);
  subject.setResolution("unresolved");
  assert.equal(
    subject.state.availability(subject.completed, subject.currentFinding).code,
    "actionable",
  );
  assert.equal(subject.state.open(subject.completed, subject.currentFinding), true);
});

test("ambiguous and absent pivots require an explicit semantic choice and never infer first SAN", () => {
  const first = {
    ...pivot("decision:first").pivot,
    decision_id: "decision:first",
    san: "e4",
    ply: 1,
  };
  const second = {
    ...pivot("decision:second").pivot,
    decision_id: "decision:second",
    san: "Nf3",
    ply: 3,
  };
  const ambiguous = {
    status: "alternatives-required",
    pivot: { explanation: "Two causal decisions need confirmation." },
    alternative_pivots: [first, second],
  } as unknown as ReplacementPivotSelectionResult;
  const subject = stateFixture(ambiguous);
  assert.equal(subject.state.open(subject.completed, subject.currentFinding), true);
  assert.equal(subject.state.snapshot().status, "pivot-required");
  assert.equal(subject.state.snapshot().selected_pivot_decision_id, null);
  assert.equal(subject.state.confirmPivot(), false);
  assert.equal(subject.state.selectPivot("decision:not-present"), false);
  assert.equal(subject.state.selectPivot("decision:second"), true);
  assert.equal(subject.state.snapshot().selected_pivot_decision_id, "decision:second");
  assert.equal(subject.state.confirmPivot(), true);

  const absent = stateFixture({
    status: "non-actionable",
    pivot: { explanation: "No causal repertoire pivot." },
    non_actionable_reason: "no-supported-causal-pivot",
    alternative_pivots: [],
  } as unknown as ReplacementPivotSelectionResult);
  assert.equal(absent.state.open(absent.completed, absent.currentFinding), false);
  assert.equal(absent.state.snapshot().open, true);
  assert.equal(absent.state.snapshot().status, "non-actionable");
  assert.equal(absent.state.snapshot().selected_pivot_decision_id, null);
});

test("progress, cancellation, retry, partial retention, and structured item errors remain observable", async () => {
  const subject = stateFixture();
  subject.state.open(subject.completed, subject.currentFinding);
  subject.state.confirmPivot();
  const cancelled = subject.state.generate();
  subject.calls[0]!.options.onLabProgress({
    phase: "engine",
    completed: 2,
    total: 7,
    detail: "Depth 12",
  });
  assert.equal(subject.state.snapshot().progress?.phase, "engine");
  assert.equal(subject.state.cancel(), true);
  assert.equal(subject.calls[0]!.options.signal.aborted, true);
  subject.calls[0]!.pending.resolve(generationResult({ stageId: "stage:cancelled" }));
  assert.equal(await cancelled, false);
  assert.equal(subject.state.snapshot().status, "cancelled");
  assert.deepEqual(subject.discarded, ["stage:cancelled"]);

  const retry = subject.state.retry();
  subject.calls[1]!.pending.resolve(generationResult({ partial: true }));
  assert.equal(await retry, true);
  assert.equal(subject.state.snapshot().status, "partial");
  assert.equal(subject.state.snapshot().attempt, 2);
  assert.equal(
    subject.state.snapshot().result?.engine_generation.candidates[0]?.candidate_id,
    "candidate:usable-local",
  );
  assert.equal(
    subject.state.snapshot().result?.engine_generation.source_results[0]?.status,
    "unavailable",
  );
  assert.equal(
    subject.state.snapshot().result?.candidate_generation.database_item_results[0]?.error_code,
    "illegal-candidate-move",
  );
});

test("late and stale generation results are suppressed while navigation-only changes stay current", async () => {
  const subject = stateFixture();
  subject.state.open(subject.completed, subject.currentFinding);
  subject.state.confirmPivot();
  subject.state.synchronize();
  assert.equal(
    subject.state.snapshot().status,
    "ready",
    "navigation is absent from semantic snapshot identity",
  );

  const stale = subject.state.generate();
  subject.patchSnapshot({ repertoire_revision: 8 });
  subject.calls[0]!.pending.resolve(generationResult({ stageId: "stage:stale" }));
  assert.equal(await stale, false);
  assert.equal(subject.state.snapshot().status, "stale");
  assert.equal(subject.state.snapshot().result, null);
  assert.deepEqual(subject.discarded, ["stage:stale"]);

  subject.state.close();
  assert.equal(
    subject.state.snapshot().open,
    false,
    "transient lab state does not survive reload/recreation",
  );
  const reloaded = stateFixture();
  assert.equal(reloaded.state.snapshot().status, "closed");
  assert.equal(reloaded.state.snapshot().result, null);
});

test("acceptance permits one in-flight atomic call and ignores late completion after close", async () => {
  const readySubject = async () => {
    const subject = stateFixture();
    subject.state.open(subject.completed, subject.currentFinding);
    subject.state.confirmPivot();
    const generation = subject.state.generate();
    subject.calls[0]!.pending.resolve(generationResult());
    assert.equal(await generation, true);
    const staging = subject.state.stageReview("candidate:usable-local");
    const stage = reviewStage();
    subject.reviewCalls[0]!.pending.resolve(reviewEvidence(stage));
    assert.equal(await staging, true);
    assert.equal(subject.state.snapshot().review?.status, "ready");
    return { subject, stage };
  };

  const current = await readySubject();
  const first = current.subject.state.acceptReview(reviewConfirmation(current.stage.stage_id));
  assert.equal(current.subject.state.snapshot().review?.status, "accepting");
  assert.equal(
    await current.subject.state.acceptReview(reviewConfirmation(current.stage.stage_id)),
    false,
  );
  assert.equal(await current.subject.state.stageReview("candidate:usable-local", "replace"), false);
  assert.equal(
    current.subject.acceptCalls.length,
    1,
    "double acceptance reached atomic boundary twice",
  );
  current.subject.patchSnapshot({ repertoire_revision: 8 });
  current.subject.state.synchronize();
  assert.equal(
    current.subject.state.snapshot().review?.status,
    "accepting",
    "owned revision publish staled acceptance",
  );
  current.subject.acceptCalls[0]!.pending.resolve({
    ok: true,
    stage: { ...current.stage, status: "accepted", result_status: "accepted" },
  });
  assert.equal(await first, true);
  assert.equal(current.subject.state.snapshot().review?.status, "accepted");

  const late = await readySubject();
  const accepting = late.subject.state.acceptReview(reviewConfirmation(late.stage.stage_id));
  assert.equal(late.subject.acceptCalls.length, 1);
  late.subject.state.close();
  late.subject.acceptCalls[0]!.pending.resolve({
    ok: true,
    stage: { ...late.stage, status: "accepted", result_status: "accepted" },
  });
  assert.equal(await accepting, false);
  assert.equal(late.subject.state.snapshot().status, "closed");
  assert.equal(late.subject.state.snapshot().review, null);
});

test("successful acceptance notifies proof tracking once and close is blocked only while its undo is in flight", async () => {
  const readySubject = async () => {
    const subject = stateFixture();
    subject.state.open(subject.completed, subject.currentFinding);
    subject.state.confirmPivot();
    const generation = subject.state.generate();
    subject.calls[0]!.pending.resolve(generationResult());
    assert.equal(await generation, true);
    const staging = subject.state.stageReview("candidate:usable-local");
    const stage = reviewStage();
    subject.reviewCalls[0]!.pending.resolve(reviewEvidence(stage));
    assert.equal(await staging, true);
    return { subject, stage };
  };

  const rejected = await readySubject();
  const failing = rejected.subject.state.acceptReview(reviewConfirmation(rejected.stage.stage_id));
  rejected.subject.acceptCalls[0]!.pending.resolve({
    ok: false,
    error: "publish-failed",
    stage: rejected.stage,
  });
  assert.equal(await failing, false);
  assert.deepEqual(
    rejected.subject.acceptedHooks,
    [],
    "rejected acceptance must not start proof tracking",
  );

  const { subject, stage } = await readySubject();
  const accepting = subject.state.acceptReview(reviewConfirmation(stage.stage_id));
  const acceptedStage = {
    ...stage,
    status: "accepted",
    result_status: "accepted",
    accepted_revision: 8,
  } as StrategicFitStagedChange;
  subject.acceptCalls[0]!.pending.resolve({ ok: true, stage: acceptedStage });
  assert.equal(await accepting, true);
  assert.equal(
    subject.acceptedHooks.length,
    1,
    "successful acceptance must notify proof tracking exactly once",
  );
  assert.equal(subject.acceptedHooks[0]!.status, "accepted");
  assert.equal(subject.acceptedHooks[0]!.accepted_revision, 8);

  subject.setCloseBlocked(true);
  assert.equal(
    subject.state.close(),
    false,
    "close must not discard an in-flight post-acceptance undo",
  );
  assert.equal(subject.state.snapshot().open, true);
  assert.equal(subject.closedHooks(), 0);
  assert.equal(
    subject.state.open(subject.completed, subject.currentFinding),
    false,
    "reopening must not swap the lab out from under an in-flight undo",
  );
  assert.equal(subject.state.snapshot().review?.status, "accepted");
  subject.setCloseBlocked(false);
  assert.equal(subject.state.close(), true);
  assert.equal(subject.state.snapshot().open, false);
  assert.equal(
    subject.closedHooks(),
    1,
    "close must clear proof tracking through the boundary hook",
  );
});

function realPipelineFixture() {
  const domain = contextFixture(undefined, "white", undefined, REPLACEMENT_PGN, "browser:7");
  const currentFinding = {
    ...finding(),
    repertoire_revision: "browser:7",
    references: {
      position_ids: domain.pivotRoute.position_ids,
      decision_ids: domain.pivotRoute.decision_ids,
      route_ids: [domain.pivotRoute.route_id],
      source_san_paths: domain.pivotRoute.source_san_paths,
    },
    evidence: {
      ...finding().evidence,
      cohort_id: domain.cohort.cohort_id,
      dimensions: [{ dimension_id: "center-dynamics.center-state" }],
      causality: {
        analysis_version: "2.0.0",
        controllability: 0.9,
        label: "mostly-player-controlled",
        player_contribution: 0.9,
        opponent_contribution: 0.1,
        likely_causal_decision_ids: [domain.pivot.decision_id],
        timeline: [
          {
            event_id: "event:replacement-lab-real",
            kind: "player-decision",
            ply: domain.pivot.ply,
            position_id: domain.pivot.position_id,
            decision_id: domain.pivot.decision_id,
            san: domain.pivot.san,
            explanation: "Real pipeline fixture pivot.",
          },
        ],
        explanation: "Real pipeline fixture attribution.",
      },
      provenance: domain.request.provenance,
    },
    provenance: {
      ...finding().provenance,
      repertoire_revision: "browser:7",
      sources: domain.request.provenance,
    },
  } as StrategicFinding;
  const snapshot = {
    ...baseSnapshot(),
    repertoire_pgn: REPLACEMENT_PGN,
  };
  const report = {
    schema_version: domain.request.schema_version,
    analysis_version: domain.request.analysis_version,
    report_id: "report:replacement-lab",
    repertoire_revision: "browser:7",
    profile: domain.request.profile,
    preflight: { issues: [] },
    cohorts: [domain.cohort],
    findings: [currentFinding],
    trajectories: domain.trajectories.trajectories,
    summary: { metrics: scoringInput(domain, []).metrics },
    provenance: { sources: domain.request.provenance },
  } as unknown as StrategicFitAnalysisResult;
  const completed: StrategicFitCompletedResult = {
    request_id: "analysis-request:replacement-lab-real",
    report_id: report.report_id,
    request_snapshot: snapshot,
    result: report,
    completed_at: "2026-07-29T12:00:02.000Z",
  };
  const context: ReplacementLabContext = {
    completed,
    report,
    finding: currentFinding,
    cohort_id: domain.cohort.cohort_id,
    request_snapshot: snapshot,
  };
  return {
    domain,
    tree: GameTree.fromPgn(REPLACEMENT_PGN),
    snapshot,
    report,
    completed,
    context,
    currentFinding,
  };
}

const pipelineControls = (
  sources: readonly (
    | "existing-repertoire-transposition"
    | "move-order-shortcut"
    | "opening-database"
    | "engine-multipv"
  )[],
) => ({
  sources,
  engine_depth: 12,
  maximum_candidates: 4,
  maximum_subtree_nodes_per_candidate: 24,
  maximum_engine_positions: 8,
  maximum_explorer_queries: 8,
  engine_multipv: 3,
  strategic_horizon_ply: 14,
  minimum_reply_popularity: 0.03,
  include_all_forcing_replies: true,
});

test("real orchestration preserves unavailable sources and returns a typed empty preview for illegal-only evidence", async () => {
  const base = realPipelineFixture();
  const sourcePgn = base.tree.toPgn();
  let stageCalls = 0;
  const dependencies = {
    ...defaultBrowserCommandDependencies,
    currentTree: () => base.tree,
    currentRevision: () => 7,
    currentDocumentId: () => base.snapshot.document_id,
    currentColor: () => "white" as const,
    analysisDepth: () => 12,
    analyse: async () => null,
    hasExplorerToken: () => true,
    explorerPosition: async () => ({
      total_games: 10,
      white_pct: 50,
      draw_pct: 25,
      black_pct: 25,
      opening: null,
      moves: [
        {
          san: "Qh9",
          uci: "a1a9",
          games: 10,
          played_pct: 100,
          white_pct: 50,
          draw_pct: 25,
          black_pct: 25,
          average_rating: null,
        },
      ],
    }),
    stageReplacementChangeSet: async () => {
      stageCalls++;
      return { ok: true, stage: { stage_id: "stage:must-not-exist" } };
    },
    discardReplacementChangeSet: async () => undefined,
  };
  const boundary = {
    dependencies,
    currentSnapshot: () => base.snapshot,
    currentCompletedReport: () => base.completed,
  };
  const controls = pipelineControls(["opening-database"]);
  const prepared = prepareReplacementLab(base.context, boundary, controls);
  assert.equal(prepared.pivot_result?.status, "selected");
  const pivotId =
    prepared.pivot_result?.status === "selected"
      ? prepared.pivot_result.pivot.decision_id
      : "missing";
  const phases: string[] = [];
  const result = await runReplacementLabGeneration(prepared, controls, pivotId, 1, boundary, {
    onLabProgress: (progress) => phases.push(progress.phase),
  });
  assert.equal(result.request.report_id, base.report.report_id);
  assert.equal(result.request.finding_id, base.currentFinding.finding_id);
  assert.equal(result.request.repertoire_color, "white");
  assert.equal(
    result.request.provenance[0]?.source_id,
    base.domain.request.provenance[0]?.source_id,
  );
  assert.equal(result.candidate_generation.database_item_results[0]?.status, "illegal");
  assert.notEqual(result.candidate_generation.database_item_results[0]?.error_code, null);
  assert.equal(result.engine_generation.source_results[0]?.status, "partial");
  assert.equal(result.preview.status, "complete");
  assert.equal(result.preview.items.length, 0);
  assert.equal(result.preview.host?.preview_policy, "stage-only");
  assert.equal(result.preview.source_tree_unchanged, true);
  assert.equal(stageCalls, 0);
  assert.equal(phases[0], "validating");
  assert.equal(phases.at(-1), "staging");
  assert.equal(base.tree.toPgn(), sourcePgn);
});

test("real orchestration retains local candidates and delegates any complete previews to stage-only browser handling", async () => {
  const base = realPipelineFixture();
  const sourcePgn = base.tree.toPgn();
  let stageCalls = 0;
  const stagedActions: string[] = [];
  const dependencies = {
    ...defaultBrowserCommandDependencies,
    currentTree: () => base.tree,
    currentRevision: () => 7,
    currentDocumentId: () => base.snapshot.document_id,
    currentColor: () => "white" as const,
    analysisDepth: () => 12,
    analyse: async () => null,
    hasExplorerToken: () => false,
    stageReplacementChangeSet: async ({ safety, change_set }) => {
      stagedActions.push(
        `${safety.candidates.find((candidate) => candidate.candidate_id === change_set.candidate_id)?.action}:${change_set.retention.prune}`,
      );
      return { ok: true, stage: { stage_id: `stage:real:${++stageCalls}` } };
    },
    discardReplacementChangeSet: async () => undefined,
  };
  const boundary = {
    dependencies,
    currentSnapshot: () => base.snapshot,
    currentCompletedReport: () => base.completed,
  };
  const controls = pipelineControls([
    "existing-repertoire-transposition",
    "move-order-shortcut",
    "engine-multipv",
  ]);
  const prepared = prepareReplacementLab(base.context, boundary, controls);
  const pivotId =
    prepared.pivot_result?.status === "selected"
      ? prepared.pivot_result.pivot.decision_id
      : "missing";
  const result = await runReplacementLabGeneration(prepared, controls, pivotId, 1, boundary);
  assert.equal(result.candidate_generation.candidates.length > 0, true);
  assert.equal(result.engine_generation.candidates.length > 0, true);
  assert.equal(result.engine_generation.source_results[0]?.status, "unavailable");
  assert.equal(result.expansion.candidates.length > 0, true);
  assert.equal(
    result.preview.items.filter((item) => item.status === "previewed").length,
    stageCalls,
  );
  assert.equal(
    result.preview.items.some((item) => item.error_code !== null),
    true,
  );
  assert.equal(result.preview.host?.preview_policy, "stage-only");
  const selected = result.safety.candidates.find((candidate) => candidate.status !== "unavailable");
  assert.ok(selected);
  const addReview = await stageReplacementLabChangeReview(
    result,
    selected.candidate_id,
    "add-alternative",
    boundary,
  );
  assert.equal(addReview.action, "add-alternative");
  assert.equal(
    addReview.safety.candidates.find(
      (candidate) => candidate.candidate_id === selected.candidate_id,
    )?.action,
    "add-alternative",
  );
  assert.equal(addReview.item.status, "previewed");
  assert.ok(stagedActions.includes("add-alternative:retain"));
  const pruneReview = await stageReplacementLabChangeReview(
    result,
    selected.candidate_id,
    "replace",
    boundary,
  );
  const pruneSafety = pruneReview.safety.candidates.find(
    (candidate) => candidate.candidate_id === selected.candidate_id,
  )!;
  assert.equal(pruneSafety.action, "replace");
  if (pruneReview.item.status === "previewed") {
    assert.ok(stagedActions.includes("replace:prune"));
  } else {
    assert.equal(pruneReview.item.status, "blocked");
    assert.ok(pruneSafety.safety_checks.some((check) => check.status === "blocked"));
  }
  assert.equal(base.tree.toPgn(), sourcePgn);
});
