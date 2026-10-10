export { uiToolSchemas } from "./ui-action-schema";
import { currentTree, currentPath, fen, color, documentId, version, dirty } from "../store/game";
import { mobileTab } from "../store/ui";
import { commandStates, commandIsStale, type DirectCommand } from "../store/commands";
import {
  comparisonDraft,
  comparisonVersion,
  comparisonOpen,
  interactionEpoch,
  guidedSurface,
  isGuidedSurface,
  presentGuidedSurface,
  selectedReview,
  type GuidedSurface,
} from "../store/guided-ui";
import {
  extendStyle,
  formVersion,
  historyMonth,
  historyPlatform,
  historyUsername,
  opponentUsername,
  structureQuery,
} from "../store/forms";
import { exportRecords } from "../store/exports";
import { importNotice } from "./analysis-workflows";
import type { CommandExecutionOptions } from "../store/commands";
import {
  FORMS,
  FORM_SURFACES,
  DECISION_STATES,
  PUBLIC_SETTINGS,
  SETTINGS_SECTIONS,
  WORKFLOWS,
  WORKFLOW_LABELS,
  isWorkflow,
  type FormId,
  type PublicSetting,
  type SettingsSection,
  type Workflow,
} from "./ui-adapters/catalog";
import {
  activeDialog,
  blockingDialogFor,
  revealWorkflowResult,
  SURFACE_ROUTES,
} from "./ui-adapters/surfaces";
import {
  approveProposal,
  pendingProposals,
  presentedInTurn,
  recordPresented,
  type AssistantTurnContext,
} from "./ui-adapters/proposals";
import {
  awaitFindingQueue,
  decisionPrecheck,
  strategicFitSnapshot,
  strategicFitSetupRequired,
} from "./ui-adapters/strategic-fit";
import { preparedDecision } from "../store/strategic-fit-decision-drafts";
import {
  bridgeItems,
  extendResultId,
  extensionItems,
  gapsResult,
  runWorkflow,
  selectPath,
  selectResult,
  setFormFields,
  shortcutItems,
} from "./ui-adapters/workflows";
import { applyRequestedSetting, openSettings, settingsSnapshot } from "./ui-adapters/settings";
import { strategicFitFindingQueue } from "../store/strategic-fit-finding-queue";
import { strategicFitLifecycle } from "../store/strategic-fit";
import { replacementLabSnapshot } from "../store/strategic-fit-replacement";
import {
  INTENTIONAL_RESOLUTION_REASONS,
  REPLACEMENT_CANDIDATE_SOURCE_KINDS,
} from "@chess-mcp/chess-tools";

export type UiToolOptions = CommandExecutionOptions & { turn?: AssistantTurnContext };

/** Binds an action to everything a user could change underneath it. */
export function uiStateToken() {
  return JSON.stringify([
    documentId(),
    version(),
    color(),
    fen(),
    currentPath().join("."),
    interactionEpoch(),
    comparisonVersion(),
    formVersion(),
  ]);
}

const RESULT_COMMANDS: readonly DirectCommand[] = [
  "get_game_summary",
  "analyze_game",
  "compare_moves",
  "evaluate_position",
  "tablebase_lookup",
  "position_popularity",
  "lichess_games",
  "chesscom_games",
  "batch_review",
  "repertoire_vs_history",
  "audit_repertoire_moves",
  "find_only_moves",
  "find_structures",
  "prep_vs_opponent",
];

const UI_CONTEXT_BUDGET = 12_000;

function commandResults(rows: number) {
  return RESULT_COMMANDS.map((name) => {
    const state = commandStates()[name];
    if (state.status === "idle") return null;
    const list =
      state.result?.moves ?? state.result?.findings ?? state.result?.matches ?? state.result?.lines;
    return {
      command: name,
      resultId: state.resultId,
      status: state.status,
      stale: commandIsStale(name),
      error: state.error,
      progress: state.progress,
      count: Array.isArray(list) ? list.length : undefined,
      comparedCandidates: name === "compare_moves" ? state.args?.moves : undefined,
      // Stable ply identities, bounded independently from full evidence retrieval.
      moves:
        name === "analyze_game" && Array.isArray(state.result?.moves)
          ? [...(state.result.moves as Record<string, unknown>[])]
              .sort((a, b) => Number(b.cp_loss ?? 0) - Number(a.cp_loss ?? 0))
              .slice(0, rows)
              .map((move) => ({
                ply: move.ply,
                san: move.san,
                classification: move.classification,
              }))
          : undefined,
    };
  }).filter((entry) => entry !== null);
}

