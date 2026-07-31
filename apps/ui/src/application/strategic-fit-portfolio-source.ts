import type {
  ReplacementSafetySimulationResult,
  ReplacementToolV2Item,
} from "@chess-mcp/chess-tools";

/** Retained Replacement Lab evidence a portfolio may be built from. Nothing here is recomputed. */
export interface StrategicFitPortfolioEvidence {
  readonly document_id: string;
  readonly repertoire_revision: number;
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly safety: ReplacementSafetySimulationResult;
  readonly previews: readonly ReplacementToolV2Item[];
}

export interface StrategicFitPortfolioStageOutcome {
  readonly ok: boolean;
  readonly stage_id: string | null;
  readonly status: string;
  readonly code: string | null;
  readonly message: string;
}

export interface StrategicFitPortfolioSource {
  /** The open lab's retained evidence, or null when no usable result exists to choose among. */
  evidence(): StrategicFitPortfolioEvidence | null;
  /**
   * Stage one already-generated candidate's existing change set through the Task 9.3 review path.
   * The portfolio adds no staging of its own, so acceptance stays revision-bound and explicit.
   */
  stageOption(
    candidateId: string,
    action: "add-alternative" | "replace",
  ): Promise<StrategicFitPortfolioStageOutcome>;
}

let source: StrategicFitPortfolioSource | null = null;

/**
 * Narrow bridge between the Replacement Lab store and portfolio redesign, in the same shape as the
 * training writer bridge and for the same reason: the browser command registry reaches portfolio
 * redesign, and the lab store reaches that registry for its engine, explorer, and staging
 * dependencies, so portfolio redesign must not import it directly. Types above are erased, so this
 * module stays a leaf at runtime.
 */
export function registerStrategicFitPortfolioSource(next: StrategicFitPortfolioSource): void {
  source = next;
}

export function currentStrategicFitPortfolioSource(): StrategicFitPortfolioSource | null {
  return source;
}
