import { Show } from "solid-js";
import { exportRecord, saveExport, type ExportCommand } from "../store/exports";
import ArtifactSaveStatus from "./primitives/ArtifactSaveStatus";

/**
 * The Save control for one export surface. An artifact the assistant generated is ready but not
 * saved, and says so; saving stays a press of this button.
 */
export default function ExportSaveControl(props: {
  command: ExportCommand;
  saveLabel: string;
  againLabel: string;
}) {
  const record = () => exportRecord(props.command);
  return (
    <Show when={record()}>
      {(current) => (
        <div
          class="export-save"
          data-export-command={props.command}
          data-export-state={
            current().save === null ? "generated" : current().save?.ok ? "saved" : "failed"
          }
        >
          <Show when={current().save === null}>
            <p role="status">
              {current().name} is ready ({current().bytes} bytes). It is not saved until you press{" "}
              {props.saveLabel}.
            </p>
          </Show>
          <button
            type="button"
            onClick={() => {
              saveExport(props.command);
            }}
          >
            {current().save === null ? props.saveLabel : props.againLabel}
          </button>
          <ArtifactSaveStatus result={current().save} />
        </div>
      )}
    </Show>
  );
}
