import { expect, test, type Page } from "./helpers/fixtures";
import { openApp } from "./helpers/app";

// Findings from the repertoire completion journey (docs/UX_REVIEW.md), run on the phone profile
// against apps/ui/test/fixtures/ux-review/rich-repertoire.pgn.

const PHONE = { width: 375, height: 629 };

const repertoirePanel = (page: Page) => page.locator(".rep-panel");

const section = (page: Page, label: string) =>
  page.locator("details.rep-section").filter({ has: page.getByText(label, { exact: true }) });

test("a scan opens the section its results land in", async ({ page }) => {
  await openApp(page, PHONE);

  // Connect, Shorten and Extend here called preventDefault on a button inside <summary>, which
  // stops the native toggle, and then never opened the section themselves: rows, errors and empty
  // states all rendered inside a drawer that stayed shut, so the press looked like a no-op.
  for (const [label, action] of [
    ["Gaps", "Scan"],
    ["Connect", "Scan"],
    ["Shorten", "Scan"],
    ["Extend here", "Suggest an extension"],
  ] as const) {
    const target = section(page, label).first();
    await target.evaluate((node: HTMLDetailsElement) => {
      node.open = false;
    });
    await target.getByRole("button", { name: action, exact: true }).click();
    await expect(target, `${label} opens when its scan starts`).toHaveAttribute("open", "");
  }
});

test("a failed command names the problem and keeps its code behind technical details", async ({
  page,
}) => {
  await openApp(page, PHONE);

  await page.evaluate(() => {
    (
      window as unknown as {
        __chess: {
          setCommandStateForTesting: (command: string, state: Record<string, unknown>) => void;
        };
      }
    ).__chess.setCommandStateForTesting("find_structures", {
      status: "failed",
      error: "missing_criteria",
      result: {
        error: "missing_criteria",
        reason: "provide at least one of structure/center/themes/color_complex",
      },
      completedAt: Date.now(),
    });
  });

  const alert = section(page, "Structure search").first().locator("[role=alert]");
  await expect(alert).toContainText("Search criteria required");
  await expect(alert).toContainText("Type a structure name");
  await expect(alert).not.toContainText("missing_criteria");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: /technical details/i }).check();
  await page.getByRole("button", { name: "Close settings" }).click();

  await expect(section(page, "Structure search").first()).toContainText("missing_criteria");
});

test("staging a line brings its Accept control into view", async ({ page }) => {
  await openApp(page, PHONE);

  // Suggestions are staged from rows near the bottom of the panel while the staged card sits at
  // the top of it: staging from Extend here put Accept line 532px above the viewport.
  const extend = section(page, "Extend here").first();
  await extend.scrollIntoViewIfNeeded();

  await page.evaluate(() => {
    (
      window as unknown as {
        __chess: { stagePreviewLine: (from: number[], sans: string[]) => { ok: boolean } };
      }
    ).__chess.stagePreviewLine([], ["e4"]);
  });

  const staged = page.locator(".rep-preview");
  await expect(staged).toBeVisible();
  const box = await staged.boundingBox();
  expect(box, "the staged card has a box").not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(PHONE.height);
  await expect(staged.getByRole("button", { name: "Accept line" })).toBeInViewport();
});

test("rows that share a move name the line they sit on", async ({ page }) => {
  await openApp(page, PHONE);

  // Two covered replies rendered as "d5 covered → Nf6" on the same scan and meant different
  // transpositions; two shortcuts rerouting at the same point rendered as the same row. The line
  // was in a `title`, which a touch device never shows.
  await page.evaluate(() => {
    const api = (
      window as unknown as {
        __chess: {
          setCoveredGapsForTesting: (next: unknown[]) => void;
          setPruneSuggestionsForTesting: (next: unknown[]) => void;
        };
      }
    ).__chess;
    api.setCoveredGapsForTesting([
      { path: [0, 0], uncoveredMove: "d5", joinsPath: ["d4", "d5", "Nf3", "Nf6"] },
      { path: [0], uncoveredMove: "d5", joinsPath: ["d4", "Nf6", "c4"] },
    ]);
    api.setPruneSuggestionsForTesting([
      {
        linePath: ["d4", "d5", "Nf3", "e6"],
        atPath: ["d4", "d5"],
        atPly: 2,
        rerouteMove: "c4",
        joinsPath: ["d4", "d5", "c4"],
        savedPlies: 4,
        evalBest: 30,
        evalStay: 25,
        evalTranspose: 10,
        evalDelta: 15,
        bestSavings: true,
        bestEval: false,
        evalConfirmed: false,
      },
      {
        linePath: ["d4", "d5", "Nf3", "Nf6"],
        atPath: ["d4", "d5"],
        atPly: 2,
        rerouteMove: "c4",
        joinsPath: ["d4", "d5", "c4"],
        savedPlies: 4,
        evalBest: 30,
        evalStay: 25,
        evalTranspose: 10,
        evalDelta: 15,
        bestSavings: false,
        bestEval: true,
        evalConfirmed: false,
      },
    ]);
  });

  const coveredRows = await repertoirePanel(page).locator(".covered").allTextContents();
  expect(coveredRows).toHaveLength(2);
  expect(coveredRows[0]).not.toBe(coveredRows[1]);
  expect(coveredRows[0]).toContain("1. d4");

  const shortcutRows = await repertoirePanel(page)
    .locator(".rep-row-action .san")
    .allTextContents();
  expect(shortcutRows).toHaveLength(2);
  expect(shortcutRows[0]).not.toBe(shortcutRows[1]);
});

test("opponent preparation says what was fetched, not just how many lines matched", async ({
  page,
}) => {
  await openApp(page, PHONE);

  // The payload carried games_total and games_matched_color; the section rendered only `lines`, so
  // an opponent whose games could not be fetched read exactly like one with no games in prep.
  await page.evaluate(() => {
    (
      window as unknown as {
        __chess: {
          setCommandStateForTesting: (command: string, state: Record<string, unknown>) => void;
        };
      }
    ).__chess.setCommandStateForTesting("prep_vs_opponent", {
      status: "succeeded",
      result: {
        username: "someone",
        opponent_color: "black",
        games_total: 0,
        games_matched_color: 0,
        coverage_pct: null,
        lines: [],
      },
      completedAt: Date.now(),
    });
  });

  const prep = section(page, "Opponent preparation").first();
  await prep.evaluate((node: HTMLDetailsElement) => {
    node.open = true;
  });
  await expect(prep).toContainText("No games fetched for someone");
});
