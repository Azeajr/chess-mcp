import { expect, test, type Page } from "./helpers/fixtures";
import { openApp } from "./helpers/app";

// Found by the repertoire UX review on the phone profile: chessground's stock coordinates sit at
// fixed pixel offsets that only line up on squares wider than about 48px. On a 375px-wide phone
// every file letter was drawn on the next square ("A" on b1), H fell off the board, and the rank
// numbers rode 20px high so the 8 was clipped.

const PHONE = { width: 375, height: 629 };

type Box = { x: number; y: number; width: number; height: number };

const labelBoxes = (page: Page, kind: "ranks" | "files") =>
  page.locator(`.board-wrap .cg-wrap coords.${kind} coord`).evaluateAll((coords) =>
    coords.map((coord) => {
      const { x, y, width, height } = coord.getBoundingClientRect();
      return { label: coord.textContent ?? "", box: { x, y, width, height } };
    }),
  );

const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5;

for (const color of ["white", "black"] as const) {
  test(`${color}: every coordinate labels its own square on a phone-sized board`, async ({
    page,
  }) => {
    await openApp(page, { ...PHONE, color });
    const board = await page.locator(".board-wrap .cg-wrap cg-board").boundingBox();
    expect(board, "the board has a box").not.toBeNull();
    const square = board!.width / 8;
    expect(square, "the squares are phone-sized").toBeLessThan(48);

    const files = await labelBoxes(page, "files");
    expect(files.map(({ label }) => label).sort()).toEqual([..."abcdefgh"]);
    for (const { label, box } of files) {
      const index = "abcdefgh".indexOf(label);
      const column = color === "white" ? index : 7 - index;
      const bottomRank = {
        x: board!.x + column * square,
        y: board!.y + 7 * square,
        width: square,
        height: square,
      };
      expect(inside(box, bottomRank), `file ${label} sits on its own bottom-edge square`).toBe(
        true,
      );
    }

    const ranks = await labelBoxes(page, "ranks");
    expect(ranks.map(({ label }) => label).sort()).toEqual([..."12345678"]);
    for (const { label, box } of ranks) {
      const rank = Number(label);
      const row = color === "white" ? 8 - rank : rank - 1;
      const leftFile = { x: board!.x, y: board!.y + row * square, width: square, height: square };
      expect(inside(box, leftFile), `rank ${label} sits on its own left-edge square`).toBe(true);
    }
  });
}
