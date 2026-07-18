import assert from "node:assert/strict";
import test from "node:test";

import {
  STRATEGIC_FIT_CLASSIFICATIONS,
  type FindingPriorityLabel,
  type StrategicFinding,
  type StrategicFitAnalysisResult,
  type StrategicFitClassification,
} from "@chess-mcp/chess-tools";
import {
  STRATEGIC_FIT_CAUSAL_LABELS,
  STRATEGIC_FIT_CLASSIFICATION_LABELS,
  STRATEGIC_FIT_RESOLUTION_LABELS,
  buildFindingCardPresentation,
} from "../src/components/strategic-fit/FindingCard.tsx";
import {
  STRATEGIC_FIT_QUEUE_PAGE_SIZE,
  buildStrategicFitFindingQueueView,
  createStrategicFitFindingQueueState,
  type StrategicFitFindingQueueSnapshot,
} from "../src/store/strategic-fit-finding-queue.ts";
import type { StrategicFitFindingQueueIntent } from "../src/store/ui.ts";

function finding(
  id: string,
  patch: {
    classification?: StrategicFitClassification;
    opening?: string;
    replacementLabel?: FindingPriorityLabel;
    replacementScore?: number;
    trainingLabel?: FindingPriorityLabel;
    trainingScore?: number;
    frequency?: number | null;
  } = {},
): StrategicFinding {
  const classification = patch.classification ?? "genuine-inconsistency";
  return {
    schema_version: "1.0.0",
    analysis_version: "2.0.0",
    finding_id: id,
    semantic_finding_id: `semantic:${id}`,
    repertoire_revision: "browser:1",
    classification,
    plain_language_category: `Category ${id}`,
    opening_scope: patch.opening ?? "Sicilian · Alapin",
    affected_line_summary: "6...Nf6 branch",
    explanation: "This branch reaches a closed center while the weighted baseline stays open.",
    references: {
      position_ids: [`position:${id}:a`, `position:${id}:b`],
      decision_ids: [`decision:${id}:a`, `decision:${id}:b`],
      route_ids: [`route:${id}:a`, `route:${id}:b`],
      source_san_paths: [
        ["e4", "c5", "c3", "Nf6"],
        ["e4", "c5", "Nf3", "e6", "c3"],
        [],
      ],
    },
    weighted_baseline_percentage: 78,
    expected_frequency: patch.frequency === undefined ? 0.12 : patch.frequency,
    learning_burden: 0.6,
    confidence: {
      analysis_version: "2.0.0",
      score: 86,
      label: "high",
      components: [],
      applied_caps: [],
      explanation: "Strong comparison evidence.",
    },
    difference: {
      analysis_version: "2.0.0",
      distance: 0.8,
      magnitude: "major",
      persistence: 0.9,
      new_concept_count: 2,
      stable_from_ply: 16,
    },
    objective_quality: {
      analysis_version: "2.0.0",
      state: "available",
      verdict: "sound",
      repertoire_pov_cp: 20,
      loss_from_best_cp: 10,
      engine_depth: 20,
      engine_lines: 3,
      database_performance: null,
      theoretical_status: null,
      reason: null,
      provenance: [],
    },
    replacement_priority: {
      analysis_version: "2.0.0",
      kind: "replacement",
      score: patch.replacementScore ?? 0.7,
      label: patch.replacementLabel ?? "review-now",
      confidence: 0.8,
      difference: 0.8,
      expected_frequency: 0.12,
      learning_burden: 0.6,
      preference_mismatch: 0.7,
      actionability: 0.9,
    },
    training_priority: {
      analysis_version: "2.0.0",
      kind: "training",
      score: patch.trainingScore ?? 0.4,
      label: patch.trainingLabel ?? "review-later",
      confidence: 0.8,
      difference: 0.8,
      expected_frequency: 0.12,
      learning_burden: 0.6,
      preference_mismatch: 0.7,
      actionability: 0.9,
    },
    evidence: {
      analysis_version: "2.0.0",
      cohort_id: "cohort:a",
      baseline_mode_ids: ["mode:a"],
      representative_route_ids: [`route:${id}:a`],
      dimensions: [],
      comparison_basis: {
        effective_branches: 4,
        weighted_reference_games: null,
        structural_classification_coverage: 1,
        analysis_window: [10, 20],
        taxonomy_version: "1.0.0",
        profile_mode: "balanced",
      },
      causality: {
        analysis_version: "2.0.0",
        controllability: 0.8,
        label: "mostly-player-controlled",
        player_contribution: 0.8,
        opponent_contribution: 0.2,
        likely_causal_decision_ids: [`decision:${id}:a`],
        timeline: [],
        explanation: "The repertoire choice owns most of this difference.",
      },
      data_quality_issue_ids: [],
      provenance: [],
    },
    resolution_state: "unresolved",
    provisional: false,
    provenance: {
      generated_at: "2026-07-18T00:00:00.000Z",
      sources: [],
    },
  } as unknown as StrategicFinding;
}

