/**
 * TopBar: open/save PGN, white/black repertoire toggle, new game, unsaved indicator, settings.
 * File I/O lives in store/files (shared with the Cmd/Ctrl+S shortcut).
 *
 * WP-017 applies DV-3: `Save to file` stays a visible one-interaction control, while Open,
 * Re-link, New, and Recover are additionally reachable in two interactions through the
 * Repertoire menu. The direct buttons remain so existing flows and their tests keep working.
 *
 * Layout is two groups rather than a flat run of peers: an identity group (what document am I
 * editing, and is it saved) on the left, an action group on the right. Previously the filename was
 * painted twice — once by DocumentStatus's prose and once by `.moveno` — with the prose clipped
 * mid-sentence between them, and all six controls carried identical visual weight so nothing said
 * which one you normally want.
 */
import { Show } from "solid-js";
import { actions, color, dirty, fileName } from "../store/game";
import {
  clearHandle,
  dismissFileNotice,
  fileNotice,
  openFile,
  reopenLast,
  requestDocumentClose,
  saveFile,
  storedFileName,
} from "../store/files";
import { setSettingsOpen } from "../store/ui";
import DocumentStatus from "./DocumentStatus";
import DocumentMenu from "./DocumentMenu";

export default function TopBar() {
  return (
    <div class="topbar">
      <h1 class="title">Chess Repertoire</h1>
      <div class="topbar-identity">
        <Show when={fileName()} fallback={<span class="topbar-untitled">Untitled repertoire</span>}>
          <span class="moveno" title={fileName() ?? ""}>
            {fileName()}
          </span>
        </Show>
        {/* WP-018: the two document indicators replace the bare "● unsaved" dot. */}
        <DocumentStatus />
      </div>
      <Show when={fileNotice()}>
        {(notice) => (
          <div class="file-notice" role="status">
            <span>{notice().message}</span>
            <Show when={notice().action === "open"}>
              <button onClick={openFile}>Open PGN</button>
            </Show>
            <button aria-label="Dismiss file notice" onClick={dismissFileNotice}>
              ×
            </button>
          </div>
        )}
      </Show>
      <div class="topbar-actions">
        <button data-topbar-duplicate onClick={openFile}>
          Open PGN
        </button>
        <Show when={storedFileName()}>
          <button
            data-topbar-duplicate
            class="reopen-button"
            title={`Re-open your last file: ${storedFileName()}`}
            onClick={() => void reopenLast()}
          >
            Reopen {storedFileName()}
          </button>
        </Show>
        {/* DV-3: Save is never behind a menu. It is also the only accented control up here, and
            only while there is something to write — an always-blue Save reads as "the thing to
            click" on a document that has nothing to save. */}
        <button
          class={`save-button${dirty() ? " ui-button-primary" : ""}`}
          onClick={() => void saveFile()}
        >
          Save
        </button>
        <button
          data-topbar-duplicate
          onClick={() => {
            requestDocumentClose("new", () => {
              clearHandle();
              actions.newGame();
            });
          }}
        >
          New
        </button>
        {/* DV-3: the same document actions, grouped and keyboard-operable, in two interactions. */}
        <DocumentMenu />
        <span class="topbar-sep" aria-hidden="true" />
        <select
          aria-label="Repertoire colour"
          title="Which side this repertoire is written for"
          value={color()}
          onChange={(e) => {
            actions.setColor(e.currentTarget.value as "white" | "black");
          }}
        >
          <option value="white">White</option>
          <option value="black">Black</option>
        </select>
        <button onClick={() => setSettingsOpen(true)}>Settings</button>
      </div>
    </div>
  );
}
