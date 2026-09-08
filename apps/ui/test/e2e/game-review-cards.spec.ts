import { readFileSync } from "node:fs";
import { expect, test } from "./helpers/fixtures";
import { goToPath, openApp } from "./helpers/app";

type Page = import("playwright/test").Page;

// A real mainline, so the ply-indexed review rows resolve against an actual tree.
const GAME_PGN = readFileSync(
  new URL("../../../../sample-game.pgn", import.meta.url),
  "utf8",
).trim();

const move = (
  ply: number,
  color: "white" | "black",
  san: string,
  cpLoss: number,
  classification: string,
) => ({ ply, color, san, cp_loss: cpLoss, classification });

// The shapes gameSummaryResult and gameAnalysisResult return for this game.
const SUMMARY = {
  total_moves: 79,
  white: { blunders: 0, mistakes: 0, inaccuracies: 3, good_moves: 37, accuracy_pct: 95.8 },
  black: { blunders: 3, mistakes: 2, inaccuracies: 4, good_moves: 30, accuracy_pct: 89.2 },
  worst_moves: [
    move(78, "black", "Re6+", 293, "blunder"),
    move(76, "black", "Re7", 229, "blunder"),
    move(34, "black", "Rxf7", 226, "blunder"),
  ],
};

const ANALYSIS = {
  total_moves: 79,
  moves: [
    move(1, "white", "c4", 0, "good"),
    move(2, "black", "Nf6", 0, "good"),
    move(3, "white", "Nc3", 0, "good"),
    move(4, "black", "d5", 0, "good"),
    move(34, "black", "Rxf7", 226, "blunder"),
    move(28, "black", "Nb6", 105, "mistake"),
  ],
};

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

const pathLength = async (page: Page) =>
  (
    await page.evaluate(() =>
      (window as unknown as { __chess: { currentPath: () => number[] } }).__chess.currentPath(),
    )
  ).length;

const openGame = (page: Page, width: number, height: number) =>
  openApp(page, { width, height, pgn: GAME_PGN, fileName: "sample-game.pgn" });

test("a game summary card names each turning point and both sides' classifications", async ({
  page,
}) => {
  await openGame(page, 1280, 800);
  await appendResult(page, "get_game_summary", SUMMARY);

  const card = page.locator(".result-card").first();
  // Blunders alone hid two thirds of the per-side classification the review is meant to compare.
  await expect(card).toContainText("0 blunders · 0 mistakes · 3 inaccuracies");
  await expect(card).toContainText("3 blunders · 2 mistakes · 4 inaccuracies");

  // A bare ply number could not tell the reader which move a turning point was.
  const worst = card.getByRole("button").first();
  await expect(worst).toContainText("Blunder 1");
  await expect(worst).toContainText("39... Re6+");
  await expect(worst).toContainText("2.93");
});

test("a move-findings card ranks the flagged moves ahead of the opening", async ({ page }) => {
  await openGame(page, 1280, 800);
  await appendResult(page, "analyze_game", ANALYSIS);

  const card = page.locator(".result-card").first();
  await expect(card).toContainText("2 flagged moves");
  // The moves arrive in game order; unranked, the rows were the opening moves with nothing to say.
  const rows = card.getByRole("button");
  await expect(rows.first()).toContainText("Blunder 1");
  await expect(rows.first()).toContainText("17... Rxf7");
  await expect(rows.nth(1)).toContainText("Mistake 2");
});

test("a turning-point row navigates the board to that move", async ({ page }) => {
  await openGame(page, 1280, 800);
  await appendResult(page, "get_game_summary", SUMMARY);

  await page.locator(".result-card").first().getByRole("button").first().click();
  await expect.poll(() => pathLength(page)).toBe(78);
});

test("the current move stays visible in the current-line ribbon after a jump", async ({ page }) => {
  await openGame(page, 1280, 800);

  await goToPath(
    page,
    Array.from({ length: 78 }, () => 0),
  );

  // The ribbon renders the whole line, so without a reveal the current move sat thousands of
  // pixels to the right while the reader still saw move 1.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ribbon = document.querySelector(".current-line");
        const current = ribbon?.querySelector(".move.current");
        if (!ribbon || !current) return null;
        const view = ribbon.getBoundingClientRect();
        const box = current.getBoundingClientRect();
        return box.left >= view.left - 1 && box.right <= view.right + 1;
      }),
    )
    .toBe(true);
});

test("a completed review stays readable and clickable on a phone", async ({ page }) => {
  await openGame(page, 375, 629);
  await page.getByRole("tab", { name: "Chat" }).click();
  await appendResult(page, "get_game_summary", SUMMARY);

  const row = page.locator(".result-nav").first();

  // The conversation used to collapse to 0px, which clipped every card out of existence: the rows
  // laid out over the context chip, so they were neither readable nor the hit target.
  const layout = await page.evaluate(() => {
    const scroller = document.querySelector(".chat-scroll");
    const composer = document.querySelector(".chat-input");
    return {
      scrollerHeight: scroller?.clientHeight ?? 0,
      // The header shares the scroller so it stops charging the conversation permanent height.
      headerScrolls: Boolean(scroller?.querySelector(".panel-header, .panel-head")),
      composerFits: (composer?.getBoundingClientRect().bottom ?? Infinity) <= window.innerHeight,
    };
  });
  // 3rem is the floor the phone stylesheet guarantees; before the fix this was 0.
  expect(layout.scrollerHeight).toBeGreaterThanOrEqual(48);
  expect(layout.headerScrolls).toBe(true);
  expect(layout.composerFits, "the conversation must not push the composer off-screen").toBe(true);

  // The board stays on screen, so tapping a turning point does not cost a tab switch.
  await expect(page.locator(".board-wrap")).toBeVisible();
  await row.click();
  expect(await pathLength(page)).toBe(78);
});
