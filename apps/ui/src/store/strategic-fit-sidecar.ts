/** Explicit, document-bound Strategic Fit sidecar import workflow. */
import { createSignal } from "solid-js";
import {
  buildRepertoireGraph,
  parseStrategicFitSidecar,
  previewStrategicFitSidecarMerge,
  reconcileStrategicFitDocumentMetadata,
  type ParsedStrategicFitSidecar,
  type StrategicFitDocumentMetadata,
  type StrategicFitMetadataNormalizationResult,
  type StrategicFitSidecarError,
  type StrategicFitSidecarMergePreview,
} from "@chess-mcp/chess-tools";
import { invalidateCachedStrategicFitReports } from "../application/strategic-fit-report-cache";
import { color, currentTree, documentId, version } from "./game";
import { normalizeBrowserDocumentId } from "./document-identity";
import {
  flushStrategicFitMetadata,
  replaceStrategicFitMetadata,
  strategicFitMetadata,
} from "./strategic-fit-metadata";

export const STRATEGIC_FIT_SIDECAR_CONFIRMATION_ERROR_CODES = [
  "no-preview",
  "preview-id-mismatch",
  "stale-preview",
  "document-id-acknowledgement-required",
] as const;
export type StrategicFitSidecarConfirmationErrorCode =
  (typeof STRATEGIC_FIT_SIDECAR_CONFIRMATION_ERROR_CODES)[number];

export interface StrategicFitSidecarConfirmationError {
  readonly error: "strategic_fit_sidecar_confirmation_error";
  readonly code: StrategicFitSidecarConfirmationErrorCode;
  readonly reason: string;
}

export interface StrategicFitSidecarImportPreview extends StrategicFitSidecarMergePreview {
  readonly preview_id: string;
  readonly target_revision: number;
  readonly target_metadata_identity: string;
  readonly resulting_stale: {
    readonly route_weights: readonly string[];
    readonly decision_weights: readonly string[];
    readonly overrides: readonly string[];
    readonly resolutions: readonly string[];
  };
}

export interface StrategicFitSidecarStateBoundary {
  currentDocumentId(): string;
  currentRevision(): number;
  currentMetadata(): StrategicFitDocumentMetadata;
  reconcile(metadata: StrategicFitDocumentMetadata): StrategicFitDocumentMetadata;
  replaceMetadata(metadata: StrategicFitDocumentMetadata): StrategicFitMetadataNormalizationResult;
  invalidateReports(): void;
  flush(documentId: string): Promise<void>;
}

export interface StrategicFitSidecarImportState {
  preview(): StrategicFitSidecarImportPreview | null;
  importError(): StrategicFitSidecarError | StrategicFitSidecarConfirmationError | null;
  prepare(input: string | unknown): StrategicFitSidecarImportPreview | StrategicFitSidecarError;
  cancel(): void;
  confirm(input: {
    readonly preview_id: string;
    readonly acknowledge_document_mismatch?: boolean;
  }): Promise<
    | { readonly ok: true; readonly preview_id: string; readonly document_id: string }
    | StrategicFitSidecarConfirmationError
  >;
}

const metadataIdentity = (metadata: StrategicFitDocumentMetadata): string => JSON.stringify(metadata);

function staleIds(metadata: StrategicFitDocumentMetadata) {
  return {
    route_weights: metadata.manual_weights.route_weights
      .filter((entry) => entry.record_state === "stale").map((entry) => entry.route_id).sort(),
    decision_weights: metadata.manual_weights.decision_weights
      .filter((entry) => entry.record_state === "stale").map((entry) => entry.decision_id).sort(),
    overrides: [...metadata.cohort_overrides, ...metadata.exclusions]
      .filter((entry) => entry.record_state === "stale").map((entry) => entry.override_id).sort(),
    resolutions: metadata.resolutions
      .filter((entry) => entry.record_state === "stale")
      .map((entry) => entry.semantic_finding_id ?? `legacy:${entry.resolution_id}`).sort(),
  };
}

const confirmationError = (
  code: StrategicFitSidecarConfirmationErrorCode,
  reason: string,
): StrategicFitSidecarConfirmationError => ({
  error: "strategic_fit_sidecar_confirmation_error",
  code,
  reason,
});