function report(
  id: string,
  findings: readonly StrategicFinding[],
  page: { offset: number; limit: number; total_count: number; has_more: boolean } = {
    offset: 0,
    limit: findings.length || 1,
    total_count: findings.length,
    has_more: false,
  },
): StrategicFitAnalysisResult {
  return {
    report_id: id,
    repertoire_revision: findings[0]?.repertoire_revision ?? "browser:1",
    findings,
    finding_page: {
      ...page,
      returned_count: findings.length,
    },
  } as unknown as StrategicFitAnalysisResult;
}

const queueSnapshot = (
  findings: readonly StrategicFinding[],
  patch: Partial<StrategicFitFindingQueueSnapshot> = {},
): StrategicFitFindingQueueSnapshot => ({
  report_id: "report:queue",
  repertoire_revision: "browser:1",
  status: "ready",
  findings,
  canonical_total_count: findings.length,
  error: null,
  sort: "replacement-priority",
  priority_kind: "replacement",
  priority_filter: "all",
  opening_filter: "",
  intent: null,
  page_offset: 0,
  selected_finding_id: null,
  ...patch,
});

test("card presentation gives every classification plain language and preserves every semantic source path", () => {
  assert.deepEqual(
    STRATEGIC_FIT_CLASSIFICATIONS.map((classification) =>
      buildFindingCardPresentation(finding(`finding:${classification}`, { classification })).classification
    ),
    STRATEGIC_FIT_CLASSIFICATIONS.map((classification) =>
      STRATEGIC_FIT_CLASSIFICATION_LABELS[classification]
    ),
  );

  const presentation = buildFindingCardPresentation(finding("finding:multi-path"));
  assert.deepEqual(presentation, {
    classification: "Avoidable inconsistency",
    baseline: "78% weighted baseline",
    expected_frequency: "12% expected frequency",
    difference: "Major difference",
    confidence: "High confidence · 86/100",
    causal_ownership: STRATEGIC_FIT_CAUSAL_LABELS["mostly-player-controlled"],
    objective_soundness: "Verified: objectively sound",
    objective_reason: null,
    resolution: STRATEGIC_FIT_RESOLUTION_LABELS.unresolved,
    replacement_priority: "Replacement: Review now",
    training_priority: "Training: Review later",
    source_paths: [
      "e4 c5 c3 Nf6",
      "e4 c5 Nf3 e6 c3",
      "Start position",
    ],
  });
});

test("missing optional frequency and objective evidence are explicit rather than zero or verified", () => {
  const unavailable = structuredClone(finding("finding:unavailable", { frequency: null }));
  Object.assign(unavailable.objective_quality, {
    state: "unavailable",
    verdict: "unknown",
    reason: "No engine verification was requested for the read-only base scan.",
  });
  const presentation = buildFindingCardPresentation(unavailable);
  assert.equal(presentation.expected_frequency, "Expected frequency unavailable");
  assert.equal(presentation.objective_soundness, "Objective soundness unavailable");
  assert.match(presentation.objective_reason ?? "", /No engine verification/);
  assert.doesNotMatch(presentation.expected_frequency, /0%/);
});

test("canonical sorts use deterministic identity tie-breaks and priority/opening filters compose", () => {
  const findings = [
    finding("finding:c", { opening: "French", replacementScore: 0.5, trainingLabel: "review-now" }),
    finding("finding:b", { opening: "Sicilian", replacementScore: 0.8, trainingLabel: "informational" }),
    finding("finding:a", { opening: "Sicilian", replacementScore: 0.8, trainingLabel: "review-now" }),
  ];
  assert.deepEqual(
    buildStrategicFitFindingQueueView(queueSnapshot(findings)).findings.map((item) => item.finding_id),
    ["finding:a", "finding:b", "finding:c"],
  );
  assert.deepEqual(
    buildStrategicFitFindingQueueView(queueSnapshot(findings, {
      priority_kind: "training",
      priority_filter: "review-now",
      opening_filter: "Sicilian",
    })).findings.map((item) => item.finding_id),
    ["finding:a"],
  );
});

