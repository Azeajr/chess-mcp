import test from "node:test";
import assert from "node:assert/strict";
import { actions, currentTree, version } from "../src/store/game.ts";
import { executeUiTool, uiSnapshot } from "../src/application/ui-actions.ts";
import { registerGuidedPresenter } from "../src/store/guided-ui.ts";
import { acceptStagedEdit, stageEdit, stagedEdit } from "../src/store/suggestions.ts";
import {
  approveProposal,
  expressesApproval,
  pendingProposals,
  recordPresented,
  resetProposalTrackingForTesting,
  type AssistantTurnContext,
} from "../src/application/ui-adapters/proposals.ts";
import { historyUsername, setHistoryUsername } from "../src/store/forms.ts";
import { commandStates, type CommandExecutionOptions } from "../src/store/commands.ts";
import { importNotice } from "../src/application/analysis-workflows.ts";
import { exportRecord } from "../src/store/exports.ts";
import { setApiKey, setLichessToken } from "../src/store/settings.ts";
import { analysisDepth, setAnalysisDepth } from "../src/store/engine-settings.ts";
import { setPruneSuggestionsForTesting } from "../src/store/repertoire.ts";
import { preview } from "../src/store/suggestions.ts";
import {
  prepareDecision,
  preparedDecision,
  acceptPreparedDecision,
  resetPreparedDecisionsForTesting,
} from "../src/store/strategic-fit-decision-drafts.ts";
import { resetOperationsForTesting } from "../src/store/operations.ts";

let sequence = 0;
const request = (action: unknown) => ({
  actionId: `phase-action-${++sequence}`,
  stateToken: uiSnapshot().stateToken,
  action,
});
const turn = (turnId: number, text: string): AssistantTurnContext => ({
  turnId,
  messageId: `user-message-${turnId}`,
  text,
});
type Receipt = { status: string; error?: string; result?: Record<string, unknown> };
const act = async (action: unknown, options: Record<string, unknown> = {}) =>
  (await executeUiTool("ui_act", request(action), options)) as Receipt;

let disposePresenter: () => void = () => undefined;
test.beforeEach(() => {
  resetProposalTrackingForTesting();
  resetPreparedDecisionsForTesting();
  disposePresenter = registerGuidedPresenter(async () => true);
});
test.afterEach(() => {
  disposePresenter();
  resetOperationsForTesting();
});

const stageNf3 = () => {
  actions.loadPgn("1. e4 e5 *");
  const staged = stageEdit("add", ["e4", "e5"], { addMoves: ["Nf3"] });
  assert.equal(staged.ok, true);
  const id = (staged as { action_id: string }).action_id;
  const proposal = pendingProposals().find((item) => item.proposalId === `repertoire_edit:${id}`)!;
  return { id, proposal };
};

test("approval wording is conservative: questions, refusals and changes are not approvals", () => {
  assert.equal(expressesApproval("Yes, apply it."), true);
  assert.equal(expressesApproval("go ahead"), true);
  assert.equal(expressesApproval("What does it change?"), false);
  assert.equal(expressesApproval("No, don't."), false);
  assert.equal(expressesApproval("Yes but use Nc3 instead"), false);
  assert.equal(expressesApproval("Help me improve this repertoire"), false);
});

test("a verified chat approval applies the single presented preview exactly once", async () => {
  const { id, proposal } = stageNf3();
  const before = version();
  recordPresented(1, [proposal]);
  const approval = turn(2, "Yes, apply that change.");
  const input = {
    proposalId: proposal.proposalId,
    previewVersion: proposal.previewVersion,
    approvalMessageId: approval.messageId,
  };
  // A card press racing the chat approval: both reach the same writer, only one applies.
  const [chat, card] = await Promise.all([
    approveProposal(input, approval),
    Promise.resolve().then(() => acceptStagedEdit(id)),
  ]);
  assert.equal([chat.ok, card.ok].filter(Boolean).length, 1, "exactly one application");
  assert.equal(stagedEdit(id)?.status, "accepted");
  assert.equal(version(), before + 1, "one revision step");
  assert.match(currentTree().toPgn(), /2\. Nf3/);
  const again = await approveProposal(input, approval);
  assert.equal(again.code, "approval_already_used");
  assert.equal(version(), before + 1);
});

