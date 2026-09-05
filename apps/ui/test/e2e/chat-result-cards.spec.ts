import { expect, test } from "./helpers/fixtures";
import { openApp } from "./helpers/app";

const chatLog = (page: import("playwright/test").Page) => page.locator(".chat-log");

async function setTechnicalDetails(page: import("playwright/test").Page, on: boolean) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const toggle = page.getByRole("checkbox", { name: /technical details/i });
  await expect(toggle).toBeVisible();
  if (on) await toggle.check();
  else await toggle.uncheck();
  await page.getByRole("button", { name: "Close settings" }).click();
}

test("WP-026 AC-1 the technical toggle gates Raw JSON and raw codes", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });

  await page.evaluate(() => {
    type Harness = {
      __chess: {
        appendToolResultForTesting: (op: string, payload: unknown) => void;
        recordDirectCommandForTesting: (command: string, args: Record<string, unknown>) => void;
      };
    };
    const api = (window as unknown as Harness).__chess;
    api.recordDirectCommandForTesting("audit_repertoire_moves", {
      depth: 1,
      min_cp_loss: 50,
    });
    api.appendToolResultForTesting("engine_unavailable", {
      error: "engine_unavailable",
      reason: "The local engine is not running.",
    });
  });

  await expect(chatLog(page).getByRole("alert")).toBeVisible();
  await expect(chatLog(page).getByRole("button", { name: "Retry" })).toBeVisible();
  expect(await chatLog(page).getByText("Raw JSON").count()).toBe(0);
  expect(await chatLog(page).getByText("engine_unavailable", { exact: true }).count()).toBe(0);

  await setTechnicalDetails(page, true);
  await expect(chatLog(page).getByText("Raw JSON")).toHaveCount(1);
  await expect(chatLog(page).getByText("engine_unavailable", { exact: true })).toBeVisible();

  await setTechnicalDetails(page, false);
  await expect(chatLog(page).getByText("Raw JSON")).toHaveCount(0);
});

test("WP-026 AC-2 a mutating card carries a non-colour badge distinguishable in forced colors", async ({
  page,
  context,
}) => {
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

  const card = page.locator(".staged-card[data-mutating='true']").first();
  await expect(card).toBeVisible({ timeout: 10_000 });

  const badge = card.locator(".mutating-badge");
  await expect(badge).toContainText("mutates");

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

  await page.evaluate(() => {
    type Harness = {
      __chess: {
        appendToolResultForTesting: (op: string, payload: unknown) => void;
        recordDirectCommandForTesting: (command: string, args: Record<string, unknown>) => void;
      };
    };
    const api = (window as unknown as Harness).__chess;
    api.recordDirectCommandForTesting("audit_repertoire_moves", {
      depth: 1,
      min_cp_loss: 50,
    });
    api.appendToolResultForTesting("engine_unavailable", {
      error: "engine_unavailable",
      reason: "The local engine is not running.",
    });
  });
  const retryButton = chatLog(page).getByRole("button", { name: "Retry" }).first();
  await expect(retryButton).toBeVisible();
  await retryButton.click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const states = (
          window as unknown as {
            __chess: {
              commandStates: () => Record<string, { status: string }>;
            };
          }
        ).__chess.commandStates();
        return states.audit_repertoire_moves?.status;
      }),
    )
    .not.toBe("idle");

  await page.evaluate(() => {
    type Harness = {
      __chess: {
        appendToolResultForTesting: (op: string, payload: unknown) => void;
      };
    };
    (window as unknown as Harness).__chess.appendToolResultForTesting("engine_unavailable", {
      error: "explorer_auth_required",
      reason: "A Lichess token is required for explorer tools.",
    });
  });
  await chatLog(page).getByRole("button", { name: "Add Lichess token" }).click();

  const tokenField = page.locator("input[data-settings-field='lichess-token']");
  await expect(tokenField).toBeVisible();
  await expect(tokenField).toBeFocused();
});
