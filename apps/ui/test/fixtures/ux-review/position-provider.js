/* eslint-disable @typescript-eslint/no-unused-expressions --
   `pnpm ux:review -- --setup` evaluates this file as a single expression, so the bare arrow
   function is the required shape rather than a stray statement. */
// UX review setup for the position journey.
//
// The position tools are only reachable through the assistant's tool calls, so a review session
// needs a provider. This stub stands in for the model's tool choice and nothing else: it reads the
// verb the reviewer typed and the SAN tokens in their own message, then asks for the matching tool.
// Every tool executes for real in the browser against the position the reviewer navigated to, and
// every result is read from the rendered cards. It performs no part of the journey itself.
async (page) => {
  await page.route("https://openrouter.ai/api/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const lastUserIndex = messages.map((message) => message?.role).lastIndexOf("user");
    const text = String(messages[lastUserIndex]?.content ?? "");
    // A tool result already came back for THIS turn, so answer instead of calling again. Earlier
    // turns in the conversation have tool results too, which is why the scan starts at the last
    // user message rather than the whole history.
    const answered = messages
      .slice(lastUserIndex + 1)
      .some((message) => message?.role === "tool");

    const SAN = /\b(?:O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)\b/g;
    const moves = (text.match(SAN) ?? []).filter((token) => token.length > 1);

    const toolCall = (name, args) => ({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: `ux-review-${name}`,
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });

    const say = (content) => ({ choices: [{ delta: { content }, finish_reason: "stop" }] });

    const lower = text.toLowerCase();
    const frame = answered
      ? say("Answered from the tool result above.")
      : lower.includes("compare")
        ? toolCall("compare_moves", { moves })
        : lower.includes("validate")
          ? toolCall("validate_line", { moves })
          : lower.includes("legal")
            ? toolCall("get_legal_moves", {})
            : lower.includes("evaluate")
              ? toolCall("evaluate_position", {})
              : say("Ask me to evaluate, compare, validate, or list legal moves.");

    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`,
    });
  });

  return {
    providerStub: "openrouter",
    scriptedTools: ["evaluate_position", "compare_moves", "validate_line", "get_legal_moves"],
    performsJourney: false,
  };
}
