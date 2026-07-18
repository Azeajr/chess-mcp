import { expect, test, type Page } from "playwright/test";

type ProfileMode = "familiar-plans" | "balanced" | "versatile" | "custom";
type StrategicFitProfile = {
  mode: ProfileMode;
  source: "explicit" | "inferred";
  provisional: boolean;
  preferences: {
    maximum_engine_loss_cp: number | null;
    opponent_popularity_importance: number;
    personal_game_frequency_importance: number;
    manual_weight_importance: number;
    additional_memorization_tolerance: number;
    preferred_concept_ids: string[];
    avoided_concept_ids: string[];
    preferred_tactical_character: string[];
    minimum_opponent_coverage: number | null;
  };
};

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  toPgn(): string;
  goto(path: number[]): void;
  setColor(color: "white" | "black"): void;
  stagePreviewLine(path: number[], moves: string[]): { ok: boolean };
  preview(): unknown;
  documentId(): string;
  version(): number;
  currentPath(): number[];
  color(): "white" | "black";
  dirty(): boolean;
  fileName(): string | null;
  commandStates(): unknown;
  strategicFitMetadata(): { profile: StrategicFitProfile };
  strategicFitMetadataStatus(): string;
  strategicFitProfile(): StrategicFitProfile;
  strategicFitProfileSetupRequired(): boolean;
  flushStrategicFitMetadata(): Promise<void>;
};

const chess = <T>(page: Page, fn: (api: ChessHarness, arg: T) => unknown, arg?: T) => page.evaluate(
  ({ source, arg }) => Function("api", "arg", `return (${source})(api, arg)`)(
    (window as unknown as { __chess: ChessHarness }).__chess,
    arg,
  ),
  { source: fn.toString(), arg },
);

const appSnapshot = (page: Page) => chess(page, (api) => ({
  pgn: api.toPgn(),
  document_id: api.documentId(),
  revision: api.version(),
  path: [...api.currentPath()],
  color: api.color(),
  dirty: api.dirty(),
  file_name: api.fileName(),
  preview: api.preview(),
  commands: api.commandStates(),
}));

const workerStarts = (page: Page) => page.evaluate(() =>
  [...((window as unknown as { __workerStarts: string[] }).__workerStarts ?? [])],
);

const indexedDbValue = (page: Page, key: string) => page.evaluate(
  async (storageKey) => new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open("chess-repertoire", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("kv", "readonly").objectStore("kv").get(storageKey);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db.close();
        resolve(request.result);
      };
    };
  }),
  key,
);

const persistedStrategicFitMetadata = (page: Page, documentId: string) =>
  indexedDbValue(page, `strategicFitMetadata:${documentId}`);

const waitForWorkingDocument = async (page: Page, documentId: string) => {
  await expect.poll(async () => {
    const saved = await indexedDbValue(page, "workingRepertoire") as { documentId?: string } | undefined;
    return saved?.documentId;
  }).toBe(documentId);
};

const openWorkspace = async (page: Page) => {
  const opener = page.getByRole("button", { name: "Open workspace" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await expect(dialog).toBeVisible();
  return { opener, dialog };
};

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
});

