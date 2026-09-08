import { Show } from "solid-js";
import { artifactSaveMessage, type ArtifactSaveResult } from "../../store/artifacts";

export interface ArtifactSaveStatusProps {
  result: ArtifactSaveResult | null | undefined;
}

/**
 * Says what happened to a download. Every save surface needs one: the page shows nothing either
 * way, so a refused download and a successful one otherwise look exactly alike.
 */
export default function ArtifactSaveStatus(props: ArtifactSaveStatusProps) {
  const failure = () => {
    const result = props.result;
    return result && !result.ok ? result : null;
  };
  return (
    <Show when={props.result}>
      {(result) => (
        <div
          class={`artifact-save-status ${failure() ? "empty" : "safe"}`}
          role={failure() ? "alert" : "status"}
          data-artifact-save={failure()?.reason ?? "saved"}
        >
          {artifactSaveMessage(result())}
        </div>
      )}
    </Show>
  );
}
