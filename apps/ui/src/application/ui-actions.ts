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
  FINDINGS_NOT_LOADED,
  findingsLoaded,
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
const shortText = (value: unknown, max = 200): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

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

// ui_act validation names the first problem and what is accepted, so a model can correct one
// field instead of guessing (a bare "invalid arguments" sent small models off course).
type Problem = string | null;

function keyProblem(
  path: string,
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): Problem {
  const missing = required.find((key) => !(key in value));
  if (missing) return `${path} is missing ${missing}.`;
  const extra = Object.keys(value).find(
    (key) => !required.includes(key) && !optional.includes(key),
  );
  return extra
    ? `${path}.${extra} is not accepted; ${path} takes ${[...required, ...optional].join(", ")}.`
    : null;
}

const quoted = (value: unknown) => (value === undefined ? "nothing" : JSON.stringify(value));

function oneOf(path: string, value: unknown, allowed: readonly unknown[]): Problem {
  if (allowed.includes(value)) return null;
  const listed = allowed.length <= 12 ? `: ${allowed.join(", ")}` : " listed in the ui_act schema";
  return `${path} ${quoted(value)} is not supported; use one of${listed}.`;
}

const textProblem = (path: string, value: unknown, max: number, required = true): Problem =>
  (!required && value === undefined) ||
  (typeof value === "string" && (value.length > 0 || !required) && value.length <= max)
    ? null
    : `${path} must be ${required ? "a non-empty" : "a"} string of at most ${max} characters.`;

function formValuesProblem(form: FormId, values: Record<string, unknown>): Problem {
  const keys = (required: string[], optional: string[] = []) =>
    keyProblem("values", values, required, optional);
  switch (form) {
    case "compare":
      return (
        keys(["candidates"]) ?? textProblem("values.candidates", values.candidates, 500, false)
      );
    case "history":
      return (
        keys([], ["platform", "username", "month"]) ??
        (values.platform === undefined
          ? null
          : oneOf("values.platform", values.platform, ["lichess", "chesscom"])) ??
        textProblem("values.username", values.username, 60, false) ??
        (values.month === undefined ||
        (typeof values.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(values.month))
          ? null
          : "values.month must be YYYY-MM.")
      );
    case "structure":
      return keys(["structure"]) ?? textProblem("values.structure", values.structure, 80, false);
    case "opponent":
      return keys(["username"]) ?? textProblem("values.username", values.username, 60, false);
    case "extend":
      return keys(["style"]) ?? oneOf("values.style", values.style, ["low_memorization", "sharp"]);
    case "decision":
      return (
        keys(["findingId", "decision"], ["reason", "note"]) ??
        textProblem("values.findingId", values.findingId, 200) ??
        oneOf("values.decision", values.decision, DECISION_STATES) ??
        (values.reason === undefined
          ? null
          : (oneOf("values.reason", values.reason, INTENTIONAL_RESOLUTION_REASONS)?.replace(
              /\.$/,
              " (only for keep-intentionally; put free text in values.note).",
            ) ?? null)) ??
        textProblem("values.note", values.note, 2000, false)
      );
    case "replacementLab":
      return (
        keys([], ["pivotDecisionId", "sources", "depth"]) ??
        (values.pivotDecisionId === undefined
          ? null
          : textProblem("values.pivotDecisionId", values.pivotDecisionId, 200)) ??
        (values.sources === undefined ||
        (Array.isArray(values.sources) &&
          values.sources.length > 0 &&
          values.sources.every((source) =>
            (REPLACEMENT_CANDIDATE_SOURCE_KINDS as readonly unknown[]).includes(source),
          ))
          ? null
          : `values.sources must be a non-empty list of: ${REPLACEMENT_CANDIDATE_SOURCE_KINDS.join(", ")}.`) ??
        (values.depth === undefined ||
        (Number.isInteger(values.depth) && Number(values.depth) >= 1 && Number(values.depth) <= 30)
          ? null
          : "values.depth must be an integer from 1 to 30.")
      );
  }
}

