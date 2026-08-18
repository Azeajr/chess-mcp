import assert from "node:assert/strict";
import test from "node:test";

type Handler = ((event?: unknown) => void) | null;

class MemoryIndexedDb {
  readonly data = new Map<string, unknown>();
  quotaFailures = 0;

  open() {
    const request = {
      result: null as unknown,
      error: null,
      onupgradeneeded: null as Handler,
      onsuccess: null as Handler,
      onerror: null as Handler,
    };
    queueMicrotask(() => {
      request.result = this.database();
      request.onupgradeneeded?.();
      queueMicrotask(() => request.onsuccess?.());
    });
    return request;
  }

  private database() {
    return {
      createObjectStore: () => undefined,
      close: () => undefined,
      transaction: (_store: string, mode: string) => {
        const pending = new Map(this.data);
        const transaction = {
          error: null as DOMException | null,
          oncomplete: null as Handler,
          onerror: null as Handler,
          onabort: null as Handler,
          objectStore: () => ({
            get: (key: string) => {
              const request = {
                result: pending.get(key),
                error: null,
                onsuccess: null as Handler,
                onerror: null as Handler,
              };
              queueMicrotask(() => request.onsuccess?.());
              return request;
            },
            put: (value: unknown, key: string) => pending.set(key, structuredClone(value)),
            delete: (key: string) => pending.delete(key),
          }),
        };
        queueMicrotask(() => {
          if (mode === "readwrite" && this.quotaFailures > 0) {
            this.quotaFailures -= 1;
            transaction.error = new DOMException("storage full", "QuotaExceededError");
            transaction.onerror?.();
            return;
          }
          if (mode === "readwrite") {
            this.data.clear();
            for (const [key, value] of pending) this.data.set(key, value);
          }
          transaction.oncomplete?.();
        });
        return transaction;
      },
    };
  }
}

const memory = new MemoryIndexedDb();
Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: memory });

const game = await import("../src/store/game");
const idb = await import("../src/store/idb");
const persist = await import("../src/store/persist");

test("WP-004 AC-1 AC-3 snapshot ring records metadata and atomically evicts the oldest", async () => {
  memory.data.clear();
  for (let index = 0; index < 6; index += 1) {
    game.actions.loadPgn(`1. e4 e5 ${index + 2}. Nf3 *`, `ring-${index}.pgn`);
    assert.ok(await persist.captureSnapshot("manual"));
  }
  const snapshots = await persist.listSnapshots();
  assert.equal(snapshots.length, 5);
  assert.deepEqual(
    snapshots.map((snapshot) => snapshot.fileName),
    ["ring-5.pgn", "ring-4.pgn", "ring-3.pgn", "ring-2.pgn", "ring-1.pgn"],
  );
  assert.ok(snapshots.every((snapshot) => snapshot.moveCount > 0 && snapshot.lineCount > 0));
  assert.equal(
    [...memory.data.keys()].filter((key) => key.startsWith("workingRepertoire.snapshot.")).length,
    5,
  );
});

test("WP-004 AC-2 restores exact PGN under a new document identity", async () => {
  memory.data.clear();
  game.actions.loadPgn("1. d4 d5 2. c4 e6 *", "recover-me.pgn");
  const expectedPgn = game.actions.toPgn();
  const snapshotId = await persist.captureSnapshot("manual");
  assert.ok(snapshotId);
  game.actions.newGame();
  const beforeRestoreId = game.documentId();
  assert.equal(await persist.restoreSnapshot(snapshotId), true);
  assert.equal(game.actions.toPgn(), expectedPgn);
  assert.notEqual(game.documentId(), beforeRestoreId);
});

test("WP-004 AC-4 corrupt snapshot remains listed and does not hide readable entries", async () => {
  memory.data.clear();
  game.actions.loadPgn("1. c4 e5 *", "readable.pgn");
  const readableId = await persist.captureSnapshot("manual");
  game.actions.loadPgn("1. Nf3 d5 *", "corrupt.pgn");
  const corruptId = await persist.captureSnapshot("manual");
  assert.ok(readableId && corruptId);
  await idb.idbSet(`workingRepertoire.snapshot.${corruptId}`, {
    id: corruptId,
    savedAt: Date.now(),
    reason: "manual",
    pgn: "1. e4 e5 2. e4 *",
    fileName: "corrupt.pgn",
  });
  const snapshots = await persist.listSnapshots();
  assert.equal(snapshots.find((entry) => entry.id === corruptId)?.readable, false);
  assert.equal(snapshots.find((entry) => entry.id === readableId)?.readable, true);
});

test("WP-004 AC-5 quota failure is atomic, preserves live state, and degrades visibly", async () => {
  memory.data.clear();
  const live = {
    pgn: "1. e4 e5 *",
    color: "white" as const,
    path: [],
    fileName: "live.pgn",
    dirty: true,
  };
  await idb.idbSet(persist.WORKING_REPERTOIRE_STORAGE_KEY, live);
  game.actions.loadPgn("1. d4 d5 *", "quota.pgn");
  memory.quotaFailures = 2;
  assert.equal(await persist.captureSnapshot("manual"), null);
  assert.equal(persist.snapshotsUnavailable(), true);
  assert.deepEqual(await idb.idbGet(persist.WORKING_REPERTOIRE_STORAGE_KEY), live);
  assert.equal(
    [...memory.data.keys()].some((key) => key.startsWith("workingRepertoire.snapshot.")),
    false,
  );
});

test("WP-004 AC-6 snapshot writes respect nested autosave pauses", async () => {
  memory.data.clear();
  game.actions.loadPgn("1. e4 c5 *", "paused.pgn");
  const release = await persist.pauseWorkingRepertoireAutosave();
  assert.equal(await persist.captureSnapshot("manual"), null);
  assert.equal((await persist.listSnapshots()).length, 0);
  release();
  assert.ok(await persist.captureSnapshot("manual"));
});

test("WP-004 AC-7 AC-8 keeps the workingRepertoire record backward and forward compatible", async () => {
  memory.data.clear();
  const legacy = {
    pgn: "1. d4 Nf6 2. c4 *",
    color: "black" as const,
    path: [0],
    fileName: "legacy.pgn",
    dirty: true,
  };
  await idb.idbSet(persist.WORKING_REPERTOIRE_STORAGE_KEY, legacy);
  await idb.idbSet("workingRepertoire.snapshotIndex", [{ extra: "ignored" }]);
  await persist.restoreWorking();
  assert.equal(game.actions.toPgn(), game.currentTree().toPgn());
  assert.equal(game.fileName(), legacy.fileName);
  assert.equal(game.color(), legacy.color);
  assert.equal(game.dirty(), true);
  assert.deepEqual(await idb.idbGet(persist.WORKING_REPERTOIRE_STORAGE_KEY), legacy);
});
