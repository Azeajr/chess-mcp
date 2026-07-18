import { expect, test, type Page } from "playwright/test";

type Lifecycle = {
  status: "idle" | "running" | "provisional" | "completed" | "cancelled" | "failed" | "stale";
  request_id: string | null;
  request_snapshot: {
    document_id: string;
    repertoire_revision: number;
    repertoire_pgn: string;
    repertoire_color: "white" | "black";
    profile_identity: string;
    settings_identity: string;
  } | null;
  error: { code: string; message: string } | null;
  current_result: {
    report_id: string;
    result: {
      report_id: string;
      preflight: { state: string; issues: Array<{ code: string }> };
      trajectories: Array<{ route_id: string }>;
    };
  } | null;
  last_completed: { report_id: string } | null;
};

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
  documentId(): string;
  version(): number;
  currentPath(): number[];
  color(): "white" | "black";
  dirty(): boolean;
  fileName(): string | null;
  preview(): unknown;
  commandStates(): unknown;
  strategicFitMetadataStatus(): string;
  strategicFitProfileSetupRequired(): boolean;
  selectStrategicFitProfile(mode: "balanced" | "versatile"): unknown;
  applyInferredStrategicFitProfile(mode: "versatile"): unknown;
  upsertStrategicFitRouteWeight(input: { target_id: string; weight: number }): unknown;
  strategicFitLifecycle(): Lifecycle;
};

const REPERTOIRE = `1. e4 e5 (1... c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6) 2. Nf3 Nc6
3. Bb5 a6 (3... Nf6 4. O-O Nxe4 5. d4 Nd6) 4. Ba4 Nf6 5. O-O Be7
6. Re1 b5 (6... d6 7. c3 O-O 8. h3) 7. Bb3 d6 8. c3 O-O *`;

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

type WorkerMode = "native" | "stall-second" | "fail-first";

async function bootstrap(page: Page, mode: WorkerMode = "native") {
  await page.addInitScript((workerMode: WorkerMode) => {
    const starts: string[] = [];
    const controlledMessages: unknown[] = [];
    let controlledTerminations = 0;
    let strategicWorkers = 0;
    const NativeWorker = window.Worker;
    Object.defineProperties(window, {
      __workerStarts: { value: starts },
      __strategicFitControlledMessages: { value: controlledMessages },
      __strategicFitControlledTerminations: { get: () => controlledTerminations },
    });
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args, newTarget) {
        const source = String(args[0]);
        starts.push(source);
        const isStrategicFit = source.includes("strategic-fit.worker");
        if (!isStrategicFit) return Reflect.construct(target, args, newTarget);
        strategicWorkers++;
        const shouldStall = workerMode === "stall-second" && strategicWorkers === 2;
        const shouldFail = workerMode === "fail-first" && strategicWorkers === 1;
        if (!shouldStall && !shouldFail) return Reflect.construct(target, args, newTarget);

        const controlled = {
          onmessage: null as ((event: MessageEvent) => void) | null,
          onerror: null as ((event: ErrorEvent) => void) | null,
          postMessage(message: unknown) {
            controlledMessages.push(message);
            if (shouldFail && (message as { type?: string }).type === "analyze") {
              queueMicrotask(() => controlled.onerror?.({
                message: "Synthetic worker failure",
                filename: "strategic-fit.worker.ts",
                lineno: 1,
                colno: 1,
              } as ErrorEvent));
            }
          },
          terminate() {
            controlledTerminations++;
          },
        };
        return controlled;
      },
    });
  }, mode);
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
}

async function loadExplicitProfile(page: Page) {
  await chess(page, (api, pgn) => {
    api.loadPgn(pgn, "lifecycle.pgn");
  }, REPERTOIRE);
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
}

