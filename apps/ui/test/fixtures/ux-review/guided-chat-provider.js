/* eslint-disable @typescript-eslint/no-unused-expressions --
   `pnpm ux:review -- --setup` evaluates this file as a single expression, so the bare arrow
   function is the required shape rather than a stray statement. */
// UX review setup for the guided-chat journeys (docs/CHAT_DRIVEN_UI_SPEC.md, J1–J5).
//
// The guided journeys are only reachable through the assistant, so a review session needs a
// provider. This stub stands in for the model's choices and nothing else: which ui_act step comes
// next for a request, and a plain-language explanation built from the evidence the app returned.
// Every step then runs for real in the browser — engine, workflows, stores and visible UI. The
// Lichess route serves three short public-style games so the import runs offline; no credential,
// account or private data is involved.
async (page) => {
  const GAMES = [
    '[Event "Fixture blitz"]\n[White "fixture-user"]\n[Black "opponent-a"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7 1-0',
    '[Event "Fixture blitz"]\n[White "opponent-b"]\n[Black "fixture-user"]\n[Result "0-1"]\n\n1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 0-1',
    '[Event "Fixture blitz"]\n[White "fixture-user"]\n[Black "opponent-c"]\n[Result "1/2-1/2"]\n\n1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 1/2-1/2',
  ];
  await page.route("https://lichess.org/api/games/user/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-chess-pgn",
      body: `${GAMES.join("\n\n")}\n`,
    }),
  );

  await page.route("https://openrouter.ai/api/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const system = String(messages[0]?.content ?? "");
    const marker = "Current UI state: ";
    const state = system.includes(marker) ? JSON.parse(system.slice(system.indexOf(marker) + marker.length)) : null;
    const lastUser = messages.map((message) => message?.role).lastIndexOf("user");
    const original = String(messages[lastUser]?.content ?? "");
    const request = original.toLowerCase();
    const since = messages.slice(lastUser + 1);
    const step = since.filter((message) => Array.isArray(message?.tool_calls)).length;
    const receipts = since
      .filter((message) => message?.role === "tool")
      .map((message) => {
        try {
          return JSON.parse(message.content);
        } catch {
          return {};
        }
      });
    const last = receipts.at(-1) ?? {};
    const results = state?.results ?? [];
    const review = results.find((entry) => entry.command === "analyze_game");
    const pawns = (cp) => `${cp >= 0 ? "+" : "−"}${(Math.abs(cp) / 100).toFixed(2)}`;

    const act = (action, purpose) => ({ action, purpose });
    const say = (text) => ({ text });
    const failed = (receipt) => receipt.status && receipt.status !== "completed";

    let next;
    if (step > 0 && failed(last)) {
      next = say(`That step didn't go through: ${last.reason ?? last.error}.`);
    } else if (request.includes("review")) {
      if (state?.document.kind === "empty")
        next =
          step === 0
            ? act(
                { kind: "navigate", surface: "document.open" },
                "To review a game I need its moves first.",
              )
            : say(
                "Press Open PGN at the top of the screen and choose your game. When it has loaded, ask me to review it.",
              );
      else if (step === 0)
        next = act(
          { kind: "submit", workflow: "review" },
          "I'll review the main line to find a decision worth studying.",
        );
      else if (step === 1) {
        const worst = (review?.moves ?? []).find((move) => move.classification !== "good");
        next = worst
          ? act({ kind: "select_result", resultId: review.resultId, ply: worst.ply })
          : say(
              "The review found no move worth flagging. You can run it again any time with Review game in the Analysis tab.",
            );
      } else {
        const selected = state?.presentation.selectedReview;
        const move = (review?.moves ?? []).find((entry) => entry.ply === selected?.ply);
        next = say(
          `This is the position before ${move ? `move ${Math.ceil(move.ply / 2)}${move.ply % 2 ? "." : "…"} ${move.san}` : "the flagged move"}. ` +
            `The review classed it as a ${move?.classification ?? "mistake"}. Compare moves can show what else was playable here; ` +
            "the other flagged moves are in the list under Review game, and you can rerun the review there yourself.",
        );
      }
    } else if (request.includes("compare")) {
      const candidates = (original.match(/\b(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8]|O-O(?:-O)?)\b/g) ?? []).join(" ");
      if (step === 0)
        next = act(
          { kind: "set_fields", form: "compare", values: { candidates }, replace: true },
          `I'll put ${candidates || "the candidates"} into Compare moves.`,
        );
      else if (step === 1) next = act({ kind: "submit", workflow: "compare" });
      else {
        const moves = Array.isArray(last.result?.candidates) ? last.result.candidates : [];
        const scored = moves
          .filter((move) => typeof move.eval_cp === "number")
          .map((move) => `${move.san} ${pawns(move.eval_cp)}`)
          .join(", ");
        const illegal = moves.filter((move) => move.error).map((move) => move.san ?? move.move);
        next = say(
          `${scored ? `From White's point of view: ${scored}.` : "No candidate could be scored."}` +
            `${illegal.length ? ` ${illegal.join(", ")} ${illegal.length === 1 ? "isn't" : "aren't"} legal here.` : ""}` +
            " Edit Candidate moves and press Compare moves to try others yourself.",
        );
      }
    } else if (request.includes("improve")) {
      const findings = state?.strategicFit.findings;
      const decidable = (findings?.items ?? []).find((item) => item.decidable && item.resolution === "unresolved");
      if (step === 0)
        next = act(
          { kind: "navigate", surface: "strategicFit.assessment" },
          "I'll open Strategic Fit, which compares the plans your lines lead to.",
        );
      else if (step === 1) next = act({ kind: "submit", workflow: "strategic_fit_analyze" });
      else if (step === 2 && findings?.items.length)
        next = act({
          kind: "select_result",
          resultId: findings.reportId,
          itemId: (decidable ?? findings.items[0]).findingId,
        });
      else {
        const item = findings?.items.find((entry) => entry.findingId === findings.selectedFindingId);
        next = say(
          !findings?.items.length
            ? "The analysis found nothing that needs a decision."
            : decidable
              ? `This branch (${item?.opening}) ${item?.category.toLowerCase()}. Choose what to do with it under “What do you want to do?”, or ask me to prepare a decision.`
              : `All ${findings.total} findings report incomplete evidence: lines such as ${item?.opening} end before the position settles, so there is nothing to decide yet. Extending them (Extend here in the Repertoire panel) gives the analysis more to compare.`,
        );
      }
    } else if (request.includes("import")) {
      if (step === 0)
        next = act(
          {
            kind: "set_fields",
            form: "history",
            values: { platform: "lichess", username: "fixture-user" },
            replace: true,
          },
          "I'll fill in the import form with your Lichess account.",
        );
      else if (step === 1) next = act({ kind: "submit", workflow: "import_history" });
      else
        next = say(
          `I fetched ${last.result?.fetched ?? "your"} games and reviewed ${last.result?.selected_for_review ?? "them"}. Your repertoire wasn't changed. ` +
            "The results are under Prepare · Import my games in the Analysis tab.",
        );
    } else if (request.includes("export")) {
      if (step === 0)
        next = act(
          { kind: "submit", workflow: "export_game" },
          "I'll create an annotated copy of this game.",
        );
      else
        next = say(
          "The annotated PGN is ready but not saved yet. Press Save annotated game, under Export annotated game in the Analysis tab, to keep it.",
        );
    } else {
      next = say("I can review a game, compare moves, improve a repertoire, import your games or export an annotated copy.");
    }

    const frames = [];
    if (next.purpose) frames.push({ choices: [{ delta: { content: next.purpose } }] });
    if (next.text) frames.push({ choices: [{ delta: { content: next.text }, finish_reason: "stop" }] });
    else
      frames.push({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: `ux-guided-${messages.length}`,
                  type: "function",
                  function: {
                    name: "ui_act",
                    arguments: JSON.stringify({
                      actionId: `ux-guided-${messages.length}-${step}`,
                      stateToken: state?.stateToken ?? "",
                      action: next.action,
                    }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      });
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`,
    });
  });

  return {
    providerStub: "openrouter + lichess games",
    scriptedSteps: "ui_act choices and narration only",
    performsJourney: false,
  };
}
