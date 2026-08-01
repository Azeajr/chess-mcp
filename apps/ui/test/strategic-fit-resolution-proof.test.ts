import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { StrategicFinding, StrategicFitMetric } from "@chess-mcp/chess-tools";
import {
  createStrategicFitResolutionProofState,
  type StrategicFitResolutionProofBoundary,
} from "../src/store/strategic-fit-resolution-proof.ts";
import {
  proofClaimText,
  proofMakesNoResolutionClaim,
} from "../src/components/strategic-fit/ResolutionProof.tsx";
import type {
  StrategicFitChangeOperationResult,
  StrategicFitStagedChange,
  StrategicFitUndoRecordSummary,
} from "../src/store/strategic-fit-changes.ts";
import type { StrategicFitReanalysisSummary } from "../src/store/strategic-fit-reanalysis.ts";
import type {
  StrategicFitCompletedResult,
  StrategicFitLifecycleSnapshot,
  StrategicFitRequestSnapshot,
} from "../src/store/strategic-fit.ts";

const DOCUMENT_ID = "document:proof";
const SEMANTIC_ID = "semantic:target";

function acceptedStage(
  overrides: Partial<{ accepted_revision: number | null; status: string }> = {},
): StrategicFitStagedChange {
  return {
    stage_id: "stage:proof",
    status: overrides.status ?? "accepted",
    document_id: DOCUMENT_ID,
    base_revision: 5,
    accepted_revision: overrides.accepted_revision === undefined ? 6 : overrides.accepted_revision,
    change_set: {
      candidate_id: "candidate:proof",
      retention: { archive: "archive", prune: "prune" },
    },
    safety: {
      finding_id: "finding:target",
      semantic_finding_id: SEMANTIC_ID,
      report_id: "report:before",
      repertoire_color: "black",
    },
  } as unknown as StrategicFitStagedChange;
}

function metric(
  id: string,
  value: number | null,
  state = "available",
  reason: string | null = null,
): StrategicFitMetric<number> {
  return {
    metric_id: id,
    state,
    value,
    unit: "fraction",
    reason,
    provenance: [],
    analysis_version: "2.0.0",
  } as unknown as StrategicFitMetric<number>;
}

function finding(semanticId: string, explanation = `Evidence for ${semanticId}`): StrategicFinding {
  return {
    finding_id: `finding:${semanticId}`,
    semantic_finding_id: semanticId,
    plain_language_category: "Test finding",
    explanation,
    resolution_state: "unresolved",
    evidence: { cohort_id: "cohort:a" },
  } as unknown as StrategicFinding;
}

function reanalysisSummary(
  patch: Partial<StrategicFitReanalysisSummary> = {},
): StrategicFitReanalysisSummary {
  return {
    trigger: "document-change",
    scope: { kind: "affected-cohorts", cohort_ids: ["cohort:a"], reason: "Changed routes." },
    previous_report_id: "report:before",
    report_id: "report:after",
    resolving_revision: "browser:6",
    disappeared_semantic_finding_ids: [],
    auto_resolved_semantic_finding_ids: [],
    reappeared_semantic_finding_ids: [],
    changed_evidence_semantic_finding_ids: [],
    new_semantic_finding_ids: [],
    preserved_resolution_ids: [],
    ...patch,
  };
}

