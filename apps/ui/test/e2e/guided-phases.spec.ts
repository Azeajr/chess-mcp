import { expect, test, type Page } from "./helpers/fixtures";
import { installFindingWorkerFixture } from "./helpers/strategic-fit-worker-fixture";
import { currentPgn, openApp } from "./helpers/app";

// Phases 2 and 3 of docs/CHAT_DRIVEN_UI_SPEC.md through a deterministic assistant. Each user
// message plays a planned list of ui_act calls; "$" values resolve against the live UI state the
// application injected that round, so identities always come from the app, never the script.

type Step = { action: unknown } | { text: string };
type Plan = Record<string, Step[]>;

async function installScript(page: Page, plan: Plan, executor?: "import" | "export") {
  await page.evaluate(
    ({ plan, executor }) => {
      type State = {
        stateToken: string;
        conversation: { messageId: string } | null;
        strategicFit: {
          findings: {
            reportId: string;
            selectedFindingId: string | null;
            items: { findingId: string; classification: string; resolution: string }[];
          } | null;
          lab: { pivots: { decisionId: string }[] } | null;
        };
        proposals: { proposalId: string; kind: string; previewVersion: string }[];
      };
      type Api = {
        setApiKey(key: string): void;
        createArtifact(format: string, content: string, name: string): unknown;
        setChatTransportForTesting(
          transport: (options: {
            messages: { role: string; content: string | null }[];
          }) => Promise<unknown>,
        ): void;
        setCommandExecutorForTesting(executor: (name: string) => Promise<unknown>): void;
      };
      const api = (window as unknown as { __chess: Api }).__chess;
      api.setApiKey("fixture-key");
      const receipts: Record<string, unknown>[] = [];
      (window as unknown as { __guidedReceipts: unknown[] }).__guidedReceipts = receipts;
      const resolve = (value: unknown, state: State): unknown => {
        if (Array.isArray(value)) return value.map((item) => resolve(item, state));
        if (value && typeof value === "object")
          return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, resolve(item, state)]),
          );
        if (typeof value !== "string" || !value.startsWith("$")) return value;
        const [name, argument] = value.slice(1).split(":");
        const findings = state.strategicFit.findings;
        const proposal = state.proposals.find((item) => item.kind === argument);
        if (name === "messageId") return state.conversation?.messageId;
        if (name === "reportId") return findings?.reportId;
        if (name === "selectedFinding") return findings?.selectedFindingId;
        if (name === "finding")
          return findings?.items.find(
            (item) =>
              item.classification === "genuine-inconsistency" && item.resolution === "unresolved",
          )?.findingId;
        if (name === "pivot") return state.strategicFit.lab?.pivots[0]?.decisionId;
        if (name === "proposalId") return proposal?.proposalId;
        if (name === "previewVersion") return proposal?.previewVersion;
        return value;
      };
      if (executor === "import")
        api.setCommandExecutorForTesting(async (name) =>
          name === "lichess_games"
            ? {
                games: [1, 2, 3].map((round) => ({
                  pgn: `[Event "Fixture ${round}"]\n[White "fixture-user"]\n[Black "opponent"]\n\n1. e4 e5 2. Nf3 Nc6 *`,
                })),
              }
            : name === "batch_review"
              ? { games_reviewed: 3, username: "fixture-user", games: [] }
              : {},
        );
      if (executor === "export")
        api.setCommandExecutorForTesting(async (name) =>
          name === "export_annotated_pgn"
            ? api.createArtifact("pgn", '[Event "Annotated"]\n\n1. e4 e5 *', "annotated-game.pgn")
            : {},
        );
      let call = 0;
      let step = 0;
      let request = "";
      api.setChatTransportForTesting(async (options) => {
        const last = options.messages.at(-1);
        if (last?.role === "user") {
          step = 0;
          request = last.content ?? "";
        }
        if (last?.role === "tool" && last.content)
          receipts.push(JSON.parse(last.content) as Record<string, unknown>);
        const system = options.messages[0]?.content ?? "";
        const state = JSON.parse(system.split("Current UI state: ")[1]!) as State;
        const current = (plan[request] ?? [])[step++] ?? { text: "Done." };
        if ("text" in current) return { content: current.text, toolCalls: [] };
        call++;
        return {
          content: "Working on the next step.",
          toolCalls: [
            {
              id: `script-${call}`,
              type: "function",
              function: {
                name: "ui_act",
                arguments: JSON.stringify({
                  actionId: `script-action-${call}`,
                  stateToken: state.stateToken,
                  action: resolve(current.action, state),
                }),
              },
            },
          ],
        };
      });
    },
    { plan, executor },
  );
}

const receipts = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __guidedReceipts: { status?: string; error?: string; result?: Record<string, unknown> }[];
        }
      ).__guidedReceipts,
  );

