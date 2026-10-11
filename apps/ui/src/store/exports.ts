import { createSignal } from "solid-js";
import { artifactById, saveArtifact, type ArtifactSaveResult } from "./artifacts";
import { documentId, version } from "./game";

export type ExportCommand =
  | "export_annotated_pgn"
  | "export_annotated_repertoire"
  | "export_strategic_fit_metadata"
  | "export_strategic_fit_intent_pgn";

export interface ExportRecord {
  readonly command: ExportCommand;
  readonly artifactId: string;
  readonly name: string;
  readonly format: string;
  readonly bytes: number;
  readonly documentId: string;
  readonly revision: number;
  readonly generatedBy: "user" | "assistant";
  /** Null until someone presses Save: generating a file is not saving it. */
  readonly save: ArtifactSaveResult | null;
}

// One record per export surface, shared by its manual button and the browser assistant, so either
// route shows the same artifact and the same truthful generated/saved state.
const [exportRecords, setExportRecords] = createSignal<
  Partial<Record<ExportCommand, ExportRecord>>
>({});
export { exportRecords };
export const exportRecord = (command: ExportCommand) => exportRecords()[command] ?? null;

export function recordExport(
  command: ExportCommand,
  artifactId: string,
  generatedBy: ExportRecord["generatedBy"],
): ExportRecord | null {
  const artifact = artifactById(artifactId);
  if (!artifact) return null;
  const record: ExportRecord = {
    command,
    artifactId,
    name: artifact.name,
    format: artifact.format,
    bytes: artifact.bytes,
    documentId: documentId(),
    revision: version(),
    generatedBy,
    save: null,
  };
  setExportRecords((all) => ({ ...all, [command]: record }));
  return record;
}

/** Hands the recorded artifact to the browser. Only a user's Save press reaches this. */
export function saveExport(command: ExportCommand): ArtifactSaveResult {
  const record = exportRecord(command);
  const result: ArtifactSaveResult = record
    ? saveArtifact(record.artifactId)
    : { ok: false, reason: "missing" };
  if (record)
    setExportRecords((all) => ({
      ...all,
      [command]:
        all[command]?.artifactId === record.artifactId ? { ...record, save: result } : all[command],
    }));
  return result;
}
