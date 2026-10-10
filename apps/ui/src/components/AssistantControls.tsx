import { Show } from "solid-js";
import { busy, stop, handoff } from "../store/chat";
import { guidedPurpose, guidedStatus, guidedSurface, manualIntervention } from "../store/guided-ui";
import { openFile, saveFile } from "../store/files";
import { setMobileTab, setStrategicFitWorkspaceOpen } from "../store/ui";

export default function AssistantControls() {
  return (
    <Show when={guidedStatus() !== "idle"}>
      <aside class="assistant-controls" aria-label="Assistant controls">
        <span role="status">
          {guidedStatus() === "executing" ? "Assistant working" : `Assistant ${guidedStatus()}`}:{" "}
          {guidedPurpose()}
        </span>
        <Show when={guidedSurface() === "document.open"}>
          <button
            data-guided-surface="document.open"
            onClick={() => {
              manualIntervention();
              openFile();
            }}
          >
            Open PGN
          </button>
        </Show>
        <Show when={guidedSurface() === "document.save"}>
          <button
            data-guided-surface="document.save"
            onClick={() => {
              manualIntervention();
              void saveFile();
            }}
          >
            Save PGN
          </button>
        </Show>
        <Show when={busy()}>
          <button onClick={stop}>Stop assistant</button>
          <button onClick={handoff}>I'll take it from here</button>
        </Show>
        <button
          onClick={() => {
            setStrategicFitWorkspaceOpen(false);
            setMobileTab("chat");
            document.querySelector<HTMLTextAreaElement>(".chat-input textarea")?.focus();
            // Land on the newest reply, once the panel is displayed and has a scroll height.
            requestAnimationFrame(() => {
              [...document.querySelectorAll<HTMLElement>(".chat-log .msg")]
                .at(-1)
                ?.scrollIntoView({ block: "end" });
            });
          }}
        >
          Return to chat
        </button>
      </aside>
    </Show>
  );
}