test("overview classification, resolution, and insufficient-evidence intents are report-bound", () => {
  const forced = finding("finding:forced", { classification: "forced-diversity" });
  const intentional = finding("finding:intentional", { classification: "intentional-diversity" });
  const uncertain = finding("finding:uncertain", { classification: "uncertain" });
  const resolved = structuredClone(finding("finding:resolved"));
  Object.assign(resolved, { resolution_state: "keep-intentionally" });
  const findings = [forced, intentional, uncertain, resolved];
  const intent = (filter: StrategicFitFindingQueueIntent["filter"]): StrategicFitFindingQueueIntent => ({
    report_id: "report:queue",
    source: "test",
    label: "Test focus",
    filter,
  });

  assert.deepEqual(buildStrategicFitFindingQueueView(queueSnapshot(findings, {
    intent: intent({ kind: "classification", classification: "forced-diversity" }),
  })).findings.map((item) => item.finding_id), ["finding:forced"]);
  assert.deepEqual(buildStrategicFitFindingQueueView(queueSnapshot(findings, {
    intent: intent({ kind: "resolution", resolution: "unresolved" }),
  })).filtered_findings.map((item) => item.finding_id).sort(), [
    "finding:forced", "finding:intentional", "finding:uncertain",
  ]);
  assert.deepEqual(buildStrategicFitFindingQueueView(queueSnapshot(findings, {
    intent: intent({ kind: "evidence", evidence: "insufficient" }),
  })).findings.map((item) => item.finding_id), ["finding:uncertain"]);
});

test("presentation paging reports exact filtered metadata and retains deterministic selection only on-page", () => {
  const findings = Array.from({ length: 14 }, (_, index) =>
    finding(`finding:${String(index).padStart(2, "0")}`, { replacementScore: 1 - index / 100 })
  );
  const view = buildStrategicFitFindingQueueView(queueSnapshot(findings, {
    page_offset: STRATEGIC_FIT_QUEUE_PAGE_SIZE,
    selected_finding_id: "finding:07",
  }));
  assert.deepEqual(view.page, {
    offset: 6,
    limit: 6,
    total_count: 14,
    returned_count: 6,
    has_more: true,
  });
  assert.deepEqual(view.findings.map((item) => item.finding_id), [
    "finding:06", "finding:07", "finding:08", "finding:09", "finding:10", "finding:11",
  ]);
  assert.equal(view.selected_finding_id, "finding:07");
});

test("large current reports reload every canonical finding-id page through the registry boundary", async () => {
  const all = Array.from({ length: 55 }, (_, index) =>
    finding(`finding:${String(index).padStart(2, "0")}`)
  );
  const calls: Record<string, unknown>[] = [];
  const queue = createStrategicFitFindingQueueState({
    execute: async (_command, args) => {
      calls.push(args);
      const page = args.page as { offset: number; limit: number };
      const items = all.slice(page.offset, page.offset + page.limit);
      return report("report:large", items, {
        offset: page.offset,
        limit: page.limit,
        total_count: all.length,
        has_more: page.offset + items.length < all.length,
      });
    },
  });
  await queue.synchronize(report("report:large", all.slice(0, 50), {
    offset: 0,
    limit: 50,
    total_count: 55,
    has_more: true,
  }));

  assert.equal(queue.snapshot().status, "ready");
  assert.equal(queue.snapshot().findings.length, 55);
  assert.deepEqual(calls, [
    { sort: "finding-id", page: { offset: 0, limit: 50 } },
    { sort: "finding-id", page: { offset: 50, limit: 50 } },
  ]);
  assert.equal(queue.view().canonical_total_count, 55);
});

test("a new report aborts and discards an older report page without leaking filters or selection", async () => {
  let resolveOld!: (value: unknown) => void;
  const oldPage = new Promise<unknown>((resolve) => { resolveOld = resolve; });
  const queue = createStrategicFitFindingQueueState({ execute: async () => oldPage });
  const oldFinding = finding("finding:old", { classification: "forced-diversity" });
  const oldRun = queue.synchronize(report("report:old", [oldFinding], {
    offset: 0,
    limit: 1,
    total_count: 2,
    has_more: true,
  }), {
    report_id: "report:old",
    source: "test",
    label: "Old forced focus",
    filter: { kind: "classification", classification: "forced-diversity" },
  });
  assert.equal(queue.snapshot().status, "loading");

  const current = finding("finding:new", { opening: "French" });
  await queue.synchronize(report("report:new", [current]));
  queue.selectFinding("finding:new");
  queue.setOpeningFilter("French");
  assert.equal(queue.snapshot().report_id, "report:new");

  resolveOld(report("report:old", [oldFinding], {
    offset: 0,
    limit: 1,
    total_count: 2,
    has_more: true,
  }));
  await oldRun;
  assert.equal(queue.snapshot().report_id, "report:new");
  assert.deepEqual(queue.snapshot().findings.map((item) => item.finding_id), ["finding:new"]);

  const newer = finding("finding:newer");
  await queue.synchronize(report("report:newer", [newer]));
  assert.equal(queue.snapshot().intent, null);
  assert.equal(queue.snapshot().opening_filter, "");
  assert.equal(queue.snapshot().selected_finding_id, null);
  assert.equal(queue.snapshot().page_offset, 0);
});
