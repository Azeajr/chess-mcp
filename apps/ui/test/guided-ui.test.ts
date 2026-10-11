import test from "node:test";
import assert from "node:assert/strict";
import { actions, currentPath, currentTree } from "../src/store/game.ts";
import { executeUiTool, uiSnapshot, uiToolSchemas } from "../src/application/ui-actions.ts";
import {
  registerGuidedPresenter,
  comparisonDraft,
  setComparisonDraft,
  manualIntervention,
} from "../src/store/guided-ui.ts";
import { commandStates, executeCommand } from "../src/store/commands.ts";
import { reviewGame, comparePosition } from "../src/application/analysis-workflows.ts";
import { operations, resetOperationsForTesting } from "../src/store/operations.ts";
import { assistantToolSchemas, toolSchemas, runAssistantTool } from "../src/llm/tools.ts";
import type { CommandExecutionOptions } from "../src/store/commands.ts";
import { pushShortcutScope } from "../src/store/shortcuts.ts";

let sequence = 0;
const request = (action: unknown) => ({
  actionId: `test-action-${++sequence}`,
  stateToken: uiSnapshot().stateToken,
  action,
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const executor: CommandExecutionOptions["executor"] = async (name) =>
  name === "analyze_game"
    ? {
        total_moves: 2,
        moves: [
          { ply: 1, san: "e4", classification: "good" },
          { ply: 2, san: "e5", classification: "mistake" },
        ],
      }
    : name === "evaluate_position"
      ? { lines: [{ san: "d4" }] }
      : name === "compare_moves"
        ? {
            moves: [
              { san: "e4", cp: 10 },
              { san: "bad", error: "illegal_move" },
            ],
          }
        : { total_moves: 2 };

test.afterEach(() => resetOperationsForTesting());

test("UI tools supplement every canonical chess schema without changing it", () => {
  assert.deepEqual(assistantToolSchemas.slice(0, toolSchemas.length), toolSchemas);
  assert.deepEqual(assistantToolSchemas.slice(toolSchemas.length), uiToolSchemas);
  assert.equal(
    new Set(assistantToolSchemas.map((tool) => tool.function.name)).size,
    assistantToolSchemas.length,
  );
});

test("shared review publishes once, deduplicates UI retries, selects pre-move position", async () => {
  actions.loadPgn("1. e4 e5 *");
  const shown: string[] = [];
  const dispose = registerGuidedPresenter(async (surface) => {
    shown.push(surface);
    return true;
  });
  const calls: string[] = [];
  const options = {
    executor: async (...args: Parameters<NonNullable<typeof executor>>) => {
      calls.push(args[0]);
      return executor!(...args);
    },
  };
  try {
    const input = request({ kind: "submit", workflow: "review" });
    const [first, duplicate] = await Promise.all([
      executeUiTool("ui_act", input, options),
      executeUiTool("ui_act", input, options),
    ]);
    assert.deepEqual(first, duplicate);
    assert.deepEqual(calls, ["get_game_summary", "analyze_game"]);
    assert.deepEqual(shown, ["analysis.review"]);
    assert.equal(operations().length, 2, "one lifecycle record per underlying command");
    assert.equal(commandStates().analyze_game.status, "completed");
    const resultId = commandStates().analyze_game.resultId;
    const selected = (await executeUiTool(
      "ui_act",
      request({ kind: "select_result", resultId, ply: 2 }),
      options,
    )) as { status: string };
    assert.equal(selected.status, "completed");
    assert.deepEqual(currentPath(), [0], "position before Black's reviewed move");
    await reviewGame(options);
    assert.deepEqual(
      calls.slice(-2),
      ["get_game_summary", "analyze_game"],
      "manual workflow uses the same executor",
    );
    const stale = (await executeUiTool(
      "ui_act",
      request({ kind: "select_result", resultId, ply: 2 }),
      options,
    )) as { error: string };
    assert.equal(stale.error, "stale_result");
  } finally {
    dispose();
  }
});

test("comparison fields are visible before submit, manual edits invalidate queued writes", async () => {
  actions.loadPgn("1. e4 e5 *");
  const dispose = registerGuidedPresenter(async () => true);
  try {
    await executeUiTool(
      "ui_act",
      request({ kind: "set_fields", form: "compare", values: { candidates: "e4 bad" } }),
    );
    assert.equal(comparisonDraft(), "e4 bad");
    const queued = request({
      kind: "set_fields",
      form: "compare",
      values: { candidates: "d4" },
      replace: true,
    });
    manualIntervention();
    setComparisonDraft("Nf3");
    assert.equal(((await executeUiTool("ui_act", queued)) as { error: string }).error, "stale_ui");
    assert.equal(comparisonDraft(), "Nf3");
    await comparePosition({ executor });
    assert.deepEqual(commandStates().compare_moves.args?.moves, ["Nf3"]);
    assert.deepEqual(commandStates().compare_moves.result?.moves, [
      { san: "e4", cp: 10 },
      { san: "bad", error: "illegal_move" },
    ]);
  } finally {
    dispose();
  }
});

test("Stop cancels the shared command and prevents the next workflow step", async () => {
  actions.loadPgn("1. e4 e5 *");
  const controller = new AbortController();
  let release!: (value: unknown) => void;
  let calls = 0;
  const pending = reviewGame({
    signal: controller.signal,
    executor: async () => {
      calls++;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  await tick();
  controller.abort();
  assert.equal(commandStates().get_game_summary.status, "cancelled");
  release({ total_moves: 2 });
  await pending;
  assert.equal(calls, 1);
  assert.equal(commandStates().get_game_summary.status, "cancelled");
});

test("superseded command completion cannot overwrite the newer result", async () => {
  let release!: (value: unknown) => void;
  const first = executeCommand(
    "compare_moves",
    {},
    {
      executor: async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
  );
  await tick();
  await executeCommand("compare_moves", {}, { executor: async () => ({ marker: "new" }) });
  release({ marker: "old" });
  await first;
  assert.equal(commandStates().compare_moves.result?.marker, "new");
});

test("unavailable presentation, dialogs and forged acceptance have no side effects", async () => {
  actions.loadPgn("1. e4 e5 *");
  const pgn = currentTree().toPgn();
  let calls = 0;
  const options = {
    executor: async () => {
      calls++;
      return {};
    },
  };
  assert.equal(
    (
      (await executeUiTool("ui_act", request({ kind: "submit", workflow: "review" }), options)) as {
        error: string;
      }
    ).error,
    "presentation_unavailable",
  );
  const close = pushShortcutScope("test-dialog");
  assert.equal(
    (
      (await executeUiTool("ui_act", request({ kind: "submit", workflow: "review" }), options)) as {
        error: string;
      }
    ).error,
    "dialog_open",
  );
  close();
  assert.equal(
    (
      (await executeUiTool(
        "ui_act",
        request({ kind: "accept", proposalId: "forged" }),
        options,
      )) as { error: string }
    ).error,
    "invalid_arguments",
  );
  assert.equal(calls, 0);
  assert.equal(currentTree().toPgn(), pgn);
});

test("structured command failures are published as failed and remain available to chat", async () => {
  const result = await executeCommand(
    "analyze_game",
    {},
    { executor: async () => ({ error: "engine_unavailable" }), returnErrors: true },
  );
  assert.equal(result?.error, "engine_unavailable");
  assert.equal(commandStates().analyze_game.status, "failed");
  const invalid = await runAssistantTool("compare_moves", { surprise: true }, {});
  assert.equal((invalid as { error: string }).error, "invalid_arguments");
  assert.equal(commandStates().compare_moves.status, "failed");
});