function completedResult(options: {
  reportId: string;
  revision: number;
  findings?: readonly StrategicFinding[];
  reanalysis?: StrategicFitReanalysisSummary | null;
  coverage?: number;
  workload?: number;
  unresolved?: number;
}): StrategicFitCompletedResult {
  const findings = options.findings ?? [];
  return {
    request_id: `request:${options.reportId}`,
    report_id: options.reportId,
    request_snapshot: {
      document_id: DOCUMENT_ID,
      repertoire_revision: options.revision,
      repertoire_pgn: "1. e4 *",
      repertoire_color: "black",
      profile_identity: "profile:balanced",
      settings_identity: "settings:default",
    },
    result: {
      report_id: options.reportId,
      repertoire_revision: `browser:${options.revision}`,
      findings,
      summary: {
        workload: "moderate",
        strategic_family_count: 3,
        unresolved_finding_count: options.unresolved ?? findings.length,
        metrics: {
          familiarity_adjusted_coverage: metric(
            "familiarity-adjusted-coverage",
            options.coverage ?? 0.96,
          ),
          training_adjusted_workload: metric("training-adjusted-workload", options.workload ?? 0.4),
          strategic_entropy: metric("strategic-entropy", null, "unavailable", "Sample too small."),
        },
      },
    },
    completed_at: "2026-07-30T12:00:00.000Z",
    findings_snapshot: findings,
    reanalysis: options.reanalysis ?? null,
  } as unknown as StrategicFitCompletedResult;
}