async function ask(page: Page, text: string) {
  const chatTab = page.getByRole("tab", { name: /Chat/ });
  if (await chatTab.isVisible()) await chatTab.click();
  await page.getByRole("textbox", { name: "Chat message" }).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

type Harness = {
  loadPgn(pgn: string, name?: string): void;
  strategicFitMetadata(): { resolutions: unknown[] };
  strategicFitMetadataStatus(): string;
  selectStrategicFitProfile(mode: "balanced"): unknown;
};
const chess = <T>(page: Page, fn: (api: Harness, arg: T) => unknown, arg?: T) =>
  page.evaluate(
    ({ source, arg }) =>
      Function(
        "api",
        "arg",
        `return (${source})(api, arg)`,
      )((window as unknown as { __chess: Harness }).__chess, arg),
    { source: fn.toString(), arg },
  );
const resolutions = (page: Page) =>
  chess(page, (api) => api.strategicFitMetadata().resolutions.length);

for (const mobile of [false, true]) {
  const tag = mobile ? " @mobile-webkit" : "";
  const viewport = mobile ? { width: 375, height: 629 } : { width: 1280, height: 800 };

  test(`J3 Strategic Fit: the assistant prepares a decision that is recorded only after approval${tag}`, async ({
    page,
  }) => {
    test.slow();
    await installFindingWorkerFixture(page);
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
    await chess(page, (api) => api.loadPgn("1. e4 e5 (1... c5) 2. Nf3 Nc6 *", "guided-fit.pgn"));
    await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
    await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
    const before = await currentPgn(page);
    const approve = {
      action: {
        kind: "approve_proposal",
        proposalId: "$proposalId:strategic_fit_decision",
        previewVersion: "$previewVersion:strategic_fit_decision",
        approvalMessageId: "$messageId",
      },
    };
    await installScript(page, {
      "Help me improve this repertoire and go ahead and apply what you find": [
        { action: { kind: "navigate", surface: "strategicFit.assessment" } },
        { action: { kind: "submit", workflow: "strategic_fit_analyze" } },
        { action: { kind: "select_result", resultId: "$reportId", itemId: "$finding" } },
        {
          action: {
            kind: "set_fields",
            form: "decision",
            values: { findingId: "$selectedFinding", decision: "defer" },
          },
        },
        // "Apply what you find" is not approval of a preview the user has not seen yet.
        approve,
        { text: "I prepared Defer for this finding. Shall I record it?" },
      ],
      "Yes, record it.": [approve, { text: "Recorded. The analysis is refreshing." }],
    });

    await ask(page, "Help me improve this repertoire and go ahead and apply what you find");
    const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
    const prepared = dialog.locator("[data-prepared-decision='defer']");
    await expect(prepared).toBeVisible({ timeout: 30_000 });
    await expect(prepared).toContainText("Nothing is recorded until you record it");
    await expect(prepared).toBeInViewport();
    await test
      .info()
      .attach("prepared-decision", { body: await page.screenshot(), contentType: "image/png" });
    await expect
      .poll(async () => (await receipts(page)).map((receipt) => receipt.error ?? receipt.status))
      .toEqual(["completed", "completed", "completed", "completed", "approval_not_presented"]);
    expect(await resolutions(page)).toBe(0);

    // The assistant's status and its route back to the conversation live inside the dialog.
    const controls = dialog.getByRole("complementary", { name: "Assistant controls" });
    await expect(controls).toContainText("completed");
    await controls.getByRole("button", { name: "Return to chat", exact: true }).click();
    // Returning lands on the newest reply, not the top of the conversation.
    await expect(
      page.getByText("I prepared Defer for this finding. Shall I record it?"),
    ).toBeInViewport();
    await test
      .info()
      .attach("chat-steps", { body: await page.screenshot(), contentType: "image/png" });
    await ask(page, "Yes, record it.");
    await expect.poll(() => resolutions(page), { timeout: 15_000 }).toBe(1);
    expect((await receipts(page)).at(-1)?.status).toBe("completed");
    expect(await currentPgn(page)).toBe(before);
  });

  test(`J4 account import fills the visible form, names the scope, and keeps the repertoire${tag}`, async ({
    page,
  }) => {
    await openApp(page, viewport);
    const before = await currentPgn(page);
    await installScript(
      page,
      {
        "Import my Lichess games, my account is fixture-user": [
          {
            action: {
              kind: "set_fields",
              form: "history",
              values: { platform: "lichess", username: "fixture-user" },
            },
          },
          { action: { kind: "submit", workflow: "import_history" } },
          { text: "I fetched and reviewed your games." },
        ],
      },
      "import",
    );
    await ask(page, "Import my Lichess games, my account is fixture-user");
    const history = page.locator("[data-guided-surface='analysis.history']");
    await expect(history.getByRole("textbox", { name: "Username" })).toHaveValue("fixture-user");
    await expect(history.locator("[data-import-notice='status']")).toContainText(
      "Fetched 3 games for fixture-user (the latest 20 Lichess games); reviewing 3. Your repertoire is unchanged.",
    );
    await expect
      .poll(async () => (await receipts(page)).at(-1)?.result?.selected_for_review)
      .toBe(3);
    // A long request in the one-line compact status must not widen the page.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await expect(history.locator("[data-import-notice='status']")).toBeInViewport();
    await test
      .info()
      .attach("import-notice", { body: await page.screenshot(), contentType: "image/png" });
    expect(await currentPgn(page)).toBe(before);
  });

  test(`J5 an assistant export is generated and saved only by the user's Save press${tag}`, async ({
    page,
  }) => {
    await openApp(page, { ...viewport, pgn: "1. e4 e5 *", fileName: "one-game.pgn" });
    await installScript(
      page,
      {
        "Export an annotated copy of this game": [
          { action: { kind: "submit", workflow: "export_game" } },
          { text: "The annotated game is ready. Press Save to keep it." },
        ],
      },
      "export",
    );
    let downloads = 0;
    page.on("download", () => downloads++);
    await ask(page, "Export an annotated copy of this game");
    const record = page.locator("[data-export-command='export_annotated_pgn']");
    await expect(record).toHaveAttribute("data-export-state", "generated");
    await expect(record).toContainText("It is not saved until you press Save annotated game.");
    // The receipt reaches the transport on the round after the UI updates.
    await expect.poll(async () => (await receipts(page)).at(-1)?.result?.generated).toBe(true);
    expect((await receipts(page)).at(-1)?.result?.saved).toBe(false);
    expect(downloads).toBe(0);
    await test
      .info()
      .attach("export-generated", { body: await page.screenshot(), contentType: "image/png" });

    const download = page.waitForEvent("download");
    await record.getByRole("button", { name: "Save annotated game", exact: true }).click();
    expect((await download).suggestedFilename()).toBe("annotated-game.pgn");
    await expect(record).toHaveAttribute("data-export-state", "saved");
    await expect(
      record.getByRole("button", { name: "Download annotated game again", exact: true }),
    ).toBeVisible();
  });

  test(`the assistant opens the Replacement Lab, and leaving it for chat keeps its state${tag}`, async ({
    page,
  }) => {
    test.slow();
    await installFindingWorkerFixture(page, true);
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
    await chess(page, (api) => api.loadPgn("1. e4 e5 (1... c5) 2. Nf3 Nc6 *", "guided-lab.pgn"));
    await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
    await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
    const before = await currentPgn(page);
    await installScript(page, {
      "Find a more familiar line to replace this one": [
        { action: { kind: "navigate", surface: "strategicFit.review" } },
        { action: { kind: "submit", workflow: "strategic_fit_analyze" } },
        { action: { kind: "select_result", resultId: "$reportId", itemId: "$finding" } },
        { action: { kind: "submit", workflow: "lab_open", target: "$selectedFinding" } },
        {
          action: {
            kind: "set_fields",
            form: "replacementLab",
            values: { pivotDecisionId: "$pivot" },
          },
        },
        { text: "I chose the decision to replace. Generate when you are ready." },
      ],
      "Show me the lab again": [
        { action: { kind: "navigate", surface: "strategicFit.lab" } },
        { text: "Here it is." },
      ],
    });
    await ask(page, "Find a more familiar line to replace this one");
    const lab = page.getByRole("dialog", { name: "Replacement Lab" });
    await expect(lab).toBeVisible({ timeout: 30_000 });
    const generate = lab.getByRole("button", { name: "Generate and stage previews" });
    await expect(generate).toBeEnabled();
    const pivot = lab.getByRole("radio", { checked: true });
    await expect(pivot).toHaveCount(1);
    const label = (radio: typeof pivot) =>
      radio.evaluate((element) => (element as HTMLInputElement).labels?.[0]?.textContent ?? "");
    const pivotName = await label(pivot);
    expect(pivotName).not.toBe("");
    const controls = lab.getByRole("complementary", { name: "Assistant controls" });
    await expect(controls).toContainText("completed");
    await test
      .info()
      .attach("lab-assistant", { body: await page.screenshot(), contentType: "image/png" });

    await controls.getByRole("button", { name: "Return to chat", exact: true }).click();
    await expect(lab).toHaveCount(0);
    await ask(page, "Show me the lab again");
    await expect(lab).toBeVisible();
    expect(await label(lab.getByRole("radio", { checked: true }))).toBe(pivotName);
    await expect(generate).toBeEnabled();
    expect(await currentPgn(page)).toBe(before);
  });
}

test("settings open at the requested section and credentials stay the user's", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  await installScript(page, {
    "I want to add my Lichess token": [
      { action: { kind: "open_settings", section: "lichess-token" } },
      { text: "Paste your token into the Lichess API token field." },
    ],
  });
  await ask(page, "I want to add my Lichess token");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await expect(settings.locator("[data-settings-field='lichess-token']")).toBeFocused();
  await expect(settings.locator("[data-settings-field='lichess-token']")).toHaveValue("");
});
