import { expect, test } from "playwright/test";
import { openApp } from "./helpers/app";

/**
 * WP-021 — the chat setup card while the assistant is unconfigured.
 *
 * PD-4 fixed the approach: the column keeps its persisted width and the terse `No API key` line is
 * replaced by a setup card. AC-1 and AC-5 were rewritten from their pre-gate rail wording, so these
 * assertions are the authority on the intended behaviour.
 *
 * `openApp` leaves localStorage empty, so the app starts unconfigured in every test here. That
 * premise is also why AC-1 seeds the persisted width explicitly rather than reading it back: with
 * an empty store `Number(null)` is `0`, so a "read it and compare if it looks set" guard can never
 * run its assertion.
 */

const CHAT_WIDTH_KEY = "chess.layout.chat";
/** Distinct from the store's own CHAT_DEFAULT (360) so a lost persisted value cannot pass. */
const SEEDED_CHAT_WIDTH = 420;

const setupCard = (page: import("playwright/test").Page) => page.locator("[data-chat-setup-card]");
const chatWrap = (page: import("playwright/test").Page) => page.locator(".chat-wrap");

/** The column's rendered width, which AC-1 and AC-3 both compare against the persisted value. */
const chatWidth = (page: import("playwright/test").Page) =>
  chatWrap(page).evaluate((element) => element.getBoundingClientRect().width);

test("WP-021 AC-1 an unconfigured assistant keeps the column width and shows the setup card", async ({
  page,
}) => {
  await openApp(page, { width: 1440, height: 900 });

  // The card stands in for the chat surface...
  const card = setupCard(page);
  await expect(card).toBeVisible();
  await expect(card).toContainText("Set up the assistant");
  await expect(card).toContainText(/assistant answers questions/i);

  // ...and the terse line it replaced is gone.
  await expect(page.locator(".chat").getByText("No API key.")).toHaveCount(0);

  // The column is at its persisted width, not a collapsed rail. Seeding a known value before the
  // app boots is what makes this a real assertion: the width is compared unconditionally against a
  // number the store did not choose, so a regression that ignored persistence and fell back to
  // CHAT_DEFAULT would fail here.
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    CHAT_WIDTH_KEY,
    String(SEEDED_CHAT_WIDTH),
  ] as const);
  await page.reload();
  await expect(setupCard(page)).toBeVisible();
  expect(Math.round(await chatWidth(page))).toBe(SEEDED_CHAT_WIDTH);

  // Whatever the source, it is a full column and emphatically not the <= 56px rail PD-4 rejected.
  expect(await chatWidth(page)).toBeGreaterThan(200);
});

test("WP-021 AC-2 the setup control is keyboard reachable and focuses the API-key field", async ({
  page,
}) => {
  await openApp(page, { width: 1440, height: 900 });

  const action = setupCard(page).getByRole("button", { name: "Set up the assistant" });
  await expect(action).toBeVisible();

  // Keyboard reachable with an accessible name: focus it directly and activate with the keyboard,
  // which fails if the control is not a real focusable button.
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

  // Configure the assistant through the store, the same path Settings uses.
  await page.evaluate(() => {
    (window as unknown as { __chess: { setApiKey: (v: string) => void } }).__chess.setApiKey(
      "sk-or-wp021-test",
    );
  });

  // The card yields to the live chat surface...
  await expect(setupCard(page)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeVisible();

  // ...at exactly the same width, and the persisted value was never rewritten.
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

  // PD-4 keeps the column at full width, so there is no collapsed state and the divider must
  // remain a working control rather than being disabled.
  const divider = page.getByRole("separator", { name: "Resize the analysis and chat panels" });
  await expect(divider).toBeVisible();

  await divider.focus();
  await expect(divider).toBeFocused();

  const storedBefore = await page.evaluate((key) => localStorage.getItem(key), CHAT_WIDTH_KEY);
  const before = await chatWidth(page);

  // Driving it from the keyboard proves it is not inert. The exact delta is the divider's own
  // contract, so this asserts movement rather than a magnitude.
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => Math.round(await chatWidth(page))).not.toBe(Math.round(before));

  // The unconfigured state itself never wrote the persisted width; only this deliberate resize
  // did. Both halves are asserted directly — the old `storedBefore === null || storedAfter !== null`
  // was the constant `true` given the empty-storage premise, so AC-5's actual claim went untested.
  expect(storedBefore, "merely opening the app unconfigured must not persist a width").toBeNull();
  const storedAfter = await page.evaluate((key) => localStorage.getItem(key), CHAT_WIDTH_KEY);
  expect(storedAfter, "the deliberate resize persists the new width").not.toBeNull();
  expect(Number(storedAfter)).toBe(Math.round(await chatWidth(page)));
});
