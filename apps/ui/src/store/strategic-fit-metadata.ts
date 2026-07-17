/**
 * Browser-facing Strategic Fit metadata facade.
 *
 * Task 4.1 intentionally exposes only the shared contract and deterministic defaults. Stable
 * document identity and persistence are introduced by Tasks 4.2 and 4.3 respectively.
 */
export {
  STRATEGIC_FIT_DOCUMENT_METADATA_KIND,
  STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
  createDefaultStrategicFitDocumentMetadata,
  normalizeStrategicFitDocumentMetadata,
} from "@chess-mcp/chess-tools";
export type {
  StrategicFitArchiveReference,
  StrategicFitDocumentMetadata,
  StrategicFitManualWeights,
  StrategicFitMetadataNormalizationResult,
  StrategicFitTrainingReference,
} from "@chess-mcp/chess-tools";
