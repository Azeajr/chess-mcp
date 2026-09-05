import { Show, createEffect, createMemo } from "solid-js";
import { changesSinceExport, dirty, fileName, version } from "../store/game";
import { announce } from "../store/announce";
import { lastAutosaveAt } from "../store/persist";

const changeWord = (count: number) => (count === 1 ? "change" : "changes");

export default function DocumentStatus() {
  const unexported = createMemo(() => changesSinceExport());
  const linkedFile = createMemo(() => fileName());

  let announcedCount: number | null = null;
  createEffect(() => {
    const count = unexported();
    version();
    if (announcedCount === null) {
      announcedCount = count;
      return;
    }
    if (count === announcedCount) return;
    announcedCount = count;
    if (count === 0) return;
    const name = linkedFile();
    announce(
      name
        ? `${name}: ${count} unexported ${changeWord(count)}.`
        : `${count} unexported ${changeWord(count)}.`,
    );
  });

  const hasStatus = () => Boolean(linkedFile()) || dirty() || lastAutosaveAt() !== null;

  const autosavedAt = () => {
    const at = lastAutosaveAt();
    return at === null
      ? null
      : new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const state = () => {
    if (!linkedFile()) return dirty() ? "unlinked" : "browser";
    return unexported() > 0 ? "unexported" : "exported";
  };
  const text = () => {
    switch (state()) {
      case "unexported":
        return `${unexported()} unsaved ${changeWord(unexported())}`;
      case "exported":
        return "Saved";
      case "unlinked":
        return "Not in a file";
      case "browser":
        return "Draft";
    }
  };
  const detail = () => {
    const time = autosavedAt();
    const stored = time ? `Stored in this browser · autosaved ${time}` : "Stored in this browser";
    const name = linkedFile();
    if (!name) return `${stored}. Not linked to a file yet.`;
    return unexported() > 0
      ? `${stored}. ${unexported()} ${changeWord(unexported())} not yet exported to ${name}.`
      : `${stored}. No changes to export to ${name}.`;
  };

  return (
    <Show when={hasStatus()}>
      <div class="document-status" data-document-status={state()} title={detail()}>
        <span class="document-status-dot" aria-hidden="true" />
        <span class="document-status-text">{text()}</span>
        {/* Kept as a hidden value so the autosave clock stays machine-readable without spending
            a strip of the top bar on a timestamp nobody acts on. */}
        <Show when={autosavedAt()}>
          {(time) => (
            <span class="document-status-autosave-value" data-autosave-time hidden>
              {time()}
            </span>
          )}
        </Show>
      </div>
    </Show>
  );
}
