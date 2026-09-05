import type { StrategicTrainingMetricEvidence } from "@chess-mcp/chess-tools";

export type StrategicFitTrainingEvidenceProvider = () => StrategicTrainingMetricEvidence | null;

let trainingEvidenceProvider: StrategicFitTrainingEvidenceProvider = () => null;

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
