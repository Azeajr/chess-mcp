import { isDecidableStrategicFinding } from "@chess-mcp/chess-tools";

/** Keep insufficient evidence and transpositions available as information, not decisions. */
export const isDecidableFinding = isDecidableStrategicFinding;
