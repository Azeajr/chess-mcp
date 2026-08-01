import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";

import {
  REPLACEMENT_TOOL_V2_CONTRACT,
  REPLACEMENT_TOOL_V2_ERROR_CODES,
  REPLACEMENT_TOOL_V2_ITEM_STATUSES,
  REPLACEMENT_TOOL_V2_RESULT_STATUSES,
  composeReplacementToolV2,
  produceReplacementToolV2Previews,
  type ReplacementToolV2Input,
} from "../../src/index.ts";
import { replacementFixture } from "./replacement-change-set.fixtures.ts";

function input(): {
  fixture: ReturnType<typeof replacementFixture>;
  value: ReplacementToolV2Input;
} {
  const fixture = replacementFixture("tool preview");
  const request = fixture.request;
  return {
    fixture,
    value: {
      contract: REPLACEMENT_TOOL_V2_CONTRACT,
      replacement_request: request,
      finding: {
        report_id: request.report_id,
        finding_id: request.finding_id,
        semantic_finding_id: request.semantic_finding_id,
        cohort_id: request.cohort_id,
        repertoire_revision: request.repertoire_revision,
      },
      pivot: request.pivot_selection,
      profile: request.profile,
      sources: request.candidate_sources,
      budget: request.budget,
      engine: {
        depth: request.budget.engine_depth,
        multipv: request.budget.engine_multipv,
        allow_unavailable_evidence: true,
      },
      coverage: {
        minimum_expected_opponent_coverage: request.minimum_expected_opponent_coverage,
        require_all_forcing_replies: request.budget.include_all_forcing_replies,
      },
      retention: [
        {
          candidate_id: fixture.candidate.candidate_id,
          action: "replace",
          prune_explicitly_confirmed: true,
        },
      ],
      candidate_ids: [fixture.candidate.candidate_id],
      safety: fixture.safety,
    },
  };
}

test("canonical V2 envelope returns complete Task 8.3-8.8 evidence and atomic preview without mutation", () => {
  const { fixture, value } = input();
  const treeBefore = fixture.tree.toPgn();
  const inputBefore = structuredClone(value);
  const result = composeReplacementToolV2(fixture.tree, value);
  assert.equal(result.status, "complete");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.status, "previewed");
  assert.equal(result.items[0]?.change_set?.atomic, true);
  assert.equal(result.items[0]?.change_set?.staged, true);
  assert.equal(result.items[0]?.preview?.status, "previewed");
  assert.equal(result.items[0]?.preview?.result.repertoire_revision, null);
  assert.equal(result.items[0]?.preview?.result.preview.archive_payloads.length, 1);
  assert.equal(fixture.tree.toPgn(), treeBefore);
  assert.equal(
    isDeepStrictEqual(value, inputBefore),
    true,
    "V2 composer mutated full input evidence",
  );
  assert.equal(result.source_tree_unchanged, true);
  assert.equal(result.inputs_unchanged, true);
  assert.equal(result.repertoire_color, "white");
  assert.equal(
    result.items[0]?.preview?.result.preview.objective_quality_after.white_pov_evaluation_cp !=
      null,
    true,
  );
});

