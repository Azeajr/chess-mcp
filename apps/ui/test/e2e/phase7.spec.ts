import { expect, test, type Page } from "playwright/test";

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  newGame(): void;
  toPgn(): string;
  goto(path: number[]): void;
  addSuggestion(moves: string[], comment?: string): { id: string };
  suggestions(): { id: string }[];
  stagePreviewLine(path: number[], moves: string[]): { ok: boolean };
  stageEdit(action: "add" | "prune" | "reorder", path: string[], options?: Record<string, unknown>): { ok: boolean; action_id?: string };
  stagedEdit(id: string): { status: string } | undefined;
  acceptStagedEdit(id: string): { ok: boolean; error?: string };
  createArtifact(format: "pgn" | "csv", content: string, name: string): { artifact_id: string };
  saveArtifact(id: string): boolean;
  selectOutcomes(text: string, preset: string, expanded: string[], documentOutcome?: "game" | "repertoire"): string[];
  runTool(name: string, args: Record<string, unknown>): Promise<unknown>;
};

const chess = <T>(page: Page, fn: (api: ChessHarness, arg: T) => unknown, arg?: T) => page.evaluate(
  ({ source, arg }) => Function("api", "arg", `return (${source})(api, arg)`)((window as unknown as { __chess: ChessHarness }).__chess, arg),
  { source: fn.toString(), arg },
);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
});

test("an ambiguous natural request inherits repertoire scope and exposes direct analysis", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. e4 (1. d4 d5) e5 2. Nf3", "prep.pgn"));
  await expect(page.getByPlaceholder("Ask about this position, game, or repertoire…")).toBeVisible();
  expect(await chess(page, (api) => api.selectOutcomes("What are the biggest problems here?", "", [], "repertoire"))).toEqual(["repertoire"]);
  await expect(page.getByText("Prescribed-move audit")).toBeVisible();
  await expect(page.getByRole("button", { name: "Audit" })).toBeVisible();
});

test("a finding path navigates to the exact move", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. e4 e5 2. Nf3 Nc6"));
  await page.locator(".move", { hasText: "Nf3" }).click();
  await expect(page.locator(".move.current").first()).toContainText("Nf3");
  await expect(page.locator(".focus-injection")).toContainText("e4 e5 Nf3");
});

test("suggestions do not mutate until accepted and can be rejected", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. e4 e5"));
  const before = await chess(page, (api) => api.toPgn());
  await chess(page, (api) => api.addSuggestion(["Nf3"], "Develop"));
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  await page.getByRole("button", { name: "Reject" }).click();
  expect(await chess(page, (api) => api.toPgn())).toBe(before);
  await chess(page, (api) => api.addSuggestion(["Nf3"], "Develop"));
  await page.getByRole("button", { name: "Accept" }).click();
  expect(await chess(page, (api) => api.toPgn())).toContain("Nf3");
});

test("direct repertoire previews expose cancel and accept controls", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. e4 e5", "prep.pgn"));
  const before = await chess(page, (api) => api.toPgn());
  await chess(page, (api) => api.stagePreviewLine([], ["d4", "d5"]));
  await expect(page.getByRole("status", { name: "Staged repertoire line" })).toContainText("1. d4 d5");
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await chess(page, (api) => api.toPgn())).toBe(before);

  await chess(page, (api) => api.stagePreviewLine([], ["d4", "d5"]));
  await page.getByRole("button", { name: "Accept line" }).click();
  expect(await chess(page, (api) => api.toPgn())).toContain("d4 d5");
  await expect(page.getByRole("status", { name: "Staged repertoire line" })).toHaveCount(0);
});

test("stale staged edits are refused after the document changes", async ({ page }) => {
  const id = await chess(page, (api) => {
    api.loadPgn("1. e4 e5");
    return api.stageEdit("add", ["e4", "e5"], { addMoves: ["Nf3"] }).action_id!;
  });
  await chess(page, (api) => api.newGame());
  expect(await chess(page, (api, editId) => api.acceptStagedEdit(editId), id)).toEqual({ ok: false, error: "stale_revision" });
  expect(await chess(page, (api, editId) => api.stagedEdit(editId)?.status, id)).toBe("stale");
});

test("artifact saving is a browser download affordance", async ({ page }) => {
  const artifact = await chess(page, (api) => api.createArtifact("pgn", "1. e4 *", "annotated.pgn"));
  const downloadPromise = page.waitForEvent("download");
  expect(await chess(page, (api, artifactId) => api.saveArtifact(artifactId), artifact.artifact_id)).toBe(true);
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("annotated.pgn");
});

test("long direct analysis exposes a working cancel action", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. e4 (1. d4 d5 2. c4) e5 2. Nf3 Nc6 3. Bb5"));
  await page.getByRole("button", { name: "Audit" }).click();
  const cancel = page.getByRole("button", { name: "Cancel" }).first();
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(page.getByRole("button", { name: "Audit" })).toBeVisible();
});

test("direct and chat clients execute the same canonical browser command", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. e4 e5 2. Nf3"));
  const direct = await chess(page, (api) => api.runTool("get_document_summary", {}));
  const chat = await chess(page, (api) => api.runTool("get_document_summary", {}));
  expect(chat).toEqual(direct);
});