function repertoireResults() {
  return {
    gaps: gapsResult(),
    connect: { resultId: `connect:${documentId()}`, items: bridgeItems() },
    shorten: { resultId: `shorten:${documentId()}`, items: shortcutItems() },
    extend: { resultId: extendResultId(), items: extensionItems() },
  };
}

/**
 * The bounded view of the interface supplied to the assistant. It summarizes active surfaces and
 * references results by identity; evidence is paged through ui_get_state. Identity, blocking
 * dialog, active work and pending decisions are never dropped to meet the budget.
 */
export function uiSnapshot(turn?: AssistantTurnContext) {
  const stats = currentTree().stats();
  const dialog = activeDialog();
  const build = (detail: "full" | "reduced") => ({
    schemaVersion: 2,
    stateToken: uiStateToken(),
    interactionEpoch: interactionEpoch(),
    conversation: turn
      ? {
          messageId: turn.messageId,
          awaitingDecision: [...presentedInTurn(turn.turnId - 1).keys()],
        }
      : null,
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
      blockingDialog: dialog,
      selectedReview: selectedReview(),
      layout:
        typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches
          ? "compact"
          : "wide",
    },
    forms: {
      version: formVersion(),
      compare: { candidates: comparisonDraft().slice(0, 500), version: comparisonVersion() },
      history: { platform: historyPlatform(), username: historyUsername(), month: historyMonth() },
      structure: { structure: structureQuery() },
      opponent: { username: opponentUsername() },
      extend: { style: extendStyle() },
    },
    results: commandResults(detail === "full" ? 20 : 5),
    importNotice: importNotice(),
    repertoire: detail === "full" ? repertoireResults() : { truncated: true },
    exports: Object.values(exportRecords()).map((entry) => ({
      command: entry.command,
      name: entry.name,
      sourceRevision: entry.revision,
      generatedBy: entry.generatedBy,
      saved: entry.save === null ? false : entry.save.ok ? true : `failed: ${entry.save.reason}`,
    })),
    strategicFit: strategicFitSnapshot(),
    proposals: pendingProposals(),
    settings: settingsSnapshot(),
    availableActions:
      dialog && dialog !== "strategic-fit" && dialog !== "replacement-lab"
        ? []
        : [
            "navigate",
            "set_fields",
            "submit",
            "select_result",
            "select_path",
            "show_proposal",
            "approve_proposal",
            "open_settings",
            "set_setting",
          ],
    disabledReason:
      dialog && dialog !== "strategic-fit" && dialog !== "replacement-lab"
        ? `The ${dialog} dialog is open. The user finishes it first.`
        : undefined,
    userOnly: [
      "file selection",
      "saving a file",
      "credentials",
      "discarding unsaved work",
      "training recall moves and attempts",
      "Strategic Fit profile setup choices",
      "accepting a proposal (Accept control, or an explicit chat approval verified by the app)",
    ],
  });
  const full = build("full");
  if (JSON.stringify(full).length <= UI_CONTEXT_BUDGET) return full;
  const reduced = build("reduced");
  const findings = reduced.strategicFit.findings;
  if (findings && JSON.stringify(reduced).length > UI_CONTEXT_BUDGET)
    reduced.strategicFit.findings = {
      ...findings,
      items: findings.items.slice(0, 4),
      truncated: true,
    };
  return reduced;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}
const shortText = (value: unknown, max = 200): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const optionalText = (value: unknown, max: number) =>
  value === undefined || (typeof value === "string" && value.length <= max);

