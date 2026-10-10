import { createSignal } from "solid-js";
import {
  currentTree,
  currentPath,
  fen,
  exploration,
  documentId,
  version,
  color,
} from "../store/game";
import { analysisDepth } from "../store/engine-settings";
import { comparisonDraft, comparisonVersion } from "../store/guided-ui";
import { executeCommand, type CommandExecutionOptions } from "../store/commands";
import {
  historyArguments,
  historyMonth,
  historyPlatform,
  historyUsername,
  opponentUsername,
  rememberOpponent,
  structureQuery,
} from "../store/forms";
import { recordExport, saveExport, type ExportCommand, type ExportRecord } from "../store/exports";

const source = () => JSON.stringify([documentId(), version(), color(), fen(), comparisonVersion()]);

export async function reviewGame(options: CommandExecutionOptions = {}) {
  if (currentTree().stats().nodes <= 1)
    return { error: "empty_game", reason: "Open a PGN game first." };
  const original = source();
  const args = { depth: analysisDepth() };
  const summary = await executeCommand("get_game_summary", args, options);
  if (!summary || summary.error) return summary;
  if (options.signal?.aborted || original !== source()) return { error: "context_changed" };
  return executeCommand("analyze_game", args, options);
}

export async function comparePosition(options: CommandExecutionOptions = {}) {
  const original = source();
  const position = fen();
  const draft = exploration();
  const text = comparisonDraft().trim();
  const candidates = text
    ? text.split(/[,\s]+/).filter(Boolean)
    : (draft?.tree ?? currentTree())
        .nodeAt(draft?.path ?? currentPath())
        .children.map((node) => node.data.san);
  const depth = analysisDepth();
  if (!text) {
    const result = await executeCommand(
      "evaluate_position",
      { fen: position, lines: 3, depth },
      options,
    );
    if (!result || result.error) return result;
    if (options.signal?.aborted || original !== source()) return { error: "context_changed" };
    if (Array.isArray(result.lines))
      for (const line of result.lines as unknown[])
        if (line && typeof line === "object" && "san" in line && typeof line.san === "string")
          candidates.push(line.san);
  }
  return executeCommand(
    "compare_moves",
    { fen: position, moves: [...new Set(candidates)], depth },
    options,
  );
}

export type PositionLookup = "evaluate_position" | "tablebase_lookup" | "position_popularity";

export function lookUpPosition(command: PositionLookup, options: CommandExecutionOptions = {}) {
  return executeCommand(
    command,
    command === "evaluate_position"
      ? { fen: fen(), lines: 3, depth: analysisDepth() }
      : { fen: fen() },
    options,
  );
}

export interface ImportNotice {
  readonly tone: "status" | "alert";
  readonly message: string;
  readonly fetched: number;
  readonly selected: number;
}

// The import form fetched games and then silently did nothing when an account had none, so an
// empty account and a failed request looked the same. The notice names the account and scope, and
// separates games fetched from games actually sent to review.
const [importNotice, setImportNotice] = createSignal<ImportNotice | null>(null);
export { importNotice };

export const IMPORT_REVIEW_LIMIT = 20;

function importScope() {
  return historyPlatform() === "chesscom"
    ? `Chess.com games from ${historyMonth()}`
    : `the latest ${IMPORT_REVIEW_LIMIT} Lichess games`;
}

