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
  appendToolResultForTesting(operation: string, result: unknown): void;
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

test("an ambiguous natural request needs no preset and direct analysis remains available", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. e4 (1. d4 d5) e5 2. Nf3", "prep.pgn"));
  await expect(page.getByPlaceholder("Ask about this position, game, or repertoire…")).toBeVisible();
  await expect(page.getByText("Prescribed-move audit")).toBeVisible();
  await expect(page.getByRole("button", { name: "Audit" })).toBeVisible();
  await expect(page.getByText("Only moves & drills")).toBeVisible();
  await expect(page.getByText("Structure search")).toBeVisible();
  await expect(page.getByText("Opponent preparation")).toBeVisible();
  await expect(page.getByText("Annotated repertoire")).toBeVisible();
});

test("analysis depth is globally adjustable and warns at the maximum", async ({ page }) => {
  const depth = page.getByRole("spinbutton", { name: "Analysis depth" });
  const slider = page.getByRole("slider", { name: "Analysis depth slider" });
  await expect(depth).toHaveValue("20");
  await slider.fill("24");
  await expect(depth).toHaveValue("24");
  await depth.fill("30");
  await expect(slider).toHaveValue("30");
  await expect(page.getByRole("status")).toContainText("Every engine task will use depth 30");
  await page.getByRole("button", { name: "Dismiss deep analysis notice" }).click();
  await expect(page.getByText("Every engine task will use depth 30")).toHaveCount(0);
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

test("typed audit navigation and nested only-move deck saving work from chat results", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. e4 e5 2. Nf3 Nc6"));
  await chess(page, (api) => api.appendToolResultForTesting("audit_repertoire_moves", {
    color: "white",
    positions_scanned: 2,
    moves_audited: 2,
    findings: [{ path: ["e4", "e5", "Nf3"], cp_loss: 90, classification: "inaccuracy", best_move: "Nc3" }],
  }));
  await expect(page.getByText("Prescribed-move audit").last()).toBeVisible();
  await page.locator(".tool-result .result-nav").last().click();
  await expect(page.locator(".move.current").first()).toContainText("Nf3");

  const deck = await chess(page, (api) => api.createArtifact("csv", "front,back\nposition,e4", "only-move-drill.csv"));
  await chess(page, (api, artifact) => api.appendToolResultForTesting("find_only_moves", {
    positions_scanned: 4,
    only_moves_found: 1,
    findings: [],
    lines: [],
    deck: { kind: "artifact", artifact_id: artifact.artifact_id, format: "csv", name: "only-move-drill.csv", bytes: 22 },
  }), deck);
  await expect(page.getByText("Only-move training positions")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".tool-result .artifact-card").last().getByRole("button", { name: "Save" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("only-move-drill.csv");
});

test("all newly reachable primary reports have typed chat cards", async ({ page }) => {
  await chess(page, (api) => api.appendToolResultForTesting("find_structures", {
    total_matches: 2, leaves_total: 8, matches: [{ path: ["d4", "d5"], structure: "Carlsbad" }],
  }));
  await chess(page, (api) => api.appendToolResultForTesting("prep_vs_opponent", {
    username: "alice", games_matched_color: 12, coverage_pct: 75, uncovered_opponent_moves: [],
  }));
  const artifact = await chess(page, (api) => api.createArtifact("pgn", "1. d4 *", "prep-annotated.pgn"));
  await chess(page, (api, nested) => api.appendToolResultForTesting("export_annotated_repertoire", {
    annotated: { audit: 1, only_moves: 2, gaps: 3, congruence: 4 }, artifact: nested,
  }), artifact);
  await expect(page.getByText("Structure search").last()).toBeVisible();
  await expect(page.getByText("Opponent preparation · alice")).toBeVisible();
  await expect(page.getByText("Annotated repertoire").last()).toBeVisible();
});

test("top-level chat artifacts have a save affordance", async ({ page }) => {
  const artifact = await chess(page, (api) => api.createArtifact("pgn", "1. e4 *", "review-annotated.pgn"));
  await chess(page, (api, result) => api.appendToolResultForTesting("export_annotated_pgn", result), artifact);
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".tool-result .artifact-card").last().getByRole("button", { name: "Save" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("review-annotated.pgn");
});

test("the working document restores from IndexedDB after reload", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. e4 e5 2. Nf3 Nc6 *", "autosaved.pgn"));
  await chess(page, (api) => api.goto([0, 0, 0]));
  await page.waitForTimeout(550);
  await page.reload();
  await expect.poll(() => chess(page, (api) => api.toPgn())).toContain("Nf3 Nc6");
  await expect(page.locator(".move.current").first()).toContainText("Nf3");
});

test("structured command errors render as distinct result cards", async ({ page }) => {
  await chess(page, (api) => api.appendToolResultForTesting("find_structures", { error: "missing_criteria", reason: "provide a structure or theme" }));
  await expect(page.getByRole("alert")).toContainText("Search criteria required");
  await expect(page.getByRole("alert")).toContainText("missing_criteria");
});

test("long direct analysis exposes a working cancel action", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. e4 (1. d4 d5 2. c4) e5 2. Nf3 Nc6 3. Bb5"));
  await page.getByRole("button", { name: "Audit" }).click();
  const cancel = page.getByRole("button", { name: "Cancel" }).first();
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(page.getByRole("button", { name: "Audit" })).toBeVisible();
});
