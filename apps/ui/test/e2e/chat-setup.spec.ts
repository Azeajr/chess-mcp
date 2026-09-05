import { expect, test } from "./helpers/fixtures";
import { openApp } from "./helpers/app";

const CHAT_WIDTH_KEY = "chess.layout.chat";
const SEEDED_CHAT_WIDTH = 420;

const setupCard = (page: import("playwright/test").Page) => page.locator("[data-chat-setup-card]");
const chatWrap = (page: import("playwright/test").Page) => page.locator(".chat-wrap");

const chatWidth = (page: import("playwright/test").Page) =>
  chatWrap(page).evaluate((element) => element.getBoundingClientRect().width);

test("WP-021 AC-1 an unconfigured assistant keeps the column width and shows the setup card", async ({
  page,
}) => {
  await openApp(page, { width: 1440, height: 900 });

  const card = setupCard(page);
  await expect(card).toBeVisible();
  await expect(card).toContainText("Set up the assistant");
  await expect(card).toContainText(/assistant answers questions/i);

  await expect(page.locator(".chat").getByText("No API key.")).toHaveCount(0);

  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    CHAT_WIDTH_KEY,
    String(SEEDED_CHAT_WIDTH),
  ] as const);
  await page.reload();
  await expect(setupCard(page)).toBeVisible();
  expect(Math.round(await chatWidth(page))).toBe(SEEDED_CHAT_WIDTH);

  expect(await chatWidth(page)).toBeGreaterThan(200);
});

test("WP-021 AC-2 the setup control is keyboard reachable and focuses the API-key field", async ({
  page,
}) => {
  await openApp(page, { width: 1440, height: 900 });

  const action = setupCard(page).getByRole("button", { name: "Set up the assistant" });
  await expect(action).toBeVisible();

  await action.focus();
  await expect(action).toBeFocused();
  await page.keyboard.press("Enter");

  const apiKeyField = page.locator("input[data-settings-field='api-key']");
  await expect(apiKeyField).toBeVisible();
  await expect(apiKeyField).toBeFocused();
});

test("WP-021 AC-3 adding a key swaps the card for chat and leaves the width untouched", async ({
  page,
}) => {
  await openApp(page, { width: 1440, height: 900 });

  const before = await chatWidth(page);
  const storedBefore = await page.evaluate((key) => localStorage.getItem(key), CHAT_WIDTH_KEY);
  await expect(setupCard(page)).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as { __chess: { setApiKey: (v: string) => void } }).__chess.setApiKey(
      "sk-or-wp021-test",
    );
  });

  await expect(setupCard(page)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeVisible();

  expect(Math.round(await chatWidth(page))).toBe(Math.round(before));
  expect(await page.evaluate((key) => localStorage.getItem(key), CHAT_WIDTH_KEY)).toBe(
    storedBefore,
  );
});

test("WP-021 AC-4 the phone Chat tab is present and shows the setup card", async ({ page }) => {
  await openApp(page, { width: 390, height: 844 });

  const chatTab = page.getByRole("tab", { name: "Chat" });
  await expect(chatTab).toBeVisible();
  await chatTab.click();

  await expect(setupCard(page)).toBeVisible();
  await expect(setupCard(page).getByRole("button", { name: "Set up the assistant" })).toBeVisible();
});

test("WP-021 AC-5 the side-chat divider stays operable while unconfigured", async ({ page }) => {
  await openApp(page, { width: 1440, height: 900 });
  await expect(setupCard(page)).toBeVisible();

  const divider = page.getByRole("separator", { name: "Resize the analysis and chat panels" });
  await expect(divider).toBeVisible();

  await divider.focus();
  await expect(divider).toBeFocused();

  const storedBefore = await page.evaluate((key) => localStorage.getItem(key), CHAT_WIDTH_KEY);
  const before = await chatWidth(page);

  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => Math.round(await chatWidth(page))).not.toBe(Math.round(before));

  expect(storedBefore, "merely opening the app unconfigured must not persist a width").toBeNull();
  const storedAfter = await page.evaluate((key) => localStorage.getItem(key), CHAT_WIDTH_KEY);
  expect(storedAfter, "the deliberate resize persists the new width").not.toBeNull();
  expect(Number(storedAfter)).toBe(Math.round(await chatWidth(page)));
});
