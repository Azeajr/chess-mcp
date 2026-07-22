import assert from "node:assert/strict";
import test from "node:test";

import type { StrategicFitAnalysisResult } from "@chess-mcp/chess-tools";
import {
  createStrategicFitLifecycleState,
  type StrategicFitLifecycleBoundary,
  type StrategicFitRequestSnapshot,
} from "../src/store/strategic-fit.ts";
import type { BrowserCommandExecutionOptions } from "../src/application/browser-commands/types.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const report = (id: string, revision = "browser:1", extra: Record<string, unknown> = {}) => ({
  report_id: id,
  repertoire_revision: revision,
  preflight: {
    analysis_version: "2.0.0",
    state: "ready",
    issues: [],
    route_count: 2,
    comparable_route_count: 2,
    incomplete_route_count: 0,
  },
  ...extra,
}) as unknown as StrategicFitAnalysisResult;

function fixture(reconcileReports?: StrategicFitLifecycleBoundary["reconcileReports"]) {
  let snapshot: StrategicFitRequestSnapshot = {
    document_id: "document:a",
    repertoire_revision: 1,
    repertoire_pgn: "1. e4 e5 *",
    repertoire_color: "white",
    profile_identity: "profile:balanced",
    settings_identity: "settings:default",
  };
  let clock = 0;
  const calls: Array<{
    command: string;
    args: Record<string, unknown>;
    options: BrowserCommandExecutionOptions;
    result: ReturnType<typeof deferred<unknown>>;
  }> = [];
  const state = createStrategicFitLifecycleState({
    currentSnapshot: () => ({ ...snapshot }),
    execute: (command, args, options) => {
      const result = deferred<unknown>();
      calls.push({ command, args, options, result });
      return result.promise;
    },
    now: () => `2026-07-18T00:00:0${++clock}.000Z`,
    ...(reconcileReports === undefined ? {} : { reconcileReports }),
  });
  return {
    state,
    calls,
    patchSnapshot: (patch: Partial<StrategicFitRequestSnapshot>) => {
      snapshot = { ...snapshot, ...patch };
    },
  };
}

test("idle, running, provisional, and completed transitions use the canonical command with monotonic progress", async () => {
  const subject = fixture();
  assert.equal(subject.state.snapshot().status, "idle");

  const pending = subject.state.analyze();
  assert.equal(subject.calls.length, 1);
  assert.equal(subject.calls[0]!.command, "analyze_repertoire_congruence");
  assert.deepEqual(subject.calls[0]!.args, {});
  assert.equal(subject.state.snapshot().status, "running");

  subject.calls[0]!.options.onProgress?.(0, 0, "Normalizing move orders");
  assert.deepEqual(subject.state.snapshot().progress, {
    done: 0,
    detail: "Normalizing move orders",
  });
  assert.equal(subject.state.snapshot().status, "provisional");
  assert.equal(subject.state.snapshot().phase_history[0]?.state, "running");
  assert.ok(subject.state.snapshot().phase_history.slice(1).every((phase) => phase.state === "pending"));
  subject.calls[0]!.options.onProgress?.(3, 6);
  subject.calls[0]!.options.onProgress?.(2, 6, "Extracting strategic patterns");
  assert.deepEqual(subject.state.snapshot().progress, {
    done: 3,
    total: 6,
    detail: "Measuring learning burden",
  });
  assert.deepEqual(subject.state.snapshot().phase_history.map((phase) => phase.state), [
    "completed", "completed", "completed", "running", "pending", "pending",
  ]);

  subject.calls[0]!.result.resolve(report("report:one"));
  await pending;
  assert.equal(subject.state.snapshot().status, "completed");
  assert.equal(subject.state.snapshot().current_result?.report_id, "report:one");
  assert.equal(subject.state.snapshot().last_completed?.report_id, "report:one");
  assert.equal(subject.state.snapshot().progress, null);
  assert.ok(subject.state.snapshot().phase_history.every((phase) => phase.state === "completed"));
});

