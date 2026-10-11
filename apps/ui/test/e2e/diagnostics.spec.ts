import { readFile } from "node:fs/promises";
import { expect, test } from "./helpers/fixtures";
import { openApp } from "./helpers/app";

const API_KEY = "sk-or-v1-e2e0123456789abcdef";
const LICHESS_TOKEN = "lip_e2e0123456789";

interface Bundle {
  readonly settings: { readonly model: string; readonly apiKeySet: boolean };
  readonly document: { readonly pgn: string | null; readonly fileName: string | null };
  readonly sessions: readonly {
    readonly rounds: readonly {
      readonly text?: string;
      readonly messages: readonly { readonly role: string }[];
    }[];
  }[];
  readonly timeline: readonly string[];
}

test("Settings saves a diagnostic bundle of the chat without the credentials", async ({ page }) => {
  await page.addInitScript(
    ([key, token]) => {
      localStorage.setItem("chess.openrouter.key", key);
      localStorage.setItem("chess.lichess.token", token);
    },
    [API_KEY, LICHESS_TOKEN] as const,
  );
  await openApp(page, {
    width: 1280,
    height: 900,
    pgn: "1. e4 c6 2. d4 d5 *",
    fileName: "caro.pgn",
  });
  await page.route("https://openrouter.ai/api/v1/chat/completions", async (route) => {
    const frame = {
      choices: [{ delta: { content: "The Caro-Kann line is in place." }, finish_reason: "stop" }],
    };
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`,
    });
  });

  await page
    .getByPlaceholder("Ask about this position, game, or repertoire…")
    .fill("What is this?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.locator(".chat-log .msg.assistant").getByText("The Caro-Kann line is in place."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText(/1 assistant requests/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save diagnostic bundle" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^chess-debug-\d{8}-\d{6}\.json$/);
  await expect(page.getByRole("status").filter({ hasText: /^Saved chess-debug-/ })).toBeVisible();

  const content = await readFile(await file.path(), "utf8");
  expect(content).not.toContain(API_KEY);
  expect(content).not.toContain(LICHESS_TOKEN);
  const bundle = JSON.parse(content) as Bundle;
  expect(bundle.settings.apiKeySet).toBe(true);
  expect(bundle.document.fileName).toBe("caro.pgn");
  expect(bundle.document.pgn).toContain("c6");
  const [round] = bundle.sessions.at(-1)!.rounds;
  expect(round!.text).toBe("The Caro-Kann line is in place.");
  expect(round!.messages.map((message) => message.role)).toEqual(["system", "user"]);
  expect(bundle.timeline.some((line) => line.includes("user (turn 1): What is this?"))).toBe(true);
});