type UiAction =
  | { kind: "navigate"; surface: GuidedSurface }
  | { kind: "set_fields"; form: FormId; values: Record<string, unknown>; replace?: boolean }
  | { kind: "submit"; workflow: Workflow; target?: string; option?: string }
  | { kind: "select_result"; resultId: string; ply?: number; itemId?: string; board?: boolean }
  | { kind: "select_path"; sanPath: string[] }
  | { kind: "show_proposal"; proposalId: string }
  | {
      kind: "approve_proposal";
      proposalId: string;
      previewVersion: string;
      approvalMessageId: string;
    }
  | { kind: "open_settings"; section: SettingsSection }
  | { kind: "set_setting"; setting: PublicSetting; value: unknown; requestMessageId: string };

function validFormValues(form: FormId, values: Record<string, unknown>): boolean {
  switch (form) {
    case "compare":
      return onlyKeys(values, ["candidates"]) && optionalText(values.candidates, 500);
    case "history":
      return (
        onlyKeys(values, [], ["platform", "username", "month"]) &&
        (values.platform === undefined ||
          values.platform === "lichess" ||
          values.platform === "chesscom") &&
        optionalText(values.username, 60) &&
        (values.month === undefined ||
          (typeof values.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(values.month)))
      );
    case "structure":
      return onlyKeys(values, ["structure"]) && optionalText(values.structure, 80);
    case "opponent":
      return onlyKeys(values, ["username"]) && optionalText(values.username, 60);
    case "extend":
      return (
        onlyKeys(values, ["style"]) &&
        (values.style === "low_memorization" || values.style === "sharp")
      );
    case "decision":
      return (
        onlyKeys(values, ["findingId", "decision"], ["reason", "note"]) &&
        shortText(values.findingId) &&
        (DECISION_STATES as readonly unknown[]).includes(values.decision) &&
        (values.reason === undefined ||
          (INTENTIONAL_RESOLUTION_REASONS as readonly unknown[]).includes(values.reason)) &&
        optionalText(values.note, 2000)
      );
    case "replacementLab":
      return (
        onlyKeys(values, [], ["pivotDecisionId", "sources", "depth"]) &&
        (values.pivotDecisionId === undefined || shortText(values.pivotDecisionId)) &&
        (values.sources === undefined ||
          (Array.isArray(values.sources) &&
            values.sources.length > 0 &&
            values.sources.every((source) =>
              (REPLACEMENT_CANDIDATE_SOURCE_KINDS as readonly unknown[]).includes(source),
            ))) &&
        (values.depth === undefined ||
          (Number.isInteger(values.depth) &&
            Number(values.depth) >= 1 &&
            Number(values.depth) <= 30))
      );
  }
}

function validAction(value: unknown): value is UiAction {
  if (!record(value)) return false;
  switch (value.kind) {
    case "navigate":
      return onlyKeys(value, ["kind", "surface"]) && isGuidedSurface(value.surface);
    case "set_fields":
      return (
        onlyKeys(value, ["kind", "form", "values"], ["replace"]) &&
        (FORMS as readonly unknown[]).includes(value.form) &&
        record(value.values) &&
        (value.replace === undefined || typeof value.replace === "boolean") &&
        validFormValues(value.form as FormId, value.values)
      );
    case "submit":
      return (
        onlyKeys(value, ["kind", "workflow"], ["target", "option"]) &&
        isWorkflow(value.workflow) &&
        (value.target === undefined || shortText(value.target, 500)) &&
        (value.option === undefined ||
          value.option === "add-alternative" ||
          value.option === "replace")
      );
    case "select_result":
      return (
        onlyKeys(value, ["kind", "resultId"], ["ply", "itemId", "board"]) &&
        shortText(value.resultId, 500) &&
        (value.ply === undefined ||
          (Number.isInteger(value.ply) && Number(value.ply) >= 1 && Number(value.ply) <= 10000)) &&
        (value.itemId === undefined || shortText(value.itemId, 500)) &&
        (value.board === undefined || typeof value.board === "boolean") &&
        (value.ply !== undefined) !== (value.itemId !== undefined)
      );
    case "select_path":
      return (
        onlyKeys(value, ["kind", "sanPath"]) &&
        Array.isArray(value.sanPath) &&
        value.sanPath.length <= 300 &&
        value.sanPath.every((san) => shortText(san, 10))
      );
    case "show_proposal":
      return onlyKeys(value, ["kind", "proposalId"]) && shortText(value.proposalId, 500);
    case "approve_proposal":
      return (
        onlyKeys(value, ["kind", "proposalId", "previewVersion", "approvalMessageId"]) &&
        shortText(value.proposalId, 500) &&
        shortText(value.previewVersion, 2000) &&
        shortText(value.approvalMessageId)
      );
    case "open_settings":
      return (
        onlyKeys(value, ["kind", "section"]) &&
        (SETTINGS_SECTIONS as readonly unknown[]).includes(value.section)
      );
    case "set_setting":
      return (
        onlyKeys(value, ["kind", "setting", "value", "requestMessageId"]) &&
        (PUBLIC_SETTINGS as readonly unknown[]).includes(value.setting) &&
        ["number", "boolean", "string"].includes(typeof value.value) &&
        shortText(value.requestMessageId)
      );
    default:
      return false;
  }
}