export function createStrategicFitSidecarImportState(
  boundary: StrategicFitSidecarStateBoundary,
): StrategicFitSidecarImportState {
  let sequence = 0;
  let currentPreview: StrategicFitSidecarImportPreview | null = null;
  let currentError: StrategicFitSidecarError | StrategicFitSidecarConfirmationError | null = null;

  const clear = () => {
    currentPreview = null;
    currentError = null;
  };

  return {
    preview: () => currentPreview,
    importError: () => currentError,

    prepare(input) {
      clear();
      const parsed = parseStrategicFitSidecar(input);
      if (!("ok" in parsed)) {
        currentError = parsed;
        return parsed;
      }
      // Browser documents are RFC UUIDs. Rejecting a forged non-UUID binding here prevents a
      // superficially valid shared envelope from bypassing the browser's stable identity contract.
      const sourceDocumentId = normalizeBrowserDocumentId(parsed.sidecar.document_id);
      if (!sourceDocumentId) {
        const invalid: StrategicFitSidecarError = {
          error: "strategic_fit_sidecar_import_error",
          code: "invalid-document-id",
          path: "$.document_id",
          reason: "The sidecar document ID is not a valid browser document UUID.",
          metadata_issues: [],
        };
        currentError = invalid;
        return invalid;
      }
      const targetDocumentId = boundary.currentDocumentId();
      const targetRevision = boundary.currentRevision();
      const local = boundary.currentMetadata();
      const targetMetadataIdentity = metadataIdentity(local);
      const browserParsed: ParsedStrategicFitSidecar = {
        ...parsed,
        sidecar: { ...parsed.sidecar, document_id: sourceDocumentId },
      };
      const merged = previewStrategicFitSidecarMerge(targetDocumentId, local, browserParsed);
      const reconciled = boundary.reconcile(merged.merged_metadata);
      currentPreview = {
        ...merged,
        merged_metadata: reconciled,
        preview_id: `strategic-fit-sidecar-preview:${++sequence}`,
        target_revision: targetRevision,
        target_metadata_identity: targetMetadataIdentity,
        resulting_stale: staleIds(reconciled),
      };
      return currentPreview;
    },

    cancel() {
      clear();
    },

    async confirm(input) {
      const preview = currentPreview;
      if (preview === null) {
        const failure = confirmationError("no-preview", "There is no Strategic Fit sidecar preview to confirm.");
        currentError = failure;
        return failure;
      }
      if (input.preview_id !== preview.preview_id) {
        const failure = confirmationError("preview-id-mismatch", "The confirmation does not match the visible sidecar preview.");
        currentError = failure;
        return failure;
      }
      if (
        boundary.currentDocumentId() !== preview.target_document_id ||
        boundary.currentRevision() !== preview.target_revision ||
        metadataIdentity(boundary.currentMetadata()) !== preview.target_metadata_identity
      ) {
        const failure = confirmationError(
          "stale-preview",
          "The document, repertoire revision, or Strategic Fit metadata changed after this preview.",
        );
        currentError = failure;
        return failure;
      }
      if (preview.document_id_mismatch && input.acknowledge_document_mismatch !== true) {
        const failure = confirmationError(
          "document-id-acknowledgement-required",
          "Confirm the source/target document mismatch before importing this sidecar.",
        );
        currentError = failure;
        return failure;
      }
      boundary.replaceMetadata(preview.merged_metadata);
      boundary.invalidateReports();
      await boundary.flush(preview.target_document_id);
      const success = {
        ok: true as const,
        preview_id: preview.preview_id,
        document_id: preview.target_document_id,
      };
      clear();
      return success;
    },
  };
}

const browserImportState = createStrategicFitSidecarImportState({
  currentDocumentId: documentId,
  currentRevision: version,
  currentMetadata: strategicFitMetadata,
  reconcile: (metadata) => {
    try {
      return reconcileStrategicFitDocumentMetadata(metadata, {
        graph: buildRepertoireGraph(currentTree(), color()),
        profile: metadata.profile,
        repertoire_revision: `browser:${version()}`,
        now: new Date().toISOString(),
      }).metadata;
    } catch {
      // Unsupported/custom starts have no canonical graph. The sidecar remains normalized and all
      // already-stale imported records remain stale; normal preflight will disclose the graph issue.
      return metadata;
    }
  },
  replaceMetadata: replaceStrategicFitMetadata,
  invalidateReports: invalidateCachedStrategicFitReports,
  flush: flushStrategicFitMetadata,
});

const [previewSignal, setPreviewSignal] = createSignal<StrategicFitSidecarImportPreview | null>(null);
const [errorSignal, setErrorSignal] = createSignal<
  StrategicFitSidecarError | StrategicFitSidecarConfirmationError | null
>(null);

export const strategicFitSidecarImportPreview = previewSignal;
export const strategicFitSidecarImportError = errorSignal;

export function prepareStrategicFitSidecarImport(input: string | unknown) {
  const result = browserImportState.prepare(input);
  setPreviewSignal(browserImportState.preview());
  setErrorSignal(browserImportState.importError());
  return result;
}

export function cancelStrategicFitSidecarImport(): void {
  browserImportState.cancel();
  setPreviewSignal(null);
  setErrorSignal(null);
}

export async function confirmStrategicFitSidecarImport(input: {
  readonly preview_id: string;
  readonly acknowledge_document_mismatch?: boolean;
}) {
  const result = await browserImportState.confirm(input);
  setPreviewSignal(browserImportState.preview());
  setErrorSignal(browserImportState.importError());
  return result;
}
