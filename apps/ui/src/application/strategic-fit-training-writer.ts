import type { StrategicFitPlanEvidence } from "@chess-mcp/chess-tools";
import type {
  StrategicFitTrainingCreationInput,
  StrategicFitTrainingCreationResult,
} from "../store/strategic-fit-training";

export interface StrategicFitTrainingWriter {
  planEvidence(input: {
    readonly report_id: string;
    readonly finding_id: string;
    readonly semantic_finding_id: string;
  }): StrategicFitPlanEvidence | null;
  createItem(input: StrategicFitTrainingCreationInput): StrategicFitTrainingCreationResult;
}

let trainingWriter: StrategicFitTrainingWriter | null = null;

export function registerStrategicFitTrainingWriter(writer: StrategicFitTrainingWriter): void {
  trainingWriter = writer;
}

export function currentStrategicFitTrainingWriter(): StrategicFitTrainingWriter | null {
  return trainingWriter;
}
