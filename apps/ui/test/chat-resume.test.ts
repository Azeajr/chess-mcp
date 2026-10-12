import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

const settings = await import("../src/store/settings.ts");
const chat = await import("../src/store/chat.ts");
const game = await import("../src/store/game.ts");
const { resumeNote } = await import("../src/application/chat-resume.ts");
const { approveProposal } = await import("../src/application/ui-adapters/proposals.ts");

const BLOCKED = {
  step: "Run Strategic Fit analysis",
  status: "blocked",
  error: "profile_setup_required",
  reason: "Strategic Fit needs the user's review preference first.",
};

const sent: { role: string; content: string | null }[][] = [];
let turnDuringCall: ReturnType<typeof chat.currentAssistantTurn> = null;

function install(result: unknown = BLOCKED) {
  settings.setApiKey("test-key");
  chat.setChatTransportForTesting(async (opts) => {
    sent.push(opts.messages.map((m) => ({ role: m.role, content: m.content })));
    const last = opts.messages.at(-1);
    if (last?.role !== "user") return { content: "Which preference do you want?", toolCalls: [] };
    return {
      content: "",
      toolCalls: [
        {
          id: `call-${sent.length}`,
          type: "function",
          function: { name: "ui_act", arguments: "{}" },
        },
      ],
    };
  });
  chat.setChatToolExecutorForTesting(async () => {
    turnDuringCall = chat.currentAssistantTurn();
    return result;
  });
}

function cleanup() {
  chat.setChatTransportForTesting();
  chat.setChatToolExecutorForTesting();
  settings.setApiKey("");
  chat.clearChat();
  sent.length = 0;
}

const REQUEST = "Run Strategic Fit on this repertoire and tell me what it found.";

test("a turn blocked on Strategic Fit setup leaves its request waiting", async (t) => {
  t.after(cleanup);
  install();
  chat.clearChat();
  await chat.send(REQUEST);
  assert.deepEqual(
    { wait: chat.pendingResume()?.wait, request: chat.pendingResume()?.request },
    { wait: "strategic-fit-setup", request: REQUEST },
  );
});

test("a turn that needs nothing from the user leaves no wait", async (t) => {
  t.after(cleanup);
  install({ status: "completed", step: "Run Strategic Fit analysis" });
  chat.clearChat();
  await chat.send(REQUEST);
  assert.equal(chat.pendingResume(), null);
});

test("the continuation runs once, as the app's note, and cannot approve anything", async (t) => {
  t.after(cleanup);
  install();
  chat.clearChat();
  await chat.send(REQUEST);
  const note = `[App] The user finished Strategic Fit setup in the app (profile: familiar-plans). Continue their request: "${REQUEST}"`;
  await chat.continueAfterWait(note);

  const request = sent.find((messages) => messages.at(-1)?.content === note);
  assert.ok(request, "the note is sent as the newest message");
  assert.equal(request.at(-1)!.role, "user");
  const continued = chat.history().find((message) => message.content === note);
  assert.equal(continued?.resume, true);

  // The tool ran inside the continuation: its turn holds no words of the user's.
  assert.match(turnDuringCall!.messageId, /^app-message-/u);
  const approval = await approveProposal(
    { proposalId: "any", previewVersion: "any", approvalMessageId: turnDuringCall!.messageId },
    turnDuringCall!,
  );
  assert.equal(approval.code, "approval_not_explicit");

  // The continuation was blocked again, so it waits again, still for the original request.
  assert.equal(chat.pendingResume()?.request, REQUEST);
  const before = sent.length;
  chat.stop();
  await chat.continueAfterWait(note);
  assert.equal(sent.length, before, "Stop dropped the wait, so nothing continues");
});

test("a new message from the user replaces the waiting request", async (t) => {
  t.after(cleanup);
  install();
  chat.clearChat();
  await chat.send(REQUEST);
  install({ status: "completed" });
  await chat.send("Never mind, evaluate this position.");
  assert.equal(chat.pendingResume(), null);
});

test("the note waits for the user's step and expires", () => {
  game.actions.loadPgn("*", "empty.pgn");
  const pending = { wait: "document-open" as const, request: "Review a game", at: Date.now() };
  assert.equal(resumeNote(pending), null, "nothing is open yet");
  game.actions.loadPgn("1. e4 e5 *", "guided-game.pgn");
  assert.equal(
    resumeNote(pending),
    '[App] The user opened guided-game.pgn. Continue their request: "Review a game"',
  );
  assert.equal(resumeNote(pending, pending.at + 31 * 60 * 1000), null, "an old request is dropped");
});