test("first run defaults to Balanced and skip keeps visible inference only for this session", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. e4 e5 2. Nf3 Nc6 *", "skip-profile.pgn"));
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  const before = await appSnapshot(page);
  await waitForWorkingDocument(page, before.document_id);
  const persistedBefore = await persistedStrategicFitMetadata(page, before.document_id);
  const workersBefore = await workerStarts(page);
  const { opener, dialog } = await openWorkspace(page);

  await expect(dialog.getByRole("heading", {
    name: "How should Strategic Fit review your repertoire?",
  })).toBeVisible();
  const choices = dialog.getByRole("radio");
  await expect(choices).toHaveCount(4);
  expect(await choices.evaluateAll((elements) => elements.map((element) =>
    (element as HTMLInputElement).value,
  ))).toEqual(["familiar-plans", "balanced", "versatile", "custom"]);
  await expect(dialog.getByRole("radio", { name: /Balanced/ })).toBeChecked();
  await expect(dialog.getByText("Recommended", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/base scan is engine-free/i)).toBeVisible();

  await dialog.getByRole("button", { name: "Skip for now" }).click();
  await expect(dialog.getByRole("heading", {
    name: "How should Strategic Fit review your repertoire?",
  })).toHaveCount(0);
  await expect(dialog.locator(".strategic-fit-workspace-pane:visible")).toHaveCount(3);
  await expect(dialog.getByText(/Balanced · Inferred · provisional/)).toBeVisible();
  expect(await chess(page, (api) => api.strategicFitProfile())).toMatchObject({
    mode: "balanced",
    source: "inferred",
    provisional: true,
  });
  expect(await chess(page, (api) => api.strategicFitProfileSetupRequired())).toBe(false);
  expect(await appSnapshot(page)).toEqual(before);
  expect(await workerStarts(page)).toEqual(workersBefore);
  await chess(page, (api) => api.flushStrategicFitMetadata());
  expect(await persistedStrategicFitMetadata(page, before.document_id)).toEqual(persistedBefore);

  await dialog.getByRole("button", { name: "Return to repertoire" }).click();
  await expect(opener).toBeFocused();
  const reopened = await openWorkspace(page);
  await expect(reopened.dialog.locator(".strategic-fit-workspace-pane:visible")).toHaveCount(3);
  await reopened.dialog.getByRole("button", { name: "Return to repertoire" }).click();

  await page.reload();
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  expect(await chess(page, (api) => api.documentId())).toBe(before.document_id);
  const afterReload = await openWorkspace(page);
  await expect(afterReload.dialog.getByRole("radio", { name: /Balanced/ })).toBeChecked();
  expect(await chess(page, (api) => api.strategicFitProfileSetupRequired())).toBe(true);
  expect(await persistedStrategicFitMetadata(page, before.document_id)).toEqual(persistedBefore);
});

test("an explicit familiar-plans choice persists and bypasses setup after reload", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. c4 e5 2. Nc3 Nf6 *", "explicit-profile.pgn"));
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  const before = await appSnapshot(page);
  await waitForWorkingDocument(page, before.document_id);
  const workersBefore = await workerStarts(page);
  const { dialog } = await openWorkspace(page);

  await dialog.getByRole("radio", { name: /Familiar plans/ }).check();
  await expect(dialog.getByRole("button", { name: "Use Familiar plans profile" })).toBeVisible();
  await dialog.getByRole("button", { name: "Use Familiar plans profile" }).click();
  await expect(dialog.locator(".strategic-fit-workspace-pane:visible")).toHaveCount(3);
  await expect(dialog.getByText(/Familiar plans · Explicit/)).toBeVisible();
  expect(await appSnapshot(page)).toEqual(before);
  expect(await workerStarts(page)).toEqual(workersBefore);
  expect(await chess(page, (api) => api.strategicFitProfile())).toMatchObject({
    mode: "familiar-plans",
    source: "explicit",
    provisional: false,
  });

  await chess(page, (api) => api.flushStrategicFitMetadata());
  expect(await persistedStrategicFitMetadata(page, before.document_id)).toMatchObject({
    profile: { mode: "familiar-plans", source: "explicit", provisional: false },
  });
  await dialog.getByRole("button", { name: "Return to repertoire" }).click();

  await page.reload();
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  const afterReload = await openWorkspace(page);
  await expect(afterReload.dialog.getByRole("radio")).toHaveCount(0);
  await expect(afterReload.dialog.locator(".strategic-fit-workspace-pane:visible")).toHaveCount(3);
  await expect(afterReload.dialog.getByText(/Familiar plans · Explicit/)).toBeVisible();
});