async function openWorkspace(page: Page) {
  await page.getByRole("button", { name: "Open workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await expect(dialog).toBeVisible();
  return dialog;
}

const workerStarts = (page: Page) => page.evaluate(() =>
  [...((window as unknown as { __workerStarts: string[] }).__workerStarts ?? [])],
);

test("opening workspace and completing setup remain idle until the explicit Analyze action", async ({ page }) => {
  await bootstrap(page);
  await chess(page, (api, pgn) => api.loadPgn(pgn, "explicit-start.pgn"), REPERTOIRE);
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  const before = await appSnapshot(page);
  const dialog = await openWorkspace(page);

  await dialog.getByRole("button", { name: "Skip for now" }).click();
  await expect(dialog.getByRole("button", { name: "Analyze strategic fit" })).toBeVisible();
  expect(await chess(page, (api) => api.strategicFitLifecycle().status)).toBe("idle");
  expect(await workerStarts(page)).toEqual([]);
  expect(await appSnapshot(page)).toEqual(before);

  await dialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({ timeout: 15_000 });
  await chess(page, (api) => api.applyInferredStrategicFitProfile("versatile"));
  await expect(dialog.locator("[data-analysis-state='stale']")).toBeVisible();
  await expect(dialog.getByText(/profile changed/i)).toBeVisible();
});

test("real canonical analysis stays current through navigation and stales for profile, settings, and edits", async ({ page }) => {
  await bootstrap(page);
  await loadExplicitProfile(page);
  await chess(page, (api) => {
    api.goto([0, 0, 0]);
  });
  const before = await appSnapshot(page);
  const dialog = await openWorkspace(page);

  await dialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({ timeout: 15_000 });
  const first = await chess(page, (api) => api.strategicFitLifecycle());
  expect(first.current_result?.report_id).toBeTruthy();
  expect(first.last_completed?.report_id).toBe(first.current_result?.report_id);
  expect((await workerStarts(page)).some((source) => source.includes("strategic-fit.worker"))).toBe(true);
  expect(await appSnapshot(page)).toEqual(before);

  await chess(page, (api) => api.goto([0]));
  await expect.poll(() => chess(page, (api) => api.strategicFitLifecycle().status)).toBe("completed");

  await chess(page, (api) => api.selectStrategicFitProfile("versatile"));
  await expect(dialog.locator("[data-analysis-state='stale']")).toBeVisible();
  await dialog.getByRole("button", { name: "Retry analysis" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({ timeout: 15_000 });
  const profileRefreshed = await chess(page, (api) => api.strategicFitLifecycle());
  expect(profileRefreshed.current_result?.report_id).not.toBe(first.current_result?.report_id);

  const routeId = profileRefreshed.current_result?.result.trajectories[0]?.route_id;
  expect(routeId).toBeTruthy();
  await chess(page, (api, targetId) => api.upsertStrategicFitRouteWeight({
    target_id: targetId,
    weight: 3,
  }), routeId!);
  await expect(dialog.locator("[data-analysis-state='stale']")).toBeVisible();
  await dialog.getByRole("button", { name: "Retry analysis" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({ timeout: 15_000 });

  const edited = await chess(page, (api) => api.applyEdit("add", [], { addMoves: ["d4", "d5"] })) as {
    ok: boolean;
  };
  expect(edited.ok).toBe(true);
  await expect(dialog.locator("[data-analysis-state='stale']")).toBeVisible();
  await expect(dialog.getByText(/Previous report—not current/)).toBeVisible();
  const currentRevision = await chess(page, (api) => api.version());

  await dialog.getByRole("button", { name: "Retry analysis" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({ timeout: 15_000 });
  const refreshed = await chess(page, (api) => api.strategicFitLifecycle());
  expect(refreshed.request_snapshot?.repertoire_revision).toBe(currentRevision);
  expect(refreshed.current_result?.report_id).not.toBe(first.current_result?.report_id);
});

test("cancelling an active canonical command aborts its Worker and retains the last report as previous", async ({ page }) => {
  await bootstrap(page, "stall-second");
  await loadExplicitProfile(page);
  const dialog = await openWorkspace(page);
  await dialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({ timeout: 15_000 });
  const completed = await chess(page, (api) => api.strategicFitLifecycle());
  const firstReportId = completed.current_result?.report_id;
  expect(firstReportId).toBeTruthy();

  await chess(page, (api) => api.setColor("black"));
  await expect(dialog.locator("[data-analysis-state='stale']")).toBeVisible();
  await dialog.getByRole("button", { name: "Retry analysis" }).click();
  await expect.poll(() => page.evaluate(() =>
    ((window as unknown as { __strategicFitControlledMessages: Array<{ type?: string }> })
      .__strategicFitControlledMessages ?? []).some((message) => message.type === "analyze"),
  )).toBe(true);
  await expect(dialog.getByRole("button", { name: "Cancel analysis" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel analysis" }).click();

  await expect(dialog.locator("[data-analysis-state='cancelled']")).toBeVisible();
  await expect(dialog.getByText(/Previous report—not current/)).toContainText(firstReportId!);
  const cancelled = await chess(page, (api) => api.strategicFitLifecycle());
  expect(cancelled.current_result).toBeNull();
  expect(cancelled.last_completed?.report_id).toBe(firstReportId);
  expect(await page.evaluate(() =>
    (window as unknown as { __strategicFitControlledTerminations: number })
      .__strategicFitControlledTerminations,
  )).toBe(1);
  expect(await page.evaluate(() =>
    ((window as unknown as { __strategicFitControlledMessages: Array<{ type?: string }> })
      .__strategicFitControlledMessages ?? []).some((message) => message.type === "cancel"),
  )).toBe(true);
});

test("worker failure is explicit and retry executes a fresh current-color snapshot", async ({ page }) => {
  await bootstrap(page, "fail-first");
  await loadExplicitProfile(page);
  const dialog = await openWorkspace(page);

  await dialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(dialog.locator("[data-analysis-state='failed']")).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("Synthetic worker failure");
  expect(await chess(page, (api) => api.strategicFitLifecycle().current_result)).toBeNull();

  await chess(page, (api) => api.setColor("black"));
  await dialog.getByRole("button", { name: "Retry analysis" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({ timeout: 15_000 });
  const retried = await chess(page, (api) => api.strategicFitLifecycle());
  expect(retried.request_snapshot?.repertoire_color).toBe("black");
  expect(retried.current_result?.report_id).toBeTruthy();
});

test("offline opening data completes as native degraded evidence rather than a fabricated verdict", async ({ page }) => {
  await page.route("**/openings.tsv", (route) => route.abort());
  await bootstrap(page);
  await loadExplicitProfile(page);
  const dialog = await openWorkspace(page);

  await dialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({ timeout: 15_000 });
  const lifecycle = await chess(page, (api) => api.strategicFitLifecycle());
  expect(lifecycle.current_result?.result.preflight.state).toBe("degraded");
  expect(lifecycle.current_result?.result.preflight.issues.map((issue) => issue.code))
    .toContain("missing-opening-classification");
  await expect(dialog.getByText(/consistent/i)).toHaveCount(0);
});
