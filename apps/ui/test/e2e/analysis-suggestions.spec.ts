import { expect, test, type Page } from "playwright/test";
import { openApp } from "./helpers/app";

type ChessHarness = {
  addSuggestion(sans: string[], comment?: string, sourceMessageIndex?: number): unknown;
  appendUserMessageForTesting?(text: string): void;
  goto(path: number[]): void;
  currentPath(): number[];
};

const chess = <T>(page: Page, fn: (api: ChessHarness, arg: T) => unknown, arg?: T) =>
  page.evaluate(
    ({ source, arg }) =>
      Function(
        "api",
        "arg",
        `return (${source})(api, arg)`,
      )((window as unknown as { __chess: ChessHarness }).__chess, arg),
    { source: fn.toString(), arg },
  );

test("WP-028 AC-1 AC-3 the showing marker follows the card that navigated and clears otherwise", async ({
  page,
}) => {
  await openApp(page);

  await chess(page, (api) => {
    api.addSuggestion(["d4", "d5"], "first idea");
    api.addSuggestion(["d4", "Nf6"], "second idea");
  });

  const cards = page.locator(".suggestion");
  await expect(cards).toHaveCount(2);
  await expect(page.locator("[data-showing-on-board]")).toHaveCount(0);

  const first = cards.nth(0);
  await first.getByRole("button", { name: "Go to line" }).click();
  await expect(first.locator("[data-showing-on-board]")).toBeVisible();
  await expect(page.locator("[data-showing-on-board]")).toHaveCount(1);

  const second = cards.nth(1);
  await second.getByRole("button", { name: "Go to line" }).click();
  await expect(second.locator("[data-showing-on-board]")).toBeVisible();
  await expect(page.locator("[data-showing-on-board]")).toHaveCount(1);
  await expect(first.locator("[data-showing-on-board]")).toHaveCount(0);

  await chess(page, (api) => api.goto([]));
  await expect(page.locator("[data-showing-on-board]")).toHaveCount(0);
});

test("WP-028 AC-3 keyboard navigation clears the showing marker", async ({ page }) => {
  await openApp(page);
  await chess(page, (api) => {
    api.addSuggestion(["d4", "d5"], "arrow-key fixture");
  });

  await page.locator(".suggestion").first().getByRole("button", { name: "Go to line" }).click();
  await expect(page.locator("[data-showing-on-board]")).toHaveCount(1);

  await page
    .locator(".board-wrap")
    .first()
    .click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("[data-showing-on-board]")).toHaveCount(0);
});

test("WP-028 AC-2 the source link scrolls to and focuses the originating message", async ({
  page,
}) => {
  await openApp(page);

  const index = await page.evaluate(() => {
    const api = (
      window as unknown as {
        __chess: {
          appendUserMessageForTesting: (text: string) => number;
          addSuggestion: (sans: string[], comment?: string, index?: number) => unknown;
        };
      }
    ).__chess;
    const messageIndex = api.appendUserMessageForTesting("what should I play here?");
    api.addSuggestion(["d4", "d5"], "linked idea", messageIndex);
    return messageIndex;
  });

  const link = page.locator("[data-suggestion-source]");
  await expect(link).toHaveCount(1);
  await link.click();

  const focusedId = await page.evaluate(() => document.activeElement?.id ?? "");
  expect(focusedId).toBe(`chat-message-${index}`);
});
