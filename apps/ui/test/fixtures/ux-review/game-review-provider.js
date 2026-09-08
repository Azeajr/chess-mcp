/* eslint-disable @typescript-eslint/no-unused-expressions --
   `pnpm ux:review -- --setup` evaluates this file as a single expression, so the bare arrow
   function is the required shape rather than a stray statement. */
// UX review setup for the game-review journey.
//
// The game review workflow is only reachable through the assistant's tool calls, so a review
// session needs a provider. This stub decides *which* tool the model asks for and nothing else:
// every tool still executes for real in the browser against the seeded document, and every
// result is read from the rendered cards. It performs no part of the journey itself.
async (page) => {
  await page.route("https://openrouter.ai/api/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const toolResults = messages.filter((message) => message?.role === "tool");
    const called = new Set(
      messages
        .filter((message) => Array.isArray(message?.tool_calls))
        .flatMap((message) => message.tool_calls.map((call) => call?.function?.name)),
    );

    const toolCall = (id, name) => ({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "{}" } }],
          },
          finish_reason: "tool_calls",
        },
      ],
    });

    const frame = !called.has("get_game_summary")
      ? toolCall("ux-review-summary", "get_game_summary")
      : !called.has("analyze_game")
        ? toolCall("ux-review-analysis", "analyze_game")
        : {
            choices: [
              {
                delta: {
                  content:
                    `Reviewed the mainline through ${toolResults.length} grounded tool results. ` +
                    `Use the rows on the cards above to reach each flagged move.`,
                },
                finish_reason: "stop",
              },
            ],
          };

    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`,
    });
  });

  return {
    providerStub: "openrouter",
    scriptedTools: ["get_game_summary", "analyze_game"],
    performsJourney: false,
  };
}
