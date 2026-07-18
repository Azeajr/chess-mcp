import assert from "node:assert/strict";
import test from "node:test";

import type { StrategicFitAnalysisResult } from "@chess-mcp/chess-tools";
import {
  createStrategicFitLifecycleState,
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
  ...extra,
}) as unknown as StrategicFitAnalysisResult;

function fixture() {
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

  subject.calls[0]!.options.onProgress?.(0, 0, "phase details belong to Task 5.4");
  assert.deepEqual(subject.state.snapshot().progress, {
    done: 0,
    detail: "phase details belong to Task 5.4",
  });
  assert.equal(subject.state.snapshot().status, "provisional");
  subject.calls[0]!.options.onProgress?.(3, 6);
  subject.calls[0]!.options.onProgress?.(2, 6);
  assert.deepEqual(subject.state.snapshot().progress, {
    done: 3,
    total: 6,
    detail: "phase details belong to Task 5.4",
  });

  subject.calls[0]!.result.resolve(report("report:one"));
  await pending;
  assert.equal(subject.state.snapshot().status, "completed");
  assert.equal(subject.state.snapshot().current_result?.report_id, "report:one");
  assert.equal(subject.state.snapshot().last_completed?.report_id, "report:one");
  assert.equal(subject.state.snapshot().progress, null);
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

test("an identity edit during analysis aborts the command and discards its late result", async () => {
  const subject = fixture();
  const pending = subject.state.analyze();
  subject.calls[0]!.options.onProgress?.(1, 6);
  subject.patchSnapshot({ repertoire_revision: 2, repertoire_pgn: "1. e4 c5 *" });
  subject.state.synchronize();

  assert.equal(subject.calls[0]!.options.signal?.aborted, true);
  assert.equal(subject.state.snapshot().status, "stale");
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
      state: "degraded",
      issues: [{ code: "missing-opening-classification" }],
    },
  }));
  await pending;

  assert.equal(subject.state.snapshot().status, "completed");
  assert.deepEqual(
    subject.state.snapshot().current_result?.result.preflight,
    { state: "degraded", issues: [{ code: "missing-opening-classification" }] },
  );
});
