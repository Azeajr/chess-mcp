import { For, Show, createSignal } from "solid-js";
import { saveArtifact } from "../store/artifacts";
import { cancelCommand, commandStates, executeCommand } from "../store/commands";
import {
  cancelStrategicFitSidecarImport,
  confirmStrategicFitSidecarImport,
  prepareStrategicFitSidecarImport,
  strategicFitSidecarImportError,
  strategicFitSidecarImportPreview,
} from "../store/strategic-fit-sidecar";

const collectionLabels = {
  route_weights: "Route weights",
  decision_weights: "Decision weights",
  overrides: "Cohort overrides and exclusions",
  resolutions: "Finding resolutions",
  archive_references: "Archive references",
  training_references: "Training references",
  provenance: "Provenance records",
} as const;

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.join(", ");
  return value === null ? "unset" : String(value);
}

export default function StrategicFitTransfer() {
  const [mismatchAcknowledged, setMismatchAcknowledged] = createSignal(false);
  const [confirmationMessage, setConfirmationMessage] = createSignal<string | null>(null);
  const sidecarState = () => commandStates().export_strategic_fit_metadata;
  const intentState = () => commandStates().export_strategic_fit_intent_pgn;

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setConfirmationMessage(null);
    setMismatchAcknowledged(false);
    prepareStrategicFitSidecarImport(await file.text());
  };

  const confirm = async () => {
    const preview = strategicFitSidecarImportPreview();
    if (!preview) return;
    const result = await confirmStrategicFitSidecarImport({
      preview_id: preview.preview_id,
      acknowledge_document_mismatch: mismatchAcknowledged(),
    });
    if ("ok" in result) setConfirmationMessage("Strategic Fit metadata imported and saved.");
  };

  return (
    <details class="rep-section strategic-fit-transfer">
      <summary><span>Strategic Fit portability</span></summary>
      <div class="scope-note">
        JSON is the canonical metadata sidecar. Portable PGN comments are a clone-only sharing format.
      </div>
      <div class="strategic-fit-transfer-actions">
        <button
          class="fix-btn"
          disabled={sidecarState().status === "running"}
          onClick={() => void executeCommand("export_strategic_fit_metadata")}
        >Generate metadata JSON</button>
        <Show when={sidecarState().result?.artifact_id}>
          {(id) => <button class="fix-btn" onClick={() => saveArtifact(String(id()))}>Save metadata JSON</button>}
        </Show>
        <Show when={intentState().status === "running"} fallback={
          <button class="fix-btn" onClick={() => void executeCommand("export_strategic_fit_intent_pgn")}>
            Generate intent PGN
          </button>
        }>
          <button class="fix-btn" onClick={() => cancelCommand("export_strategic_fit_intent_pgn")}>
            Cancel intent export
          </button>
        </Show>
        <Show when={intentState().result?.artifact_id}>
          {(id) => <button class="fix-btn" onClick={() => saveArtifact(String(id()))}>Save intent PGN</button>}
        </Show>
        <label class="fix-btn strategic-fit-import-label">
          Preview metadata import
          <input
            aria-label="Choose Strategic Fit metadata JSON"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const input = event.currentTarget;
              void importFile(input.files?.[0]).finally(() => { input.value = ""; });
            }}
          />
        </label>
      </div>
      <Show when={sidecarState().error}><div class="empty" role="alert">{sidecarState().error}</div></Show>
      <Show when={intentState().error}><div class="empty" role="alert">{intentState().error}</div></Show>
      <Show when={intentState().progress}>{(progress) => (
        <div class="scan-progress" role="status">
          {progress().detail ?? "Generating intent PGN"} {progress().total ? `${progress().done}/${progress().total}` : "…"}
        </div>
      )}</Show>
      <Show when={strategicFitSidecarImportError()}>
        {(failure) => (
          <div class="strategic-fit-import-error" role="alert">
            {failure().reason} <span class="muted">({failure().code})</span>
          </div>
        )}
      </Show>
      <Show when={confirmationMessage()}>{(message) => <div class="safe" role="status">{message()}</div>}</Show>
      <Show when={strategicFitSidecarImportPreview()}>
        {(preview) => (
          <section class="strategic-fit-import-preview" aria-label="Strategic Fit metadata import preview">
            <h4>Import preview</h4>
            <dl>
              <dt>Source document</dt><dd>{preview().source_document_id}</dd>
              <dt>Current document</dt><dd>{preview().target_document_id}</dd>
              <dt>Profile</dt>
              <dd>{preview().profile.changed
                ? `${preview().profile.local.mode} → ${preview().profile.incoming?.mode ?? "unchanged"}`
                : "Unchanged"}</dd>
            </dl>
            <Show when={preview().profile.changed && preview().profile.incoming}>
              {(incoming) => {
                const local = () => preview().profile.local;
                const rows = () => {
                  const localProfile = local();
                  const incomingProfile = incoming();
                  const localPreferences = localProfile.preferences;
                  const incomingPreferences = incomingProfile.preferences;
                  return [
                    ["mode", localProfile.mode, incomingProfile.mode],
                    ["source", localProfile.source, incomingProfile.source],
                    ["provisional", localProfile.provisional, incomingProfile.provisional],
                    ...Object.keys(localPreferences).map((key) => [
                      `preferences.${key}`,
                      localPreferences[key as keyof typeof localPreferences],
                      incomingPreferences[key as keyof typeof incomingPreferences],
                    ]),
                  ].filter(([, before, after]) => JSON.stringify(before) !== JSON.stringify(after));
                };
                return (
                  <details class="strategic-fit-import-identities">
                    <summary>Review profile changes</summary>
                    <For each={rows()}>{([field, before, after]) => (
                      <div><strong>{String(field)}:</strong> {displayValue(before)} → {displayValue(after)}</div>
                    )}</For>
                  </details>
                );
              }}
            </Show>
            <ul class="strategic-fit-import-counts">
              <For each={Object.entries(collectionLabels)}>{([key, label]) => {
                const summary = () => preview().collections[key as keyof typeof collectionLabels];
                return (
                  <li>
                    <strong>{label}:</strong> {summary().added.length} add, {summary().replaced.length} replace, {summary().preserved.length} preserve
                    <Show when={summary().incoming_stale.length > 0}> · {summary().incoming_stale.length} incoming stale</Show>
                  </li>
                );
              }}</For>
            </ul>
            <div class="scope-note">
              Incoming records replace matching durable identities; unmatched current records are preserved.
              The incoming profile replaces the current profile only when this preview is confirmed.
            </div>
            <details class="strategic-fit-import-identities">
              <summary>Review affected identities</summary>
              <For each={Object.entries(collectionLabels)}>{([key, label]) => {
                const summary = () => preview().collections[key as keyof typeof collectionLabels];
                return (
                  <Show when={summary().added.length > 0 || summary().replaced.length > 0 || summary().incoming_stale.length > 0}>
                    <div>
                      <strong>{label}</strong>
                      <Show when={summary().added.length > 0}><div>Add: {summary().added.join(", ")}</div></Show>
                      <Show when={summary().replaced.length > 0}><div>Replace: {summary().replaced.join(", ")}</div></Show>
                      <Show when={summary().incoming_stale.length > 0}><div>Remain stale: {summary().incoming_stale.join(", ")}</div></Show>
                    </div>
                  </Show>
                );
              }}</For>
            </details>
            <div class="scope-note">
              Resulting stale records: {Object.values(preview().resulting_stale).reduce((total, ids) => total + ids.length, 0)}.
              Stale records remain stale.
            </div>
            <Show when={Object.values(preview().resulting_stale).some((ids) => ids.length > 0)}>
              <details class="strategic-fit-import-identities">
                <summary>Review resulting stale identities</summary>
                <For each={Object.entries(preview().resulting_stale)}>{([key, ids]) => (
                  <Show when={ids.length > 0}>
                    <div><strong>{key.replace(/_/g, " ")}:</strong> {ids.join(", ")}</div>
                  </Show>
                )}</For>
              </details>
            </Show>
            <Show when={preview().document_id_mismatch}>
              <label class="strategic-fit-mismatch-confirm">
                <input
                  type="checkbox"
                  checked={mismatchAcknowledged()}
                  onChange={(event) => setMismatchAcknowledged(event.currentTarget.checked)}
                />
                I understand this sidecar belongs to a different document ID.
              </label>
            </Show>
            <div class="rep-preview-actions">
              <button
                class="accept"
                disabled={preview().document_id_mismatch && !mismatchAcknowledged()}
                onClick={() => void confirm()}
              >Confirm metadata import</button>
              <button class="reject" onClick={() => {
                cancelStrategicFitSidecarImport();
                setMismatchAcknowledged(false);
              }}>Cancel</button>
            </div>
          </section>
        )}
      </Show>
    </details>
  );
}
