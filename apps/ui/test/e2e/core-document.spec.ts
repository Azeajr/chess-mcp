import { expect, test } from "playwright/test";
import { currentPgn, openApp } from "./helpers/app";

test.fixme("UX-005 mutation application, undo, and redo preserve exact PGN", async ({ page }) => {
  await openApp(page);
  const original = await currentPgn(page);
  const mutation = await page.evaluate(() => {
    const chess = (
      window as unknown as {
        __chess: {
          applyEdit(
            action: "add",
            path: string[],
            options: { addMoves: string[] },
          ): { ok: boolean };
        };
      }
    ).__chess;
    return chess.applyEdit("add", ["d4", "Nf6"], { addMoves: ["Nf3"] });
  });
  expect(mutation).toEqual({ ok: true });
  const mutated = await currentPgn(page);
  expect(mutated).not.toBe(original);

  await page.keyboard.press("Control+z");
  expect(await currentPgn(page)).toBe(original);
  await page.keyboard.press("Control+Shift+z");
  expect(await currentPgn(page)).toBe(mutated);
});
