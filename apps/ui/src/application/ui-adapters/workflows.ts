import type {
  IntentionalResolutionReason,
  ReplacementCandidateSourceKind,
} from "@chess-mcp/chess-tools";
import { actions, color, currentPath, currentTree, documentId, fen } from "../../store/game";
import { commandIsStale, commandStates, type CommandExecutionOptions } from "../../store/commands";
import { comparisonDraft, setComparisonDraft, type GuidedSurface } from "../../store/guided-ui";
import {
  extendStyle,
  historyMonth,
  historyPlatform,
  historyUsername,
  opponentUsername,
  setExtendStyle,
  setHistoryMonth,
  setHistoryPlatform,
  setHistoryUsername,
  setOpponentUsername,
  setStructureQuery,
  structureQuery,
  type ExtendStyle,
  type HistoryPlatform,
} from "../../store/forms";
import {
  cancelScan,
  fillGap,
  fills,
  gapKey,
  gaps,
  gapsStale,
  scanGaps,
  scanCompleted,
} from "../../store/gaps";
import {
  cancelPrune,
  complementary,
  compError,
  extBridges,
  bridgeError,
  pruneError,
  pruneSuggestions,
  scanBridges,
  scanComplementary,
  scanPrune,
  shortcutKey,
} from "../../store/repertoire";
import { stagePreviewLine } from "../../store/suggestions";
import {
  compareWithHistory,
  comparePosition,
  generateExport,
  importHistory,
  lookUpPosition,
  reviewGame,
  runRepertoireCommand,
  type ExportOutcome,
} from "../analysis-workflows";
import { selectReviewedMove } from "../review-selection";
import type { ExportCommand } from "../../store/exports";
import {
  awaitFindingQueue,
  awaitStrategicFitReport,
  configureReplacementLab,
  generateReplacementCandidates,
  openDrill,
  openReplacementLab,
  prepareFindingDecision,
  selectFinding,
  showFindingOnBoard,
  stageReplacementCandidate,
  strategicFitSetupRequired,
} from "./strategic-fit";
import type { PreparedDecisionState } from "../../store/strategic-fit-decision-drafts";
import { strategicFitLifecycle } from "../../store/strategic-fit";
import type { FormId, Workflow } from "./catalog";

export { WORKFLOWS, FORMS, FORM_SURFACES, type Workflow, type FormId } from "./catalog";

export interface Blocked {
  readonly error: string;
  readonly reason: string;
  /** A precondition refused the step, as opposed to a chess operation that ran and failed. */
  readonly blocked: true;
  readonly current?: unknown;
}
const blocked = (error: string, reason: string | undefined, current?: unknown): Blocked => ({
  error,
  reason: reason ?? "The step could not complete.",
  blocked: true,
  ...(current === undefined ? {} : { current }),
});

const usersTurn = () => (fen().split(" ")[1] === "w" ? "white" : "black") === color();

// The visible draft wins: a filled field the user typed is replaced only when the request says so.
function conflict(current: string, next: string | undefined, replace: boolean) {
  return next !== undefined && current.trim() !== "" && current.trim() !== next.trim() && !replace;
}

export type FormValues = Record<string, unknown>;

