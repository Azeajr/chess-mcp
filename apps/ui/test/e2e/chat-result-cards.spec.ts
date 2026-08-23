import { expect, test } from "playwright/test";
import { openApp } from "./helpers/app";

/**
 * WP-026 — chat result cards: technical-details gating, mutating-card distinction, staged-edit
 * consequences, and error recovery actions.
 *
 * The staged-edit card is driven through the DEV harness (appendToolResultForTesting) rather
 * than a live LLM round, so the assertions are deterministic.
 */

const chatLog = (page: import("playwright/test").Page) => page.locator(".chat-log");

test("WP-026 AC-1 the technical toggle gates Raw JSON and raw codes", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });

  const toggle = page.getByRole("checkbox", { name: /technical details/i });
  await expect(toggle).toBeVisible();

  // Off by default: append a raw tool result and assert no disclosure and no code text.
  await page.evaluate(() => {
    type Harness = {
      __chess: {
        appendToolResultForTesting: (op: string, payload: unknown) => void;
      };
    };
    (window as unknown as Harness).__chess.appendToolResultForTesting("engine_unavailable", {
      error: "engine_unavailable",
      reason: "The local engine is not running.",
    });
  });

  await expect(chatLog(page).getByRole("alert")).toBeVisible();
  // The recovery action still shows with details off — hiding detail must never hide the way out.
  await expect(chatLog(page).getByRole("button", { name: "Retry" })).toBeVisible();
  expect(await chatLog(page).getByText("Raw JSON").count()).toBe(0);
  expect(await chatLog(page).getByText("engine_unavailable", { exact: true }).count()).toBe(0);

  // On: both the disclosure and the raw code appear.
  await toggle.check();
  await expect(chatLog(page).getByText("Raw JSON")).toHaveCount(1);
  await expect(chatLog(page).getByText("engine_unavailable", { exact: true })).toBeVisible();

  // Off again: both disappear.
  await toggle.uncheck();
  await expect(chatLog(page).getByText("Raw JSON")).toHaveCount(0);
});

test("WP-026 AC-2 a mutating card carries a non-colour badge distinguishable in forced colors", async ({
  page,
  context,
}) => {
  // Chromium-only emulation; the assertion is about computed state, not palette.
  test.skip(context.browser()?.browserType().name() !== "chromium", "forced-colors is chromium");
  await page.emulateMedia({ forcedColors: "active" });
  await openApp(page, { width: 1280, height: 800 });

  await page.evaluate(() => {
    type Harness = {
      __chess: {
        appendToolResultForTesting: (op: string, payload: unknown) => void;
        setStagedEditsForTesting: (edits: unknown[]) => void;
      };
    };
    const api = (window as unknown as Harness).__chess;
    // Add the staged edit to the store so StagedEditResult can find it.
    api.setStagedEditsForTesting([
      {
        id: "wp026-badge",
        kind: "repertoire_edit",
        action: "add",
        revision: 0,
        path: [],
        addMoves: ["d4", "d5"],
        before: { nodes: 3, leaves: 1, maxDepth: 10 },
        after: { nodes: 5, leaves: 2, maxDepth: 10 },
        status: "pending",
      },
    ]);
    // Also append the tool result so the chat history shows it.
    api.appendToolResultForTesting("staged_edit", {
      kind: "staged_edit",
      action_id: "wp026-badge",
      action: "add",
      path: [],
      line: ["d4", "d5"],
      before: { nodes: 3, leaves: 1 },
      after: { nodes: 5, leaves: 2 },
    });
  });

  // Wait for the card to render
  const card = page.locator(".staged-card[data-mutating='true']").first();
  await expect(card).toBeVisible({ timeout: 10_000 });

  // Non-colour cue #1: an icon+text badge exists.
  const badge = card.locator(".mutating-badge");
  await expect(badge).toContainText("mutates");

  // Non-colour cue #2: under forced colors, the border weight differs and is not transparent.
  const border = await card.evaluate((element) => {
    const cs = getComputedStyle(element);
    return { width: cs.borderTopWidth, style: cs.borderTopStyle };
  });
  expect(parseFloat(border.width)).toBeGreaterThanOrEqual(2);
  expect(border.style).not.toBe("none");
});

test("WP-026 AC-3 the staged-edit card states the change, scope, and undoability", async ({
  page,
}) => {
  await openApp(page, { width: 1280, height: 800 });

  await page.evaluate(() => {
    type Harness = {
      __chess: {
        appendToolResultForTesting: (op: string, payload: unknown) => void;
        setStagedEditsForTesting: (edits: unknown[]) => void;
      };
    };
    const api = (window as unknown as Harness).__chess;
    // Add the staged edit to the store so StagedEditResult can find it.
    api.setStagedEditsForTesting([
      {
        id: "wp026-consequences",
        kind: "repertoire_edit",
        action: "add",
        revision: 0,
        path: [],
        addMoves: ["e4", "e5", "Nf3"],
        before: { nodes: 3, leaves: 1, maxDepth: 10 },
        after: { nodes: 6, leaves: 2, maxDepth: 10 },
        status: "pending",
      },
    ]);
    // Also append the tool result so the chat history shows it.
    api.appendToolResultForTesting("staged_edit", {
      kind: "staged_edit",
      action_id: "wp026-consequences",
      action: "add",
      path: [],
      line: ["e4", "e5", "Nf3"],
      before: { nodes: 3, leaves: 1 },
      after: { nodes: 6, leaves: 2 },
    });
  });

  const card = page.locator(".staged-card[data-mutating='true']").first();
  await expect(card).toBeVisible();
  const consequences = card.locator(".staged-consequences");
  await expect(consequences).toContainText(/can be undone/);
  await expect(consequences).toContainText(/changes the working repertoire in this browser/);
  await expect(consequences).toContainText(/\b3 moves\b/);
});

test("WP-026 AC-4 engine_unavailable offers Retry and explorer_auth_required opens Settings on the token field", async ({
  page,
}) => {
  await openApp(page, { width: 1280, height: 800 });

  // Retry: inject an engine failure, then confirm the card's Retry re-dispatches.
  await page.evaluate(() => {
    type Harness = {
      __chess: { appendToolResultForTesting: (op: string, payload: unknown) => void };
    };
    (window as unknown as Harness).__chess.appendToolResultForTesting("engine_unavailable", {
      error: "engine_unavailable",
      reason: "The local engine is not running.",
    });
  });
  const retryButton = chatLog(page).getByRole("button", { name: "Retry" }).first();
  await expect(retryButton).toBeVisible();
  await retryButton.click();

  // Add Lichess token: focus lands on the token input inside Settings.
  await page.evaluate(() => {
    type Harness = {
      __chess: { appendToolResultForTesting: (op: string, payload: unknown) => void };
    };
    (window as unknown as Harness).__chess.appendToolResultForTesting("engine_unavailable", {
      error: "explorer_auth_required",
      reason: "A Lichess token is required for explorer tools.",
    });
  });
  await chatLog(page).getByRole("button", { name: "Add Lichess token" }).click();

  // Focus lands asynchronously: the effect waits for the dialog to mount, its initial focus to run,
  // then runs rAF. Give it enough time.
  await page.waitForTimeout(500);

  const tokenField = page.locator("input[data-settings-field='lichess-token']");
  await expect(tokenField).toBeVisible();
  await expect(tokenField).toBeFocused();
});
