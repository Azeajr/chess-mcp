import { expect, test } from "./helpers/fixtures";
import { openApp, currentPath } from "./helpers/app";
import type { Page } from "playwright/test";

async function installAssistant(page: Page, slow = false) {
  await page.evaluate(
    ({ slow }) => {
      type ChatTransport = typeof import("../../src/store/chat").setChatTransportForTesting;
      type CommandExecutor = typeof import("../../src/store/commands").setCommandExecutorForTesting;
      const api = (
        window as unknown as {
          __chess: {
            setApiKey(key: string): void;
            setChatTransportForTesting: ChatTransport;
            setCommandExecutorForTesting: CommandExecutor;
          };
        }
      ).__chess;
      api.setApiKey("fixture-key");
      let step = 0;
      let call = 0;
      let request = "";
      api.setCommandExecutorForTesting(async (name, _args, options) => {
        if (slow)
          return new Promise((_resolve, reject) => {
            if (options.signal?.aborted) reject(new DOMException("Cancelled", "AbortError"));
            else
              options.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("Cancelled", "AbortError")),
                { once: true },
              );
          });
        if (name === "analyze_game")
          return {
            total_moves: 2,
            moves: [{ ply: 2, san: "e5", classification: "mistake", cp_loss: 90 }],
          };
        if (name === "compare_moves")
          return {
            fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            eval_pov: "white",
            moves: [{ move: "e4", san: "e4", cp: 30, mate: null, legal: true }],
          };
        return {
          total_moves: 2,
          white: { accuracy: 90 },
          black: { accuracy: 80 },
          moves: [{ ply: 2, san: "e5", classification: "mistake", cp_loss: 90 }],
        };
      });
      api.setChatTransportForTesting(async (options) => {
        const last = options.messages.at(-1);
        if (last?.role === "user") {
          step = 0;
          request = last.content ?? "";
        }
        const system = options.messages[0]?.content ?? "";
        const state = JSON.parse(system.split("Current UI state: ")[1]!) as {
          stateToken: string;
          document: { kind: string };
          results: { command: string; resultId: string }[];
        };
        let action: unknown;
        if (state.document.kind === "empty" && step === 0)
          action = { kind: "navigate", surface: "document.open" };
        else if (state.document.kind !== "empty" && /compare/i.test(request)) {
          if (step === 0)
            action = { kind: "set_fields", form: "compare", values: { candidates: "e4 d4" } };
          if (step === 1) action = { kind: "submit", workflow: "compare" };
        } else if (state.document.kind !== "empty") {
          if (step === 0) action = { kind: "submit", workflow: "review" };
          if (step === 1)
            action = {
              kind: "select_result",
              resultId: state.results.find((result) => result.command === "analyze_game")?.resultId,
              ply: 2,
            };
        }
        step++;
        return action
          ? {
              content: "I'll show the relevant controls and run this step.",
              toolCalls: [
                {
                  id: `fixture-${++call}`,
                  type: "function",
                  function: {
                    name: "ui_act",
                    arguments: JSON.stringify({
                      actionId: `fixture-action-${call}`,
                      stateToken: state.stateToken,
                      action,
                    }),
                  },
                },
              ],
            }
          : {
              content:
                state.document.kind === "empty"
                  ? "Open a PGN, then ask me to review it."
                  : "The result is ready. You can continue with the same controls.",
              toolCalls: [],
            };
      });
    },
    { slow },
  );
}

