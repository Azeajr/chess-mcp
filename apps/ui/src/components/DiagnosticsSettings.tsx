import { createSignal, Show } from "solid-js";
import { buildDiagnosticBundle } from "../application/diagnostic-bundle";
import { artifactSaveMessage, downloadText } from "../store/artifacts";
import { clearDiagnostics, diagnosticStats } from "../store/diagnostics";

const kilobytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Saves the local record of this session and the previous one for diagnosing a problem. */
export default function DiagnosticsSettings() {
  const [includeRepertoire, setIncludeRepertoire] = createSignal(true);
  const [status, setStatus] = createSignal<string | null>(null);
  const summary = () => {
    const stats = diagnosticStats();
    const previous = stats.previousRounds
      ? `; the previous session has ${stats.previousRounds} more`
      : "";
    return `${stats.rounds} assistant requests, ${stats.tools} tool results and ${stats.faults} errors recorded this session${previous} (${kilobytes(stats.bytes)}).`;
  };
  return (
    // A label would claim the buttons as its control; these are actions, not a field.
    <div class="ui-field field">
      <span class="ui-field-label">Diagnostics</span>
      <button
        type="button"
        class="settings-recover"
        data-settings-field="diagnostics"
        onClick={() => {
          try {
            const bundle = buildDiagnosticBundle({ includeRepertoire: includeRepertoire() });
            setStatus(
              artifactSaveMessage(downloadText(bundle.name, "application/json", bundle.content)),
            );
          } catch (error) {
            setStatus(
              `The diagnostic bundle could not be built: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }}
      >
        Save diagnostic bundle
      </button>
      <label class="settings-toggle">
        <input
          type="checkbox"
          checked={includeRepertoire()}
          onChange={(event) => {
            setIncludeRepertoire(event.currentTarget.checked);
          }}
        />
        <span>Include the repertoire PGN</span>
      </label>
      <small>
        One JSON file with this session and the previous one: every assistant request and reply,
        tool results, errors and app state. Your API key and Lichess token are removed, and nothing
        is sent anywhere. Chat and results still mention lines from the repertoire.
      </small>
      <small>{summary()}</small>
      <button
        type="button"
        class="settings-recover"
        onClick={() => {
          clearDiagnostics();
          setStatus("Diagnostic log cleared.");
        }}
      >
        Clear diagnostic log
      </button>
      <Show when={status()}>
        <small role="status">{status()}</small>
      </Show>
    </div>
  );
}
