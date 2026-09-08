import { createSignal } from "solid-js";

export type ArtifactFormat = "pgn" | "csv" | "json";
interface Artifact {
  id: string;
  kind: "artifact";
  format: ArtifactFormat;
  name: string;
  mediaType: string;
  content: string;
  bytes: number;
}

const [artifacts, setArtifacts] = createSignal<Artifact[]>([]);
export { artifacts };
let nextArtifact = 1;

export function createArtifact(format: ArtifactFormat, content: string, name: string) {
  const artifact: Artifact = {
    id: `artifact-${nextArtifact++}`,
    kind: "artifact",
    format,
    name,
    mediaType:
      format === "pgn"
        ? "application/x-chess-pgn"
        : format === "json"
          ? "application/json"
          : "text/csv",
    content,
    bytes: new Blob([content]).size,
  };
  setArtifacts((all) => [...all, artifact]);
  return {
    kind: artifact.kind,
    artifact_id: artifact.id,
    format,
    name,
    media_type: artifact.mediaType,
    bytes: artifact.bytes,
  };
}

export const artifactById = (id: string) => artifacts().find((artifact) => artifact.id === id);

export type ArtifactSaveResult =
  | { ok: true; name: string }
  | { ok: false; reason: "missing" | "blocked" };

/**
 * Hands a generated artifact to the browser as a download. Callers must act on the result: a
 * download that never happens is otherwise indistinguishable from one that did, because the page
 * shows nothing either way.
 */
export function saveArtifact(id: string): ArtifactSaveResult {
  const artifact = artifactById(id);
  // The store is in-memory, so a reload leaves an old result pointing at an artifact that is gone.
  if (!artifact) return { ok: false, reason: "missing" };
  let url: string | null = null;
  try {
    url = URL.createObjectURL(new Blob([artifact.content], { type: artifact.mediaType }));
    const link = document.createElement("a");
    link.href = url;
    link.download = artifact.name;
    link.click();
    return { ok: true, name: artifact.name };
  } catch {
    return { ok: false, reason: "blocked" };
  } finally {
    // Revoking in the same tick can cancel a download the browser has not started reading yet.
    if (url !== null) {
      const revoke = url;
      setTimeout(() => {
        URL.revokeObjectURL(revoke);
      }, 0);
    }
  }
}
