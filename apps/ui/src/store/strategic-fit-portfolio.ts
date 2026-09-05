import {
  StrategicFitPortfolioError,
  buildStrategicFitPortfolio,
  detectStrategicFitPortfolioConflicts,
  resolveStrategicFitPortfolioConstraints,
  strategicFitPortfolioConstraintIdentity,
  strategicFitPortfolioErrorResult,
  type StrategicFitPortfolioConflict,
  type StrategicFitPortfolioConstraintInput,
  type StrategicFitPortfolioConstraintSet,
  type StrategicFitPortfolioOption,
  type StrategicFitPortfolioResult,
} from "@chess-mcp/chess-tools";
import { createSignal } from "solid-js";
import {
  currentStrategicFitPortfolioSource,
  type StrategicFitPortfolioEvidence,
} from "../application/strategic-fit-portfolio-source";
import { documentId, version } from "./game";
import { strategicFitProfile } from "./strategic-fit-profile";

type StrategicFitPortfolioConstraintStatus = "pending" | "confirmed" | "rejected" | "stale";

interface StrategicFitStagedConstraintSet {
  readonly constraint_set_id: string;
  readonly status: StrategicFitPortfolioConstraintStatus;
  readonly document_id: string;
  readonly repertoire_revision: number;
  readonly constraint_identity: string;
  readonly set: StrategicFitPortfolioConstraintSet;
  readonly conflicts: readonly StrategicFitPortfolioConflict[];
  readonly created_at: string;
}

type StrategicFitPortfolioSelectionStatus = "staged" | "superseded" | "failed";

interface StrategicFitPortfolioSelection {
  readonly constraint_set_id: string;
  readonly option_id: string;
  readonly candidate_id: string;
  readonly status: StrategicFitPortfolioSelectionStatus;
  readonly stage_id: string | null;
}

export interface StrategicFitPortfolioConstraintResult {
  readonly kind: "strategic_fit_portfolio_constraints";
  readonly constraint_set_id: string;
  readonly status: "pending";
  readonly revision: number;
  readonly constraints: StrategicFitPortfolioConstraintSet["constraints"];
  readonly rationale: string | null;
  readonly conflicts: readonly StrategicFitPortfolioConflict[];
  readonly persisted: false;
  readonly scope: "one-redesign-only";
  readonly next_step: string;
}

export interface StrategicFitPortfolioViewResult extends StrategicFitPortfolioResult {
  readonly kind: "strategic_fit_portfolio";
  readonly constraint_set_id: string;
  readonly persisted: false;
  readonly next_step: string;
}

export type StrategicFitPortfolioSelectionResult =
  | {
      readonly kind: "strategic_fit_portfolio_selection";
      readonly constraint_set_id: string;
      readonly option_id: string;
      readonly candidate_id: string;
      readonly status: "staged";
      readonly stage_id: string | null;
      readonly applied: false;
      readonly persisted: false;
      readonly next_step: string;
    }
  | { readonly error: string; readonly reason: string };

export interface StrategicFitPortfolioBoundary {
  currentDocumentId(): string;
  currentRevision(): number;
  currentProfile(): Parameters<typeof detectStrategicFitPortfolioConflicts>[1]["profile"];
  evidence(): StrategicFitPortfolioEvidence | null;
  stageOption(
    candidateId: string,
    action: "add-alternative" | "replace",
  ): Promise<{
    readonly ok: boolean;
    readonly stage_id: string | null;
    readonly code: string | null;
    readonly message: string;
  }>;
  now(): string;
}

export interface StrategicFitPortfolioState {
  constraintSets(): readonly StrategicFitStagedConstraintSet[];
  constraintSet(id: string): StrategicFitStagedConstraintSet | undefined;
  selection(): StrategicFitPortfolioSelection | null;
  propose(input: StrategicFitPortfolioConstraintInput): StrategicFitPortfolioConstraintResult;
  portfolio(constraintSetId: string): StrategicFitPortfolioViewResult;
  select(constraintSetId: string, optionId: string): Promise<StrategicFitPortfolioSelectionResult>;
  confirm(constraintSetId: string): {
    readonly ok: boolean;
    readonly status: StrategicFitPortfolioConstraintStatus;
  };
  reject(constraintSetId: string): {
    readonly ok: boolean;
    readonly status: StrategicFitPortfolioConstraintStatus;
  };
}

const evidenceUnavailable = (): StrategicFitPortfolioError =>
  new StrategicFitPortfolioError(
    "strategic_fit_portfolio_evidence_unavailable",
    "No Replacement Lab result is available for the current document, so there are no generated candidates to choose among. Open Replacement Lab on an unresolved finding and generate candidates first; do not describe alternatives from chess knowledge.",
  );