function failure(error: string, reason: string, extra: Record<string, unknown> = {}) {
  return {
    status: "blocked",
    error,
    reason,
    ...extra,
    presentation: "deferred",
    state: uiSnapshot(),
  };
}

/** What a step does, in the interface's own words; the receipt status says whether it happened. */
function describe(action: UiAction): string {
  switch (action.kind) {
    case "navigate":
      return `Open ${SURFACE_ROUTES[action.surface].label}`;
    case "set_fields":
      return action.form === "decision"
        ? "Prepare a decision for you to record"
        : `Fill ${SURFACE_ROUTES[FORM_SURFACES[action.form]].label}`;
    case "submit":
      return `Run ${WORKFLOW_LABELS[action.workflow]}`;
    case "select_result":
      return action.ply === undefined ? "Select a result" : `Select reviewed move ${action.ply}`;
    case "select_path":
      return `Move the board to ${action.sanPath.length ? action.sanPath.join(" ") : "the start"}`;
    case "show_proposal":
      return "Show a proposed change for your decision";
    case "approve_proposal":
      return "Apply the change you approved";
    case "open_settings":
      return "Open Settings";
    case "set_setting":
      return `Change ${action.setting.replaceAll("_", " ")}`;
  }
}

/** The surface an action reveals before it runs, when it has one. */
function surfaceFor(action: UiAction): GuidedSurface | null {
  switch (action.kind) {
    case "navigate":
      return action.surface;
    case "set_fields":
      return FORM_SURFACES[action.form];
    case "submit":
      return WORKFLOWS[action.workflow];
    case "select_result":
      return action.ply !== undefined ? "analysis.review" : null;
    case "select_path":
      return "workspace.board";
    case "show_proposal":
    case "approve_proposal":
    case "open_settings":
    case "set_setting":
      return null;
  }
}

function proposalSurface(proposalId: string): GuidedSurface | null {
  const proposal = pendingProposals().find((item) => item.proposalId === proposalId);
  return proposal && proposal.surface !== "chat" ? proposal.surface : null;
}

// Session-only receipts. Never evict a receipt and risk replaying its action.
const receipts = new Map<string, { request: string; result: Promise<unknown> }>();

function evidencePage(resultId: string, offset: number) {
  const command = RESULT_COMMANDS.find((name) => commandStates()[name].resultId === resultId);
  let list: unknown;
  let whole: unknown;
  if (command) {
    if (commandIsStale(command)) return null;
    const result = commandStates()[command].result;
    list = result?.moves ?? result?.findings ?? result?.matches ?? result?.lines ?? result?.games;
    whole = result;
  } else if (strategicFitLifecycle().current_result?.report_id === resultId) {
    const queue = strategicFitFindingQueue.snapshot();
    if (queue.report_id !== resultId) return null;
    list = queue.findings.map((finding) => ({
      findingId: finding.finding_id,
      classification: finding.classification,
      category: finding.plain_language_category,
      opening: finding.opening_scope,
      line: finding.affected_line_summary,
      explanation: finding.explanation,
      sourceSanPaths: finding.references.source_san_paths.slice(0, 3),
    }));
  } else if (replacementLabSnapshot().result?.request.request_id === resultId) {
    list = replacementLabSnapshot().result?.preview.items;
  } else return null;
  return {
    evidence: Array.isArray(list) ? list.slice(offset, offset + 10) : whole,
    next_offset: Array.isArray(list) && list.length > offset + 10 ? offset + 10 : null,
  };
}