/** Fills a form's visible fields. Strategic Fit decisions are prepared, never recorded, here. */
export function setFormFields(
  form: FormId,
  values: FormValues,
  replace: boolean,
): Blocked | { form: FormId; values: unknown; proposalId?: string } {
  switch (form) {
    case "compare": {
      const candidates = values.candidates as string;
      if (conflict(comparisonDraft(), candidates, replace))
        return blocked("draft_conflict", "Candidate moves already hold the user's text.", {
          candidates: comparisonDraft(),
        });
      setComparisonDraft(candidates);
      return { form, values: { candidates: comparisonDraft() } };
    }
    case "history": {
      const username = values.username as string | undefined;
      const month = values.month as string | undefined;
      if (conflict(historyUsername(), username, replace))
        return blocked("draft_conflict", "The username field already holds another account.", {
          username: historyUsername(),
        });
      if (values.platform !== undefined) setHistoryPlatform(values.platform as HistoryPlatform);
      if (username !== undefined) setHistoryUsername(username);
      if (month !== undefined) setHistoryMonth(month);
      return {
        form,
        values: { platform: historyPlatform(), username: historyUsername(), month: historyMonth() },
      };
    }
    case "structure": {
      const structure = values.structure as string;
      if (conflict(structureQuery(), structure, replace))
        return blocked("draft_conflict", "Structure search already holds the user's text.", {
          structure: structureQuery(),
        });
      setStructureQuery(structure);
      return { form, values: { structure: structureQuery() } };
    }
    case "opponent": {
      const username = values.username as string;
      if (conflict(opponentUsername(), username, replace))
        return blocked("draft_conflict", "Opponent username already holds another account.", {
          username: opponentUsername(),
        });
      setOpponentUsername(username);
      return { form, values: { username: opponentUsername() } };
    }
    case "extend":
      setExtendStyle(values.style as ExtendStyle);
      return { form, values: { style: extendStyle() } };
    case "decision": {
      const prepared = prepareFindingDecision({
        findingId: values.findingId as string,
        decision: values.decision as PreparedDecisionState,
        reason: (values.reason as IntentionalResolutionReason | undefined) ?? null,
        note: (values.note as string | undefined) ?? "",
      });
      if ("error" in prepared) return blocked(prepared.error, prepared.reason);
      return {
        form,
        values: { findingId: prepared.findingId, decision: prepared.state },
        proposalId: `strategic_fit_decision:${prepared.proposalId}`,
      };
    }
    case "replacementLab": {
      const configured = configureReplacementLab({
        ...(values.pivotDecisionId === undefined
          ? {}
          : { pivotDecisionId: values.pivotDecisionId as string }),
        ...(values.sources === undefined
          ? {}
          : { sources: values.sources as ReplacementCandidateSourceKind[] }),
        ...(values.depth === undefined ? {} : { depth: values.depth as number }),
      });
      if ("error" in configured) return blocked(configured.error, configured.reason);
      return { form, values };
    }
  }
}

const exportReceipt = (outcome: ExportOutcome | undefined) =>
  !outcome
    ? blocked("export_failed", "The export did not produce a file.")
    : "error" in outcome
      ? blocked(outcome.error, outcome.reason ?? "The export failed.")
      : {
          artifact: {
            name: outcome.record.name,
            format: outcome.record.format,
            bytes: outcome.record.bytes,
            sourceRevision: outcome.record.revision,
          },
          generated: true,
          saved: false,
          next: "Ask the user to press Save on the export; generating a file is not saving it.",
        };

const EXPORTS: Partial<Record<Workflow, ExportCommand>> = {
  export_game: "export_annotated_pgn",
  export_repertoire: "export_annotated_repertoire",
  export_strategic_fit_metadata: "export_strategic_fit_metadata",
  export_strategic_fit_intent: "export_strategic_fit_intent_pgn",
};

