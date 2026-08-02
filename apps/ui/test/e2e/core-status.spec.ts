import { expect, test } from "playwright/test";
import { openApp } from "./helpers/app";
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

test.fixme("UX-015 UX-016 chat and Strategic Fit never expose raw identifiers", async ({
  page,
}) => {
  await openApp(page);
  expect(await rawIdentifierViolations(page.locator(".chat-wrap"))).toEqual([]);
  await page.getByRole("button", { name: "Open workspace" }).click();
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