test("reanalysis atomically reconciles settings and publishes the exact resolving revision", async () => {
  let subject!: ReturnType<typeof fixture>;
  subject = fixture((previous, next, findings, request) => {
    subject.patchSnapshot({ settings_identity: "settings:reconciled" });
    subject.state.synchronize();
    return {
      result: next,
      findings,
      requires_follow_up: false,
      summary: {
        trigger: request.trigger,
        scope: request.scope,
        previous_report_id: previous.report_id,
        report_id: next.report_id,
        resolving_revision: next.repertoire_revision,
        disappeared_semantic_finding_ids: ["semantic:gone"],
        auto_resolved_semantic_finding_ids: ["semantic:gone"],
        reappeared_semantic_finding_ids: [],
        changed_evidence_semantic_finding_ids: [],
        new_semantic_finding_ids: [],
        preserved_resolution_ids: [],
      },
    };
  });
  const initial = subject.state.analyze();
  subject.calls[0]!.result.resolve(report("report:before"));
  await initial;

  const refreshed = subject.state.reanalyze({
    trigger: "document-change",
    scope: { kind: "affected-cohorts", cohort_ids: ["cohort:a"], reason: "Local edit." },
  });
  subject.calls[1]!.result.resolve(report("report:after", "browser:2"));
  await refreshed;

  const completed = subject.state.snapshot();
  assert.equal(completed.status, "completed");
  assert.equal(completed.current_result?.request_snapshot.settings_identity, "settings:reconciled");
  assert.equal(completed.current_result?.reanalysis?.resolving_revision, "browser:2");
  assert.deepEqual(completed.current_result?.reanalysis?.auto_resolved_semantic_finding_ids, ["semantic:gone"]);
});

test("newer and cancelled reanalysis requests never publish superseded work", async () => {
  const subject = fixture();
  const initial = subject.state.analyze();
  subject.calls[0]!.result.resolve(report("report:before"));
  await initial;
  const request = {
    trigger: "profile-change" as const,
    scope: { kind: "affected-cohorts" as const, cohort_ids: ["cohort:a"], reason: "Profile changed." },
  };

  const superseded = subject.state.reanalyze(request);
  const cancelled = subject.state.reanalyze(request);
  assert.equal(subject.calls[1]!.options.signal?.aborted, true);
  subject.calls[1]!.result.resolve(report("report:superseded"));
  await superseded;
  assert.equal(subject.state.snapshot().status, "running");

  subject.state.cancel();
  assert.equal(subject.calls[2]!.options.signal?.aborted, true);
  subject.calls[2]!.result.resolve(report("report:cancelled"));
  await cancelled;
  assert.equal(subject.state.snapshot().status, "cancelled");
  assert.equal(subject.state.snapshot().current_result, null);
  assert.equal(subject.state.snapshot().last_completed?.report_id, "report:before");
});

test("navigation-equivalent synchronization stays current while every analysis identity change stales", async () => {
  const subject = fixture();
  const pending = subject.state.analyze();
  subject.calls[0]!.result.resolve(report("report:current"));
  await pending;

  // Navigation is intentionally absent from StrategicFitRequestSnapshot.
  subject.state.synchronize();
  assert.equal(subject.state.snapshot().status, "completed");

  subject.patchSnapshot({ profile_identity: "profile:versatile" });
  subject.state.synchronize();
  assert.equal(subject.state.snapshot().status, "stale");
  assert.match(subject.state.snapshot().stale_reason ?? "", /profile changed/i);
  assert.equal(subject.state.snapshot().current_result, null);
  assert.equal(subject.state.snapshot().last_completed?.report_id, "report:current");
  assert.ok(subject.state.snapshot().phase_history.every((phase) => phase.state === "completed"));

  for (const patch of [
    { repertoire_revision: 2, repertoire_pgn: "1. d4 d5 *" },
    { document_id: "document:b" },
    { repertoire_color: "black" as const },
    { settings_identity: "settings:override" },
  ]) {
    const next = fixture();
    const run = next.state.analyze();
    next.calls[0]!.result.resolve(report("report:fixture"));
    await run;
    next.patchSnapshot(patch);
    next.state.synchronize();
    assert.equal(next.state.snapshot().status, "stale", JSON.stringify(patch));
  }
});