async function perform(
  action: UiAction,
  options: UiToolOptions,
  epoch: number,
): Promise<Record<string, unknown>> {
  const signal = options.signal;
  const turn = options.turn;
  const proposalCreated = (before: ReadonlySet<string>) =>
    pendingProposals().filter((item) => !before.has(item.proposalId));
  switch (action.kind) {
    case "navigate":
      if (
        action.surface.startsWith("strategicFit.") &&
        strategicFitSetupRequired() &&
        action.surface !== "strategicFit.assessment"
      )
        return {
          error: "profile_setup_required",
          reason: "Strategic Fit shows its first-run setup until the user chooses a preference.",
        };
      return { surface: action.surface };
    case "set_fields": {
      const before = new Set(pendingProposals().map((item) => item.proposalId));
      const filled = setFormFields(action.form, action.values, action.replace === true);
      if ("error" in filled) return { ...filled };
      if (turn) recordPresented(turn.turnId, proposalCreated(before));
      return { ...filled };
    }
    case "submit": {
      const value = await runWorkflow(action.workflow, action.target, action.option, {
        ...options,
        returnErrors: true,
      });
      return record(value) ? value : { result: value ?? null };
    }
    case "select_result": {
      const before = new Set(pendingProposals().map((item) => item.proposalId));
      const selected = selectResult(action.resultId, action);
      if ("error" in selected) return { ...selected };
      const visible =
        selected.surface === surfaceFor(action)
          ? undefined
          : await presentGuidedSurface(selected.surface, signal);
      if (turn) recordPresented(turn.turnId, proposalCreated(before));
      return {
        selected: selected.selected,
        ...(selected.proposal ? { previewStaged: true } : {}),
        ...(visible === undefined ? {} : { visible }),
      };
    }
    case "select_path":
      return { ...selectPath(action.sanPath) };
    case "show_proposal": {
      const proposal = pendingProposals().find((item) => item.proposalId === action.proposalId);
      if (!proposal)
        return { error: "proposal_not_pending", reason: "That proposal is not pending." };
      if (proposal.status === "stale")
        return { error: "proposal_stale", reason: "That proposal is stale; stage it again." };
      const surface = proposalSurface(action.proposalId);
      const visible = surface ? await presentGuidedSurface(surface, signal) : true;
      if (turn) recordPresented(turn.turnId, [proposal]);
      return {
        proposal,
        visible,
        next: "Ask the user to accept it with its Accept control or to approve this preview explicitly.",
      };
    }
    case "approve_proposal": {
      if (signal?.aborted || epoch !== interactionEpoch())
        return { error: "cancelled", reason: "You took control before this step completed." };
      let visible: boolean | undefined;
      const outcome = await approveProposal(action, turn, async () => {
        // Reveal where the change lands. A finding decision also needs its report's queue, which
        // only the open workspace keeps loaded.
        const surface = proposalSurface(action.proposalId);
        if (surface) visible = await presentGuidedSurface(surface, signal);
        const decision = action.proposalId.startsWith("strategic_fit_decision:")
          ? preparedDecision(action.proposalId.slice("strategic_fit_decision:".length))
          : undefined;
        if (decision) await awaitFindingQueue(decision.reportId, signal);
      });
      return outcome.ok
        ? {
            approved: action.proposalId,
            result: outcome.result ?? null,
            ...(visible === undefined ? {} : { visible }),
          }
        : {
            error: outcome.code ?? "approval_rejected",
            reason: outcome.reason ?? "",
            candidates: outcome.candidates,
          };
    }
    case "open_settings":
      openSettings(action.section);
      return {
        section: action.section,
        next: "Settings are open; the user enters any credentials. Wait for them to close it.",
      };
    case "set_setting": {
      const applied = applyRequestedSetting(action, turn);
      return applied.ok
        ? { setting: applied.setting, value: applied.value }
        : { error: applied.error, reason: applied.reason };
    }
  }
}

