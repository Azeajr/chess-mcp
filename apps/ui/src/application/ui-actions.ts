export { uiToolSchemas } from "./ui-action-schema";
import { currentTree, currentPath, fen, color, documentId, version, dirty } from "../store/game";
import { backgroundSuspended } from "../store/shortcuts";
import { mobileTab } from "../store/ui";
import { commandStates, commandIsStale } from "../store/commands";
import {
  comparisonDraft,
  comparisonVersion,
  comparisonOpen,
  interactionEpoch,
  guidedSurface,
  presentGuidedSurface,
  setComparisonDraft,
  selectedReview,
} from "../store/guided-ui";
import { comparePosition, reviewGame } from "./analysis-workflows";
import type { CommandExecutionOptions } from "../store/commands";
import { selectReviewedMove } from "./review-selection";

export function uiStateToken() {
  return JSON.stringify([
    documentId(),
    version(),
    color(),
    fen(),
    currentPath().join("."),
    interactionEpoch(),
    comparisonVersion(),
  ]);
}

export function uiSnapshot() {
  const stats = currentTree().stats();
  const results = (
    ["get_game_summary", "analyze_game", "compare_moves", "evaluate_position"] as const
  ).map((name) => {
    const state = commandStates()[name];
    return {
      command: name,
      resultId: state.resultId,
      status: state.status,
      stale: commandIsStale(name),
      error: state.error,
      progress: state.progress,
      comparedCandidates: name === "compare_moves" ? state.args?.moves : undefined,
      // Stable ply identities, bounded independently from full evidence retrieval.
      moves:
        name === "analyze_game" && Array.isArray(state.result?.moves)
          ? [...(state.result.moves as Record<string, unknown>[])]
              .sort((a, b) => Number(b.cp_loss ?? 0) - Number(a.cp_loss ?? 0))
              .slice(0, 20)
              .map((move) => ({
                ply: move.ply,
                san: move.san,
                classification: move.classification,
              }))
          : undefined,
      movesTruncated:
        name === "analyze_game" &&
        Array.isArray(state.result?.moves) &&
        state.result.moves.length > 20,
    };
  });
  return {
    schemaVersion: 1,
    stateToken: uiStateToken(),
    interactionEpoch: interactionEpoch(),
    document: {
      id: documentId(),
      revision: version(),
      kind: stats.nodes <= 1 ? "empty" : stats.leaves > 1 ? "repertoire" : "game",
      fen: fen(),
      sanPath: currentTree().sanPathAt(currentPath()).slice(-80),
      sanPathTruncated: currentPath().length > 80,
      color: color(),
      dirty: dirty(),
    },
    presentation: {
      activeSurface: guidedSurface(),
      mobileTab: mobileTab(),
      comparisonOpen: comparisonOpen(),
      blockingDialog: backgroundSuspended(),
      selectedReview: selectedReview(),
      layout:
        typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches
          ? "compact"
          : "wide",
    },
    comparison: {
      candidates: comparisonDraft().slice(0, 500),
      truncated: comparisonDraft().length > 500,
      version: comparisonVersion(),
    },
    results,
    disabledReason: backgroundSuspended() ? "Finish the open dialog first." : undefined,
    availableActions: backgroundSuspended()
      ? []
      : ["navigate", "set_fields", "submit", "select_result"],
    userOnly: ["file selection", "proposal acceptance", "credentials", "training attempt"],
  };
}

type UiAction =
  | { kind: "navigate"; surface: "analysis.review" | "analysis.compare" | "document.open" }
  | { kind: "set_fields"; candidates: string }
  | { kind: "submit"; workflow: "review" | "compare" }
  | { kind: "select_result"; resultId: string; ply: number };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  return (
    Object.keys(value).length === allowed.length &&
    Object.keys(value).every((key) => allowed.includes(key))
  );
}
function validAction(value: unknown): value is UiAction {
  if (!record(value)) return false;
  if (value.kind === "navigate")
    return (
      keys(value, ["kind", "surface"]) &&
      ["analysis.review", "analysis.compare", "document.open"].includes(String(value.surface))
    );
  if (value.kind === "set_fields")
    return (
      keys(value, ["kind", "candidates"]) &&
      typeof value.candidates === "string" &&
      value.candidates.length <= 500
    );
  if (value.kind === "submit")
    return (
      keys(value, ["kind", "workflow"]) && ["review", "compare"].includes(String(value.workflow))
    );
  return (
    value.kind === "select_result" &&
    keys(value, ["kind", "resultId", "ply"]) &&
    typeof value.resultId === "string" &&
    value.resultId.length <= 200 &&
    Number.isInteger(value.ply) &&
    Number(value.ply) >= 1 &&
    Number(value.ply) <= 10000
  );
}

function failure(error: string, reason: string) {
  return { status: "blocked", error, reason, presentation: "deferred", state: uiSnapshot() };
}

