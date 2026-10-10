import { currentTree, documentId, version } from "../../store/game";
import {
  acceptPreview,
  acceptStagedEdit,
  acceptSuggestion,
  preview,
  stagedEdit,
  stagedEdits,
  suggestions,
} from "../../store/suggestions";
import {
  acceptStrategicFitProfileProposal,
  strategicFitProfileProposals,
} from "../../store/strategic-fit-intent-interview";
import {
  acceptStrategicFitPlanCard,
  strategicFitPlanCards,
} from "../../store/strategic-fit-plan-synthesis";
import {
  confirmStrategicFitPortfolioConstraints,
  strategicFitPortfolioConstraintSets,
} from "../../store/strategic-fit-portfolio";
import { replacementLab, replacementLabSnapshot } from "../../store/strategic-fit-replacement";
import { strategicFitChangeConfirmation } from "../../store/strategic-fit-changes";
import {
  acceptPreparedDecision,
  preparedDecisions,
} from "../../store/strategic-fit-decision-drafts";
import type { GuidedSurface } from "../../store/guided-ui";

export type ProposalKind =
  | "repertoire_edit"
  | "preview_line"
  | "strategic_fit_profile"
  | "strategic_fit_plan"
  | "strategic_fit_portfolio_bounds"
  | "strategic_fit_change_set"
  | "strategic_fit_decision";

export interface ProposalSummary {
  /** `<kind>:<owner id>`; unique across every staging store. */
  readonly proposalId: string;
  readonly kind: ProposalKind;
  readonly status: "pending" | "stale";
  /** Changes whenever the previewed content or its source revision changes. */
  readonly previewVersion: string;
  readonly revision: number;
  readonly summary: string;
  /** Where the visible Accept control lives. */
  readonly surface: GuidedSurface | "chat";
}

const id = (kind: ProposalKind, ownerId: string) => `${kind}:${ownerId}`;
const ownerId = (proposalId: string) => proposalId.slice(proposalId.indexOf(":") + 1);
const sanText = (path: readonly string[]) => (path.length ? path.join(" ") : "the start");

/**
 * Every decision currently staged for the user, read from the stores that own them. Nothing is
 * copied: acceptance always goes back to the owning store's existing writer.
 */
export function pendingProposals(): ProposalSummary[] {
  const revision = version();
  const document = documentId();
  const out: ProposalSummary[] = [];
  for (const edit of stagedEdits()) {
    if (edit.status !== "pending") continue;
    out.push({
      proposalId: id("repertoire_edit", edit.id),
      kind: "repertoire_edit",
      status: edit.revision === revision ? "pending" : "stale",
      previewVersion: `${edit.id}@${edit.revision}`,
      revision: edit.revision,
      summary: `${edit.action} at ${sanText(edit.path)}${edit.addMoves?.length ? `: ${edit.addMoves.join(" ")}` : ""}`,
      surface: "chat",
    });
  }
  const line = preview();
  if (line && !stagedEdit(line.id)) {
    let from = "";
    try {
      from = sanText(currentTree().sanPathAt(line.fromPath));
    } catch {
      from = "an earlier position";
    }
    out.push({
      proposalId: id("preview_line", line.id),
      kind: "preview_line",
      status: line.revision === revision && line.document === document ? "pending" : "stale",
      previewVersion: `${line.id}@${line.revision}:${line.sans.join(" ")}`,
      revision: line.revision,
      summary: `Add ${line.sans.join(" ")} after ${from}`,
      surface: "repertoire.preview",
    });
  }
  for (const proposal of strategicFitProfileProposals()) {
    if (proposal.status !== "pending") continue;
    out.push({
      proposalId: id("strategic_fit_profile", proposal.proposal_id),
      kind: "strategic_fit_profile",
      status:
        proposal.document_id === document && proposal.repertoire_revision === revision
          ? "pending"
          : "stale",
      previewVersion: `${proposal.proposal_id}@${proposal.repertoire_revision}:${proposal.profile_identity}`,
      revision: proposal.repertoire_revision,
      summary: `Profile ${proposal.current_mode} → ${proposal.resulting_mode} (${proposal.diff.length} change${proposal.diff.length === 1 ? "" : "s"})`,
      surface: "chat",
    });
  }
  for (const plan of strategicFitPlanCards()) {
    if (plan.status !== "pending") continue;
    out.push({
      proposalId: id("strategic_fit_plan", plan.plan_id),
      kind: "strategic_fit_plan",
      status:
        plan.document_id === document && plan.repertoire_revision === revision
          ? "pending"
          : "stale",
      previewVersion: `${plan.plan_id}@${plan.repertoire_revision}:${plan.evidence_identity}`,
      revision: plan.repertoire_revision,
      summary: `Training plan “${plan.card.title}” for ${plan.subject.finding_id}`,
      surface: "chat",
    });
  }
  for (const set of strategicFitPortfolioConstraintSets()) {
    if (set.status !== "pending") continue;
    out.push({
      proposalId: id("strategic_fit_portfolio_bounds", set.constraint_set_id),
      kind: "strategic_fit_portfolio_bounds",
      status:
        set.document_id === document && set.repertoire_revision === revision ? "pending" : "stale",
      previewVersion: `${set.constraint_set_id}@${set.repertoire_revision}:${set.constraint_identity}`,
      revision: set.repertoire_revision,
      summary: `Replacement bounds ${set.constraint_set_id}${set.conflicts.length ? ` (${set.conflicts.length} conflict${set.conflicts.length === 1 ? "" : "s"})` : ""}`,
      surface: "chat",
    });
  }
  const review = replacementLabSnapshot().review;
  if (review?.status === "ready" && review.stage) {
    const stage = review.stage;
    out.push({
      proposalId: id("strategic_fit_change_set", stage.stage_id),
      kind: "strategic_fit_change_set",
      status:
        stage.document_id === document && stage.base_revision === revision ? "pending" : "stale",
      previewVersion: stage.preview_identity,
      revision: stage.base_revision,
      summary: `${review.action === "replace" ? "Replace with" : "Add alternative"} candidate ${review.candidate_id}`,
      surface: "strategicFit.lab",
    });
  }
  for (const decision of preparedDecisions()) {
    if (decision.status !== "pending") continue;
    out.push({
      proposalId: id("strategic_fit_decision", decision.proposalId),
      kind: "strategic_fit_decision",
      status:
        decision.documentId === document && decision.revision === revision ? "pending" : "stale",
      previewVersion: `${decision.proposalId}@${decision.revision}:${decision.state}:${decision.reason ?? ""}:${decision.note}`,
      revision: decision.revision,
      summary: `${decision.state} for ${decision.findingId}`,
      surface: "strategicFit.decision",
    });
  }
  return out;
}