test("a completed evidence report can be rebound only after a resolution-only settings change", async () => {
  const subject = fixture();
  const pending = subject.state.analyze();
  subject.calls[0]!.result.resolve(report("report:resolution"));
  await pending;

  assert.equal(subject.state.retainCompletedReportAfterResolution("report:resolution"), false);
  assert.equal(subject.state.prepareCompletedReportForResolution("report:resolution"), true);
  subject.patchSnapshot({ settings_identity: "settings:resolution" });
  subject.state.synchronize();
  assert.equal(subject.state.snapshot().status, "completed");
  assert.equal(subject.state.retainCompletedReportAfterResolution("report:resolution"), true);
  assert.equal(subject.state.snapshot().status, "completed");
  assert.equal(
    subject.state.snapshot().current_result?.request_snapshot.settings_identity,
    "settings:resolution",
  );

  assert.equal(subject.state.prepareCompletedReportForResolution("report:resolution"), true);
  subject.patchSnapshot({ profile_identity: "profile:versatile" });
  subject.state.synchronize();
  assert.equal(subject.state.snapshot().status, "stale");
  assert.equal(subject.state.retainCompletedReportAfterResolution("report:resolution"), false);
  assert.equal(subject.state.prepareCompletedReportForResolution("report:resolution"), false);
  assert.equal(subject.state.retainCompletedReportAfterResolution("report:other"), false);
});

test("an identity edit during analysis aborts the command and discards its late result", async () => {
  const subject = fixture();
  const pending = subject.state.analyze();
  subject.calls[0]!.options.onProgress?.(1, 6);
  subject.patchSnapshot({ repertoire_revision: 2, repertoire_pgn: "1. e4 c5 *" });
  subject.state.synchronize();

  assert.equal(subject.calls[0]!.options.signal?.aborted, true);
  assert.equal(subject.state.snapshot().status, "stale");
  assert.deepEqual(subject.state.snapshot().phase_history.map((phase) => phase.state), [
    "completed", "cancelled", "pending", "pending", "pending", "pending",
  ]);
  subject.calls[0]!.options.onProgress?.(6, 6);
  subject.calls[0]!.result.resolve(report("report:late", "browser:1"));
  await pending;
  assert.equal(subject.state.snapshot().status, "stale");
  assert.equal(subject.state.snapshot().current_result, null);
});

test("cancellation retains the last completed report as previous and never publishes cancelled work", async () => {
  const subject = fixture();
  const first = subject.state.analyze();
  subject.calls[0]!.result.resolve(report("report:first"));
  await first;

  const cancelled = subject.state.analyze();
  subject.calls[1]!.options.onProgress?.(2, 6);
  subject.state.cancel();
  assert.equal(subject.calls[1]!.options.signal?.aborted, true);
  assert.equal(subject.state.snapshot().status, "cancelled");
  assert.equal(subject.state.snapshot().current_result, null);
  assert.equal(subject.state.snapshot().last_completed?.report_id, "report:first");
  assert.deepEqual(subject.state.snapshot().phase_history.map((phase) => phase.state), [
    "completed", "completed", "cancelled", "pending", "pending", "pending",
  ]);

  subject.calls[1]!.result.resolve(report("report:cancelled-late"));
  await cancelled;
  assert.equal(subject.state.snapshot().status, "cancelled");
  assert.equal(subject.state.snapshot().last_completed?.report_id, "report:first");
});