/** Runs a registered workflow exactly as its visible control does. */
export async function runWorkflow(
  workflow: Workflow,
  target: string | undefined,
  option: string | undefined,
  options: CommandExecutionOptions,
): Promise<unknown> {
  const signal = options.signal;
  const exportCommand = EXPORTS[workflow];
  if (exportCommand)
    return exportReceipt(await generateExport(exportCommand, "assistant", options));
  switch (workflow) {
    case "review":
      if (currentTree().stats().leaves > 1)
        return blocked(
          "mainline_confirmation_required",
          "This is a repertoire. Ask whether mainline review is intended; direct mainline chess tools remain available.",
        );
      return reviewGame(options);
    case "compare":
      return comparePosition(options);
    case "evaluate":
      return lookUpPosition("evaluate_position", options);
    case "tablebase":
      return lookUpPosition("tablebase_lookup", options);
    case "popularity":
      return lookUpPosition("position_popularity", options);
    case "import_history":
      return importHistory(options);
    case "compare_history":
      return compareWithHistory(options);
    case "audit":
      return runRepertoireCommand("audit_repertoire_moves", options);
    case "only_moves":
      return runRepertoireCommand("find_only_moves", options);
    case "structures":
      if (!structureQuery().trim())
        return blocked("missing_structure", "Fill the structure name first.");
      return runRepertoireCommand("find_structures", options);
    case "prep":
      if (!opponentUsername().trim())
        return blocked("missing_username", "Fill the opponent's username first.");
      return runRepertoireCommand("prep_vs_opponent", options);
    case "gaps":
    case "gaps_next": {
      const abort = () => {
        cancelScan();
      };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await scanGaps(workflow === "gaps_next");
      } finally {
        signal?.removeEventListener("abort", abort);
      }
      return gapsResult();
    }
    case "gap_fill": {
      const gap = gaps().find((candidate) => gapKey(candidate) === target);
      if (!gap || gapsStale())
        return blocked("stale_result", "Select a gap from the current scan.");
      actions.goto(gap.path);
      const fill = await fillGap(gap);
      const state = fills()[gapKey(gap)];
      if (state && typeof state === "object" && "error" in state)
        return blocked("fill_failed", state.error);
      const ready = fill ?? (typeof state === "object" ? state : null);
      if (!ready) return blocked("fill_failed", "No fill was found for this gap.");
      return {
        resultId: `gapfill:${gapKey(gap)}`,
        options: [
          {
            itemId: "best_eval",
            line: ready.bestEval.line,
            evalCp: ready.bestEval.evalCp,
            fit: ready.bestEval.fit,
          },
          ...(ready.bestFit
            ? [
                {
                  itemId: "best_fit",
                  line: ready.bestFit.line,
                  evalCp: ready.bestFit.evalCp,
                  fit: ready.bestFit.fit,
                },
              ]
            : []),
        ],
      };
    }
    case "connect":
      await scanBridges();
      return bridgeError()
        ? blocked("scan_failed", bridgeError() ?? "Connect failed.")
        : { resultId: `connect:${documentId()}`, items: bridgeItems() };
    case "shorten": {
      const abort = () => {
        cancelPrune();
      };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await scanPrune();
      } finally {
        signal?.removeEventListener("abort", abort);
      }
      return pruneError()
        ? blocked("scan_failed", pruneError() ?? "Shorten failed.")
        : { resultId: `shorten:${documentId()}`, items: shortcutItems() };
    }
    case "extend":
      if (!usersTurn())
        return blocked("opponent_to_move", "Select a position where it is the user's move first.");
      await scanComplementary(extendStyle());
      return compError()
        ? blocked("scan_failed", compError() ?? "Extend failed.")
        : { resultId: extendResultId(), items: extensionItems() };
    case "strategic_fit_analyze": {
      const outcome = await awaitStrategicFitReport(signal);
      if ("error" in outcome) return blocked(outcome.error, outcome.reason);
      await awaitFindingQueue(outcome.report.report_id, signal);
      return {
        reportId: outcome.report.report_id,
        reused: outcome.reused,
        preflight: outcome.report.result.preflight.state,
      };
    }
    case "lab_open": {
      if (!target) return blocked("missing_target", "Name the finding to redesign.");
      if (strategicFitSetupRequired())
        return blocked("profile_setup_required", "Strategic Fit setup is not complete.");
      const opened = openReplacementLab(target);
      return "error" in opened ? blocked(opened.error, opened.reason) : { findingId: target };
    }
    case "lab_generate": {
      const generated = await generateReplacementCandidates(signal);
      return "error" in generated ? blocked(generated.error, generated.reason) : generated;
    }
    case "lab_stage": {
      if (!target) return blocked("missing_target", "Name the candidate to stage.");
      const staged = await stageReplacementCandidate(
        target,
        option === "replace" ? "replace" : "add-alternative",
      );
      return "error" in staged ? blocked(staged.error, staged.reason) : staged;
    }
    case "export_game":
    case "export_repertoire":
    case "export_strategic_fit_metadata":
    case "export_strategic_fit_intent":
      return blocked("unknown_workflow", "Exports are handled above.");
    case "open_drill": {
      if (!target) return blocked("missing_target", "Name the finding whose drill to open.");
      const opened = openDrill(target);
      return "error" in opened
        ? blocked(opened.error, opened.reason)
        : {
            ...opened,
            note: "The drill is open. The user plays their own recall move; never supply or record it.",
          };
    }
  }
  return blocked("unknown_workflow", "That workflow is not registered.");
}