export function createStrategicFitPortfolioState(
  boundary: StrategicFitPortfolioBoundary,
): StrategicFitPortfolioState {
  const [sets, setSets] = createSignal<readonly StrategicFitStagedConstraintSet[]>([]);
  const [selection, setSelection] = createSignal<StrategicFitPortfolioSelection | null>(null);
  let nextId = 1;

  const find = (id: string) => sets().find((entry) => entry.constraint_set_id === id);
  const update = (id: string, status: StrategicFitPortfolioConstraintStatus) =>
    setSets((all) =>
      all.map((entry) => (entry.constraint_set_id === id ? { ...entry, status } : entry)),
    );

  const evidence = (): StrategicFitPortfolioEvidence => {
    let current: StrategicFitPortfolioEvidence | null = null;
    try {
      current = boundary.evidence();
    } catch {
      throw evidenceUnavailable();
    }
    if (current === null) throw evidenceUnavailable();
    return current;
  };

  const usableSet = (constraintSetId: string): StrategicFitStagedConstraintSet => {
    const staged = find(constraintSetId);
    if (!staged) {
      throw new StrategicFitPortfolioError(
        "strategic_fit_portfolio_unconfirmed_constraints",
        "That constraint set is not available in this session. State the bounds again and let the user confirm them.",
      );
    }
    if (staged.status !== "confirmed") {
      throw new StrategicFitPortfolioError(
        "strategic_fit_portfolio_unconfirmed_constraints",
        staged.status === "pending"
          ? "These bounds are still waiting for the user's confirmation. Nothing may be built from them until they confirm, and a contradiction they were shown is theirs to settle."
          : `These bounds were ${staged.status}. State the bounds again rather than reusing a set the user did not confirm.`,
      );
    }
    if (
      staged.document_id !== boundary.currentDocumentId() ||
      staged.repertoire_revision !== boundary.currentRevision()
    ) {
      update(constraintSetId, "stale");
      throw new StrategicFitPortfolioError(
        "strategic_fit_portfolio_stale",
        "The document or repertoire changed after these bounds were confirmed, so the measured evidence behind any portfolio would no longer match them. State the bounds again against the current repertoire.",
      );
    }
    return staged;
  };

  const buildFor = (
    staged: StrategicFitStagedConstraintSet,
    current: StrategicFitPortfolioEvidence,
  ): StrategicFitPortfolioResult =>
    buildStrategicFitPortfolio({
      constraint_set: staged.set,
      safety: current.safety,
      previews: current.previews,
    });

  return {
    constraintSets: sets,
    constraintSet: find,
    selection,

    propose(input) {
      const set = resolveStrategicFitPortfolioConstraints(input);
      const conflicts = detectStrategicFitPortfolioConflicts(set, {
        profile: boundary.currentProfile(),
      });
      const staged: StrategicFitStagedConstraintSet = {
        constraint_set_id: `strategic-fit-portfolio-constraints:${nextId++}`,
        status: "pending",
        document_id: boundary.currentDocumentId(),
        repertoire_revision: boundary.currentRevision(),
        constraint_identity: strategicFitPortfolioConstraintIdentity(set),
        set,
        conflicts,
        created_at: boundary.now(),
      };
      setSets((all) => [...all, staged]);
      return {
        kind: "strategic_fit_portfolio_constraints",
        constraint_set_id: staged.constraint_set_id,
        status: "pending",
        revision: staged.repertoire_revision,
        constraints: set.constraints,
        rationale: set.rationale,
        conflicts,
        persisted: false,
        scope: "one-redesign-only",
        next_step:
          conflicts.length > 0
            ? "Nothing is bound. Put each contradiction to the user as a question and let them decide; do not drop, relax, or reconcile a bound yourself. Once they confirm the bounds in the application, ask for the portfolio with this constraint_set_id."
            : "Nothing is bound and no preference was saved. Once the user confirms these bounds in the application, ask for the portfolio with this constraint_set_id.",
      };
    },

    portfolio(constraintSetId) {
      const staged = usableSet(constraintSetId);
      const result = buildFor(staged, evidence());
      return {
        kind: "strategic_fit_portfolio",
        constraint_set_id: constraintSetId,
        ...result,
        persisted: false,
        next_step:
          result.status === "available"
            ? "Nothing is selected and nothing is applied. Present the options with the measured values behind each bound, say which are Pareto-optimal and which are dominated, and let the user choose; then select that option to stage its existing change set for their confirmation."
            : "No portfolio option exists. Report the bound that excluded the candidates and ask the user which bound to move; never propose a line of your own instead.",
      };
    },

    async select(constraintSetId, optionId) {
      let staged: StrategicFitStagedConstraintSet;
      let current: StrategicFitPortfolioEvidence;
      let option: StrategicFitPortfolioOption | undefined;
      try {
        staged = usableSet(constraintSetId);
        current = evidence();
        const result = buildFor(staged, current);
        option = result.options.find((entry) => entry.option_id === optionId);
      } catch (error) {
        return strategicFitPortfolioErrorResult(error);
      }
      if (!option) {
        return {
          error: "strategic_fit_portfolio_unknown_option",
          reason: `${optionId} is not an option in the current portfolio for these bounds. Only an option this portfolio returned can be staged; ask for the portfolio again if the evidence moved.`,
        };
      }
      const previous = selection();
      const outcome = await boundary.stageOption(option.candidate_id, option.action);
      if (!outcome.ok) {
        setSelection({
          constraint_set_id: constraintSetId,
          option_id: optionId,
          candidate_id: option.candidate_id,
          status: "failed",
          stage_id: outcome.stage_id,
        });
        return {
          error: outcome.code ?? "strategic_fit_portfolio_stale",
          reason: outcome.message,
        };
      }
      if (previous?.status === "staged" && previous.option_id !== optionId) {
        setSelection({ ...previous, status: "superseded" });
      }
      setSelection({
        constraint_set_id: constraintSetId,
        option_id: optionId,
        candidate_id: option.candidate_id,
        status: "staged",
        stage_id: outcome.stage_id,
      });
      return {
        kind: "strategic_fit_portfolio_selection",
        constraint_set_id: constraintSetId,
        option_id: optionId,
        candidate_id: option.candidate_id,
        status: "staged",
        stage_id: outcome.stage_id,
        applied: false,
        persisted: false,
        next_step:
          "The change is staged, not applied. Summarize what it adds and costs from the review evidence and let the user confirm or reject it in the application; never state that the repertoire changed until they confirm.",
      };
    },

    confirm(constraintSetId) {
      const staged = find(constraintSetId);
      if (staged?.status !== "pending") {
        return { ok: false, status: staged?.status ?? "stale" };
      }
      if (
        staged.document_id !== boundary.currentDocumentId() ||
        staged.repertoire_revision !== boundary.currentRevision()
      ) {
        update(constraintSetId, "stale");
        return { ok: false, status: "stale" };
      }
      update(constraintSetId, "confirmed");
      return { ok: true, status: "confirmed" };
    },

    reject(constraintSetId) {
      const staged = find(constraintSetId);
      if (staged?.status !== "pending") {
        return { ok: false, status: staged?.status ?? "stale" };
      }
      update(constraintSetId, "rejected");
      return { ok: true, status: "rejected" };
    },
  };
}

