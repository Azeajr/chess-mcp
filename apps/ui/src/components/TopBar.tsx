/**
 * TopBar: open/save PGN, white/black repertoire toggle, new game, unsaved indicator, settings.
 * File I/O lives in store/files (shared with the Cmd/Ctrl+S shortcut).
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

export default function TopBar() {
  return (
    <div class="topbar">
      <h1 class="title">Chess Repertoire</h1>
      <Show when={dirty()}>
        <span class="dirty">● unsaved</span>
      </Show>
      <Show when={fileName()}>
        <span class="moveno" title={fileName() ?? ""}>
          {fileName()}
        </span>
      </Show>
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
      <button onClick={openFile}>Open PGN</button>
      <Show when={storedFileName()}>
        <button
          class="reopen-button"
          title={`Re-open your last file: ${storedFileName()}`}
          onClick={() => void reopenLast()}
        >
          Reopen {storedFileName()}
        </button>
      </Show>
      <button onClick={() => void saveFile()}>Save</button>
      <button
        onClick={() => {
          requestDocumentClose("new", () => {
            clearHandle();
            actions.newGame();
          });
        }}
      >
        New
      </button>
      <select
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
  );
}