export interface AcceptanceOutcome {
  readonly ok: boolean;
  readonly code?: string;
  readonly reason?: string;
  readonly result?: unknown;
}

const inFlight = new Set<string>();

/**
 * The single acceptance coordinator for the assistant route. It calls the same writer as the
 * visible Accept control, and holds the proposal while an asynchronous writer runs so a card press
 * and a chat approval can never apply one preview twice.
 */
export async function acceptProposal(proposalId: string): Promise<AcceptanceOutcome> {
  const proposal = pendingProposals().find((item) => item.proposalId === proposalId);
  if (!proposal) return { ok: false, code: "proposal_not_pending", reason: "Nothing to accept." };
  if (proposal.status === "stale")
    return {
      ok: false,
      code: "proposal_stale",
      reason: "The document changed after this preview.",
    };
  if (inFlight.has(proposalId))
    return { ok: false, code: "acceptance_in_progress", reason: "Already being applied." };
  inFlight.add(proposalId);
  try {
    const owner = ownerId(proposalId);
    switch (proposal.kind) {
      case "repertoire_edit": {
        if (suggestions().some((item) => item.id === owner)) acceptSuggestion(owner);
        else acceptStagedEdit(owner);
        const status = stagedEdit(owner)?.status;
        return status === "accepted"
          ? { ok: true, result: { status } }
          : { ok: false, code: "edit_not_applied", reason: `The edit is ${status ?? "missing"}.` };
      }
      case "preview_line": {
        if (preview()?.id !== owner)
          return { ok: false, code: "proposal_not_pending", reason: "The preview changed." };
        const before = version();
        acceptPreview();
        return version() !== before
          ? { ok: true, result: { revision: version() } }
          : { ok: false, code: "preview_stale", reason: "The preview was out of date." };
      }
      case "strategic_fit_profile": {
        const result = acceptStrategicFitProfileProposal(owner);
        return result.ok
          ? { ok: true, result }
          : { ok: false, code: result.error, reason: result.reason };
      }
      case "strategic_fit_plan": {
        const result = acceptStrategicFitPlanCard(owner);
        return result.ok
          ? { ok: true, result }
          : { ok: false, code: result.error, reason: result.reason };
      }
      case "strategic_fit_portfolio_bounds": {
        const result = confirmStrategicFitPortfolioConstraints(owner);
        return result.ok
          ? { ok: true, result }
          : {
              ok: false,
              code: `bounds_${result.status}`,
              reason: `The bounds are ${result.status}.`,
            };
      }
      case "strategic_fit_change_set": {
        const stage = replacementLabSnapshot().review?.stage;
        if (stage?.stage_id !== owner)
          return { ok: false, code: "proposal_not_pending", reason: "The staged change moved on." };
        const accepted = await replacementLab.acceptReview(strategicFitChangeConfirmation(stage));
        const review = replacementLabSnapshot().review;
        return accepted
          ? { ok: true, result: { stage_id: owner, status: review?.status } }
          : {
              ok: false,
              code: review?.error?.code ?? "change_not_applied",
              reason: review?.error?.message ?? "The change was not applied.",
            };
      }
      case "strategic_fit_decision": {
        const result = acceptPreparedDecision(owner);
        return result.state === "blocked"
          ? { ok: false, code: result.code ?? "decision_blocked", reason: result.message }
          : { ok: true, result };
      }
    }
  } finally {
    inFlight.delete(proposalId);
  }
}