test("retry after failure snapshots current inputs and structured stale adapter results stay non-current", async () => {
  const subject = fixture();
  const failed = subject.state.analyze();
  subject.calls[0]!.result.reject(Object.assign(new Error("worker unavailable"), {
    code: "strategic_fit_worker_unavailable",
  }));
  await failed;
  assert.equal(subject.state.snapshot().status, "failed");
  assert.deepEqual(subject.state.snapshot().error, {
    code: "strategic_fit_worker_unavailable",
    message: "worker unavailable",
  });

  subject.patchSnapshot({
    repertoire_revision: 4,
    repertoire_pgn: "1. c4 e5 *",
    settings_identity: "settings:current",
  });
  const retried = subject.state.retry();
  assert.equal(subject.state.snapshot().request_snapshot?.repertoire_revision, 4);
  assert.equal(subject.state.snapshot().request_snapshot?.settings_identity, "settings:current");
  subject.calls[1]!.result.resolve({
    error: "strategic_fit_stale_report",
    reason: "Adapter rejected a late settings snapshot.",
  });
  await retried;
  assert.equal(subject.state.snapshot().status, "stale");
  assert.equal(subject.state.snapshot().current_result, null);
});

test("a newer request supersedes old progress, results, and errors", async () => {
  const subject = fixture();
  const first = subject.state.analyze();
  const second = subject.state.analyze();
  assert.equal(subject.calls[0]!.options.signal?.aborted, true);
  assert.equal(subject.state.snapshot().request_id, "strategic-fit-lifecycle:2");

  subject.calls[0]!.options.onProgress?.(6, 6);
  subject.calls[0]!.result.reject(new Error("late failure"));
  await first;
  assert.equal(subject.state.snapshot().status, "running");
  assert.equal(subject.state.snapshot().progress, null);

  subject.calls[1]!.options.onProgress?.(1, 6);
  subject.calls[1]!.result.resolve(report("report:new"));
  await second;
  assert.equal(subject.state.snapshot().status, "completed");
  assert.equal(subject.state.snapshot().current_result?.report_id, "report:new");
});

test("native degraded reports are completed evidence, not fabricated failures or consistency", async () => {
  const subject = fixture();
  const pending = subject.state.analyze();
  subject.calls[0]!.result.resolve(report("report:degraded", "browser:1", {
    preflight: {
      analysis_version: "2.0.0",
      state: "degraded",
      issues: [{ code: "missing-opening-classification" }],
      route_count: 2,
      comparable_route_count: 2,
      incomplete_route_count: 0,
    },
  }));
  await pending;

  assert.equal(subject.state.snapshot().status, "completed");
  assert.deepEqual(
    subject.state.snapshot().current_result?.result.preflight,
    {
      analysis_version: "2.0.0",
      state: "degraded",
      issues: [{ code: "missing-opening-classification" }],
      route_count: 2,
      comparable_route_count: 2,
      incomplete_route_count: 0,
    },
  );
  assert.ok(subject.state.snapshot().phase_history.every((phase) => phase.state === "completed"));
});

test("blocked preflight completes normalization only and leaves dependent phases not run", async () => {
  const subject = fixture();
  const pending = subject.state.analyze();
  subject.calls[0]!.options.onProgress?.(0, 6, "Normalizing move orders");
  subject.calls[0]!.options.onProgress?.(1, 6, "Normalizing move orders");
  subject.calls[0]!.result.resolve(report("report:blocked", "browser:1", {
    preflight: {
      analysis_version: "2.0.0",
      state: "blocked",
      issues: [{ code: "empty-repertoire", kind: "error", severity: "blocking" }],
      route_count: 0,
      comparable_route_count: 0,
      incomplete_route_count: 0,
    },
  }));
  await pending;

  assert.equal(subject.state.snapshot().status, "completed");
  assert.deepEqual(subject.state.snapshot().phase_history.map((phase) => phase.state), [
    "completed", "pending", "pending", "pending", "pending", "pending",
  ]);

  subject.patchSnapshot({ profile_identity: "profile:versatile" });
  subject.state.synchronize();
  assert.equal(subject.state.snapshot().status, "stale");
  assert.deepEqual(subject.state.snapshot().phase_history.map((phase) => phase.state), [
    "completed", "pending", "pending", "pending", "pending", "pending",
  ]);
});
