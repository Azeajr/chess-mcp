import {
  StrategicFitPlanError,
  resolveStrategicFitPlanCard,
  strategicFitPlanErrorResult,
  strategicFitPlanEvidenceIdentity,
  type StrategicFitPlanCard,
  type StrategicFitPlanCardInput,
  type StrategicFitPlanEvidence,
} from "@chess-mcp/chess-tools";
import { createSignal } from "solid-js";
import { currentStrategicFitTrainingWriter } from "../application/strategic-fit-training-writer";
import { documentId, version } from "./game";
import type { StrategicFitTrainingCreationResult } from "./strategic-fit-training";

type StrategicFitPlanStatus = "pending" | "accepted" | "rejected" | "stale";

interface StrategicFitPlanSubject {
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
}

interface StrategicFitStagedPlanCard {
  readonly plan_id: string;
  readonly status: StrategicFitPlanStatus;
  readonly document_id: string;
  readonly repertoire_revision: number;
  readonly subject: StrategicFitPlanSubject;
  readonly evidence_identity: string;
  readonly card: StrategicFitPlanCard;
  readonly created_at: string;
}

export interface StrategicFitPlanBasisResult extends StrategicFitPlanEvidence {
  readonly kind: "strategic_fit_plan_basis";
  readonly persisted: false;
  readonly next_step: string;
}

export interface StrategicFitPlanProposalResult {
  readonly kind: "strategic_fit_plan_card";
  readonly plan_id: string;
  readonly status: "pending";
  readonly revision: number;
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly title: string;
  readonly sections: StrategicFitPlanCard["sections"];
  readonly persisted: false;
  readonly scope: "training-metadata-only";
  readonly next_step: string;
}

type StrategicFitPlanDecisionResult =
  | {
      readonly ok: true;
      readonly plan_id: string;
      readonly status: StrategicFitPlanStatus;
      readonly training_id: string | null;
      readonly artifact_id: string | null;
    }
  | { readonly ok: false; readonly error: string; readonly reason: string };

export interface StrategicFitPlanSynthesisBoundary {
  currentDocumentId(): string;
  currentRevision(): number;
  planEvidence(subject: StrategicFitPlanSubject): StrategicFitPlanEvidence | null;
  saveTraining(
    subject: StrategicFitPlanSubject,
    card: StrategicFitPlanCard,
  ): StrategicFitTrainingCreationResult;
  now(): string;
}

export interface StrategicFitPlanSynthesisState {
  plans(): readonly StrategicFitStagedPlanCard[];
  plan(planId: string): StrategicFitStagedPlanCard | undefined;
  basis(subject: StrategicFitPlanSubject): StrategicFitPlanBasisResult;
  propose(
    subject: StrategicFitPlanSubject,
    plan: StrategicFitPlanCardInput,
  ): StrategicFitPlanProposalResult;
  accept(planId: string): StrategicFitPlanDecisionResult;
  reject(planId: string): StrategicFitPlanDecisionResult;
}

const evidenceUnavailable = (subject: StrategicFitPlanSubject): StrategicFitPlanError =>
  new StrategicFitPlanError(
    "strategic_fit_plan_evidence_unavailable",
    `No current deterministic training evidence exists for finding ${subject.finding_id} in report ${subject.report_id}. The report may be stale, the finding may no longer exist, or its branch may have no legal checkpoint left; say the evidence is unavailable instead of describing the branch from chess knowledge.`,
  );

