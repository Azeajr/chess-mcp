import { createSignal } from "solid-js";

export type ArtifactFormat = "pgn" | "csv";
export interface Artifact {
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
    mediaType: format === "pgn" ? "application/x-chess-pgn" : "text/csv",
    content,
    bytes: new Blob([content]).size,
  };
  setArtifacts((all) => [...all, artifact]);
  return { kind: artifact.kind, artifact_id: artifact.id, format, name, media_type: artifact.mediaType, bytes: artifact.bytes };
}

export const artifactById = (id: string) => artifacts().find((artifact) => artifact.id === id);

export function saveArtifact(id: string) {
  const artifact = artifactById(id);
  if (!artifact) return false;
  const url = URL.createObjectURL(new Blob([artifact.content], { type: artifact.mediaType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = artifact.name;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}
