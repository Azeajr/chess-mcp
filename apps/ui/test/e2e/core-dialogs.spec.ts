import { expect, test, type Locator, type Page } from "./helpers/fixtures";
import { currentPath, currentPgn, openApp } from "./helpers/app";
import { basicAccessibilityViolations } from "./helpers/accessibility";

type DialogFixture = {
  name: string;
  dialog: (page: Page) => Locator;
  first: (page: Page) => Locator;
  open: (page: Page) => Promise<Locator>;
  opener: (page: Page) => Locator;
};

const settings: DialogFixture = {
  name: "Settings",
  dialog: (page) => page.getByRole("dialog", { name: "Settings" }),
  first: (page) => page.getByRole("button", { name: "Close settings" }),
  opener: (page) => page.getByRole("button", { name: "Settings" }),
  open: async (page) => {
    const opener = page.getByRole("button", { name: "Settings" });
    await opener.focus();
    await opener.click();
    return page.getByRole("dialog", { name: "Settings" });
  },
};

const colorPicker: DialogFixture = {
  name: "Colour picker",
  dialog: (page) => page.getByRole("dialog", { name: "Which color is this repertoire for?" }),
  first: (page) => page.getByRole("button", { name: "White" }),
  opener: (page) => page.getByRole("button", { name: "Open PGN" }),
  open: async (page) => {
    await page.evaluate(() =>
      Object.defineProperty(window, "showOpenFilePicker", {
        configurable: true,
        value: async () => [
          {
            name: "candidate.pgn",
            getFile: async () => new File(["1. d4 d5 *"], "candidate.pgn"),
          },
        ],
      }),
    );
    const opener = page.getByRole("button", { name: "Open PGN" });
    await opener.focus();
    await opener.click();
    await page
      .getByRole("dialog", { name: "Replace current repertoire?" })
      .getByRole("button", { name: "Continue" })
      .click();
    return page.getByRole("dialog", { name: "Which color is this repertoire for?" });
  },
};

const promotion: DialogFixture = {
  name: "Promotion",
  dialog: (page) => page.getByRole("dialog", { name: "Promote pawn — dismiss to cancel the move" }),
  first: (page) => page.getByRole("button", { name: "Promote to queen" }),
  opener: (page) => page.getByRole("button", { name: "New" }),
  open: async (page) => {
    const opener = page.getByRole("button", { name: "New" });
    await opener.focus();
    await page.evaluate(async () => {
      const { setPendingPromo } = await import("/src/store/promotion.ts");
      setPendingPromo({ orig: "a7", dest: "a8", color: "white" });
    });
    return page.getByRole("dialog", { name: "Promote pawn — dismiss to cancel the move" });
  },
};

async function focusables(dialog: Locator): Promise<Locator[]> {
  return dialog
    .locator(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
    )
    .all();
}

test("WP-007 AC-1 AC-2 AC-4 AC-8 every overlay traps focus, restores it, and blocks board navigation", async ({
  page,
}) => {
  for (const fixture of [settings, colorPicker, promotion]) {
    await openApp(page);
    const dialog = await fixture.open(page);
    await expect(dialog, fixture.name).toBeVisible();
    await expect(fixture.first(page), fixture.name).toBeFocused();
    await expect(page.locator(".app-main")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".app-main")).toHaveJSProperty("inert", true);
    expect(await basicAccessibilityViolations(dialog), fixture.name).toEqual([]);

    const beforePath = await currentPath(page);
    const beforePgn = await currentPgn(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Control+z");
    expect(await currentPath(page), fixture.name).toEqual(beforePath);
    expect(await currentPgn(page), fixture.name).toEqual(beforePgn);

    const candidates = await focusables(dialog);
    const first = candidates[0]!;
    const last = candidates.at(-1)!;
    await first.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(last, fixture.name).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(first, fixture.name).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog, fixture.name).toHaveCount(0);
    await expect(fixture.opener(page), fixture.name).toBeFocused();
    await expect(page.locator(".app-main")).not.toHaveAttribute("aria-hidden", "true");
  }
});

test("WP-007 AC-3 saves from the chat editor without clearing it", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const saves: string[] = [];
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => ({
        name: "saved.pgn",
        createWritable: async () => ({
          write: async (pgn: string) => saves.push(pgn),
          close: async () => undefined,
        }),
      }),
    });
    (window as unknown as { __wp007Saves: string[] }).__wp007Saves = saves;
  });
  const input = page.getByRole("textbox", { name: "Chat message" });
  await input.fill("Keep this draft");
  await input.press("Control+s");
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __wp007Saves: string[] }).__wp007Saves.length),
    )
    .toBe(1);
  await expect(input).toHaveValue("Keep this draft");
});

test("WP-007 AC-5 AC-6 keeps file loading explicit and cancels promotion on backdrop dismissal", async ({
  page,
}) => {
  await openApp(page);
  const colorDialog = await colorPicker.open(page);
  await page.locator(".ui-dialog-backdrop").click({ position: { x: 5, y: 5 } });
  await expect(colorDialog).toBeVisible();
  await colorDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(colorDialog).toHaveCount(0);

  const promotionDialog = await promotion.open(page);
  await page.locator(".ui-dialog-backdrop").click({ position: { x: 5, y: 5 } });
  await expect(promotionDialog).toHaveCount(0);
});
