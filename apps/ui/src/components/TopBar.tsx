/**
 * TopBar: open/save PGN (File System Access API with a download/upload fallback), white/black
 * repertoire toggle, new game, unsaved indicator. The FileHandle is kept in a module variable
 * so Save writes back to the same file; Phase 6 will persist it in IndexedDB across sessions.
 */
import { Show } from "solid-js";
import { actions, color, dirty, fileName } from "../store/game";
import { setSettingsOpen } from "../store/ui";

// File System Access API is not in the default TS lib; narrow what we use.
type FilePickerHandle = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
};
type PickerWindow = Window & {
  showOpenFilePicker?: (opts?: unknown) => Promise<FilePickerHandle[]>;
  showSaveFilePicker?: (opts?: unknown) => Promise<FilePickerHandle>;
};

let handle: FilePickerHandle | null = null;

const PGN_TYPES = [{ description: "PGN", accept: { "application/x-chess-pgn": [".pgn"] } }];

async function openFile() {
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    const [h] = await w.showOpenFilePicker({ types: PGN_TYPES });
    if (!h) return;
    handle = h;
    const text = await (await h.getFile()).text();
    actions.loadPgn(text, h.name);
    return;
  }
  // Fallback: hidden file input.
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pgn";
  input.onchange = async () => {
    const f = input.files?.[0];
    if (f) actions.loadPgn(await f.text(), f.name);
  };
  input.click();
}

async function saveFile() {
  const pgn = actions.toPgn();
  const w = window as PickerWindow;
  if (handle) {
    const ws = await handle.createWritable();
    await ws.write(pgn);
    await ws.close();
    actions.markSaved();
    return;
  }
  if (w.showSaveFilePicker) {
    const h = await w.showSaveFilePicker({ suggestedName: "repertoire.pgn", types: PGN_TYPES });
    handle = h;
    const ws = await h.createWritable();
    await ws.write(pgn);
    await ws.close();
    actions.markSaved();
    return;
  }
  // Fallback: trigger a download.
  const blob = new Blob([pgn], { type: "application/x-chess-pgn" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName() ?? "repertoire.pgn";
  a.click();
  URL.revokeObjectURL(a.href);
  actions.markSaved();
}

export default function TopBar() {
  return (
    <div class="topbar">
      <span class="title">Chess Repertoire</span>
      <Show when={dirty()}>
        <span class="dirty">● unsaved</span>
      </Show>
      <Show when={fileName()}>
        <span class="moveno">{fileName()}</span>
      </Show>
      <button onClick={() => void openFile()}>Open PGN</button>
      <button onClick={() => void saveFile()}>Save</button>
      <button
        onClick={() => {
          handle = null;
          actions.newGame();
        }}
      >
        New
      </button>
      <select
        value={color()}
        onChange={(e) => actions.setColor(e.currentTarget.value as "white" | "black")}
      >
        <option value="white">White</option>
        <option value="black">Black</option>
      </select>
      <button onClick={() => setSettingsOpen(true)}>Settings</button>
    </div>
  );
}