export function gapsResult() {
  return {
    resultId: `gaps:${documentId()}`,
    completed: scanCompleted(),
    stale: gapsStale(),
    items: gaps()
      .slice(0, 10)
      .map((gap) => ({
        itemId: gapKey(gap),
        line: gap.sanPath.join(" "),
        uncoveredMove: gap.uncoveredMove,
        severity: gap.severity,
        evalCp: gap.evalCp,
      })),
    truncated: gaps().length > 10,
  };
}

const bridgeKey = (bridge: { fromPath: readonly string[]; moves: readonly string[] }) =>
  `${bridge.fromPath.join(" ")}>${bridge.moves.join(" ")}`;
export const bridgeItems = () =>
  (extBridges() ?? []).slice(0, 10).map((bridge) => ({
    itemId: bridgeKey(bridge),
    from: bridge.fromPath.join(" "),
    moves: bridge.moves,
    joins: bridge.joinsPath.join(" "),
  }));
export const shortcutItems = () =>
  (pruneSuggestions() ?? []).slice(0, 10).map((shortcut) => ({
    itemId: shortcutKey(shortcut),
    line: shortcut.linePath.join(" "),
    at: shortcut.atPath.join(" "),
    reroute: shortcut.rerouteMove,
    savedPlies: shortcut.savedPlies,
  }));
export const extendResultId = () => `extend:${documentId()}:${currentPath().join(".")}`;
export const extensionItems = () =>
  (complementary() ?? []).slice(0, 10).map((move) => ({
    itemId: move.move,
    move: move.move,
    eval: move.eval,
  }));

const COMMAND_ROWS: Readonly<Record<string, string>> = {
  audit_repertoire_moves: "findings",
  find_only_moves: "findings",
  find_structures: "matches",
};

function goToSan(sanPath: readonly string[]) {
  const path = currentTree().indexPathOfSan([...sanPath]);
  if (!path) return false;
  actions.goto(path);
  return true;
}

/**
 * Selects one item of a current result by its stable identity. Selecting a repertoire suggestion
 * stages a preview for the user to accept; nothing is added here.
 */
