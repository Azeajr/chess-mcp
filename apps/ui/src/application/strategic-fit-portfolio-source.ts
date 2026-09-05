import type {
  ReplacementSafetySimulationResult,
  ReplacementToolV2Item,
} from "@chess-mcp/chess-tools";

export interface StrategicFitPortfolioEvidence {
  readonly document_id: string;
  readonly repertoire_revision: number;
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly safety: ReplacementSafetySimulationResult;
  readonly previews: readonly ReplacementToolV2Item[];
}

interface StrategicFitPortfolioStageOutcome {
  readonly ok: boolean;
  readonly stage_id: string | null;
  readonly status: string;
  readonly code: string | null;
  readonly message: string;
}

export interface StrategicFitPortfolioSource {
  evidence(): StrategicFitPortfolioEvidence | null;
  stageOption(
    candidateId: string,
    action: "add-alternative" | "replace",
  ): Promise<StrategicFitPortfolioStageOutcome>;
}

let source: StrategicFitPortfolioSource | null = null;

export function registerStrategicFitPortfolioSource(next: StrategicFitPortfolioSource): void {
  source = next;
}

export function currentStrategicFitPortfolioSource(): StrategicFitPortfolioSource | null {
  return source;
}