test("forged, unpresented, ambiguous, implicit and stale approvals change nothing", async () => {
  const { proposal } = stageNf3();
  const pgn = currentTree().toPgn();
  const input = (messageId: string) => ({
    proposalId: proposal.proposalId,
    previewVersion: proposal.previewVersion,
    approvalMessageId: messageId,
  });

  const current = turn(2, "Yes, apply it.");
  assert.equal(
    (await approveProposal(input("user-message-1"), current)).code,
    "approval_message_invalid",
  );
  assert.equal(
    (await approveProposal(input(current.messageId), undefined)).code,
    "approval_message_invalid",
  );
  // Staged and "approved" in the same turn: the user never saw it before answering.
  recordPresented(2, [proposal]);
  assert.equal(
    (await approveProposal(input(current.messageId), current)).code,
    "approval_not_presented",
  );

  recordPresented(2, [proposal]);
  const question = turn(3, "What would that add?");
  assert.equal(
    (await approveProposal(input(question.messageId), question)).code,
    "approval_not_explicit",
  );

  const second = stageEdit("add", ["e4", "e5"], { addMoves: ["Nc3"] }) as { action_id: string };
  const other = pendingProposals().find(
    (item) => item.proposalId === `repertoire_edit:${second.action_id}`,
  )!;
  recordPresented(3, [proposal, other]);
  const yes = turn(4, "yes, apply it");
  const ambiguous = await approveProposal(input(yes.messageId), yes);
  assert.equal(ambiguous.code, "approval_ambiguous");
  assert.equal(ambiguous.candidates?.length, 2);

  recordPresented(4, [proposal]);
  const later = turn(5, "OK, apply it");
  assert.equal(
    (await approveProposal({ ...input(later.messageId), previewVersion: "forged@0" }, later)).code,
    "approval_stale",
  );
  assert.equal(currentTree().toPgn(), pgn, "no rejected route changed the document");

  // The document moves on after the preview was shown: the stale preview is never applied.
  recordPresented(5, [proposal]);
  actions.applyEdit("add", ["e4", "e5"], { addMoves: ["d4"] }, version());
  const stale = turn(6, "Yes, apply it");
  const outcome = await approveProposal(input(stale.messageId), stale);
  assert.equal(outcome.ok, false);
  assert.match(outcome.code ?? "", /stale|not_pending/);
  assert.doesNotMatch(currentTree().toPgn(), /Nf3/);
});

test("a model call alone cannot approve: ui_act needs the current user message", async () => {
  const { proposal } = stageNf3();
  recordPresented(1, [proposal]);
  const pgn = currentTree().toPgn();
  const forged = await act(
    {
      kind: "approve_proposal",
      proposalId: proposal.proposalId,
      previewVersion: proposal.previewVersion,
      approvalMessageId: "user-message-2",
    },
    {},
  );
  assert.equal(forged.status, "blocked");
  assert.equal(forged.error, "approval_message_invalid");
  const generated = await act({ kind: "accept", proposalId: proposal.proposalId });
  assert.equal(generated.error, "invalid_arguments");
  assert.equal(currentTree().toPgn(), pgn);
  const approved = await act(
    {
      kind: "approve_proposal",
      proposalId: proposal.proposalId,
      previewVersion: proposal.previewVersion,
      approvalMessageId: "user-message-2",
    },
    { turn: turn(2, "Yes, add it") },
  );
  assert.equal(approved.status, "completed");
  assert.match(currentTree().toPgn(), /Nf3/);
});

test("show_proposal presents for the next turn; a decision prepared for a finding stays staged", async () => {
  actions.loadPgn("1. e4 e5 (1... c5) *");
  const decision = prepareDecision({
    reportId: "report-1",
    findingId: "finding-1",
    semanticFindingId: "semantic-1",
    state: "defer",
    reason: null,
    note: "",
  });
  const id = `strategic_fit_decision:${decision.proposalId}`;
  assert.equal(
    pendingProposals().some((item) => item.proposalId === id),
    true,
  );
  const shown = await act({ kind: "show_proposal", proposalId: id }, { turn: turn(7, "show me") });
  assert.equal(shown.status, "completed");
  assert.equal(preparedDecision(decision.proposalId)?.status, "pending", "showing never records");
  // The document changes before anyone records it: the prepared decision goes stale.
  actions.applyEdit("add", ["e4", "e5"], { addMoves: ["Nf3"] }, version());
  assert.equal(acceptPreparedDecision(decision.proposalId).state, "blocked");
  assert.equal(preparedDecision(decision.proposalId)?.status, "stale");
});

test("filled forms win over assistant drafts unless the request replaces them", async () => {
  actions.loadPgn("1. e4 e5 *");
  setHistoryUsername("my-own-account");
  const conflict = await act({
    kind: "set_fields",
    form: "history",
    values: { platform: "lichess", username: "someone-else" },
  });
  assert.equal(conflict.error, "draft_conflict");
  assert.equal(historyUsername(), "my-own-account");
  const replaced = await act({
    kind: "set_fields",
    form: "history",
    values: { username: "someone-else" },
    replace: true,
  });
  assert.equal(replaced.status, "completed");
  assert.equal(historyUsername(), "someone-else");
  const bad = await act({ kind: "set_fields", form: "history", values: { month: "2026-13" } });
  assert.equal(bad.error, "invalid_arguments");
});