export function createStrategicFitPlanSynthesisState(
  boundary: StrategicFitPlanSynthesisBoundary,
): StrategicFitPlanSynthesisState {
  const [plans, setPlans] = createSignal<readonly StrategicFitStagedPlanCard[]>([]);
  let nextId = 1;

  const find = (planId: string) => plans().find((entry) => entry.plan_id === planId);
  const update = (planId: string, status: StrategicFitPlanStatus) =>
    setPlans((all) =>
      all.map((entry) => (entry.plan_id === planId ? { ...entry, status } : entry)),
    );

  const evidence = (subject: StrategicFitPlanSubject): StrategicFitPlanEvidence => {
    let basis: StrategicFitPlanEvidence | null = null;
    try {
      basis = boundary.planEvidence(subject);
    } catch {
      throw evidenceUnavailable(subject);
    }
    if (basis === null) throw evidenceUnavailable(subject);
    return basis;
  };

  return {
    plans,
    plan: find,

    basis(subject) {
      return {
        kind: "strategic_fit_plan_basis",
        ...evidence(subject),
        persisted: false,
        next_step:
          "Nothing is saved. Write the plan from exactly these concepts, checkpoints, drills, and moves, and say that anything omitted here was withheld rather than absent.",
      };
    },

    propose(subject, plan) {
      const card = resolveStrategicFitPlanCard(plan, evidence(subject));
      const staged: StrategicFitStagedPlanCard = {
        plan_id: `strategic-fit-plan:${nextId++}`,
        status: "pending",
        document_id: boundary.currentDocumentId(),
        repertoire_revision: boundary.currentRevision(),
        subject,
        evidence_identity: card.evidence_identity,
        card,
        created_at: boundary.now(),
      };
      setPlans((all) => [...all, staged]);
      return {
        kind: "strategic_fit_plan_card",
        plan_id: staged.plan_id,
        status: "pending",
        revision: staged.repertoire_revision,
        report_id: subject.report_id,
        finding_id: subject.finding_id,
        semantic_finding_id: subject.semantic_finding_id,
        title: card.title,
        sections: card.sections,
        persisted: false,
        scope: "training-metadata-only",
        next_step:
          "Nothing has been saved. Summarize the plan and let the user accept or reject it in the application; never state that it was saved, or that the exception is now trained, until they accept.",
      };
    },

    accept(planId) {
      const staged = find(planId);
      if (staged?.status !== "pending") {
        return {
          ok: false,
          error: "strategic_fit_plan_not_pending",
          reason: staged
            ? `This plan card was already ${staged.status}.`
            : "That plan card is not available in this session.",
        };
      }
      const stale = (reason: string): StrategicFitPlanDecisionResult => {
        update(planId, "stale");
        return {
          ok: false,
          error: "strategic_fit_plan_stale",
          reason: `${reason} Write the plan again against the current evidence so the user confirms what is actually supported.`,
        };
      };
      if (staged.document_id !== boundary.currentDocumentId())
        return stale("A different document is open.");
      if (staged.repertoire_revision !== boundary.currentRevision()) {
        return stale("The repertoire changed after this plan was written.");
      }
      let identity: string;
      try {
        identity = strategicFitPlanEvidenceIdentity(evidence(staged.subject));
      } catch (error) {
        return stale(
          error instanceof StrategicFitPlanError
            ? error.message
            : "The evidence for this finding is unavailable.",
        );
      }
      if (identity !== staged.evidence_identity) {
        return stale("The deterministic evidence behind this plan changed after it was written.");
      }
      const saved = boundary.saveTraining(staged.subject, staged.card);
      if (saved.state === "blocked" || saved.record === null) {
        update(planId, "stale");
        return {
          ok: false,
          error: saved.code ?? "strategic_fit_plan_stale",
          reason: saved.message,
        };
      }
      update(planId, "accepted");
      return {
        ok: true,
        plan_id: planId,
        status: "accepted",
        training_id: saved.record.training_id,
        artifact_id: saved.artifact_id,
      };
    },

    reject(planId) {
      const staged = find(planId);
      if (staged?.status !== "pending") {
        return {
          ok: false,
          error: "strategic_fit_plan_not_pending",
          reason: staged
            ? `This plan card was already ${staged.status}.`
            : "That plan card is not available in this session.",
        };
      }
      update(planId, "rejected");
      return {
        ok: true,
        plan_id: planId,
        status: "rejected",
        training_id: null,
        artifact_id: null,
      };
    },
  };
}

const missingWriter = (): StrategicFitTrainingCreationResult => ({
  state: "blocked",
  code: "strategic_fit_plan_evidence_unavailable",
  message:
    "Training state is not loaded in this session, so there is nothing to ground or save a plan card with.",
  record: null,
  artifact_id: null,
});

const browserPlanSynthesis = createStrategicFitPlanSynthesisState({
  currentDocumentId: documentId,
  currentRevision: version,
  planEvidence: (subject) => currentStrategicFitTrainingWriter()?.planEvidence(subject) ?? null,
  saveTraining: (subject, card) =>
    currentStrategicFitTrainingWriter()?.createItem({ ...subject, plan_card: card }) ??
    missingWriter(),
  now: () => new Date().toISOString(),
});

export const strategicFitPlanCard = (planId: string) => browserPlanSynthesis.plan(planId);
export const acceptStrategicFitPlanCard = (planId: string) => browserPlanSynthesis.accept(planId);
export const rejectStrategicFitPlanCard = (planId: string) => browserPlanSynthesis.reject(planId);

export function proposeStrategicFitPlan(input: {
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly plan?: StrategicFitPlanCardInput;
}):
  | StrategicFitPlanBasisResult
  | StrategicFitPlanProposalResult
  | { readonly error: string; readonly reason: string } {
  const subject: StrategicFitPlanSubject = {
    report_id: input.report_id,
    finding_id: input.finding_id,
    semantic_finding_id: input.semantic_finding_id,
  };
  try {
    return input.plan === undefined
      ? browserPlanSynthesis.basis(subject)
      : browserPlanSynthesis.propose(subject, input.plan);
  } catch (error) {
    return strategicFitPlanErrorResult(error);
  }
}
