import { expect, test } from "playwright/test";
import { currentPath, currentPgn, goToPath, openApp } from "./helpers/app";
import { destinationSquares, dragMove, pieceAt, selectSquare } from "./helpers/board";

const board = (page: Parameters<typeof openApp>[0]) => page.locator(".board-wrap .cg-wrap");

const PROMOTION_PGN = "1. e4 f5 2. exf5 g6 3. fxg6 d5 4. gxh7 Nc6 *";
const PROMOTION_PATH = [0, 0, 0, 0, 0, 0, 0, 0];

test("a dragged promotion opens the picker instead of auto-queening, and plays the piece chosen", async ({
  page,
}) => {
  await openApp(page, { pgn: PROMOTION_PGN });
  await goToPath(page, PROMOTION_PATH);

  await dragMove(board(page), "h7", "g8");

  const dialog = page.getByRole("dialog", { name: /Promote pawn/u });
  await expect(dialog).toBeVisible();
  expect(await currentPath(page)).toEqual(PROMOTION_PATH);

  await page.getByRole("button", { name: "Promote to knight" }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(() => currentPath(page)).toEqual([...PROMOTION_PATH, 0]);
  expect(await currentPgn(page)).toContain("hxg8=N");
  await expect.poll(() => pieceAt(board(page), "g8")).toBe("white knight");
});

test("a drag to a square the piece cannot reach plays nothing", async ({ page }) => {
  await openApp(page, { pgn: "*" });
  await selectSquare(board(page), "e2");
  expect((await destinationSquares(board(page))).sort()).toEqual(["e3", "e4"]);

  await dragMove(board(page), "e2", "e5");
  await expect.poll(() => pieceAt(board(page), "e2")).toBe("white pawn");
  expect(await pieceAt(board(page), "e5")).toBeNull();

  await dragMove(board(page), "e2", "e4");
  await expect.poll(() => currentPath(page)).toEqual([0]);
  expect(await currentPgn(page)).toContain("1. e4");
});