export function selectResult(
  resultId: string,
  item: { ply?: number; itemId?: string; board?: boolean },
): Blocked | { selected: unknown; surface: GuidedSurface; proposal?: boolean } {
  const commands = commandStates();
  if (item.ply !== undefined) {
    if (!selectReviewedMove(resultId, item.ply))
      return blocked("stale_result", "Select a move from the current completed review.");
    return { selected: { ply: item.ply }, surface: "analysis.review" };
  }
  const itemId = item.itemId ?? "";
  for (const [command, key] of Object.entries(COMMAND_ROWS)) {
    const state = commands[command as keyof typeof commands];
    if (state.resultId !== resultId) continue;
    if (commandIsStale(command as keyof typeof commands))
      return blocked("stale_result", "That result is out of date. Run it again.");
    const rows = state.result?.[key];
    const row = Array.isArray(rows)
      ? (rows[Number(itemId)] as { path?: unknown } | undefined)
      : undefined;
    if (!row || !Array.isArray(row.path) || !goToSan(row.path as string[]))
      return blocked("stale_result", "That row is not in the current result or tree.");
    return {
      selected: { index: Number(itemId), sanPath: row.path },
      surface: "workspace.board",
    };
  }
  if (resultId === `gaps:${documentId()}`) {
    const gap = gaps().find((candidate) => gapKey(candidate) === itemId);
    if (!gap || gapsStale()) return blocked("stale_result", "Select a gap from the current scan.");
    actions.goto(gap.path);
    return { selected: { itemId, sanPath: gap.sanPath }, surface: "repertoire.gaps" };
  }
  if (resultId.startsWith("gapfill:")) {
    const gap = gaps().find((candidate) => `gapfill:${gapKey(candidate)}` === resultId);
    const state = gap ? fills()[gapKey(gap)] : undefined;
    const fill = state && typeof state === "object" && "bestEval" in state ? state : null;
    const option = itemId === "best_fit" ? fill?.bestFit : fill?.bestEval;
    if (!gap || !option) return blocked("stale_result", "Fill this gap again first.");
    actions.goto(gap.path);
    if (!stagePreviewLine(gap.path, option.line).ok)
      return blocked("illegal_line", "That fill is no longer legal here.");
    return {
      selected: { itemId, line: option.line },
      surface: "repertoire.preview",
      proposal: true,
    };
  }
  if (resultId === `connect:${documentId()}`) {
    const bridge = (extBridges() ?? []).find((candidate) => bridgeKey(candidate) === itemId);
    const from = bridge ? currentTree().indexPathOfSan(bridge.fromPath) : null;
    if (!bridge || !from) return blocked("stale_result", "Scan Connect again.");
    actions.goto(from);
    if (!stagePreviewLine(from, bridge.moves).ok)
      return blocked("illegal_line", "That connection is no longer legal here.");
    return { selected: { itemId }, surface: "repertoire.preview", proposal: true };
  }
  if (resultId === `shorten:${documentId()}`) {
    const shortcut = (pruneSuggestions() ?? []).find(
      (candidate) => shortcutKey(candidate) === itemId,
    );
    const at = shortcut ? currentTree().indexPathOfSan(shortcut.atPath) : null;
    if (!shortcut || !at) return blocked("stale_result", "Scan Shorten again.");
    actions.goto(at);
    if (!stagePreviewLine(at, [shortcut.rerouteMove]).ok)
      return blocked("illegal_line", "That shortcut is no longer legal here.");
    return { selected: { itemId }, surface: "repertoire.preview", proposal: true };
  }
  if (resultId === extendResultId()) {
    const move = (complementary() ?? []).find((candidate) => candidate.move === itemId);
    if (!move || !stagePreviewLine(currentPath(), [move.move]).ok)
      return blocked("stale_result", "Suggest an extension here again.");
    return { selected: { itemId }, surface: "repertoire.preview", proposal: true };
  }
  const report = strategicFitLifecycle().current_result;
  if (report?.report_id === resultId) {
    if (item.board) {
      const shown = showFindingOnBoard(resultId, itemId);
      return shown
        ? { selected: { findingId: itemId, sanPath: shown.sanPath }, surface: "workspace.board" }
        : blocked("stale_result", "That finding's line is not available in the current tree.");
    }
    const finding = selectFinding(resultId, itemId);
    return finding
      ? { selected: { findingId: itemId }, surface: "strategicFit.branch" }
      : blocked("stale_result", "That finding is not in the current report.");
  }
  return blocked("stale_result", "That result is not current. Read the UI state again.");
}

export function selectPath(sanPath: readonly string[]) {
  return goToSan(sanPath)
    ? { selected: { sanPath } }
    : blocked("unknown_path", "That line is not in the current document.");
}
