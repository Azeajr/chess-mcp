import { expect, test } from "playwright/test";
import { currentPgn, openApp } from "./helpers/app";

test.fixme("UX-005 mutation application, undo, and redo preserve exact PGN", async ({ page }) => {
  await openApp(page);
  const before = await currentPgn(page);
  await page.keyboard.press("Control+z");
  expect(await currentPgn(page)).toBe(before);
  await page.keyboard.press("Control+Shift+z");
  expect(await currentPgn(page)).toBe(before);
});
