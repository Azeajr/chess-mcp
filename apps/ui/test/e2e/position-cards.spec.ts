import { expect, test } from "./helpers/fixtures";
import { currentPath, currentPgn, goToPath, openApp } from "./helpers/app";
import { dragMove } from "./helpers/board";

type Page = import("playwright/test").Page;

const board = (page: Page) => page.locator(".board-wrap .cg-wrap");
const card = (page: Page) => page.locator(".result-card").last();

// 1. d4 d5 2. c4 c6 3. Nc3 Nf6 4. e3 e6 5. Nf3 Bd6 6. Bd3, Black to move.
const SEMI_SLAV = "1. d4 d5 2. c4 c6 3. Nc3 Nf6 4. e3 e6 5. Nf3 Bd6 6. Bd3 *";
const AT_BD3 = Array.from({ length: 11 }, () => 0);

const appendResult = (page: Page, op: string, payload: unknown) =>
  page.evaluate(
    ({ op, payload }) => {
      (
        window as unknown as {
          __chess: { appendToolResultForTesting: (op: string, payload: unknown) => void };
        }
      ).__chess.appendToolResultForTesting(op, payload);
    },
    { op, payload },
  );

const openPosition = async (page: Page) => {
  await openApp(page, { width: 1280, height: 900, pgn: SEMI_SLAV, fileName: "semi-slav.pgn" });
  await goToPath(page, AT_BD3);
};

test("an evaluation card names each line, its score and the point of view", async ({ page }) => {
  await openPosition(page);
  await appendResult(page, "evaluate_position", {
    fen: "rnbqk2r/pp3ppp/2pbpn2/3p4/2PP4/2NBPN2/PP3PPP/R1BQK2R b KQkq - 3 6",
    eval_pov: "white",
    eval_sign: "positive favors White; negative favors Black",
    lines: [
      { uci: "d5c4", san: "dxc4", cp: 36, mate: null, depth: 20 },
      { uci: "e8g8", san: "O-O", cp: 37, mate: null, depth: 20 },
    ],
  });

  // The card used to render the FEN alone, dropping every line the engine computed.
  await expect(card(page)).toContainText("Position evaluation");
  await expect(card(page)).toContainText("positive favors White");
  await expect(card(page)).toContainText("dxc4 +0.36");
  await expect(card(page)).toContainText("depth 20");
});

test("a comparison card ranks the candidates and shows White-POV scores", async ({ page }) => {
  await openPosition(page);
  await appendResult(page, "compare_moves", {
    fen: "rnbqk2r/pp3ppp/2pbpn2/3p4/2PP4/2NBPN2/PP3PPP/R1BQK2R b KQkq - 3 6",
    candidates: [
      { san: "dxc4", uci: "d5c4", eval_cp: 35, mate: null, mover_cp: -35, rank: 1 },
      { san: "O-O", uci: "e8h8", eval_cp: 48, mate: null, mover_cp: -48, rank: 2 },
    ],
  });

  await expect(card(page)).toContainText("Move comparison");
  await expect(card(page)).toContainText("1. dxc4 +0.35");
  await expect(card(page)).toContainText("2. O-O +0.48");
});

test("a rejected candidate is announced instead of passing as a result", async ({ page }) => {
  await openPosition(page);
  await appendResult(page, "compare_moves", {
    fen: "rnbqk2r/pp3ppp/2pbpn2/3p4/2PP4/2NBPN2/PP3PPP/R1BQK2R b KQkq - 3 6",
    candidates: [{ san: "Ra3", error: "illegal_move" }],
  });

  // The per-candidate error sits inside the array, where the top-level error check never looked,
  // so an illegal move used to render exactly like a successful comparison.
  const alert = card(page).getByRole("alert");
  await expect(alert).toContainText("Ra3");
  await expect(alert).toContainText("illegal move");
});

test("a validated line states its verdict, its moves and the position it reaches", async ({
  page,
}) => {
  await openPosition(page);
  await appendResult(page, "validate_line", {
    ok: true,
    canonical: ["dxc4", "Bxc4", "b5"],
    firstUci: "d5c4",
    finalFen: "rnbqk2r/p4ppp/2pbpn2/1p6/2BP4/2N1PN2/PP3PPP/R1BQK2R w KQkq - 0 8",
  });

  // This card used to render as an empty box: no verdict, no moves, and no child position.
  await expect(card(page)).toContainText("Line is legal");
  await expect(card(page)).toContainText("dxc4 Bxc4 b5");
  await expect(card(page)).toContainText("rnbqk2r/p4ppp/2pbpn2/1p6/2BP4/2N1PN2/PP3PPP/R1BQK2R");
});

test("a move played on the board can be undone and redone", async ({ page }) => {
  await openPosition(page);
  const before = await currentPgn(page);

  await dragMove(board(page), "d5", "c4");
  await expect.poll(() => currentPath(page).then((path) => path.length)).toBe(12);
  expect(await currentPgn(page)).not.toBe(before);

  // Every applyEdit path recorded a mutation and the board path did not, so undo was a no-op for
  // the one kind of change a person makes by hand.
  await page.keyboard.press("Control+z");
  await expect.poll(() => currentPgn(page)).toBe(before);
  expect((await currentPath(page)).length).toBe(11);

  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => currentPgn(page)).not.toBe(before);
});

test("walking into a move that already exists is navigation, not an undoable change", async ({
  page,
}) => {
  await openApp(page, {
    width: 1280,
    height: 900,
    pgn: "1. d4 d5 2. c4 *",
    fileName: "short.pgn",
  });
  const before = await currentPgn(page);

  // d4 is already the first move, so replaying it must not stack an empty undo entry.
  await dragMove(board(page), "d2", "d4");
  await expect.poll(() => currentPath(page).then((path) => path.length)).toBe(1);

  await page.keyboard.press("Control+z");
  await expect.poll(() => currentPgn(page)).toBe(before);
});