/** The first problem with a ui_act action, or null when it is valid. */
function actionProblem(value: unknown): Problem {
  if (!record(value)) return "action must be an object with a kind.";
  const keys = (required: string[], optional: string[] = []) =>
    keyProblem("action", value, required, optional);
  switch (value.kind) {
    case "navigate":
      return (
        keys(["kind", "surface"]) ??
        (isGuidedSurface(value.surface)
          ? null
          : `action.surface ${quoted(value.surface)} is not a guided surface; use one listed in the ui_act schema.`)
      );
    case "set_fields":
      return (
        keys(["kind", "form", "values"], ["replace"]) ??
        oneOf("action.form", value.form, FORMS) ??
        (record(value.values) ? null : "action.values must be an object of field values.") ??
        (value.replace === undefined || typeof value.replace === "boolean"
          ? null
          : "action.replace must be true or false.") ??
        formValuesProblem(value.form as FormId, value.values as Record<string, unknown>)
      );
    case "submit":
      return (
        keys(["kind", "workflow"], ["target", "option"]) ??
        (isWorkflow(value.workflow)
          ? null
          : `action.workflow ${quoted(value.workflow)} is not a workflow; use one listed in the ui_act schema.`) ??
        (value.target === undefined ? null : textProblem("action.target", value.target, 500)) ??
        (value.option === undefined
          ? null
          : oneOf("action.option", value.option, ["add-alternative", "replace"]))
      );
    case "select_result":
      return (
        keys(["kind", "resultId"], ["ply", "itemId", "board"]) ??
        textProblem("action.resultId", value.resultId, 500) ??
        (value.ply === undefined ||
        (Number.isInteger(value.ply) && Number(value.ply) >= 1 && Number(value.ply) <= 10000)
          ? null
          : "action.ply must be an integer from 1 to 10000.") ??
        (value.itemId === undefined ? null : textProblem("action.itemId", value.itemId, 500)) ??
        (value.board === undefined || typeof value.board === "boolean"
          ? null
          : "action.board must be true or false.") ??
        ((value.ply !== undefined) !== (value.itemId !== undefined)
          ? null
          : "select_result takes exactly one of action.ply (review plies) or action.itemId (other items).")
      );
    case "select_path":
      return (
        keys(["kind", "sanPath"]) ??
        (Array.isArray(value.sanPath) &&
        value.sanPath.length <= 300 &&
        value.sanPath.every((san) => shortText(san, 10))
          ? null
          : "action.sanPath must be a list of at most 300 SAN moves.")
      );
    case "show_proposal":
      return (
        keys(["kind", "proposalId"]) ?? textProblem("action.proposalId", value.proposalId, 500)
      );
    case "approve_proposal":
      return (
        keys(["kind", "proposalId", "previewVersion", "approvalMessageId"]) ??
        textProblem("action.proposalId", value.proposalId, 500) ??
        textProblem("action.previewVersion", value.previewVersion, 2000) ??
        textProblem("action.approvalMessageId", value.approvalMessageId, 200)
      );
    case "open_settings":
      return keys(["kind", "section"]) ?? oneOf("action.section", value.section, SETTINGS_SECTIONS);
    case "set_setting":
      return (
        keys(["kind", "setting", "value", "requestMessageId"]) ??
        oneOf("action.setting", value.setting, PUBLIC_SETTINGS) ??
        (["number", "boolean", "string"].includes(typeof value.value)
          ? null
          : "action.value must be a number, boolean or string.") ??
        textProblem("action.requestMessageId", value.requestMessageId, 200)
      );
    default:
      return oneOf("action.kind", value.kind, [
        "navigate",
        "set_fields",
        "submit",
        "select_result",
        "select_path",
        "show_proposal",
        "approve_proposal",
        "open_settings",
        "set_setting",
      ]);
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
      return `Show ${SURFACE_ROUTES[action.surface].label}`;
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

// A chess tool the assistant calls directly on the visible game already publishes into its panel's
// result state, but live models took that route about half the time and left the user looking at
// nothing: the panel stayed hidden, Candidate moves stayed empty and no decision was selected. The
// guided path's visible steps are finished here, and the user's own text still wins.
const DIRECT_SURFACES: Partial<Record<DirectCommand, GuidedSurface>> = {
  analyze_game: WORKFLOWS.review,
  get_game_summary: WORKFLOWS.review,
  compare_moves: WORKFLOWS.compare,
  evaluate_position: WORKFLOWS.evaluate,
  tablebase_lookup: WORKFLOWS.tablebase,
  position_popularity: WORKFLOWS.popularity,
  lichess_games: WORKFLOWS.import_history,
  chesscom_games: WORKFLOWS.import_history,
  batch_review: WORKFLOWS.import_history,
  repertoire_vs_history: WORKFLOWS.compare_history,
  audit_repertoire_moves: WORKFLOWS.audit,
  find_only_moves: WORKFLOWS.only_moves,
  find_structures: WORKFLOWS.structures,
  prep_vs_opponent: WORKFLOWS.prep,
};

/** Shows a direct command's result where its visible control would have put it. */
export async function presentDirectResult(
  command: DirectCommand,
  args: Record<string, unknown>,
  result: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const surface = DIRECT_SURFACES[command];
  if (!surface || !record(result) || "error" in result || signal?.aborted || activeDialog())
    return result;
  const ui: Record<string, unknown> = { surface, resultId: commandStates()[command].resultId };
  if (command === "compare_moves" && Array.isArray(args.moves)) {
    const filled = setFormFields("compare", { candidates: args.moves.join(" ") }, false);
    ui.candidates = "error" in filled ? "kept the user's text" : "filled";
  }
  ui.presentation = (await presentGuidedSurface(surface, signal)) ? "visible" : "deferred";
  if (command === "analyze_game")
    ui.next =
      "The review is on the Analysis panel. select_result this resultId with a ply to show that decision's position on the board.";
  else if (command === "get_game_summary")
    ui.next = "For moves the user can select on the board, ui_act submit review instead.";
  return { ...result, ui };
}

// Opening Strategic Fit only shows it: a model that read "analyzing" as done ended its turn with
// nothing selected. Name the step that waits for, runs or refreshes the report.
function strategicFitNext(surface: GuidedSurface): { next?: string } {
  if (!surface.startsWith("strategicFit.") || surface === "strategicFit.lab") return {};
  const status = strategicFitLifecycle().status;
  if (status === "completed") return {};
  return {
    next:
      status === "running" || status === "provisional"
        ? "Strategic Fit is still analyzing. Submit strategic_fit_analyze to wait for this run's report (it does not start another) before selecting findings."
        : status === "stale"
          ? "The Strategic Fit report is out of date. Submit strategic_fit_analyze to refresh it before selecting findings."
          : "There is no Strategic Fit report yet. Submit strategic_fit_analyze to run it before selecting findings.",
  };
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
    if (!findingsLoaded(resultId)) return FINDINGS_NOT_LOADED;
    const queue = strategicFitFindingQueue.snapshot();
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
      return { surface: action.surface, ...strategicFitNext(action.surface) };
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
    if ("error" in page) return failure(page.error, page.reason);
    return { state: uiSnapshot(options.turn), resultId: raw.resultId, offset, ...page };
  }
  const problem =
    name !== "ui_act" || !record(raw)
      ? "Call ui_act with actionId, stateToken and action."
      : (keyProblem("arguments", raw, ["actionId", "stateToken", "action"]) ??
        textProblem("actionId", raw.actionId, 200) ??
        (typeof raw.stateToken === "string" && raw.stateToken.length <= 4000
          ? null
          : "stateToken must be the exact token from the latest state or receipt.") ??
        actionProblem(raw.action));
  if (problem || !record(raw)) return failure("invalid_arguments", `${problem} Nothing was done.`);
  const actionId = raw.actionId as string;
  const token = raw.stateToken as string;
  const request = JSON.stringify([token, raw.action]);
  const existing = receipts.get(actionId);
  if (existing)
    return existing.request === request
      ? existing.result
      : failure("action_id_conflict", "Use a new actionId for new inputs.");
  if (receipts.size >= 1000)
    return failure(
      "session_limit",
      "Reload before starting further UI actions; completed work is retained by existing stores.",
    );
  const action = raw.action as UiAction;
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