test("Custom saves every bounded preference without changing repertoire or staged state", async ({ page }) => {
  await chess(page, (api) => {
    api.loadPgn("1. d4 d5 2. c4 e6 (2... c6) 3. Nc3 *", "custom-profile.pgn");
    api.goto([0, 0]);
    api.setColor("black");
    api.stagePreviewLine([], ["Nf3", "Nf6"]);
  });
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  const before = await appSnapshot(page);
  const workersBefore = await workerStarts(page);
  const { dialog } = await openWorkspace(page);

  await dialog.getByRole("radio", { name: /Custom/ }).check();
  const advanced = dialog.locator("details.strategic-fit-profile-advanced");
  await expect(advanced).toHaveAttribute("open", "");
  await expect(dialog.getByText(/base scan is engine-free/i)).toBeVisible();
  await expect(dialog.getByText(/Engine depth is used only later/i)).toBeVisible();

  const engineLoss = advanced.getByLabel(/Maximum acceptable engine loss/);
  const coverage = advanced.getByLabel(/Minimum opponent coverage/);
  await expect(engineLoss).toHaveAttribute("min", "0");
  await expect(engineLoss).toHaveAttribute("max", "1000");
  await expect(coverage).toHaveAttribute("min", "0");
  await expect(coverage).toHaveAttribute("max", "100");
  await engineLoss.fill("180");
  await advanced.getByLabel(/Opponent popularity importance/).fill("0.8");
  await advanced.getByLabel(/Personal-game importance/).fill("0.65");
  await advanced.getByLabel(/Manual weighting importance/).fill("0.35");
  await advanced.getByLabel(/Additional memorization tolerance/).fill("0.25");
  await coverage.fill("90");
  await advanced.getByLabel(/Preferred concepts/).fill("minority-attack, space");
  await advanced.getByLabel(/Avoided concepts/).fill("isolated-queen-pawn");
  await advanced.getByLabel(/Preferred tactical character/).fill("forcing, sharp");

  await dialog.getByRole("button", { name: "Use Custom profile" }).click();
  expect(await chess(page, (api) => api.strategicFitProfile())).toMatchObject({
    mode: "custom",
    source: "explicit",
    provisional: false,
    preferences: {
      maximum_engine_loss_cp: 180,
      opponent_popularity_importance: 0.8,
      personal_game_frequency_importance: 0.65,
      manual_weight_importance: 0.35,
      additional_memorization_tolerance: 0.25,
      preferred_concept_ids: ["minority-attack", "space"],
      avoided_concept_ids: ["isolated-queen-pawn"],
      preferred_tactical_character: ["forcing", "sharp"],
      minimum_opponent_coverage: 0.9,
    },
  });
  expect(await appSnapshot(page)).toEqual(before);
  expect(await workerStarts(page)).toEqual(workersBefore);

  await chess(page, (api) => api.flushStrategicFitMetadata());
  expect(await persistedStrategicFitMetadata(page, before.document_id)).toMatchObject({
    profile: {
      mode: "custom",
      preferences: { maximum_engine_loss_cp: 180, minimum_opponent_coverage: 0.9 },
    },
  });
});

test("setup has a keyboard-safe phone layout and accessible advanced controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { dialog } = await openWorkspace(page);
  const close = dialog.getByRole("button", { name: "Return to repertoire" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("radio", { name: /Balanced/ })).toBeFocused();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await dialog.getByRole("radio", { name: /Custom/ }).focus();
  await page.keyboard.press("Space");
  await expect(dialog.getByRole("radio", { name: /Custom/ })).toBeChecked();
  await expect(dialog.locator("details.strategic-fit-profile-advanced")).toHaveAttribute("open", "");

  for (const name of [
    /Maximum acceptable engine loss/,
    /Opponent popularity importance/,
    /Personal-game importance/,
    /Manual weighting importance/,
    /Additional memorization tolerance/,
    /Minimum opponent coverage/,
    /Preferred concepts/,
    /Avoided concepts/,
    /Preferred tactical character/,
  ]) {
    await expect(dialog.getByLabel(name)).toBeVisible();
  }
  await expect(dialog.getByRole("button", { name: "Skip for now" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Use Custom profile" })).toBeVisible();

  for (let index = 0; index < 18; index++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[role='dialog']")))).toBe(true);
  }
});
