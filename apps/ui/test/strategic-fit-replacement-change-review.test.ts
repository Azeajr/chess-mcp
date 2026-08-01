import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyReplacementChangeSet,
  constructReplacementChangeSet,
  type ReplacementCandidateSafetySimulation,
} from "@chess-mcp/chess-tools";
import {
  addOnlyFixture,
  replacementFixture,
} from "../../../packages/chess-tools/test/strategic-fit/replacement-change-set.fixtures.ts";
import { buildBeforeAfterImpact } from "../src/components/strategic-fit/BeforeAfterImpact.tsx";
import {
  blockedReviewCopy,
  buildChangeSetReviewEvidence,
} from "../src/components/strategic-fit/ChangeSetPreview.tsx";
import { replacementLabChangeReviewStatus } from "../src/store/strategic-fit-replacement.ts";
import {
  strategicFitChangeConfirmation,
  type StrategicFitStagedChange,
} from "../src/store/strategic-fit-changes.ts";

function stagedFixture(action: "add" | "replace") {
  const values =
    action === "add" ? addOnlyFixture("novel") : replacementFixture("keep exact annotation");
  const constructed = constructReplacementChangeSet({
    source_tree: values.tree,
    current_repertoire_revision: values.request.repertoire_revision,
    safety: values.safety,
    candidate_id: values.candidate.candidate_id,
  });
  assert.equal(
    constructed.status,
    "constructed",
    `${constructed.error_code}: ${constructed.explanation}`,
  );
  assert.ok(constructed.change_set);
  const applied = applyReplacementChangeSet({
    source_tree: values.tree,
    current_repertoire_revision: values.request.repertoire_revision,
    safety: values.safety,
    change_set: constructed.change_set,
  });
  assert.equal(applied.status, "success");
  if (applied.status !== "success") throw new Error(applied.output.failure?.explanation);
  const candidate = values.safety.candidates.find(
    (item) => item.candidate_id === values.candidate.candidate_id,
  )!;
  const stage: StrategicFitStagedChange = {
    stage_id: `stage:${action}`,
    status: "staged",
    result_status: "previewed",
    document_id: "document:change-review",
    base_revision: 42,
    base_repertoire_revision: values.request.repertoire_revision,
    tree_identity: "tree:immutable",
    metadata_identity: "metadata:immutable",
    safety_identity: "safety:immutable",
    change_set_identity: "change-set:immutable",
    preview_identity: "preview:immutable",
    archive_identity: "archive:immutable",
    provenance_identity: "provenance:immutable",
    safety: structuredClone(values.safety),
    change_set: structuredClone(constructed.change_set),
    preview: structuredClone(applied.output),
    navigation_san_path: [],
    created_at: "2026-07-29T12:00:00.000Z",
    accepted_revision: null,
    error_code: null,
  };
  return { stage, candidate };
}

test("add-only default exposes exact additions, descendants, coverage, metrics, theory, training, and no pruning", () => {
  const { stage, candidate } = stagedFixture("add");
  const review = buildChangeSetReviewEvidence(stage, candidate);
  const impact = buildBeforeAfterImpact(stage.preview.result.preview);
  assert.equal(review.retention.prune, "retain");
  assert.equal(review.retention.archive, "keep-active");
  assert.equal(
    review.operations.some(({ operation }) => operation.kind === "prune-subtree"),
    false,
  );
  assert.equal(
    review.operations.some(({ operation }) => operation.kind === "archive-subtree"),
    false,
  );
  assert.ok(review.operations.some(({ operation }) => operation.kind === "add-subtree"));
  assert.ok(review.operations.flatMap(({ diff }) => diff?.added_paths ?? []).length > 0);
  assert.ok(review.affected_paths.length > 0);
  assert.equal(impact.coverage.state, candidate.coverage_effects.state);
  assert.deepEqual(impact.coverage.newly_covered, candidate.coverage_effects.newly_covered_replies);
  assert.equal(impact.affected_metrics.length, candidate.coverage_effects.affected_metrics.length);
  assert.equal(
    impact.theory.added,
    stage.preview.result.preview.strategic_score_after.theory_nodes_added,
  );
  assert.equal(
    impact.training.after,
    stage.preview.result.preview.strategic_score_after.training_cost,
  );
  assert.equal(stage.preview.source_tree_unchanged, true);
});

test("safe replacement displays archive-before-prune, annotations, exact links/removals, provenance, and stable identities", () => {
  const { stage, candidate } = stagedFixture("replace");
  const review = buildChangeSetReviewEvidence(stage, candidate);
  const kinds = review.operations.map(({ operation }) => operation.kind);
  assert.equal(review.retention.archive, "archive");
  assert.equal(review.retention.prune, "prune");
  assert.equal(review.retention.prune_explicitly_confirmed, true);
  assert.ok(kinds.indexOf("archive-subtree") >= 0);
  assert.ok(kinds.indexOf("prune-subtree") > kinds.indexOf("archive-subtree"));
  assert.ok(review.archive_payloads.length > 0);
  assert.match(review.archive_payloads[0]!.pgn, /keep exact annotation/);
  assert.ok(review.operations.flatMap(({ diff }) => diff?.removed_paths ?? []).length > 0);
  assert.equal(review.identities.stage_id, stage.stage_id);
  assert.equal(review.identities.preview_identity, stage.preview_identity);
  assert.equal(review.versions.replacement_schema_version, "1.0.0");
  assert.ok(review.provenance.length > 0);
  assert.equal(review.finding_changes_state, "not-reanalyzed");
  const component = readFileSync(
    new URL("../src/components/strategic-fit/ChangeSetPreview.tsx", import.meta.url),
    "utf8",
  );
  assert.match(component, /preserve-annotation/);
  assert.match(component, /Comments:/);
  assert.match(component, /semantic_equivalence_verified/);
});

