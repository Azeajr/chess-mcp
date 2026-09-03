/**
 * WP-018 DocumentStatus — visible indicators for file linkage, unexported changes, and browser
 * autosave.
 *
 * Two indicators, not one: the file indicator names the linked file and how many changes have not
 * been exported to it; the browser indicator says the working copy is stored locally and when it
 * was last autosaved. `dirty()` keeps its existing meaning — this adds a second concept.
 *
 * Every value is read through an accessor inside JSX so it stays reactive; reading a signal once
 * during setup would freeze the indicator at its mount-time value.
 */
import { Show, createEffect, createMemo } from "solid-js";
import { changesSinceExport, dirty, fileName, version } from "../store/game";
import { announce } from "../store/announce";
import { lastAutosaveAt } from "../store/persist";

const changeWord = (count: number) => (count === 1 ? "change" : "changes");

export default function DocumentStatus() {
  const unexported = createMemo(() => changesSinceExport());
  const linkedFile = createMemo(() => fileName());

  // AC-7: one polite announcement per change in the count, never per keystroke. Seeded on the
  // first run so mounting an already-dirty document does not announce a change nobody made.
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

  // Nothing to report before the first autosave on an unlinked, unmodified document — and an
  // empty status still occupies a flex slot plus its gap, which is enough to push the phone tab
  // bar past the fold on a short viewport.
  const hasStatus = () => Boolean(linkedFile()) || dirty() || lastAutosaveAt() !== null;

  const autosavedAt = () => {
    const at = lastAutosaveAt();
    return at === null
      ? null
      : new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  /**
   * One phrase, not two clipped ones. The top bar had a "Stored in this browser · autosaved HH:MM"
   * line, a "File: <name> — N changes not exported" line, and a third copy of the filename, all
   * competing for one ellipsised strip. The state everything else hangs off is whether there is
   * unexported work; the storage location and the autosave clock are reassurance, so they move to
   * the tooltip where they cost no width.
   */
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