async function ask(page: Page, text: string) {
  const chatTab = page.getByRole("tab", { name: /Chat/ });
  if (await chatTab.isVisible()) await chatTab.click();
  await page.getByRole("textbox", { name: "Chat message" }).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test("without an API key the request is kept, names the manual route, and opens setup", async ({
  page,
}) => {
  await openApp(page, { pgn: "*" });
  await page.getByRole("button", { name: "Review a game" }).click();
  const composer = page.getByRole("textbox", { name: "Chat message" });
  await expect(composer).toHaveValue("Review a game");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const error = page.locator(".chat-error");
  await expect(error).toContainText(
    "Without the assistant: open the game with Open PGN in the File menu, then press Review game in the Analysis tab.",
  );
  // The request used to be cleared, so setting up the key meant typing it again.
  await expect(composer).toHaveValue("Review a game");
  await expect(error.getByRole("button", { name: "Send again" })).toHaveCount(0);
  await error.getByRole("button", { name: "Set up the assistant" }).click();
  await expect(page.getByLabel("OpenRouter API key")).toBeFocused();
});

for (const mobile of [false, true]) {
  const tag = mobile ? " @mobile-webkit" : "";
  test(`empty app goal reveals file input and continues after user loads a game${tag}`, async ({
    page,
  }) => {
    await openApp(page, { width: mobile ? 375 : 1280, height: mobile ? 629 : 800, pgn: "*" });
    // Chromium's File System Access picker never raises Playwright's filechooser event; force
    // the <input type=file> fallback so every browser goes through the native chooser.
    await page.evaluate(() =>
      Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined }),
    );
    await installAssistant(page);
    await ask(page, "Review a game");
    const open = page.locator('.assistant-controls [data-guided-surface="document.open"]');
    await expect(open).toBeVisible();
    const chooser = page.waitForEvent("filechooser");
    await open.click();
    await (
      await chooser
    ).setFiles({
      name: "guided-game.pgn",
      mimeType: "application/x-chess-pgn",
      buffer: Buffer.from("1. e4 e5 *"),
    });
    await page.getByRole("button", { name: "Load", exact: true }).click();
    await expect(page.getByText("guided-game.pgn", { exact: true })).toBeVisible();
    await ask(page, "Review this game");
    await expect(page.getByText("Showing the position before reviewed move 2.")).toBeVisible();
    await expect.poll(() => currentPath(page)).toEqual([0]);
  });
  test(`assistant review selects its board position and hands comparison to manual controls${tag}`, async ({
    page,
  }) => {
    await openApp(page, {
      width: mobile ? 375 : 1280,
      height: mobile ? 629 : 800,
      pgn: "1. e4 e5 *",
    });
    await installAssistant(page);
    await ask(page, "Review this game");
    await expect(page.getByText("Showing the position before reviewed move 2.")).toBeVisible();
    await expect.poll(() => currentPath(page)).toEqual([0]);
    await expect(page.locator(".direct-analysis .result-nav[aria-pressed=true]")).toContainText(
      "e5",
    );
    // One list of reviewed moves: the summary's own rows went to the position after each move.
    await expect(page.locator(".direct-analysis .result-nav", { hasText: "e5" })).toHaveCount(1);
    // On a phone the selected position is brought into view, not left above the results.
    if (mobile) await expect(page.locator(".board-stage")).toBeInViewport();
    // A finished step shows the assistant's reply, so it reads where the user is looking.
    await expect(page.locator(".assistant-controls")).toContainText(
      "Assistant: The result is ready.",
    );
    await ask(page, "Compare candidate moves");
    await expect(page.getByRole("textbox", { name: "Candidate moves" })).toHaveValue("e4 d4");
    await expect(page.locator(".assistant-controls")).toContainText(
      "Assistant: The result is ready.",
    );
    await page.getByRole("textbox", { name: "Candidate moves" }).fill("Nf3");
    await page.getByRole("button", { name: "Compare moves", exact: true }).click();
    // Taking over retires the finished reply, after the press lands rather than under the finger.
    await expect(page.locator(".assistant-controls")).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __chess: { commandStates(): { compare_moves: { args: { moves: string[] } } } };
              }
            ).__chess.commandStates().compare_moves.args.moves,
        ),
      )
      .toEqual(["Nf3"]);
    await page.screenshot({ path: test.info().outputPath("guided-manual-handoff.png") });
  });

  test(`the conversation follows the newest reply${tag}`, async ({ page }) => {
    await openApp(page, {
      width: mobile ? 375 : 1280,
      height: mobile ? 629 : 800,
      pgn: "1. e4 e5 *",
    });
    await installAssistant(page);
    const replies = page.locator(".chat-log .msg.assistant", {
      hasText: "The result is ready. You can continue with the same controls.",
    });
    for (const count of [1, 2, 3]) {
      await ask(page, "Review this game");
      await expect(replies).toHaveCount(count);
    }
    if (mobile) await page.getByRole("tab", { name: /Chat/ }).click();
    // The log stayed where it was, so on a phone the newest reply sat below a two-line window.
    await expect(replies.last()).toBeInViewport();
  });

  test(`manual edits pause assistant work and Stop remains accessible${tag}`, async ({ page }) => {
    await openApp(page, {
      width: mobile ? 375 : 1280,
      height: mobile ? 629 : 800,
      pgn: "1. e4 e5 *",
    });
    await installAssistant(page, true);
    await ask(page, "Compare candidate moves");
    const candidates = page.getByRole("textbox", { name: "Candidate moves" });
    await expect(candidates).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop assistant", exact: true })).toBeVisible();
    if (mobile) {
      await page.getByRole("tab", { name: /Chat/ }).click();
      await expect(page.locator(".assistant-controls")).toContainText("working");
      await page.getByRole("tab", { name: /Analysis/ }).click();
    }
    await candidates.fill("Nf3");
    await expect(page.locator(".assistant-controls")).toContainText("paused");
    await expect(candidates).toHaveValue("Nf3");
    await page.getByRole("button", { name: "Return to chat", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEditable();
    await ask(page, "Review this game");
    await expect(page.getByRole("button", { name: "Stop assistant", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Stop assistant", exact: true }).click();
    await expect(page.locator(".assistant-controls")).toContainText("cancelled");
  });
}
