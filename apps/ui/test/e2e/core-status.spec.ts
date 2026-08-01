import { expect, test } from "playwright/test";
import { openApp } from "./helpers/app";
import { rawIdentifierViolations } from "./helpers/accessibility";

test.fixme("UX-012 every operation produces exactly one live-region announcement", async ({
  page,
}) => {
  await openApp(page);
  const liveRegions = page.locator("[role='status'], [role='alert'], [aria-live]");
  const before = await liveRegions.allTextContents();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const after = await liveRegions.allTextContents();
  expect(after.filter((message, index) => message !== before[index]).length).toBe(1);
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
