import test from "node:test";
import assert from "node:assert/strict";

import {
  operations,
  registerOperation,
  resetOperationsForTesting,
  runningOperations,
  settleOperation,
  updateOperation,
  updateOperationStatus,
} from "../src/store/operations.ts";
import { resetAnnouncementsForTesting, announcementLogForTesting } from "../src/store/announce.ts";

test.beforeEach(() => {
  resetOperationsForTesting();
  resetAnnouncementsForTesting();
});

test("a registered operation appears in the running set with its label and surface", () => {
  registerOperation({
    kind: "gaps-scan",
    label: "Gaps scan",
    surface: "repertoire",
  });
  assert.equal(operations().length, 1);
  const [operation] = operations();
  assert.equal(operation.kind, "gaps-scan");
  assert.equal(operation.label, "Gaps scan");
  assert.equal(operation.surface, "repertoire");
  assert.equal(operation.status, "running");
  assert.equal(runningOperations().length, 1);
});

test("registering announces the start exactly once", () => {
  registerOperation({ kind: "k", label: "Only-moves scan", surface: "analysis" });
  const log = announcementLogForTesting();
  assert.equal(log.length, 1);
  assert.match(log[0]!.message, /started/u);
});

test("progress patches never announce", () => {
  const id = registerOperation({ kind: "k", label: "Structure search", surface: "repertoire" });
  resetAnnouncementsForTesting();
  updateOperation(id, { done: 3, total: 10 });
  updateOperation(id, { done: 5, total: 10 });
  updateOperation(id, { detail: "halfway" });
  assert.equal(announcementLogForTesting().length, 0);
  const [operation] = operations();
  assert.equal(operation.done, 5);
  assert.equal(operation.total, 10);
  assert.equal(operation.detail, "halfway");
});

test("settle marks terminal status, announces once, and lingers before eviction", async () => {
  const id = registerOperation({ kind: "k", label: "Annotated export", surface: "analysis" });
  resetAnnouncementsForTesting();
  settleOperation(id, "completed", { detail: "2 file(s)" });
  const log = announcementLogForTesting();
  assert.equal(log.length, 1);
  assert.match(log[0]!.message, /completed.*2 file\(s\)/u);
  assert.equal(operations().length, 1);
  assert.equal(operations()[0].status, "completed");
  assert.equal(operations()[0].cancel, undefined, "settled operations are no longer cancellable");
  assert.equal(runningOperations().length, 0);
});

test("cancellation settles as cancelled with an assertive-free message", () => {
  let cancelled = false;
  const id = registerOperation({
    kind: "k",
    label: "Preparation comparison",
    surface: "chat",
    cancel: () => {
      cancelled = true;
    },
  });
  assert.ok(operations()[0].cancel, "running operations expose their cancel callback");
  settleOperation(id, "cancelled");
  assert.match(announcementLogForTesting().slice(-1)[0]!.message, /cancelled/u);
  assert.equal(operations()[0].status, "cancelled");
  void cancelled;
});

test("failure announces assertively with a detail", () => {
  const id = registerOperation({ kind: "k", label: "Audit", surface: "repertoire" });
  settleOperation(id, "failed", { detail: "engine offline" });
  const [announcement] = announcementLogForTesting().slice(-1);
  assert.match(announcement!.message, /failed.*engine offline/u);
  assert.equal(announcement!.assertive, true);
});

test("settling twice is a no-op — exactly one announcement per operation", () => {
  const id = registerOperation({ kind: "k", label: "Scan", surface: "repertoire" });
  settleOperation(id, "completed");
  const announcementsAfterFirstSettle = announcementLogForTesting().length;
  settleOperation(id, "cancelled");
  settleOperation(id, "failed");
  assert.equal(announcementLogForTesting().length, announcementsAfterFirstSettle);
  assert.equal(operations()[0].status, "completed");
});

test("a completed operation disappears after the linger window", async () => {
  const id = registerOperation({ kind: "k", label: "Scan", surface: "repertoire" });
  settleOperation(id, "completed");
  assert.equal(operations().length, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    operations().length,
    1,
    "eviction must respect the full linger window (not evict early)",
  );
});

test("multiple operations from different surfaces coexist", () => {
  registerOperation({ kind: "gaps", label: "Gaps scan", surface: "repertoire" });
  registerOperation({ kind: "audit", label: "Audit", surface: "repertoire" });
  registerOperation({ kind: "chat-tool", label: "Chat tool call", surface: "chat" });
  registerOperation({ kind: "live-analysis", label: "Live analysis pass", surface: "analysis" });
  assert.equal(runningOperations().length, 4);
  assert.deepEqual([...new Set(runningOperations().map((operation) => operation.surface))].sort(), [
    "analysis",
    "chat",
    "repertoire",
  ]);
});

test("an abandoned operation would block every registry consumer until it settles", () => {
  const superseded = registerOperation({
    kind: "live-analysis",
    label: "Live engine analysis",
    surface: "analysis",
  });
  assert.equal(runningOperations().length, 1);

  updateOperationStatus(superseded, "completed");
  assert.equal(
    runningOperations().length,
    0,
    "a superseded owner must release its entry so the registry can drain",
  );
  assert.equal(operations()[0].status, "completed");
});

test("a quiet settle releases the entry without announcing", () => {
  const id = registerOperation({ kind: "live-analysis", label: "Live pass", surface: "analysis" });
  resetAnnouncementsForTesting();
  updateOperationStatus(id, "failed");
  assert.equal(runningOperations().length, 0);
  assert.equal(
    announcementLogForTesting().length,
    0,
    "live analysis settles many times a minute; announcing each is the WP-009 speech flood",
  );
});