function proofHarness() {
  let lifecycle = {
    status: "stale",
    current_result: null,
    error: null,
  } as unknown as StrategicFitLifecycleSnapshot;
  let current: StrategicFitRequestSnapshot = {
    document_id: DOCUMENT_ID,
    repertoire_revision: 6,
    repertoire_pgn: "1. e4 *",
    repertoire_color: "black",
    profile_identity: "profile:balanced",
    settings_identity: "settings:default",
  };
  let record: StrategicFitUndoRecordSummary | null = {
    undo_id: "undo:proof",
    stage_id: "stage:proof",
    document_id: DOCUMENT_ID,
    status: "available",
    base_revision: 5,
    accepted_revision: 6,
  };
  let undoResult: StrategicFitChangeOperationResult = {
    ok: true,
    stage: {
      ...acceptedStage(),
      status: "undone",
      accepted_revision: 7,
    } as StrategicFitStagedChange,
  };
  const undoCalls: string[] = [];
  let deferRecords = false;
  const recordResolvers: Array<(value: StrategicFitUndoRecordSummary | null) => void> = [];
  let deferUndo = false;
  const undoResolvers: Array<(value: StrategicFitChangeOperationResult) => void> = [];
  const boundary: StrategicFitResolutionProofBoundary = {
    lifecycle: () => lifecycle,
    currentSnapshot: () => ({ ...current }),
    undoRecordForStage: async () => {
      if (deferRecords) return new Promise((resolve) => recordResolvers.push(resolve));
      return record === null ? null : { ...record };
    },
    undo: async (undoId) => {
      undoCalls.push(undoId);
      if (deferUndo) return new Promise((resolve) => undoResolvers.push(resolve));
      return undoResult;
    },
    now: () => "2026-07-30T12:00:00.000Z",
  };
  return {
    state: createStrategicFitResolutionProofState(boundary),
    undoCalls,
    recordResolvers,
    undoResolvers,
    deferRecords: () => {
      deferRecords = true;
    },
    deferUndo: () => {
      deferUndo = true;
    },
    setLifecycle: (value: Partial<StrategicFitLifecycleSnapshot>) => {
      lifecycle = {
        status: "stale",
        current_result: null,
        error: null,
        ...value,
      } as StrategicFitLifecycleSnapshot;
    },
    setRevision: (revision: number) => {
      current = { ...current, repertoire_revision: revision };
    },
    setRecord: (value: StrategicFitUndoRecordSummary | null) => {
      record = value;
    },
    setUndoResult: (value: StrategicFitChangeOperationResult) => {
      undoResult = value;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("acceptance tracks without any success claim until the affected-cohort rescan completes and proves resolution", async () => {
  const h = proofHarness();
  const before = completedResult({
    reportId: "report:before",
    revision: 5,
    findings: [finding(SEMANTIC_ID)],
    unresolved: 4,
  });
  assert.equal(h.state.track(acceptedStage(), before), true);
  await settle();
  assert.equal(h.state.snapshot().status, "awaiting-rescan");
  assert.equal(h.state.snapshot().outcome, null);
  assert.equal(h.state.snapshot().claims, null);
  assert.equal(proofMakesNoResolutionClaim(h.state.snapshot().status), true);
  assert.equal(h.state.snapshot().undo_record?.undo_id, "undo:proof");

  h.setLifecycle({ status: "running" });
  h.state.synchronize();
  assert.equal(h.state.snapshot().status, "rescanning");
  assert.equal(proofMakesNoResolutionClaim("rescanning"), true);

  const after = completedResult({
    reportId: "report:after",
    revision: 6,
    findings: [],
    unresolved: 3,
    workload: 0.34,
    reanalysis: reanalysisSummary({
      disappeared_semantic_finding_ids: [SEMANTIC_ID],
      auto_resolved_semantic_finding_ids: [SEMANTIC_ID],
    }),
  });
  h.setLifecycle({ status: "completed", current_result: after });
  h.state.synchronize();
  const snapshot = h.state.snapshot();
  assert.equal(snapshot.status, "proven");
  assert.equal(proofMakesNoResolutionClaim("proven"), false);
  assert.deepEqual(snapshot.outcome, {
    kind: "resolved",
    semantic_finding_id: SEMANTIC_ID,
    resolving_revision: "browser:6",
    reconciled: true,
  });
  assert.equal(snapshot.claims?.before_report_id, "report:before");
  assert.equal(snapshot.claims?.after_report_id, "report:after");
  assert.equal(snapshot.claims?.after_repertoire_revision, "browser:6");
  const workload = snapshot.claims?.metrics.find(
    (claim) => claim.claim_id === "training-adjusted-workload",
  );
  assert.equal(workload?.before?.value, 0.4);
  assert.equal(workload?.after?.value, 0.34);
  const unresolvedCounts = snapshot.claims?.counts.find(
    (claim) => claim.claim_id === "unresolved-finding-count",
  );
  assert.equal(unresolvedCounts?.before, 4);
  assert.equal(unresolvedCounts?.after, 3);
  const entropy = snapshot.claims?.metrics.find((claim) => claim.claim_id === "strategic-entropy");
  assert.match(proofClaimText(entropy!.after), /unavailable: Sample too small\./);
  assert.match(proofClaimText(workload!.after ?? null), /34\.0%/);
});

test("still-unresolved rescan keeps the finding open with changed evidence and surfaces new findings from the change", async () => {
  const h = proofHarness();
  h.state.track(
    acceptedStage(),
    completedResult({ reportId: "report:before", revision: 5, findings: [finding(SEMANTIC_ID)] }),
  );
  await settle();
  const reopened = finding(SEMANTIC_ID, "Still mismatched after the accepted change.");
  const created = finding("semantic:new", "The replacement introduced a new uncovered reply.");
  const after = completedResult({
    reportId: "report:after",
    revision: 6,
    findings: [reopened, created],
    reanalysis: reanalysisSummary({
      changed_evidence_semantic_finding_ids: [SEMANTIC_ID],
      new_semantic_finding_ids: ["semantic:new"],
    }),
  });
  h.setLifecycle({ status: "completed", current_result: after });
  h.state.synchronize();
  const snapshot = h.state.snapshot();
  assert.equal(snapshot.status, "proven");
  assert.equal(snapshot.outcome?.kind, "still-open");
  assert.equal(snapshot.outcome?.kind === "still-open" && snapshot.outcome.changed_evidence, true);
  assert.equal(
    snapshot.outcome?.kind === "still-open" && snapshot.outcome.finding.explanation,
    "Still mismatched after the accepted change.",
  );
  assert.deepEqual(
    snapshot.new_findings.map((entry) => entry.semantic_finding_id),
    ["semantic:new"],
  );
  assert.equal(
    snapshot.claims?.counts.find((claim) => claim.claim_id === "unresolved-finding-count")?.after,
    2,
  );
});

test("coverage-preserving change reports identical before and after coverage from complete reports only", async () => {
  const h = proofHarness();
  h.state.track(
    acceptedStage(),
    completedResult({
      reportId: "report:before",
      revision: 5,
      findings: [finding(SEMANTIC_ID)],
      coverage: 0.96,
    }),
  );
  await settle();
  const after = completedResult({
    reportId: "report:after",
    revision: 6,
    findings: [],
    coverage: 0.96,
    reanalysis: reanalysisSummary({
      auto_resolved_semantic_finding_ids: [SEMANTIC_ID],
      disappeared_semantic_finding_ids: [SEMANTIC_ID],
    }),
  });
  h.setLifecycle({ status: "completed", current_result: after });
  h.state.synchronize();
  const coverage = h.state
    .snapshot()
    .claims?.metrics.find((claim) => claim.claim_id === "familiarity-adjusted-coverage");
  assert.equal(coverage?.before?.value, 0.96);
  assert.equal(coverage?.after?.value, 0.96);
  assert.equal(proofClaimText(coverage!.before), proofClaimText(coverage!.after));
});

test("a rescan completed without a reconciliation summary stays honest about the missing resolution record", async () => {
  const h = proofHarness();
  h.state.track(
    acceptedStage(),
    completedResult({ reportId: "report:before", revision: 5, findings: [finding(SEMANTIC_ID)] }),
  );
  await settle();
  h.setLifecycle({
    status: "completed",
    current_result: completedResult({
      reportId: "report:after",
      revision: 6,
      findings: [],
      reanalysis: null,
    }),
  });
  h.state.synchronize();
  const outcome = h.state.snapshot().outcome;
  assert.equal(outcome?.kind, "resolved");
  assert.equal(outcome?.kind === "resolved" && outcome.reconciled, false);
  assert.equal(outcome?.kind === "resolved" && outcome.resolving_revision, "browser:6");
});

test("a race with another edit supersedes the proof and rescan failure or cancellation stays claimless", async () => {
  const h = proofHarness();
  h.state.track(
    acceptedStage(),
    completedResult({ reportId: "report:before", revision: 5, findings: [finding(SEMANTIC_ID)] }),
  );
  await settle();
  h.setLifecycle({
    status: "failed",
    error: { code: "strategic_fit_engine_unavailable", message: "Engine died." },
  });
  h.state.synchronize();
  assert.equal(h.state.snapshot().status, "rescan-failed");
  assert.equal(h.state.snapshot().error?.code, "strategic_fit_engine_unavailable");
  assert.equal(proofMakesNoResolutionClaim("rescan-failed"), true);

  h.setLifecycle({ status: "cancelled" });
  h.state.synchronize();
  assert.equal(h.state.snapshot().status, "rescan-cancelled");
  assert.equal(proofMakesNoResolutionClaim("rescan-cancelled"), true);

  h.setRevision(7);
  h.setLifecycle({
    status: "completed",
    current_result: completedResult({ reportId: "report:race", revision: 7, findings: [] }),
  });
  h.state.synchronize();
  const snapshot = h.state.snapshot();
  assert.equal(snapshot.status, "superseded");
  assert.equal(snapshot.outcome, null);
  assert.equal(snapshot.claims, null);
  assert.match(snapshot.superseded_reason ?? "", /revision 7/);
  assert.match(snapshot.superseded_reason ?? "", /revision 6/);
  assert.equal(proofMakesNoResolutionClaim("superseded"), true);
});

test("undo from the proof runs one exact undo record and re-verifies the restored report after rescan", async () => {
  const h = proofHarness();
  h.state.track(
    acceptedStage(),
    completedResult({ reportId: "report:before", revision: 5, findings: [finding(SEMANTIC_ID)] }),
  );
  await settle();
  h.setLifecycle({
    status: "completed",
    current_result: completedResult({
      reportId: "report:after",
      revision: 6,
      findings: [],
      reanalysis: reanalysisSummary({
        auto_resolved_semantic_finding_ids: [SEMANTIC_ID],
        disappeared_semantic_finding_ids: [SEMANTIC_ID],
      }),
    }),
  });
  h.state.synchronize();
  assert.equal(h.state.snapshot().status, "proven");

  const undone = await h.state.undo();
  assert.equal(undone, true);
  assert.deepEqual(h.undoCalls, ["undo:proof"]);
  assert.equal(h.state.snapshot().phase, "undo");
  assert.equal(h.state.snapshot().status, "awaiting-rescan");
  assert.equal(h.state.snapshot().outcome, null);
  assert.equal(h.state.snapshot().claims, null);

  h.setRevision(7);
  h.setLifecycle({ status: "running" });
  h.state.synchronize();
  assert.equal(h.state.snapshot().status, "rescanning");

  h.setLifecycle({
    status: "completed",
    current_result: completedResult({
      reportId: "report:restored",
      revision: 7,
      findings: [finding(SEMANTIC_ID)],
      unresolved: 4,
    }),
  });
  h.state.synchronize();
  const snapshot = h.state.snapshot();
  assert.equal(snapshot.status, "undone");
  assert.equal(snapshot.outcome?.kind, "restored-open");
  assert.equal(snapshot.claims?.after_report_id, "report:restored");
  assert.equal(
    snapshot.claims?.counts.find((claim) => claim.claim_id === "unresolved-finding-count")?.after,
    4,
  );

  const again = await h.state.undo();
  assert.equal(again, false, "undo must not run twice from one proof");
  assert.deepEqual(h.undoCalls, ["undo:proof"]);
});

test("blocked undo surfaces the structured error without mutating and unavailable records disable undo", async () => {
  const h = proofHarness();
  h.setRecord({
    undo_id: "undo:proof",
    stage_id: "stage:proof",
    document_id: DOCUMENT_ID,
    status: "stale",
    base_revision: 5,
    accepted_revision: 6,
  });
  h.state.track(
    acceptedStage(),
    completedResult({ reportId: "report:before", revision: 5, findings: [finding(SEMANTIC_ID)] }),
  );
  await settle();
  const staleRecordAttempt = await h.state.undo();
  assert.equal(staleRecordAttempt, false, "non-available undo records must not be submitted");
  assert.equal(h.undoCalls.length, 0, "stale record undo reached the controller");

  h.setRecord({
    undo_id: "undo:proof",
    stage_id: "stage:proof",
    document_id: DOCUMENT_ID,
    status: "available",
    base_revision: 5,
    accepted_revision: 6,
  });
  h.setUndoResult({ ok: false, error: "undo-stale", stage: null });
  h.state.track(acceptedStage(), null);
  await settle();
  const blocked = await h.state.undo();
  assert.equal(blocked, false);
  assert.deepEqual(
    h.undoCalls,
    ["undo:proof"],
    "controller-authoritative rejection must come from one submitted undo",
  );
  assert.equal(h.state.snapshot().status, "undo-blocked");
  assert.equal(h.state.snapshot().error?.code, "undo-stale");
  assert.equal(h.state.snapshot().phase, "acceptance");
});

test("tracking rejects unaccepted stages, reload starts claimless, and clearing forgets the acceptance", async () => {
  const h = proofHarness();
  assert.equal(
    h.state.track(acceptedStage({ status: "staged", accepted_revision: null }), null),
    false,
  );
  assert.equal(h.state.snapshot().status, "idle");

  h.state.track(acceptedStage(), null);
  await settle();
  const claims = h.state.snapshot();
  assert.equal(claims.status, "awaiting-rescan");
  h.state.clear();
  assert.equal(h.state.snapshot().status, "idle");
  assert.equal(h.state.snapshot().tracked, null);

  const reloaded = proofHarness();
  assert.equal(reloaded.state.snapshot().status, "idle");
  assert.equal(reloaded.state.snapshot().outcome, null);
  assert.equal(reloaded.state.snapshot().claims, null);
});

test("late undo-record and undo completions from a superseded tracking sequence never overwrite newer state", async () => {
  const h = proofHarness();
  h.deferRecords();
  h.state.track(acceptedStage(), null);
  const firstResolver = h.recordResolvers[0]!;
  h.state.track(acceptedStage(), null);
  const secondResolver = h.recordResolvers[1]!;
  secondResolver({
    undo_id: "undo:current",
    stage_id: "stage:proof",
    document_id: DOCUMENT_ID,
    status: "available",
    base_revision: 5,
    accepted_revision: 6,
  });
  await settle();
  assert.equal(h.state.snapshot().undo_record?.undo_id, "undo:current");
  firstResolver({
    undo_id: "undo:stale-sequence",
    stage_id: "stage:proof",
    document_id: DOCUMENT_ID,
    status: "available",
    base_revision: 5,
    accepted_revision: 6,
  });
  await settle();
  assert.equal(
    h.state.snapshot().undo_record?.undo_id,
    "undo:current",
    "a late record fetch from the older tracking sequence overwrote the current record",
  );

  h.deferUndo();
  const undoing = h.state.undo();
  assert.equal(h.state.snapshot().status, "undoing");
  assert.equal(await h.state.undo(), false, "second undo submitted while one is in flight");
  assert.equal(h.undoCalls.length, 1);
  h.state.clear();
  h.undoResolvers[0]!({
    ok: true,
    stage: {
      ...acceptedStage(),
      status: "undone",
      accepted_revision: 7,
    } as StrategicFitStagedChange,
  });
  assert.equal(await undoing, false, "late undo completion after clear must be discarded");
  assert.equal(h.state.snapshot().status, "idle");
  assert.equal(h.state.snapshot().phase, "acceptance");
});

test("missing pre-change report keeps every before claim explicitly unavailable instead of zero", async () => {
  const h = proofHarness();
  h.state.track(acceptedStage(), null);
  await settle();
  h.setLifecycle({
    status: "completed",
    current_result: completedResult({ reportId: "report:after", revision: 6, findings: [] }),
  });
  h.state.synchronize();
  const snapshot = h.state.snapshot();
  assert.equal(snapshot.claims?.before_report_id, null);
  for (const claim of snapshot.claims?.metrics ?? []) {
    assert.equal(claim.before, null);
    assert.match(proofClaimText(claim.before), /unavailable: no pre-change report was retained/);
  }
  for (const claim of snapshot.claims?.counts ?? []) assert.equal(claim.before, null);
});

test("proof UI supplies keyboard, screen-reader, no-color, reduced-motion, mobile, and overflow contracts", () => {
  const component = readFileSync(
    new URL("../src/components/strategic-fit/ResolutionProof.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /role=\{alerting\(\) \? "alert" : "status"\}/);
  assert.match(component, /No success or resolution claim is made before a completed rescan/);
  assert.match(component, /data-proof-status=\{state\(\)\.status\}/);
  assert.match(component, /data-proof-outcome=\{value\.kind\}/);
  assert.match(component, /aria-label="Post-commit report metric claims"/);
  assert.match(component, /repertoire POV/);
  assert.match(component, /White POV/);
  assert.match(
    styles,
    /\.replacement-proof-claims-scroll\s*\{\s*max-width:\s*100%;\s*overflow-x:\s*auto;/,
  );
  assert.match(styles, /\.replacement-proof-actions button\s*\{\s*min-height:\s*44px;\s*\}/);
  assert.match(
    styles,
    /\.replacement-resolution-proof,\s*\.replacement-proof-outcome,\s*\.replacement-proof-new-findings > li\s*\{\s*forced-color-adjust:\s*auto;\s*\}/,
  );
  assert.match(styles, /data-proof-status="superseded"/);
});
