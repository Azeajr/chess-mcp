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
