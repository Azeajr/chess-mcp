import type { StrategicFitPlanEvidence } from "@chess-mcp/chess-tools";
import type {
  StrategicFitTrainingCreationInput,
  StrategicFitTrainingCreationResult,
} from "../store/strategic-fit-training";

export interface StrategicFitTrainingWriter {
  /** The bounded deterministic plan basis for one finding, derived without saving anything. */
  planEvidence(input: {
    readonly report_id: string;
    readonly finding_id: string;
    readonly semantic_finding_id: string;
  }): StrategicFitPlanEvidence | null;
  /** The single path that records a training reference, resolution, targets, and artifact. */
  createItem(input: StrategicFitTrainingCreationInput): StrategicFitTrainingCreationResult;
}

let trainingWriter: StrategicFitTrainingWriter | null = null;

/**
 * Narrow bridge between the training store and plan synthesis, in the same shape as the training
 * evidence provider and for the same reason: the browser command registry reaches plan synthesis,
 * and the training store reaches the finding-resolution and lifecycle graph, so plan synthesis must
 * not import it directly. Types above are erased, so this module stays a leaf at runtime.
 */
export function registerStrategicFitTrainingWriter(writer: StrategicFitTrainingWriter): void {
  trainingWriter = writer;
}

export function currentStrategicFitTrainingWriter(): StrategicFitTrainingWriter | null {
  return trainingWriter;
}