/** The user message that started the current assistant turn, supplied by the chat store. */
export interface AssistantTurnContext {
  readonly turnId: number;
  readonly messageId: string;
  readonly text: string;
}

// Which previews each assistant turn put in front of the user, and at which version. A chat
// approval can only refer to what the previous turn showed, so "yes" never reaches back to an
// older preview or a preview created after the user answered.
const presented = new Map<number, Map<string, string>>();
const PRESENTATION_TURNS = 50;

export function recordPresented(turnId: number, proposals: readonly ProposalSummary[]) {
  if (!proposals.length) return;
  const turn = presented.get(turnId) ?? new Map<string, string>();
  for (const proposal of proposals) turn.set(proposal.proposalId, proposal.previewVersion);
  presented.set(turnId, turn);
  for (const key of presented.keys()) if (key < turnId - PRESENTATION_TURNS) presented.delete(key);
}

export function presentedInTurn(turnId: number): ReadonlyMap<string, string> {
  return presented.get(turnId) ?? new Map();
}

const consumedApprovals = new Set<string>();

// Deliberately conservative: an approval that reads as a question, a refusal or a change of
// content is not one. The visible Accept control remains available for everything this rejects.
const AFFIRM =
  /\b(yes|yep|yeah|ok|okay|sure|apply|accept|approve|approved|confirm|confirmed|go ahead|proceed|do it|sounds good|make (?:the|that|this) change|record (?:it|that|the decision)|keep it|save it|add it|use it|create it)\b/i;
const NEGATE =
  /\b(no|not|don'?t|do not|never|stop|cancel|reject|wait|hold on|instead|but)\b|\?\s*$/i;

export function expressesApproval(text: string): boolean {
  return AFFIRM.test(text) && !NEGATE.test(text);
}

export type ApprovalOutcome = AcceptanceOutcome & { readonly candidates?: readonly string[] };

/**
 * Applies a preview the user approved in chat. The model only names the candidate; the application
 * verifies that the approval is the user's own current message, unused, explicit, and answers the
 * single current preview the previous turn presented, before invoking the owning writer.
 */
export async function approveProposal(
  input: { proposalId: string; previewVersion: string; approvalMessageId: string },
  turn: AssistantTurnContext | undefined,
  /** Runs once the approval is verified, before the writer: e.g. reveal where it lands. */
  beforeApply?: () => Promise<void>,
): Promise<ApprovalOutcome> {
  if (turn?.messageId !== input.approvalMessageId)
    return {
      ok: false,
      code: "approval_message_invalid",
      reason: "An approval must cite the user's current message.",
    };
  if (consumedApprovals.has(turn.messageId))
    return {
      ok: false,
      code: "approval_already_used",
      reason: "That message already approved a change.",
    };
  if (!expressesApproval(turn.text))
    return {
      ok: false,
      code: "approval_not_explicit",
      reason:
        "The user's message is not an explicit approval. Ask, or point to the Accept control.",
    };
  const shown = presentedInTurn(turn.turnId - 1);
  const pending = pendingProposals();
  const candidates = [...shown.keys()].filter((proposalId) =>
    pending.some((item) => item.proposalId === proposalId && item.status === "pending"),
  );
  if (!shown.has(input.proposalId))
    return {
      ok: false,
      code: "approval_not_presented",
      reason: "That preview was not shown before the user's message. Show it and ask again.",
      candidates,
    };
  if (candidates.length > 1)
    return {
      ok: false,
      code: "approval_ambiguous",
      reason: "Several previews were awaiting a decision. Ask which one, showing only that one.",
      candidates,
    };
  const current = pending.find((item) => item.proposalId === input.proposalId);
  if (current?.status !== "pending")
    return {
      ok: false,
      code: current ? "proposal_stale" : "proposal_not_pending",
      reason: "That preview is no longer pending at this revision.",
    };
  if (
    current.previewVersion !== input.previewVersion ||
    shown.get(input.proposalId) !== current.previewVersion
  )
    return {
      ok: false,
      code: "approval_stale",
      reason: "The preview changed after the user saw it. Show the new preview and ask again.",
    };
  consumedApprovals.add(turn.messageId);
  await beforeApply?.();
  return acceptProposal(input.proposalId);
}

export function resetProposalTrackingForTesting() {
  presented.clear();
  consumedApprovals.clear();
  inFlight.clear();
}
