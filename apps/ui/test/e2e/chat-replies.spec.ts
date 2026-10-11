import { expect, test } from "./helpers/fixtures";
import { openApp } from "./helpers/app";

type Page = import("playwright/test").Page;

const REPLY = [
  "**Strategic Fit ran.** Most of the Caro-Kann is too short to judge yet.",
  "",
  "- English: two plans compete",
  "- Caro-Kann Short: same",
  "",
  "Want me to open the English finding?",
].join("\n");

async function reply(page: Page, content: string) {
  await page.route("https://openrouter.ai/api/v1/chat/completions", async (route) => {
    const frame = { choices: [{ delta: { content }, finish_reason: "stop" }] };
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`,
    });
  });
}

test("a reply's markdown renders as text formatting, not symbols", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("chess.openrouter.key", "fake-key"));
  await openApp(page, { width: 1280, height: 900 });
  await reply(page, REPLY);
  await page
    .getByPlaceholder("Ask about this position, game, or repertoire…")
    .fill("What did it find?");
  await page.getByRole("button", { name: "Send" }).click();

  const message = page.locator(".chat-log .msg.assistant").last();
  await expect(message.locator("strong")).toHaveText("Strategic Fit ran.");
  await expect(message.locator("li")).toHaveText([
    "English: two plans compete",
    "Caro-Kann Short: same",
  ]);
  await expect(message).not.toContainText("**");
  await expect(page.locator(".assistant-controls")).toContainText(
    "Assistant: Strategic Fit ran. Most of the Caro-Kann",
  );
});

test("the assistant's reads fold to one line and open on request", async ({ page }) => {
  await openApp(page, { width: 1280, height: 900 });
  await page.evaluate(() => {
    (
      window as unknown as {
        __chess: { appendToolResultForTesting: (op: string, payload: unknown) => void };
      }
    ).__chess.appendToolResultForTesting("get_strategic_fit_report", {
      retrieval: "strategic-fit-findings",
      report_id: "strategic-fit-report:fixture",
      repertoire_revision: "browser:1",
      sort: "replacement-priority",
      page: { offset: 0, limit: 10, total_count: 0, returned_count: 0, has_more: false },
      cursor: "cursor:0",
      next_cursor: null,
      findings: [],
    });
  });

  const receipt = page.locator(".chat-log details.tool-result-receipt").last();
  await expect(receipt.locator("summary")).toHaveText("Strategic Fit report · no findings of 0");
  await expect(receipt).not.toHaveAttribute("open");
  await receipt.locator("summary").click();
  await expect(receipt).toHaveAttribute("open");
});
