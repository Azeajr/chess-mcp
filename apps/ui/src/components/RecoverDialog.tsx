import { createEffect, createSignal, For, Show } from "solid-js";
import {
  deleteSnapshot,
  listSnapshots,
  readSnapshot,
  recoverDialogOpen,
  restoreSnapshot,
  setRecoverDialogOpen,
  snapshotsUnavailable,
  type SnapshotListEntry,
} from "../store/persist";
import Dialog from "./primitives/Dialog";

function snapshotName(snapshot: SnapshotListEntry) {
  return snapshot.fileName ?? "Untitled repertoire";
}

function snapshotSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RecoverDialog() {
  const [snapshots, setSnapshots] = createSignal<SnapshotListEntry[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [preview, setPreview] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  async function refresh() {
    const entries = await listSnapshots();
    setSnapshots(entries);
    const selected = selectedId();
    if (!selected || !entries.some((entry) => entry.id === selected && entry.readable)) {
      setSelectedId(entries.find((entry) => entry.readable)?.id ?? null);
    }
  }

  createEffect(() => {
    if (!recoverDialogOpen()) return;
    setError(null);
    void refresh();
  });

  createEffect(() => {
    const id = selectedId();
    if (!recoverDialogOpen() || !id) {
      setPreview("");
      return;
    }
    void readSnapshot(id).then((snapshot) => setPreview(snapshot?.pgn ?? ""));
  });

  return (
    <Show when={recoverDialogOpen()}>
      <Dialog
        title="Recover a repertoire"
        description="Choose a working document saved in this browser. Restoring creates a new document."
        class="recover-dialog"
        onClose={() => setRecoverDialogOpen(false)}
      >
        <Show when={snapshotsUnavailable()}>
          <p class="document-close-error" role="alert">
            Snapshot history unavailable. Your current repertoire is still autosaved.
          </p>
        </Show>
        <Show when={snapshots().length > 0} fallback={<p>No recovery snapshots yet.</p>}>
          {/* A named list, not a named div: aria-label on a role-less element is prohibited and
              axe flags it, and the rows are a list in every sense that matters to a reader. */}
          <ul class="recover-list" aria-label="Recovery snapshots">
            <For each={snapshots()}>
              {(snapshot) => (
                <li class="recover-item">
                  <Show
                    when={snapshot.readable}
                    fallback={
                      <p>
                        <strong>{snapshotName(snapshot)}</strong> — Couldn't read this snapshot
                      </p>
                    }
                  >
                    <label>
                      <input
                        type="radio"
                        name="recovery-snapshot"
                        checked={selectedId() === snapshot.id}
                        onChange={() => setSelectedId(snapshot.id)}
                      />
                      <span>
                        <strong>{snapshotName(snapshot)}</strong>
                        <small>
                          {new Date(snapshot.savedAt).toLocaleString()} ·{" "}
                          {snapshotSize(snapshot.byteSize)} · {snapshot.moveCount} moves ·{" "}
                          {snapshot.lineCount} lines
                        </small>
                      </span>
                    </label>
                  </Show>
                  <button
                    type="button"
                    aria-label={`Delete ${snapshotName(snapshot)} snapshot`}
                    onClick={() => void deleteSnapshot(snapshot.id).then(refresh)}
                  >
                    Delete
                  </button>
                </li>
              )}
            </For>
          </ul>
          <Show when={preview()}>
            <section aria-label="Snapshot PGN preview">
              <pre class="recover-preview">{preview()}</pre>
            </section>
          </Show>
          <Show when={error()}>
            {(message) => (
              <p class="document-close-error" role="alert">
                {message()}
              </p>
            )}
          </Show>
          <div class="document-close-actions">
            <button type="button" onClick={() => setRecoverDialogOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedId()}
              onClick={() => {
                const id = selectedId();
                if (!id) return;
                void restoreSnapshot(id)
                  .then((restored) => {
                    if (restored) setRecoverDialogOpen(false);
                    else setError("Couldn't read this snapshot");
                  })
                  .catch(() => setError("Couldn't read this snapshot"));
              }}
            >
              Restore as new document
            </button>
          </div>
        </Show>
      </Dialog>
    </Show>
  );
}
