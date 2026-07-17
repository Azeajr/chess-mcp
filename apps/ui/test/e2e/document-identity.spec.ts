import { expect, test, type Page } from "playwright/test";

type ChessHarness = {
  documentId(): string;
  loadPgn(pgn: string, name?: string): void;
  newGame(): void;
  toPgn(): string;
  goto(path: number[]): void;
  setColor(color: "white" | "black"): void;
  applyEdit(
    action: "add" | "prune" | "reorder",
    path: string[],
    options?: { addMoves?: string[]; promoteMove?: string },
  ): { ok: boolean };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const chess = <T>(page: Page, fn: (api: ChessHarness, arg: T) => unknown, arg?: T) => page.evaluate(
  ({ source, arg }) => Function("api", "arg", `return (${source})(api, arg)`)(
    (window as unknown as { __chess: ChessHarness }).__chess,
    arg,
  ),
  { source: fn.toString(), arg },
);

async function savedWorkingDocumentId(page: Page): Promise<string | undefined> {
  return page.evaluate(async () => new Promise<string | undefined>((resolve, reject) => {
    const open = indexedDB.open("chess-repertoire", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("kv", "readonly").objectStore("kv").get("workingRepertoire");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const value = request.result as { documentId?: string } | undefined;
        db.close();
        resolve(value?.documentId);
      };
    };
  }));
}

async function putWorkingDocument(page: Page, value: unknown): Promise<void> {
  await page.evaluate(async (saved) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("chess-repertoire", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(saved, "workingRepertoire");
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  }), value);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
});

test("initial, import, edit, navigation, save, New, and failed-load identity lifecycle", async ({ page }) => {
  const initial = await chess(page, (api) => api.documentId()) as string;
  expect(initial).toMatch(UUID);

  await chess(page, (api) => api.loadPgn("1. e4 e5 *", "one.pgn"));
  const firstImport = await chess(page, (api) => api.documentId()) as string;
  expect(firstImport).toMatch(UUID);
  expect(firstImport).not.toBe(initial);

  await chess(page, (api) => api.goto([0]));
  await chess(page, (api) => api.setColor("black"));
  expect(await chess(page, (api) => api.applyEdit("add", ["e4", "e5"], { addMoves: ["Nf3"] }))).toMatchObject({ ok: true });
  expect(await chess(page, (api) => api.documentId())).toBe(firstImport);

  await page.evaluate(() => Object.defineProperty(window, "showSaveFilePicker", {
    value: undefined,
    configurable: true,
  }));
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await download;
  expect(await chess(page, (api) => api.documentId())).toBe(firstImport);

  await chess(page, (api) => api.loadPgn("1. e4 e5 *", "two.pgn"));
  const secondImport = await chess(page, (api) => api.documentId()) as string;
  expect(secondImport).not.toBe(firstImport);

  const beforeFailure = secondImport;
  await expect(chess(page, (api) => api.loadPgn("1. e4 e5 2. e4 *", "illegal.pgn"))).rejects.toThrow(/illegal move/);
  expect(await chess(page, (api) => api.documentId())).toBe(beforeFailure);

  await chess(page, (api) => api.newGame());
  const fresh = await chess(page, (api) => api.documentId()) as string;
  expect(fresh).toMatch(UUID);
  expect(fresh).not.toBe(secondImport);
});

test("autosave reload resumes the persisted working document identity", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. d4 d5 2. c4 e6 *", "autosaved.pgn"));
  const expectedId = await chess(page, (api) => api.documentId()) as string;

  await expect.poll(() => savedWorkingDocumentId(page)).toBe(expectedId);
  await page.reload();
  await expect.poll(() => chess(page, (api) => api.toPgn())).toContain("d4 d5 2. c4 e6");
  await expect.poll(() => chess(page, (api) => api.documentId())).toBe(expectedId);
});

test("separate explicit imports never share identity, even with the same name or contents", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. c4 e5 *", "repertoire.pgn"));
  const first = await chess(page, (api) => api.documentId()) as string;
  await chess(page, (api) => api.loadPgn("1. c4 e5 *", "repertoire.pgn"));
  const second = await chess(page, (api) => api.documentId()) as string;
  expect(second).toMatch(UUID);
  expect(second).not.toBe(first);
});

test("cancelled and invalid file-picker loads leave the active identity and content untouched", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. e4 e5 *", "active.pgn"));
  const activeId = await chess(page, (api) => api.documentId()) as string;
  const activePgn = await chess(page, (api) => api.toPgn()) as string;

  await page.evaluate(() => Object.defineProperty(window, "showOpenFilePicker", {
    configurable: true,
    value: async () => [{
      name: "candidate.pgn",
      getFile: async () => new File(["1. d4 d5 *"], "candidate.pgn"),
    }],
  }));
  await page.getByRole("button", { name: "Open PGN" }).click();
  await expect(page.getByText("Which color is this repertoire for?")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await chess(page, (api) => api.documentId())).toBe(activeId);
  expect(await chess(page, (api) => api.toPgn())).toBe(activePgn);

  await page.evaluate(() => Object.defineProperty(window, "showOpenFilePicker", {
    configurable: true,
    value: async () => [{
      name: "illegal.pgn",
      getFile: async () => new File(["1. e4 e5 2. e4 *"], "illegal.pgn"),
    }],
  }));
  await page.getByRole("button", { name: "Open PGN" }).click();
  await page.getByRole("button", { name: "Load" }).click();
  await expect(page.getByText(/Could not load: illegal move/)).toBeVisible();
  expect(await chess(page, (api) => api.documentId())).toBe(activeId);
  expect(await chess(page, (api) => api.toPgn())).toBe(activePgn);
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("corrupt saved identity restores safe content under a fresh UUID", async ({ page }) => {
  const before = await chess(page, (api) => api.documentId()) as string;
  await putWorkingDocument(page, {
    pgn: "1. Nf3 d5 2. g3 *",
    color: "white",
    path: [0],
    fileName: "legacy-autosave.pgn",
    dirty: true,
    documentId: "not-a-document-uuid",
  });

  await page.reload();
  await expect.poll(() => chess(page, (api) => api.toPgn())).toContain("Nf3 d5 2. g3");
  const restored = await chess(page, (api) => api.documentId()) as string;
  expect(restored).toMatch(UUID);
  expect(restored).not.toBe(before);
  expect(restored).not.toBe("not-a-document-uuid");
});