export async function importHistory(options: CommandExecutionOptions = {}) {
  const username = historyUsername().trim();
  if (!username) return { error: "missing_username", reason: "Enter an account username first." };
  const scope = importScope();
  const command = historyPlatform() === "lichess" ? "lichess_games" : "chesscom_games";
  setImportNotice(null);
  const fetched = await executeCommand(
    command,
    { ...historyArguments(), include_pgn: true },
    options,
  );
  if (!fetched || fetched.error) return fetched;
  const games = Array.isArray(fetched.games) ? (fetched.games as unknown[]) : [];
  const pgn = games
    .map((game) =>
      game && typeof game === "object" && "pgn" in game && typeof game.pgn === "string"
        ? game.pgn
        : "",
    )
    .filter(Boolean)
    .join("\n\n");
  if (!pgn) {
    setImportNotice({
      tone: "alert",
      message: `No public games found for ${username} in ${scope}. Check the username${historyPlatform() === "chesscom" ? " and month" : ""}, then import again.`,
      fetched: 0,
      selected: 0,
    });
    return {
      error: "no_games",
      reason: `No public games found for ${username} in ${scope}.`,
      fetched: 0,
      username,
      scope,
    };
  }
  const selected = Math.min(games.length, IMPORT_REVIEW_LIMIT);
  setImportNotice({
    tone: "status",
    message: `Fetched ${games.length} ${games.length === 1 ? "game" : "games"} for ${username} (${scope}); reviewing ${selected}. Your repertoire is unchanged.`,
    fetched: games.length,
    selected,
  });
  const reviewed = await executeCommand(
    "batch_review",
    { pgn, username, max_games: IMPORT_REVIEW_LIMIT, depth: analysisDepth() },
    options,
  );
  if (!reviewed || reviewed.error) return reviewed;
  return { ...reviewed, fetched: games.length, selected_for_review: selected, username, scope };
}

export function compareWithHistory(options: CommandExecutionOptions = {}) {
  const username = historyUsername().trim();
  if (!username)
    return Promise.resolve({
      error: "missing_username",
      reason: "Enter an account username first.",
    });
  return executeCommand(
    "repertoire_vs_history",
    { ...historyArguments(), platform: historyPlatform() },
    options,
  );
}

export type RepertoireScanCommand =
  | "audit_repertoire_moves"
  | "find_only_moves"
  | "find_structures"
  | "prep_vs_opponent";

/** The arguments each Repertoire panel button submits, shared with the assistant. */
export function repertoireCommandArguments(command: RepertoireScanCommand) {
  if (command === "audit_repertoire_moves") return { depth: analysisDepth() };
  if (command === "find_only_moves") return { max_positions: 60, depth: analysisDepth() };
  if (command === "find_structures") return { structure: structureQuery() };
  const username = opponentUsername().trim();
  rememberOpponent(username);
  return { username };
}

export function runRepertoireCommand(
  command: RepertoireScanCommand,
  options: CommandExecutionOptions = {},
) {
  return executeCommand(command, repertoireCommandArguments(command), options);
}

const EXPORT_ARGUMENTS: Record<ExportCommand, () => Record<string, unknown>> = {
  export_annotated_pgn: () => ({ depth: analysisDepth() }),
  export_annotated_repertoire: () => ({ max_positions: 60, depth: analysisDepth() }),
  export_strategic_fit_metadata: () => ({}),
  export_strategic_fit_intent_pgn: () => ({}),
};

export type ExportOutcome =
  | { readonly record: ExportRecord; readonly result: Record<string, unknown> }
  | { readonly error: string; readonly reason?: string };

/**
 * Generates an export through its canonical command and records the artifact for its surface. A
 * Save press hands it to the browser; an assistant-generated artifact waits for that press,
 * because saving a file is the user's gesture.
 */
export async function generateExport(
  command: ExportCommand,
  generatedBy: ExportRecord["generatedBy"],
  options: CommandExecutionOptions = {},
): Promise<ExportOutcome | undefined> {
  const result = await executeCommand(command, EXPORT_ARGUMENTS[command](), options);
  if (!result) return undefined;
  if (typeof result.error === "string")
    return {
      error: result.error,
      ...(typeof result.reason === "string" ? { reason: result.reason } : {}),
    };
  if (typeof result.artifact_id !== "string") return { error: "artifact_missing" };
  const record = recordExport(command, result.artifact_id, generatedBy);
  if (!record) return { error: "artifact_missing" };
  if (generatedBy === "user") saveExport(command);
  return { record, result };
}