test("blocked unsafe prune preserves exact coverage failure, partial/unavailable states, risks, and structured errors", () => {
  const { stage, candidate } = stagedFixture("replace");
  const blocked = {
    ...candidate,
    status: "blocked",
    error_code: "required-reply-uncovered",
    scored_candidate: {
      ...candidate.scored_candidate,
      expansion: {
        ...candidate.scored_candidate.expansion,
        unresolved_risks: [
          {
            analysis_version: "2.0.0",
            risk_id: "risk:coverage-loss",
            kind: "coverage-gap",
            status: "blocking",
            explanation: "Required reply e5 becomes uncovered.",
            affected_position_ids: ["position:gap"],
            affected_route_ids: ["route:gap"],
            provenance: candidate.provenance,
          },
        ],
      },
    },
    safety_checks: candidate.safety_checks.map((check) =>
      check.kind === "coverage" || check.kind === "gap-scan"
        ? {
            ...check,
            status: "blocked" as const,
            explanation: "Exact required reply becomes uncovered.",
          }
        : check.kind === "affected-cohort-preview"
          ? {
              ...check,
              status: "unavailable" as const,
              explanation: "Canonical metric evidence is partial.",
            }
          : check,
    ),
  } as ReplacementCandidateSafetySimulation;
  const review = buildChangeSetReviewEvidence(stage, blocked);
  assert.equal(review.safety_checks.filter((check) => check.status === "blocked").length, 2);
  assert.ok(review.safety_checks.some((check) => check.status === "unavailable"));
  assert.equal(review.unresolved_risks[0]?.status, "blocking");
  assert.equal(blocked.error_code, "required-reply-uncovered");
  assert.match(
    blocked.safety_checks.find((check) => check.kind === "coverage")!.explanation,
    /Exact required reply/,
  );
});

test("invalid, unavailable, and action-specific blocked review states stay explicit", () => {
  const { stage } = stagedFixture("add");
  assert.equal(replacementLabChangeReviewStatus("previewed", stage), "ready");
  assert.equal(replacementLabChangeReviewStatus("invalid", null), "error");
  assert.equal(replacementLabChangeReviewStatus("cancelled", null), "error");
  assert.equal(replacementLabChangeReviewStatus("stale", null), "stale");
  assert.equal(replacementLabChangeReviewStatus("blocked", null), "blocked");
  assert.match(blockedReviewCopy("add-alternative").heading, /Add-and-validate/);
  assert.doesNotMatch(blockedReviewCopy("add-alternative").heading, /Pruning/);
  assert.match(blockedReviewCopy("replace").heading, /Pruning/);
  assert.match(blockedReviewCopy("add-alternative").fallback, /add-and-validate/);
});

test("final confirmation binds current revision and immutable evidence identity without collapsing POV labels", () => {
  const { stage } = stagedFixture("replace");
  const confirmation = strategicFitChangeConfirmation(stage);
  assert.deepEqual(confirmation, {
    stage_id: "stage:replace",
    document_id: "document:change-review",
    base_revision: 42,
    base_repertoire_revision: stage.base_repertoire_revision,
    safety_identity: "safety:immutable",
    change_set_identity: "change-set:immutable",
    preview_identity: "preview:immutable",
    archive_identity: "archive:immutable",
    provenance_identity: "provenance:immutable",
  });
  const component = readFileSync(
    new URL("../src/components/strategic-fit/BeforeAfterImpact.tsx", import.meta.url),
    "utf8",
  );
  assert.match(component, /repertoire POV before/);
  assert.match(component, /White-POV engine transport before/);
  assert.doesNotMatch(component, /best candidate/i);
});

test("review UI supplies keyboard, screen-reader, no-color, reduced-motion, mobile, and long-diff contracts", () => {
  const component = readFileSync(
    new URL("../src/components/strategic-fit/ChangeSetPreview.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(component, /<fieldset\s+class="replacement-retention-controls"/);
  assert.match(component, /<legend>Old-line retention<\/legend>/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /role="alert"/);
  assert.match(component, /Final atomic acceptance/);
  assert.match(styles, /data-check-status="blocked"/);
  assert.match(styles, /border-left-style: double/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /@media \(forced-colors: active\)/);
  assert.match(styles, /@media \(max-width: 820px\)/);
  assert.match(styles, /replacement-operation-list pre/);
  assert.match(styles, /max-height:\s*18rem;\s*overflow:\s*auto/);
});
