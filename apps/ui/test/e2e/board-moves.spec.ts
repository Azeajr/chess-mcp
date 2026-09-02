/**
 * Moves played on the main board with real pointer input, through `helpers/board.ts`.
 *
 * The plain drag and click gestures are covered next door as WP-014 AC-7, which exists to prove the
 * keyboard layer does not disturb them. What is here is the rest of the board's move handling: a
 * promotion, which is the one path where chessground hands the move to the app *unfinished* and the
 * app has to finish it, and a refusal, which is the path where the board must do nothing at all.
 */
import { expect, test } from "playwright/test";
import { currentPath, currentPgn, goToPath, openApp } from "./helpers/app";
import { destinationSquares, dragMove, pieceAt, selectSquare } from "./helpers/board";

const board = (page: Parameters<typeof openApp>[0]) => page.locator(".board-wrap .cg-wrap");

/**
 * A short, fully legal line leaving a white pawn on h7 able to capture the still-home g8 knight, so
 * the promotion is reached by real replayable SAN moves — the UI's `GameTree` rejects a FEN-setup
 * header, so a position cannot simply be declared. `core-keyboard.spec.ts` reaches its own
 * promotion the same way.
 */
const PROMOTION_PGN = "1. e4 f5 2. exf5 g6 3. fxg6 d5 4. gxh7 Nc6 *";
const PROMOTION_PATH = [0, 0, 0, 0, 0, 0, 0, 0];

test("a dragged promotion opens the picker instead of auto-queening, and plays the piece chosen", async ({
  page,
}) => {
  await openApp(page, { pgn: PROMOTION_PGN });
  await goToPath(page, PROMOTION_PATH);

  await dragMove(board(page), "h7", "g8");

  // Chessground has already reported the move; the app must hold it back until the piece is chosen.
  const dialog = page.getByRole("dialog", { name: /Promote pawn/u });
  await expect(dialog).toBeVisible();
  expect(await currentPath(page)).toEqual(PROMOTION_PATH);

  // A knight rather than a queen: an under-promotion is the choice a defaulting implementation
  // cannot accidentally get right.
  await page.getByRole("button", { name: "Promote to knight" }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(() => currentPath(page)).toEqual([...PROMOTION_PATH, 0]);
  expect(await currentPgn(page)).toContain("hxg8=N");
  await expect.poll(() => pieceAt(board(page), "g8")).toBe("white knight");
});

test("a drag to a square the piece cannot reach plays nothing", async ({ page }) => {
  await openApp(page, { pgn: "*" }); // a clean tree, so a played move would land at [0]
  await selectSquare(board(page), "e2");
  expect((await destinationSquares(board(page))).sort()).toEqual(["e3", "e4"]);

  await dragMove(board(page), "e2", "e5"); // one square further than the pawn can go
  await expect.poll(() => pieceAt(board(page), "e2")).toBe("white pawn");
  expect(await pieceAt(board(page), "e5")).toBeNull();

  // Then a legal move, which is what makes the refusal provable rather than merely not-yet-arrived:
  // chessground reports a move through a `setTimeout`, so an assertion taken straight after the
  // illegal drag would pass even if that drag were about to land. If it had landed, this move would
  // sit at [0, 0] — or be impossible, the pawn having left e2 — instead of at [0].
  await dragMove(board(page), "e2", "e4");
  await expect.poll(() => currentPath(page)).toEqual([0]);
  expect(await currentPgn(page)).toContain("1. e4");
});
