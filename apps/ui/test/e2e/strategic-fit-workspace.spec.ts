import { expect, test, type Page } from "playwright/test";

type Region = "overview" | "findings" | "evidence" | "resolution";
type RegionState = { status: "empty" | "loading" | "error"; message?: string };

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  toPgn(): string;
  goto(path: number[]): void;
  setColor(color: "white" | "black"): void;
  applyEdit(
    action: "add" | "prune" | "reorder",
    path: string[],
    options?: { addMoves?: string[]; promoteMove?: string },
  ): { ok: boolean };
  stagePreviewLine(path: number[], moves: string[]): { ok: boolean };
  preview(): unknown;
  documentId(): string;
  version(): number;
  currentPath(): number[];
  color(): "white" | "black";
  dirty(): boolean;
  fileName(): string | null;
  commandStates(): unknown;
  strategicFitMetadata(): unknown;
  strategicFitMetadataStatus(): string;
  selectStrategicFitProfile(mode: "balanced"): unknown;
  flushStrategicFitMetadata(): Promise<void>;
  setStrategicFitWorkspaceRegionState(region: Region, state: RegionState): void;
};

const chess = <T>(page: Page, fn: (api: ChessHarness, arg: T) => unknown, arg?: T) => page.evaluate(
  ({ source, arg }) => Function("api", "arg", `return (${source})(api, arg)`)(
    (window as unknown as { __chess: ChessHarness }).__chess,
    arg,
  ),
  { source: fn.toString(), arg },
);

const snapshot = (page: Page) => chess(page, (api) => ({
  pgn: api.toPgn(),
  document_id: api.documentId(),
  revision: api.version(),
  path: [...api.currentPath()],
  color: api.color(),
  dirty: api.dirty(),
  file_name: api.fileName(),
  preview: api.preview(),
  commands: api.commandStates(),
  metadata: api.strategicFitMetadata(),
}));

const workerStarts = (page: Page) => page.evaluate(() =>
  [...((window as unknown as { __workerStarts: string[] }).__workerStarts ?? [])],
);

const persistedStrategicFitMetadata = (page: Page, documentId: string) => page.evaluate(
  async (id) => new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open("chess-repertoire", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("kv", "readonly").objectStore("kv").get(`strategicFitMetadata:${id}`);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db.close();
        resolve(request.result);
      };
    };
  }),
  documentId,
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const starts: string[] = [];
    const NativeWorker = window.Worker;
    Object.defineProperty(window, "__workerStarts", { value: starts });
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args) {
        starts.push(String(args[0]));
        return Reflect.construct(target, args, target);
      },
    });
  });
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
});

test("desktop shell opens and closes without analysis, mutation, or state loss", async ({ page }) => {
  await chess(page, (api) => {
    api.loadPgn("1. e4 e5 2. Nf3 Nc6 (2... Nf6) 3. Bb5 *", "strategic-fit.pgn");
    api.applyEdit("add", ["e4", "e5", "Nf3", "Nc6", "Bb5"], { addMoves: ["a6"] });
    api.goto([0, 0, 0]);
    api.setColor("black");
    api.stagePreviewLine([], ["d4", "d5"]);
  });
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
  await chess(page, (api) => api.flushStrategicFitMetadata());
  const before = await snapshot(page);
  const persistedBefore = await persistedStrategicFitMetadata(page, before.document_id);
  const workersBefore = await workerStarts(page);
  const opener = page.getByRole("button", { name: "Open workspace" });

  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-analysis-state='idle']").getByText("Analysis not started"))
    .toBeVisible();
  await expect(dialog.locator(".strategic-fit-workspace-pane:visible")).toHaveCount(3);
  await expect(dialog.getByRole("heading", { name: "Strategic map" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Findings" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Evidence / comparison" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Resolution" })).toBeHidden();
  await expect(dialog.locator("[data-region-state='empty']")).toHaveCount(4);
  expect(await snapshot(page)).toEqual(before);
  expect(await persistedStrategicFitMetadata(page, before.document_id)).toEqual(persistedBefore);
  expect(await workerStarts(page)).toEqual(workersBefore);

  await dialog.getByRole("button", { name: "Return to repertoire" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await snapshot(page)).toEqual(before);
  expect(await persistedStrategicFitMetadata(page, before.document_id)).toEqual(persistedBefore);
  expect(await workerStarts(page)).toEqual(workersBefore);
});

test("focus is trapped in both directions and Escape restores the exact opener", async ({ page }) => {
  const opener = page.getByRole("button", { name: "Open workspace" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  const close = dialog.getByRole("button", { name: "Return to repertoire" });
  const overview = dialog.locator("#strategic-fit-pane-overview");
  const evidence = dialog.locator("#strategic-fit-pane-evidence");

  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(evidence).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Analyze strategic fit" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(overview).toBeFocused();

  for (let index = 0; index < 10; index++) {
    await page.keyboard.press(index % 2 === 0 ? "Tab" : "Shift+Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[role='dialog']")))).toBe(true);
  }
  await page.locator(".topbar button", { hasText: "Open PGN" }).evaluate((button: HTMLElement) => button.focus());
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[role='dialog']")))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("phone shell exposes the four frozen stages one at a time", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  const stages = dialog.getByRole("tab");
  await expect(stages).toHaveCount(4);
  await expect(stages).toHaveText(["Overview", "Findings", "Evidence", "Resolution"]);
  await expect(stages.filter({ hasText: "Overview" })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.locator("#strategic-fit-pane-overview")).toBeVisible();
  await expect(dialog.locator("#strategic-fit-pane-findings")).toBeHidden();

  for (const [stage, pane] of [
    ["Findings", "findings"],
    ["Evidence", "evidence"],
    ["Resolution", "resolution"],
    ["Overview", "overview"],
  ] as const) {
    await dialog.getByRole("tab", { name: stage }).click();
    await expect(dialog.getByRole("tab", { name: stage })).toHaveAttribute("aria-selected", "true");
    await expect(dialog.locator(`#strategic-fit-pane-${pane}`)).toBeVisible();
    await expect(dialog.locator(".strategic-fit-workspace-pane:visible")).toHaveCount(1);
  }

  expect(await dialog.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(390);
});

test("shell regions render explicit empty, loading, and error states", async ({ page }) => {
  await page.getByRole("button", { name: "Open workspace" }).click();
  await chess(page, (api) => {
    api.setStrategicFitWorkspaceRegionState("overview", {
      status: "loading",
      message: "Loading the overview fixture.",
    });
    api.setStrategicFitWorkspaceRegionState("findings", {
      status: "error",
      message: "The findings fixture is unavailable.",
    });
  });

  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await expect(dialog.locator("#strategic-fit-pane-overview").getByRole("status"))
    .toContainText("Loading the overview fixture.");
  await expect(dialog.locator("#strategic-fit-pane-findings").getByRole("alert"))
    .toContainText("The findings fixture is unavailable.");
  await expect(dialog.locator("#strategic-fit-pane-evidence [data-region-state='empty']"))
    .toContainText("No evidence selected");
});
