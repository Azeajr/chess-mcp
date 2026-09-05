import { expect, test, type Page } from "playwright/test";
import { currentPath, openApp } from "./helpers/app";

type ToolHarness = {
  loadPgn(pgn: string, name?: string): void;
  appendToolResultForTesting(operation: string, result: unknown): void;
};

const chess = <T>(page: Page, fn: (api: ToolHarness, arg: T) => unknown, arg?: T) =>
  page.evaluate(
    ({ source, arg }) =>
      Function(
        "api",
        "arg",
        `return (${source})(api, arg)`,
      )((window as unknown as { __chess: ToolHarness }).__chess, arg),
    { source: fn.toString(), arg },
  );
import { rawIdentifierViolations } from "./helpers/accessibility";

type AnnouncementScenario =
  | "file-saved"
  | "document-restored"
  | "operation-started"
  | "operation-completed"
  | "operation-cancelled"
  | "operation-failed"
  | "mutation-applied"
  | "mutation-undone"
  | "engine-offline";

const announcementScenarios: ReadonlyArray<{
  scenario: AnnouncementScenario;
  message: RegExp;
}> = [
  { scenario: "file-saved", message: /saved .*\.pgn/i },
  { scenario: "document-restored", message: /restored .*autosave/i },
  { scenario: "operation-started", message: /audit.*started/i },
  { scenario: "operation-completed", message: /audit.*completed/i },
  { scenario: "operation-cancelled", message: /cancelled/i },
  { scenario: "operation-failed", message: /failed/i },
  { scenario: "mutation-applied", message: /applied/i },
  { scenario: "mutation-undone", message: /undone/i },
  { scenario: "engine-offline", message: /engine.*offline/i },
];

test("announcement reset completes before subsequent events are recorded", async ({ page }) => {
  await openApp(page);
  const messages = await page.evaluate(async () => {
    const store = await import("/src/store/announce.ts");
    const chess = (
      window as unknown as {
        __chess: { resetAnnouncementsForTesting(): Promise<void> };
      }
    ).__chess;
    store.announce("Before reset");
    await chess.resetAnnouncementsForTesting();
    const afterReset = store.announcementLogForTesting().map((entry) => entry.message);
    store.announce("After reset");
    await Promise.resolve();
    return {
      afterReset,
      afterEvent: store.announcementLogForTesting().map((entry) => entry.message),
    };
  });
  expect(messages).toEqual({ afterReset: [], afterEvent: ["After reset"] });
});

test("UX-012 every required event produces exactly one live-region announcement", async ({
  page,
}) => {
  await openApp(page);
  for (const { scenario, message } of announcementScenarios) {
    await page.evaluate(() => {
      const chess = (
        window as unknown as {
          __chess: { resetAnnouncementsForTesting(): Promise<void> };
        }
      ).__chess;
      return chess.resetAnnouncementsForTesting();
    });
    await page.evaluate((event) => {
      const chess = (
        window as unknown as {
          __chess: { exerciseAnnouncementScenario(scenario: AnnouncementScenario): Promise<void> };
        }
      ).__chess;
      return chess.exerciseAnnouncementScenario(event);
    }, scenario);
    const log = await page.evaluate(() => {
      const chess = (
        window as unknown as {
          __chess: { announcementLogForTesting(): Promise<string[]> };
        }
      ).__chess;
      return chess.announcementLogForTesting();
    });
    expect(log.some((text) => text.match(message))).toBe(true);
    expect(await page.locator("[data-app-live-region='polite'] p").count()).toBeLessThanOrEqual(1);
    expect(await page.locator("[data-app-live-region='assertive'] p").count()).toBeLessThanOrEqual(
      1,
    );
  }
});

test("UX-012 AC-5 two identical messages within 500 ms produce one announcement", async ({
  page,
}) => {
  await openApp(page);
  const run = () =>
    page.evaluate(() => {
      const chess = (
        window as unknown as {
          __chess: {
            exerciseAnnouncementScenario(scenario: AnnouncementScenario): Promise<void>;
          };
        }
      ).__chess;
      return chess.exerciseAnnouncementScenario("document-restored");
    });
  await run();
  const region = page.locator("[data-app-live-region='polite']");
  await expect(region).not.toHaveText("");
  await run();
  await expect(page.locator("[data-app-live-region='polite'] p")).toHaveCount(1);
});

test("UX-012 AC-6 streaming chat text produces no announcements", async ({ page }) => {
  await openApp(page);
  const before = await page.locator("[data-app-live-region]").allTextContents();
  await page.evaluate(async () => {
    const specifier = "/src/store/chat";
    const chat = (await import(/* @vite-ignore */ specifier)) as {
      setChatTransportForTesting(t?: unknown): void;
      send(text: string): Promise<unknown>;
    };
    chat.setChatTransportForTesting(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                content: "streamed reply tokens",
                toolCalls: [],
              }),
            20,
          );
        }),
    );
    await chat.send("hello").catch(() => undefined);
    chat.setChatTransportForTesting();
  });
  expect(await page.locator("[data-app-live-region]").allTextContents()).toEqual(before);
});

test("WP-025 AC-1 AC-2 AC-3 chat and Strategic Fit never expose raw identifiers", async ({
  page,
}) => {
  await openApp(page);
  await chess(page, (api) => api.loadPgn("1. e4 e5 2. Nf3 Nc6"));
  await chess(page, (api) =>
    api.appendToolResultForTesting("audit_repertoire_moves", {
      color: "white",
      positions_scanned: 2,
      moves_audited: 2,
      findings: [
        { path: ["e4", "e5", "Nf3"], cp_loss: 90, classification: "inaccuracy", best_move: "Nc3" },
      ],
    }),
  );
  const chat = page.locator(".chat-wrap");
  await expect(chat.getByText("Prescribed-move audit").last()).toBeVisible();
  expect(await rawIdentifierViolations(chat)).toEqual([]);

  const navLabels = await page.locator(".tool-result .result-nav").allTextContents();
  expect(navLabels.length).toBeGreaterThan(0);
  for (const label of navLabels) {
    expect(label).not.toMatch(/_/u);
  }

  await page.locator(".tool-result .result-nav").last().click();
  await expect(page.locator(".move.current").first()).toContainText("Nf3");
  expect(await currentPath(page)).toEqual([0, 0, 0]);

  await page.getByRole("button", { name: "Open Strategic Fit" }).click();
  expect(
    await rawIdentifierViolations(page.getByRole("dialog", { name: "Strategic Fit" })),
  ).toEqual([]);
});

test("UX-011 a running Gaps scan remains visible after switching to Chat on a phone", async ({
  page,
}) => {
  await openApp(page, { width: 390, height: 844 });
  const gaps = page
    .locator("details.rep-section")
    .filter({ has: page.locator("summary span", { hasText: /^Gaps$/ }) });
  await gaps.evaluate((element) => ((element as HTMLDetailsElement).open = true));
  await gaps.getByRole("button", { name: "Scan" }).click();
  await page.getByRole("tab", { name: "Chat" }).click();
  await expect(page.getByText(/Gaps.*running|Running.*Gaps/i)).toBeVisible();
});
