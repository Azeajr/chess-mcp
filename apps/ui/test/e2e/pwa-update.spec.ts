import { expect, test, type Page } from "playwright/test";
import { openApp } from "./helpers/app";

type PwaHarness = {
  simulatePwaUpdate(): void;
  resetPwaUpdateForTesting(): void;
  startPwaBlockingOperationForTesting(): void;
  settlePwaBlockingOperationForTesting(): void;
  pwaUpdateSnapshotForTesting(): {
    pending: boolean;
    visible: boolean;
    runningOperations: number;
    reloadRequested: boolean;
  };
  resetAnnouncementsForTesting(): Promise<void>;
  announcementLogForTesting(): Promise<string[]>;
};

const pwa = <T>(page: Page, callback: (api: PwaHarness) => T) =>
  page.evaluate((source) => {
    const api = (window as unknown as { __chess: PwaHarness }).__chess;
    return Function("api", `return (${source})(api)`)(api) as T;
  }, callback.toString());

const toast = (page: Page) => page.locator(".ui-toast", { hasText: "A new version is ready." });

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await pwa(page, async (api) => {
    api.resetPwaUpdateForTesting();
    await api.resetAnnouncementsForTesting();
  });
});

test("WP-019 AC-1 a waiting update offers Reload and Later without activating itself", async ({
  page,
}) => {
  await pwa(page, (api) => api.simulatePwaUpdate());

  await expect(toast(page)).toBeVisible();
  await expect(toast(page).getByRole("button", { name: "Reload" })).toBeVisible();
  await expect(toast(page).getByRole("button", { name: "Later" })).toBeVisible();

  expect(await pwa(page, (api) => api.pwaUpdateSnapshotForTesting())).toMatchObject({
    pending: true,
    visible: true,
    reloadRequested: false,
  });

  await Promise.all([
    page.waitForEvent("framenavigated"),
    toast(page).getByRole("button", { name: "Reload" }).click(),
  ]);
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __chess?: PwaHarness }).__chess),
  );
  expect(await pwa(page, (api) => api.pwaUpdateSnapshotForTesting())).toMatchObject({
    pending: false,
    reloadRequested: true,
  });
});

test("WP-019 AC-2 the prompt waits for the last running operation to settle", async ({ page }) => {
  await pwa(page, (api) => {
    api.startPwaBlockingOperationForTesting();
    api.simulatePwaUpdate();
  });

  await expect(toast(page)).toHaveCount(0);
  expect(await pwa(page, (api) => api.pwaUpdateSnapshotForTesting())).toMatchObject({
    pending: true,
    visible: false,
    runningOperations: 1,
  });

  await pwa(page, (api) => api.settlePwaBlockingOperationForTesting());
  await expect(toast(page)).toBeVisible();
});

test("WP-019 AC-3 Later dismisses this page but a still-pending update returns on reload", async ({
  page,
}) => {
  await pwa(page, (api) => api.simulatePwaUpdate());
  await toast(page).getByRole("button", { name: "Later" }).click();
  await expect(toast(page)).toHaveCount(0);

  expect(await pwa(page, (api) => api.pwaUpdateSnapshotForTesting())).toMatchObject({
    pending: true,
    visible: false,
    reloadRequested: false,
  });

  await page.reload();
  await expect(toast(page)).toBeVisible();
});

test("WP-019 AC-5 the update message enters the polite announcement history once", async ({
  page,
}) => {
  await pwa(page, (api) => api.simulatePwaUpdate());
  await expect(toast(page)).toBeVisible();

  const messages = await pwa(page, (api) => api.announcementLogForTesting());
  expect(messages.filter((message) => message === "A new version is ready.")).toHaveLength(1);
});
