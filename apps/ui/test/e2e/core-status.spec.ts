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
  { scenario: "file-saved", message: /file.*saved/i },
  { scenario: "document-restored", message: /document.*restored/i },
  { scenario: "operation-started", message: /operation.*started/i },
  { scenario: "operation-completed", message: /operation.*\d+.*result/i },
  { scenario: "operation-cancelled", message: /operation.*cancelled/i },
  { scenario: "operation-failed", message: /operation.*failed/i },
  { scenario: "mutation-applied", message: /mutation.*applied/i },
  { scenario: "mutation-undone", message: /mutation.*undone/i },
  { scenario: "engine-offline", message: /engine.*offline/i },
];

test.fixme("UX-012 every required event produces exactly one live-region announcement", async ({
  page,
}) => {
  await openApp(page);
  const liveRegions = page.locator("[data-app-live-region]");
  for (const { scenario, message } of announcementScenarios) {
    const before = await liveRegions.allTextContents();
    await page.evaluate((event) => {
      const chess = (
        window as unknown as {
          __chess: { exerciseAnnouncementScenario(scenario: AnnouncementScenario): Promise<void> };
        }
      ).__chess;
      return chess.exerciseAnnouncementScenario(event);
    }, scenario);
    const changed = async () => {
      const after = await liveRegions.allTextContents();
      return after.filter((text, index) => text.trim() !== "" && text !== before[index]);
    };
    await expect.poll(changed).toHaveLength(1);
    expect((await changed())[0]).toMatch(message);
  }
});

test("WP-025 AC-1 AC-2 AC-3 chat and Strategic Fit never expose raw identifiers", async ({
  page,
}) => {
  await openApp(page);
  // An empty chat log cannot violate anything, so seed a real tool call and result first: the
  // chip, the result header, and the navigation rows are the three places a raw identifier
  // actually reaches the user.
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

  // AC-2: every navigation row reads as a chess description or an ordinal.
  const navLabels = await page.locator(".tool-result .result-nav").allTextContents();
  expect(navLabels.length).toBeGreaterThan(0);
  for (const label of navLabels) {
    expect(label).not.toMatch(/_/u);
  }

  // AC-3: the row still resolves to the same board position it did before relabelling.
  await page.locator(".tool-result .result-nav").last().click();
  await expect(page.locator(".move.current").first()).toContainText("Nf3");
  expect(await currentPath(page)).toEqual([0, 0, 0]);

  await page.getByRole("button", { name: "Open Strategic Fit" }).click();
  expect(
    await rawIdentifierViolations(page.getByRole("dialog", { name: "Strategic Fit" })),
  ).toEqual([]);
});

test.fixme("UX-011 a running Gaps scan remains visible after switching to Chat on a phone", async ({
  page,
}) => {
  await openApp(page, { width: 390, height: 844 });
  const gaps = page.locator("details.rep-section", { hasText: "Gaps" });
  await gaps.evaluate((element) => ((element as HTMLDetailsElement).open = true));
  await gaps.getByRole("button", { name: "Scan" }).click();
  await page.getByRole("button", { name: "Chat" }).click();
  await expect(page.getByText(/Gaps.*running|Running.*Gaps/i)).toBeVisible();
});