test("finding, pivot, profile, source, budget, engine, coverage, retention, safety, and candidate errors stay structured", () => {
  const mutations: Array<[string, (value: ReplacementToolV2Input) => ReplacementToolV2Input]> = [
    [
      "finding-mismatch",
      (value) => ({ ...value, finding: { ...value.finding, finding_id: "finding:stale" } }),
    ],
    [
      "pivot-mismatch",
      (value) => ({ ...value, pivot: { kind: "user-selected", decision_id: "decision:stale" } }),
    ],
    [
      "profile-mismatch",
      (value) => ({ ...value, profile: { ...value.profile, mode: "balanced" } }),
    ],
    ["source-mismatch", (value) => ({ ...value, sources: ["user-line"] })],
    [
      "budget-mismatch",
      (value) => ({ ...value, budget: { ...value.budget, maximum_candidates: 2 } }),
    ],
    [
      "engine-mismatch",
      (value) => ({ ...value, engine: { ...value.engine, depth: value.engine.depth - 1 } }),
    ],
    [
      "coverage-mismatch",
      (value) => ({
        ...value,
        coverage: { ...value.coverage, require_all_forcing_replies: false },
      }),
    ],
    ["retention-mismatch", (value) => ({ ...value, retention: [] })],
    [
      "safety-mismatch",
      (value) => ({ ...value, safety: { ...value.safety, finding_id: "finding:stale" } }),
    ],
    [
      "duplicate-candidate",
      (value) => ({ ...value, candidate_ids: [...value.candidate_ids, ...value.candidate_ids] }),
    ],
  ];
  for (const [expected, mutate] of mutations) {
    const { fixture, value } = input();
    const result = composeReplacementToolV2(fixture.tree, mutate(value));
    assert.equal(result.error_code, expected, expected);
    assert.equal(result.items.length, 0, expected);
  }
  const { fixture, value } = input();
  const missing = composeReplacementToolV2(fixture.tree, {
    ...value,
    candidate_ids: ["candidate:missing"],
    retention: [],
  });
  assert.equal(missing.status, "partial");
  assert.equal(missing.items[0]?.status, "invalid");
  assert.equal(missing.items[0]?.error_code, "candidate-not-found");
});

test("cancellation and unavailable evidence remain explicit; enums and package-root serialization are exhaustive", () => {
  const { fixture, value } = input();
  const controller = new AbortController();
  controller.abort();
  const cancelled = composeReplacementToolV2(fixture.tree, value, { signal: controller.signal });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.error_code, "cancelled");
  assert.equal(cancelled.items.length, 0);
  assert.equal(value.engine.allow_unavailable_evidence, true);
  assert.deepEqual(REPLACEMENT_TOOL_V2_ITEM_STATUSES, [
    "previewed",
    "stale",
    "invalid",
    "blocked",
    "cancelled",
  ]);
  assert.deepEqual(REPLACEMENT_TOOL_V2_RESULT_STATUSES, [
    "complete",
    "partial",
    "stale",
    "invalid",
    "cancelled",
  ]);
  assert.equal(
    new Set(REPLACEMENT_TOOL_V2_ERROR_CODES).size,
    REPLACEMENT_TOOL_V2_ERROR_CODES.length,
  );
  const serialized = JSON.stringify(cancelled);
  assert.equal(serialized.includes('"contract":"strategic-fit-replacement-v2"'), true);
  assert.equal(serialized.includes('"replacement_schema_version":"1.0.0"'), true);
  assert.equal(serialized.includes('"provenance"'), true);
  assert.equal(
    produceReplacementToolV2Previews,
    composeReplacementToolV2,
    "canonical producer alias missing from package root",
  );
});

test("host-injected revision and ownership reject cross-handle retained evidence", () => {
  const { fixture, value } = input();
  for (const options of [
    {
      expected_repertoire_revision: "mcp:another-handle",
      expected_repertoire_color: value.replacement_request.repertoire_color,
    },
    {
      expected_repertoire_revision: value.replacement_request.repertoire_revision,
      expected_repertoire_color: "black" as const,
    },
  ]) {
    const result = composeReplacementToolV2(fixture.tree, value, options);
    assert.equal(result.status, "stale");
    assert.equal(result.error_code, "safety-mismatch");
    assert.equal(result.items.length, 0);
  }
});

test("malformed nested retained evidence is a total structured invalid result", () => {
  const { fixture, value } = input();
  const malformed = {
    ...value,
    replacement_request: { ...value.replacement_request, provenance: [null] },
  } as unknown as ReplacementToolV2Input;
  const result = composeReplacementToolV2(fixture.tree, malformed);
  assert.equal(result.status, "invalid");
  assert.equal(result.error_code, "invalid-request");
  assert.equal(result.items.length, 0);
});