const browserPortfolio = createStrategicFitPortfolioState({
  currentDocumentId: documentId,
  currentRevision: version,
  currentProfile: strategicFitProfile,
  evidence: () => currentStrategicFitPortfolioSource()?.evidence() ?? null,
  stageOption: async (candidateId, action) => {
    const source = currentStrategicFitPortfolioSource();
    if (!source) {
      return {
        ok: false,
        stage_id: null,
        code: "strategic_fit_portfolio_evidence_unavailable",
        message: "Replacement Lab is not open in this session, so there is nothing to stage.",
      };
    }
    const outcome = await source.stageOption(candidateId, action);
    return {
      ok: outcome.ok,
      stage_id: outcome.stage_id,
      code: outcome.code,
      message: outcome.message,
    };
  },
  now: () => new Date().toISOString(),
});

export const strategicFitPortfolioConstraintSet = (id: string) =>
  browserPortfolio.constraintSet(id);
export const strategicFitPortfolioSelection = () => browserPortfolio.selection();
export const confirmStrategicFitPortfolioConstraints = (id: string) => browserPortfolio.confirm(id);
export const rejectStrategicFitPortfolioConstraints = (id: string) => browserPortfolio.reject(id);

export async function proposeStrategicFitPortfolio(input: {
  readonly constraints?: unknown;
  readonly rationale?: unknown;
  readonly constraint_set_id?: string;
  readonly option_id?: string;
}): Promise<
  | StrategicFitPortfolioConstraintResult
  | StrategicFitPortfolioViewResult
  | StrategicFitPortfolioSelectionResult
  | { readonly error: string; readonly reason: string }
> {
  try {
    if (input.constraints !== undefined) {
      return browserPortfolio.propose({
        constraints: input.constraints,
        ...(input.rationale === undefined ? {} : { rationale: input.rationale }),
      });
    }
    const constraintSetId = input.constraint_set_id ?? "";
    if (input.option_id !== undefined) {
      return await browserPortfolio.select(constraintSetId, input.option_id);
    }
    return browserPortfolio.portfolio(constraintSetId);
  } catch (error) {
    return strategicFitPortfolioErrorResult(error);
  }
}
