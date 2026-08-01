import { expect, test } from "playwright/test";
import { currentPgn, openApp } from "./helpers/app";
import { keyboardReachable } from "./helpers/accessibility";

test.fixme("UX-003 UX-004 board, move tree, and repertoire controls are keyboard reachable", async ({
  page,
}) => {
  await openApp(page);
  const app = page.locator(".app");
  expect(await keyboardReachable(app, ".cg-wrap")).toEqual([]);
  expect(await keyboardReachable(app, ".moves")).toEqual([]);
  expect(await keyboardReachable(app, ".rep-row")).toEqual([]);
});

test.fixme("UX-005 every document mutation round-trips through undo and redo", async ({ page }) => {
  await openApp(page);
  const before = await currentPgn(page);
  for (const action of ["add", "prune", "reorder"] as const) {
    await page.evaluate((kind) => {
      const api = (
        window as unknown as {
          __chess: {
            applyEdit(
              action: "add" | "prune" | "reorder",
              path: string[],
              options: { addMoves: string[] },
            ): unknown;
          };
        }
      ).__chess;
      api.applyEdit(kind, ["d4", "Nf6"], { addMoves: ["Nf3"] });
    }, action);
    const applied = await currentPgn(page);
    await page.keyboard.press("Control+z");
    expect(await currentPgn(page)).toBe(before);
    await page.keyboard.press("Control+Shift+z");
    expect(await currentPgn(page)).toBe(applied);
  }
});