export async function executeUiTool(
  name: string,
  raw: unknown,
  options: UiToolOptions = {},
): Promise<unknown> {
  if (options.signal?.aborted) return failure("cancelled", "The request stopped.");
  if (name === "ui_get_state") {
    if (
      !record(raw) ||
      Object.keys(raw).some((key) => !["resultId", "offset"].includes(key)) ||
      (raw.resultId !== undefined && !shortText(raw.resultId, 500)) ||
      (raw.offset !== undefined &&
        (!Number.isInteger(raw.offset) || Number(raw.offset) < 0 || Number(raw.offset) > 10000))
    )
      return failure(
        "invalid_arguments",
        "Use an optional current resultId and nonnegative offset.",
      );
    if (raw.resultId === undefined) return uiSnapshot(options.turn);
    const offset = Number(raw.offset ?? 0);
    const page = evidencePage(raw.resultId, offset);
    if (!page) return failure("stale_result", "That result is no longer current.");
    return { state: uiSnapshot(options.turn), resultId: raw.resultId, offset, ...page };
  }
  if (
    name !== "ui_act" ||
    !record(raw) ||
    !onlyKeys(raw, ["actionId", "stateToken", "action"]) ||
    !shortText(raw.actionId) ||
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
  const actionId = raw.actionId;
  const step = describe(action);
  const result = Promise.resolve().then(async () => {
    if (options.signal?.aborted) return failure("cancelled", "The request stopped.", { step });
    if (token !== uiStateToken())
      return failure(
        "stale_ui",
        "The document, position or inputs changed. Read current UI state before continuing.",
        { step },
      );
    const surface =
      surfaceFor(action) ??
      (action.kind === "show_proposal" || action.kind === "approve_proposal"
        ? proposalSurface(action.proposalId)
        : null);
    const dialog = surface ? blockingDialogFor(surface) : activeDialog();
    if (dialog && dialog !== "strategic-fit" && dialog !== "replacement-lab")
      return failure("dialog_open", `Finish the open ${dialog} dialog before continuing.`, {
        blockingDialog: dialog,
        step,
      });
    if (dialog === "replacement-lab" && surface)
      return failure(
        "dialog_open",
        "The Replacement Lab covers the Strategic Fit panes. Closing it discards its candidates, so the user closes it.",
        { blockingDialog: dialog, step },
      );
    if (action.kind === "set_fields" && action.form === "decision") {
      const refused = decisionPrecheck(action.values.findingId as string);
      if (refused) return failure(refused.error, refused.reason, { step });
    }
    const epoch = interactionEpoch();
    let visible = false;
    if (surface && action.kind !== "approve_proposal") {
      visible = await presentGuidedSurface(surface, options.signal);
      if (options.signal?.aborted || epoch !== interactionEpoch())
        return failure("cancelled", "You took control before this step completed.", { step });
      if (token !== uiStateToken())
        return failure("stale_ui", "The position or inputs changed while opening the view.", {
          step,
        });
      if (!visible && action.kind !== "select_result")
        return failure(
          "presentation_unavailable",
          "The requested view could not be shown. Nothing was submitted.",
          { surface, step },
        );
    }
    const value = await perform(action, options, epoch);
    // A staged proposal renders after its surface was opened; bring the new card into view.
    if (surface && action.kind === "set_fields" && typeof value.proposalId === "string")
      visible = await presentGuidedSurface(surface, options.signal);
    // A workflow's outcome renders below the control that ran it; show the outcome itself.
    if (
      action.kind === "submit" &&
      (typeof value.error !== "string" || action.workflow === "import_history") &&
      typeof window !== "undefined"
    ) {
      const revealed = await revealWorkflowResult(action.workflow);
      if (revealed !== null) visible = revealed;
    }
    if (options.signal?.aborted || epoch !== interactionEpoch())
      return failure("cancelled", "The request stopped; completed results remain in their views.", {
        step,
      });
    const error = typeof value.error === "string" ? value.error : undefined;
    const shown = typeof value.visible === "boolean" ? value.visible : surface ? visible : null;
    return {
      actionId,
      step,
      status: !error
        ? "completed"
        : error === "cancelled"
          ? "cancelled"
          : action.kind === "submit" && value.blocked !== true
            ? "failed"
            : "blocked",
      ...(error ? { error, reason: value.reason } : {}),
      result: value,
      presentation: shown === null ? "none" : shown ? "visible" : "deferred",
      state: uiSnapshot(options.turn),
    };
  });
  receipts.set(actionId, { request, result });
  return result;
}
