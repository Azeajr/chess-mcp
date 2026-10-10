import { createSignal } from "solid-js";
import type { IntentionalResolutionReason } from "@chess-mcp/chess-tools";
import { documentId, version } from "./game";
import {
  transitionStrategicFitFindingResolution,
  type StrategicFitFindingResolutionTransitionResult,
} from "./strategic-fit-finding-resolutions";
import { assertTestOnly } from "./test-seam";

export type PreparedDecisionState =
  | "keep-intentionally"
  | "defer"
  | "exclude-from-analysis"
  | "invalid-comparison";

export interface PreparedDecision {
  readonly proposalId: string;
  readonly reportId: string;
  readonly findingId: string;
  readonly semanticFindingId: string;
  readonly state: PreparedDecisionState;
  readonly reason: IntentionalResolutionReason | null;
  readonly note: string;
  readonly documentId: string;
  readonly revision: number;
  readonly status: "pending" | "accepted" | "discarded" | "stale";
  readonly message: string | null;
}

// A finding decision the assistant filled in but nobody has recorded. The resolution controls
// write document metadata the moment they are pressed, so an assistant may only prepare one: the
// existing writer runs when the user presses Record decision or explicitly approves it in chat.
const [preparedDecisions, setPreparedDecisions] = createSignal<readonly PreparedDecision[]>([]);
export { preparedDecisions };
let sequence = 0;

export const preparedDecision = (proposalId: string) =>
  preparedDecisions().find((decision) => decision.proposalId === proposalId);

export const pendingDecisionForFinding = (findingId: string) =>
  preparedDecisions().find(
    (decision) => decision.findingId === findingId && decision.status === "pending",
  ) ?? null;

export function prepareDecision(input: {
  reportId: string;
  findingId: string;
  semanticFindingId: string;
  state: PreparedDecisionState;
  reason: IntentionalResolutionReason | null;
  note: string;
}): PreparedDecision {
  const decision: PreparedDecision = {
    ...input,
    proposalId: `decision-${++sequence}`,
    documentId: documentId(),
    revision: version(),
    status: "pending",
    message: null,
  };
  // A newer preparation replaces the old one for the same finding; it never accumulates.
  setPreparedDecisions((all) => [
    ...all.map((item) =>
      item.findingId === input.findingId && item.status === "pending"
        ? { ...item, status: "discarded" as const }
        : item,
    ),
    decision,
  ]);
  return decision;
}

const update = (proposalId: string, patch: Partial<PreparedDecision>) =>
  setPreparedDecisions((all) =>
    all.map((item) => (item.proposalId === proposalId ? { ...item, ...patch } : item)),
  );

export function discardPreparedDecision(proposalId: string) {
  if (preparedDecision(proposalId)?.status === "pending")
    update(proposalId, { status: "discarded" });
}

/** Records a prepared decision through the existing resolution writer. */
export function acceptPreparedDecision(
  proposalId: string,
):
  | StrategicFitFindingResolutionTransitionResult
  | { state: "blocked"; code: string; message: string } {
  const decision = preparedDecision(proposalId);
  if (decision?.status !== "pending")
    return {
      state: "blocked",
      code: "decision_not_pending",
      message: decision ? `This decision was already ${decision.status}.` : "Unknown decision.",
    };
  if (decision.documentId !== documentId() || decision.revision !== version()) {
    update(proposalId, { status: "stale", message: "The repertoire changed after preparation." });
    return {
      state: "blocked",
      code: "decision_stale",
      message: "The repertoire changed after this decision was prepared.",
    };
  }
  const result = transitionStrategicFitFindingResolution({
    report_id: decision.reportId,
    finding_id: decision.findingId,
    semantic_finding_id: decision.semanticFindingId,
    state: decision.state,
    intentional_reason: decision.state === "keep-intentionally" ? decision.reason : null,
    note: decision.note,
  });
  update(
    proposalId,
    result.state === "blocked"
      ? { status: "stale", message: result.message }
      : { status: "accepted", message: result.message },
  );
  return result;
}

export function resetPreparedDecisionsForTesting() {
  assertTestOnly();
  setPreparedDecisions([]);
}
