import type { StrategicTrainingMetricEvidence } from "@chess-mcp/chess-tools";

export type StrategicFitTrainingEvidenceProvider = () => StrategicTrainingMetricEvidence | null;

let trainingEvidenceProvider: StrategicFitTrainingEvidenceProvider = () => null;

/**
 * Narrow bridge between the training store and browser command defaults. Keeping the provider in
 * this leaf module prevents the command registry from importing the full training/lifecycle graph.
 */
export function registerStrategicFitTrainingEvidenceProvider(
  provider: StrategicFitTrainingEvidenceProvider,
): void {
  trainingEvidenceProvider = provider;
}

export function currentStrategicFitTrainingEvidence(): StrategicTrainingMetricEvidence | null {
  try {
    return trainingEvidenceProvider();
  } catch {
    return null;
  }
}
