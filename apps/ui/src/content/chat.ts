import { countLabel, numbered } from "./format";

export interface StagedEditContentInput {
  readonly action?: unknown;
  readonly path?: unknown;
  readonly line?: unknown;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? [...value]
    : [];
}

/** Plain-language copy for the browser-only repertoire edit that is waiting for acceptance. */
export function stagedEditContent(data: StagedEditContentInput) {
  const action = ["add", "prune", "reorder"].includes(String(data.action))
    ? String(data.action)
    : "repertoire";
  const path = stringList(data.path);
  const line = stringList(data.line);
  const scopeMoves = action === "add" ? line.length : path.length;
  const currentLine = path.length
    ? `Current line: ${numbered(path)}.`
    : "Current line: starting position.";
  const proposedLine =
    action === "add" && line.length
      ? `New continuation: ${numbered(line, path.length)}.`
      : action === "prune"
        ? "The selected continuation will be removed."
        : action === "reorder"
          ? "The selected continuation will be reordered."
          : "The selected repertoire line will change.";
  const title =
    action === "add"
      ? "Proposed line addition"
      : action === "prune"
        ? "Proposed line removal"
        : action === "reorder"
          ? "Proposed line reorder"
          : "Proposed repertoire edit";

  return {
    title,
    scope: `Scope: ${countLabel(scopeMoves, "move")} in ${countLabel(1, "line")}.`,
    currentLine,
    proposedLine,
    acceptance: "Accepting updates the working repertoire in this browser.",
    reversible: "You can undo this change from the move tree after accepting.",
  };
}
