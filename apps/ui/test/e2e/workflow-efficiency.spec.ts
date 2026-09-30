import { expect, test, type Page } from "./helpers/fixtures";
import { openApp, currentPgn, goToPath } from "./helpers/app";

async function fastEngine(page: Page) {
  await page.getByRole("button", { name: "Engine settings", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Analysis depth" }).fill("1");
  await page.getByRole("button", { name: "Close settings" }).click();
}

const command = (page: Page, name: string) =>
  page.evaluate((key) => {
    const api = (
      window as unknown as {
        __chess: {
          commandStates(): Record<string, { status: string; error?: string; result?: unknown }>;
        };
      }
    ).__chess;
    return api.commandStates()[key];
  }, name);

test("F1 game review and move comparison run without an assistant key", async ({ page }) => {
  await openApp(page, { pgn: "1. e4 e5 *" });
  await fastEngine(page);
  await page.getByRole("button", { name: "Review game", exact: true }).click();
  await expect.poll(async () => (await command(page, "analyze_game")).status).toBe("completed");
  await expect(page.locator(".direct-analysis")).toContainText("Game review · 2 moves");
  await page.getByText("Compare moves and position tools", { exact: true }).click();
  await page.getByRole("button", { name: "Compare moves", exact: true }).click();
  await expect.poll(async () => (await command(page, "compare_moves")).status).toBe("completed");
  expect((await command(page, "compare_moves")).error).toBeUndefined();
});

for (const platform of ["lichess", "chesscom"]) {
  test(`F1 ${platform} imports and history use the canonical arguments`, async ({ page }) => {
    const pgn = '[White "tester"]\n[Black "opponent"]\n[Result "1-0"]\n\n1. e4 e5 1-0';
    await page.route("https://lichess.org/api/games/user/**", (route) =>
      route.fulfill({ contentType: "application/x-chess-pgn", body: pgn }),
    );
    await page.route("https://api.chess.com/pub/player/**", (route) =>
      route.fulfill({ json: { games: [{ pgn }] } }),
    );
    await openApp(page, { pgn: "1. e4 e5 *" });
    await fastEngine(page);
    const before = await currentPgn(page);
    await page.getByText("Prepare · Import my games", { exact: true }).click();
    const panel = page.locator(".direct-analysis");
    await panel.getByLabel("Platform").selectOption(platform);
    await panel.getByLabel("Username", { exact: true }).fill("tester");
    await panel.getByRole("button", { name: "Import and review games" }).click();
    await expect.poll(async () => (await command(page, "batch_review")).status).toBe("completed");
    await panel.getByRole("button", { name: "Compare with my history" }).click();
    await expect
      .poll(async () => (await command(page, "repertoire_vs_history")).status)
      .toBe("completed");
    expect(await currentPgn(page)).toBe(before);
  });
}

test("F2/F3/F7/F8 explore engine moves without edits, keep, undo, redo and delete on screen", async ({
  page,
}) => {
  await openApp(page, { pgn: "1. d4 d5 *" });
  await fastEngine(page);
  const before = await currentPgn(page);
  await page.getByRole("button", { name: "Turn on evaluation", exact: true }).click();
  const line = page.locator(".analysis .line").first();
  await expect(line).toBeVisible();
  await line.getByRole("button", { name: /^Play / }).click();
  await expect(page.getByRole("button", { name: "Keep line", exact: true })).toBeVisible();
  expect(await currentPgn(page)).toBe(before);
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  expect(await currentPgn(page)).toBe(before);
  await page.reload();
  await expect(page.locator(".analysis .line").first()).toBeVisible();
  await expect(page.getByText("Engine evaluation is off.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Engine settings", exact: true }).click();
  await page.locator(".analysis-settings").getByRole("switch").uncheck();
  await page.getByRole("button", { name: "Close settings" }).click();
  await goToPath(page, [0]);
  await page.getByText("Current move actions", { exact: true }).click();
  await page.getByRole("button", { name: "Delete from here" }).click();
  expect(await currentPgn(page)).not.toBe(before);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await currentPgn(page)).toBe(before);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect(await currentPgn(page)).not.toBe(before);
});

test("F17/F19/F21 remembered inputs, off-turn explanation, and stale result rerun", async ({
  page,
}) => {
  await openApp(page, { pgn: "1. d4 d5 *" });
  const structure = page.locator("details.rep-section", { hasText: "Structure search" });
  await structure.locator("summary").click();
  await page.getByLabel("Structure name").fill("Kings Indian");
  await structure.getByRole("button", { name: "Search", exact: true }).click();
  await expect.poll(async () => (await command(page, "find_structures")).status).toBe("completed");
  await page.getByLabel("Repertoire colour").selectOption("black");
  await expect(structure).toContainText("Out of date");
  await structure.getByRole("button", { name: "Re-run", exact: true }).click();
  await expect(structure).not.toContainText("Out of date");
  await page.getByRole("button", { name: "Suggest an extension" }).click();
  await expect(page.locator("details.rep-section", { hasText: "Extend here" })).toContainText(
    "Navigate to your move",
  );
  await page.reload();
  await structure.locator("summary").click();
  await expect(page.getByLabel("Structure name")).toHaveValue("Kings Indian");
});

test("F9/F10/F26 first setup starts analysis and informational lines stay out of the review count", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("button", { name: "Open Strategic Fit" }).click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit", exact: true });
  await dialog.getByRole("button", { name: "Use Balanced profile" }).click();
  await expect(dialog.locator('[data-analysis-state="completed"]')).toBeVisible({
    timeout: 20_000,
  });
  await dialog.locator("#strategic-fit-stage-findings").click();
  await expect(dialog.locator("[data-finding-id]")).toHaveCount(0);
  const checklist = dialog.locator(".strategic-fit-evidence-checklist");
  await expect(checklist).toContainText("9 lines need more evidence");
  await checklist.locator("summary").click();
  await checklist.getByRole("button", { name: "Review evidence" }).first().click();
  await dialog.getByRole("button", { name: "Show on repertoire board" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Back to Strategic Fit" }).click();
  await expect(dialog.locator(".strategic-fit-workspace-body")).toHaveAttribute(
    "data-stage",
    "evidence",
  );
});

test("F5/F24/F25 White gaps retain playable replies, accept in place, and continue the original sweep", async ({
  page,
}) => {
  await openApp(page, { width: 390, height: 844 });
  await fastEngine(page);
  const section = page.locator("details.rep-section", {
    has: page.locator("summary > span", { hasText: /^Gaps$/ }),
  });
  await section.locator("summary").click();
  await section.getByRole("button", { name: "Scan", exact: true }).click();
  await expect(section.getByRole("button", { name: "Scan next 12" })).toBeVisible({
    timeout: 20_000,
  });
  const fills = section.getByRole("button", { name: "Add best fill", exact: true });
  await expect(fills.first()).toBeVisible();
  const count = await fills.count();
  await fills.first().click();
  await expect(fills).toHaveCount(count - 1);
  await expect(section).toContainText("original snapshot");
  await section.getByRole("button", { name: "Scan next 12" }).click();
  await expect(section).toContainText("24", { timeout: 20_000 });
  await section.getByRole("button", { name: "Choose fill…" }).first().click();
  await expect(section.locator(".fill-row").first()).toBeVisible();
  await section.locator(".fill-row").first().click();
  await expect(section.getByRole("button", { name: "Accept line", exact: true })).toBeVisible();
  await expect(page.locator(".rep-panel > .rep-preview")).toHaveCount(0);
  await section.getByRole("button", { name: "Accept line", exact: true }).click();
  await expect(section.getByRole("button", { name: "Accept line", exact: true })).toHaveCount(0);
});

test("F6/F13 retained only moves export without rescanning and can be practised", async ({
  page,
}) => {
  await openApp(page, { pgn: "1. e4 e5 *" });
  // Seed a retained engine finding, then drive export and recall exclusively through controls.
  await page.evaluate(() => {
    const api = (
      window as unknown as {
        __chess: { setCommandStateForTesting(name: string, state: unknown): void };
      }
    ).__chess;
    api.setCommandStateForTesting("find_only_moves", {
      status: "completed",
      result: {
        findings: [
          {
            path: [],
            fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            best_move: "e4",
            margin: 120,
            prescribed: ["e4"],
            prescribed_is_best: true,
            best_eval: 30,
          },
        ],
      },
    });
  });
  const section = page.locator("details.rep-section", { hasText: "Only moves & drills" });
  await section.locator("summary").click();
  const retained = await command(page, "find_only_moves");
  const download = page.waitForEvent("download");
  await section.getByRole("button", { name: "Create drill deck" }).click();
  expect((await download).suggestedFilename()).toBe("only-move-drill.csv");
  expect(await command(page, "find_only_moves")).toEqual(retained);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Practice", exact: true });
  await dialog.getByRole("button", { name: "Practice latest only moves" }).click();
  const board = dialog.locator("cg-board");
  const box = await board.boundingBox();
  if (!box) throw new Error("Drill board is not visible");
  await board.click({ position: { x: (box.width * 4.5) / 8, y: (box.height * 6.5) / 8 } });
  await board.click({ position: { x: (box.width * 4.5) / 8, y: (box.height * 4.5) / 8 } });
  await expect(dialog).toContainText("Practice complete.");
  await expect(dialog.getByRole("button", { name: "Next position" })).toHaveCount(0);
});
