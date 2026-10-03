import type { StrategicFinding } from "@chess-mcp/chess-tools";

/** Keep insufficient evidence and transpositions available as information, not decisions. */
export const isDecidableFinding = (finding: StrategicFinding): boolean =>
  finding.classification !== "transpositional-equivalence" &&
  finding.classification !== "uncertain" &&
  finding.classification !== "data-quality-issue" &&
  finding.replacement_priority.label !== "insufficient-evidence" &&
  finding.training_priority.label !== "insufficient-evidence";
