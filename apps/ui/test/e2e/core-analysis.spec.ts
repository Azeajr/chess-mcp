import { expect, test, type Page } from "playwright/test";
import { openApp } from "./helpers/app";

type EngineFixtureMode = "lines" | "empty" | "offline";

async function installEngineFixture(page: Page, mode: EngineFixtureMode) {
  await page.addInitScript((fixtureMode: EngineFixtureMode) => {
    const depths: number[] = [];
    const starts: string[] = [];
    const testWindow = window as Window & {
      __wp016Depths?: number[];
      __wp016EngineStarts?: string[];
    };
    Object.defineProperties(testWindow, {
      __wp016Depths: { value: depths },
      __wp016EngineStarts: { value: starts },
    });

    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args, newTarget) {
        const source = String(args[0]);
        if (!source.includes("stockfish-18-lite-single.js")) {
          return Reflect.construct(target, args, newTarget);
        }

        starts.push(source);
        const worker = {
          onmessage: null as ((event: MessageEvent<string>) => void) | null,
          onerror: null as ((event: ErrorEvent) => void) | null,
          postMessage(message: unknown) {
            const command = String(message);
            if (fixtureMode === "offline" && command === "uci") {
              queueMicrotask(() =>
                worker.onerror?.({ message: "Synthetic engine offline" } as ErrorEvent),
              );
              return;
            }
            if (!command.startsWith("go depth ")) return;

            const depth = Number(command.slice("go depth ".length));
            depths.push(depth);
            if (fixtureMode === "offline") return;
            queueMicrotask(() => {
              if (fixtureMode === "lines") {
                worker.onmessage?.({
                  data: `info depth ${depth} multipv 1 score cp 34 pv e2e4`,
                } as MessageEvent<string>);
              }
              worker.onmessage?.({ data: "bestmove e2e4" } as MessageEvent<string>);
            });
          },
          terminate() {},
        };
        return worker;
      },
    });
  }, mode);
}

const fixtureDepths = (page: Page) =>
  page.evaluate(() => [...((window as Window & { __wp016Depths?: number[] }).__wp016Depths ?? [])]);

const fixtureStarts = (page: Page) =>
  page.evaluate(() => [
    ...((window as Window & { __wp016EngineStarts?: string[] }).__wp016EngineStarts ?? []),
  ]);

const commandStatus = (page: Page, command: string) =>
  page.evaluate((name) => {
    const api = (
      window as unknown as {
        __chess: { commandStates(): Record<string, { status: string }> };
      }
    ).__chess;
    return api.commandStates()[name]?.status;
  }, command);

async function openEngineSettings(page: Page) {
  const settings = page.locator(".analysis-settings");
  await settings.locator("summary").click();
  await expect(settings).toHaveAttribute("open", "");
  return settings;
}

test("WP-016 AC-1 AC-2 AC-4 AC-6 AC-7 exposes honest engine states and controls", async ({
  page,
}) => {
  await installEngineFixture(page, "lines");
  await openApp(page, { width: 1280, height: 800 });

  const panel = page.locator(".analysis");
  await expect(panel.getByText("Engine evaluation is off.", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Evaluation unavailable — engine off" }),
  ).toBeVisible();
  await expect(panel.locator(".analysis-depth-chip")).toHaveText("Depth 20");
  await expect(page.locator(".topbar").getByLabel("Analysis depth")).toHaveCount(0);
  await expect(page.locator(".topbar").getByRole("button", { name: /eval/i })).toHaveCount(0);

  await panel.getByRole("button", { name: "Turn on evaluation" }).click();
  await expect(panel.getByText("Starting engine analysis…", { exact: true })).toBeVisible();
  await expect(panel.getByText("Engine evaluation is off.", { exact: true })).toHaveCount(0);
  await expect(panel.locator(".line")).toHaveCount(1, { timeout: 10_000 });
  await expect(
    page.getByRole("img", { name: "Evaluation: +0.34, white slightly better" }),
  ).toBeVisible();
  expect(await fixtureDepths(page)).toContain(20);
});

test("WP-016 AC-3 shows the offline recovery action and retries through the live worker", async ({
  page,
}) => {
  await installEngineFixture(page, "offline");
  await openApp(page);

  const panel = page.locator(".analysis");
  await panel.getByRole("button", { name: "Turn on evaluation" }).click();
  await expect(
    panel.getByText("Engine offline — arrows unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Evaluation unavailable — engine offline" }),
  ).toBeVisible();

  const startsBeforeReload = (await fixtureStarts(page)).length;
  await panel.getByRole("button", { name: "Reload engine" }).click();
  await expect
    .poll(async () => (await fixtureStarts(page)).length)
    .toBeGreaterThan(startsBeforeReload);
});

test("WP-016 AC-5 AC-9 keeps deep-analysis guidance inline and cloud privacy copy intact", async ({
  page,
}) => {
  await openApp(page, { width: 1280, height: 800 });

  const panel = page.locator(".analysis");
  const before = await panel.boundingBox();
  const settings = await openEngineSettings(page);
  const after = await panel.boundingBox();
  expect(after?.height).toBe(before?.height);

  const disclosure = await settings.locator(".analysis-settings-body").boundingBox();
  expect(disclosure?.x).toBeGreaterThanOrEqual((after?.x ?? 0) - 0.5);
  expect((disclosure?.x ?? 0) + (disclosure?.width ?? 0)).toBeLessThanOrEqual(
    (after?.x ?? 0) + (after?.width ?? 0) + 0.5,
  );

  const depth = settings.getByRole("spinbutton", { name: "Analysis depth" });
  await depth.fill("30");
  await expect(
    settings.getByText(
      "Deep analysis is enabled. Every engine task will use depth 30 and may take several minutes.",
      { exact: true },
    ),
  ).toBeVisible();
  await depth.fill("20");
  await expect(settings.getByText("Deep analysis is enabled.", { exact: false })).toHaveCount(0);
  await depth.fill("30");
  await expect(settings.getByText("Deep analysis is enabled.", { exact: false })).toBeVisible();
  await expect(page.locator(".topbar .analysis-notice")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dismiss deep analysis notice" })).toHaveCount(0);
  await expect(
    settings.getByText(
      "Sends each browsed position (FEN only) to Lichess for a cloud second opinion. Turn off to keep prep lines fully on this machine — local Stockfish is unaffected.",
      { exact: true },
    ),
  ).toBeVisible();
});

test("WP-016 AC-8 preserves the selected depth for direct engine commands", async ({ page }) => {
  await installEngineFixture(page, "empty");
  await openApp(page);

  const settings = await openEngineSettings(page);
  await settings.getByRole("spinbutton", { name: "Analysis depth" }).fill("23");
  await expect(page.locator(".analysis-depth-chip")).toHaveText("Depth 23");

  const audit = page.locator("details.rep-section", { hasText: "Prescribed-move audit" });
  await audit.locator("summary").click();
  await audit.getByRole("button", { name: "Audit" }).click();
  await expect.poll(() => commandStatus(page, "audit_repertoire_moves")).toBe("completed");

  const depths = await fixtureDepths(page);
  expect(depths.length).toBeGreaterThan(0);
  expect(depths.every((depth) => depth === 23)).toBe(true);
});