// Session-only bounded receipts. Never evict a receipt and risk replaying its action.
const receipts = new Map<string, { request: string; result: Promise<unknown> }>();

export async function executeUiTool(
  name: string,
  raw: unknown,
  options: CommandExecutionOptions = {},
): Promise<unknown> {
  if (options.signal?.aborted) return failure("cancelled", "The request stopped.");
  if (name === "ui_get_state") {
    if (
      !record(raw) ||
      Object.keys(raw).some((key) => !["resultId", "offset"].includes(key)) ||
      (raw.resultId !== undefined &&
        (typeof raw.resultId !== "string" || raw.resultId.length > 200)) ||
      (raw.offset !== undefined &&
        (!Number.isInteger(raw.offset) || Number(raw.offset) < 0 || Number(raw.offset) > 10000))
    )
      return failure(
        "invalid_arguments",
        "Use an optional current resultId and nonnegative offset.",
      );
    if (raw.resultId === undefined) return uiSnapshot();
    const entry = (
      ["get_game_summary", "analyze_game", "compare_moves", "evaluate_position"] as const
    ).find((command) => commandStates()[command].resultId === raw.resultId);
    if (!entry || commandIsStale(entry))
      return failure("stale_result", "That result is no longer current.");
    const result = commandStates()[entry].result;
    const offset = Number(raw.offset ?? 0);
    const list = result?.moves ?? result?.lines;
    return {
      state: uiSnapshot(),
      resultId: raw.resultId,
      evidence: Array.isArray(list) ? list.slice(offset, offset + 10) : result,
      offset,
      next_offset: Array.isArray(list) && list.length > offset + 10 ? offset + 10 : null,
    };
  }
  if (
    name !== "ui_act" ||
    !record(raw) ||
    !keys(raw, ["actionId", "stateToken", "action"]) ||
    typeof raw.actionId !== "string" ||
    !raw.actionId.length ||
    raw.actionId.length > 200 ||
    typeof raw.stateToken !== "string" ||
    raw.stateToken.length > 4000 ||
    !validAction(raw.action)
  )
    return failure("invalid_arguments", "Use a supported UI action and the current stateToken.");
  const request = JSON.stringify([raw.stateToken, raw.action]);
  const existing = receipts.get(raw.actionId);
  if (existing)
    return existing.request === request
      ? existing.result
      : failure("action_id_conflict", "Use a new actionId for new inputs.");
  if (receipts.size >= 1000)
    return failure(
      "session_limit",
      "Reload before starting further UI actions; completed work is retained by existing stores.",
    );
  const action = raw.action;
  const token = raw.stateToken;
  const result = Promise.resolve().then(async () => {
    if (options.signal?.aborted) return failure("cancelled", "The request stopped.");
    if (token !== uiStateToken())
      return failure(
        "stale_ui",
        "The document, position or inputs changed. Read current UI state before continuing.",
      );
    if (backgroundSuspended())
      return failure("dialog_open", "Finish the open dialog before continuing.");
    const epoch = interactionEpoch();
    let value: unknown;
    let surface: "analysis.review" | "analysis.compare" | "document.open";
    if (action.kind === "navigate") surface = action.surface;
    else if (action.kind === "set_fields") surface = "analysis.compare";
    else if (action.kind === "submit")
      surface = action.workflow === "review" ? "analysis.review" : "analysis.compare";
    else surface = "analysis.review";
    const visible = await presentGuidedSurface(surface, options.signal);
    if (options.signal?.aborted || epoch !== interactionEpoch())
      return failure("cancelled", "You took control before this step completed.");
    if (token !== uiStateToken())
      return failure("stale_ui", "The position or inputs changed while opening the view.");
    if (!visible)
      return failure(
        "presentation_unavailable",
        "The requested view could not be shown. No workflow was submitted.",
      );
    if (action.kind === "set_fields") setComparisonDraft(action.candidates);
    if (action.kind === "submit") {
      if (action.workflow === "review" && currentTree().stats().leaves > 1)
        return failure(
          "mainline_confirmation_required",
          "This is a repertoire. Ask whether mainline review is intended; direct mainline chess tools remain available.",
        );
      value = await (action.workflow === "review" ? reviewGame : comparePosition)({
        ...options,
        returnErrors: true,
      });
    }
    if (action.kind === "select_result") {
      if (!selectReviewedMove(action.resultId, action.ply))
        return failure("stale_result", "Select a move from the current completed review.");
    }
    if (options.signal?.aborted || epoch !== interactionEpoch())
      return failure("cancelled", "The request stopped; completed results remain in their views.");
    const error = record(value) && typeof value.error === "string" ? value.error : undefined;
    return {
      actionId: raw.actionId,
      status: error ? "failed" : "completed",
      error,
      result: value,
      presentation: "visible",
      state: uiSnapshot(),
    };
  });
  receipts.set(raw.actionId, { request, result });
  return result;
}
