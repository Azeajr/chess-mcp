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

  return (
    <Show when={hasStatus()}>
      <div class="document-status">
        {/* Browser indicator (PD-1): the working copy always lives in this browser. */}
        <span class="document-status-browser" data-document-status="browser">
          Stored in this browser
          <Show when={lastAutosaveAt()}>
            {(at) => (
              <>
                {" · autosaved "}
                <span data-autosave-time>
                  {new Date(at()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </>
            )}
          </Show>
        </span>
        {/* File indicator (PD-1): only meaningful once a file is linked. */}
        <Show when={linkedFile()}>
          {(name) => (
            <span class="document-status-file" data-document-status="file">
              {"File: "}
              {/* The canonical `.moveno` filename element lives in TopBar; this one is the status
                line's own copy and must not answer that selector. */}
              <span class="document-status-filename" title={name()}>
                {name()}
              </span>
              <Show when={unexported() > 0} fallback={<>{" — no changes to export"}</>}>
                {` — ${unexported()} ${changeWord(unexported())} not exported`}
              </Show>
            </span>
          )}
        </Show>
        <Show when={!linkedFile() && dirty()}>
          <span class="document-status-unlinked" data-document-status="unlinked">
            Not linked to a file
          </span>
        </Show>
      </div>
    </Show>
  );
}