test("account import names the scope, separates fetched from reviewed, and keeps the repertoire", async () => {
  actions.loadPgn("1. e4 e5 (1... c5) *");
  const pgn = currentTree().toPgn();
  setHistoryUsername("fixture-user");
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const games = Array.from({ length: 25 }, (_, index) => ({
    pgn: `[Event "${index}"]\n\n1. d4 *`,
  }));
  const options: CommandExecutionOptions = {
    executor: async (name, args) => {
      calls.push({ name, args: args as Record<string, unknown> });
      return name === "lichess_games" ? { games } : { count: 20, games_reviewed: 20 };
    },
  };
  const receipt = await act({ kind: "submit", workflow: "import_history" }, options);
  assert.equal(receipt.status, "completed");
  assert.deepEqual(
    calls.map((call) => call.name),
    ["lichess_games", "batch_review"],
  );
  assert.equal(calls[1]!.args.max_games, 20);
  assert.equal(receipt.result?.fetched, 25);
  assert.equal(receipt.result?.selected_for_review, 20);
  assert.match(
    importNotice()?.message ?? "",
    /Fetched 25 games for fixture-user .* and reviewed 20/,
  );
  assert.equal(currentTree().toPgn(), pgn);

  const empty = await act(
    { kind: "submit", workflow: "import_history" },
    { executor: async () => ({ games: [] }) },
  );
  assert.equal(empty.status, "failed");
  assert.equal(empty.error, "no_games");
  assert.equal(importNotice()?.tone, "alert");
  assert.match(importNotice()?.message ?? "", /No public games found for fixture-user/);
});

test("an assistant export is generated, not saved, until the Save control is pressed", async () => {
  actions.loadPgn("1. e4 e5 *");
  const receipt = await act(
    { kind: "submit", workflow: "export_game" },
    {
      executor: async () => {
        const { createArtifact } = await import("../src/store/artifacts.ts");
        return createArtifact("pgn", "1. e4 e5 *", "annotated-game.pgn");
      },
    },
  );
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.result?.generated, true);
  assert.equal(receipt.result?.saved, false);
  const record = exportRecord("export_annotated_pgn");
  assert.equal(record?.generatedBy, "assistant");
  assert.equal(record?.save, null);
  assert.equal(commandStates().export_annotated_pgn.status, "completed");
});

test("settings: only requested public values change, and secrets never enter state", async () => {
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  });
  setApiKey("sk-or-secret-value");
  setLichessToken("lip_secret_value");
  const snapshot = JSON.stringify(uiSnapshot());
  assert.doesNotMatch(snapshot, /secret_value|secret-value/);
  assert.match(snapshot, /"openrouter_key_configured":true/);
  setAnalysisDepth(20);
  const setting = {
    kind: "set_setting",
    setting: "analysis_depth",
    value: 12,
    requestMessageId: "user-message-9",
  };
  const inferred = await act(setting, { turn: turn(9, "Review this game for me") });
  assert.equal(inferred.error, "setting_not_requested");
  assert.equal(analysisDepth(), 20);
  const forged = await act(setting, { turn: turn(10, "Use depth 12") });
  assert.equal(forged.error, "request_message_invalid");
  const requested = await act(setting, { turn: turn(9, "Use depth 12 from now on") });
  assert.equal(requested.status, "completed");
  assert.equal(analysisDepth(), 12);
  const apiKey = await act({
    kind: "set_setting",
    setting: "api_key",
    value: "x",
    requestMessageId: "user-message-9",
  });
  assert.equal(apiKey.error, "invalid_arguments");
  setAnalysisDepth(20);
  setApiKey("");
  setLichessToken("");
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

test("selecting a Shorten suggestion stages a preview proposal and edits nothing", async () => {
  actions.loadPgn("1. d4 d5 2. c4 e6 (2... c6 3. Nf3) 3. Nc3 *");
  const pgn = currentTree().toPgn();
  setPruneSuggestionsForTesting([
    {
      linePath: ["d4", "d5", "c4", "c6", "Nf3"],
      atPath: ["d4", "d5", "c4", "c6"],
      rerouteMove: "Nc3",
      joinsPath: ["d4", "d5", "c4", "e6", "Nc3"],
      savedPlies: 1,
      evalDelta: 0,
    } as never,
  ]);
  const state = uiSnapshot().repertoire as {
    shorten: { resultId: string; items: { itemId: string }[] };
  };
  const item = state.shorten.items[0]!;
  const selected = await act({
    kind: "select_result",
    resultId: state.shorten.resultId,
    itemId: item.itemId,
  });
  assert.equal(selected.status, "completed");
  assert.equal(selected.result?.previewStaged, true);
  assert.deepEqual(preview()?.sans, ["Nc3"]);
  assert.equal(currentTree().toPgn(), pgn, "a preview is not an applied change");
  assert.equal(
    pendingProposals().some((proposal) => proposal.kind === "preview_line"),
    true,
  );
  const stale = await act({
    kind: "select_result",
    resultId: "shorten:other",
    itemId: item.itemId,
  });
  assert.equal(stale.error, "stale_result");
});

test("the injected UI context stays within its budget", () => {
  actions.loadPgn("1. e4 e5 (1... c5) *");
  const json = JSON.stringify(uiSnapshot());
  assert.ok(json.length <= 12_000, `${json.length} characters`);
  const parsed = JSON.parse(json) as { document: { id: string }; proposals: unknown[] };
  assert.ok(parsed.document.id);
  assert.ok(Array.isArray(parsed.proposals));
});
