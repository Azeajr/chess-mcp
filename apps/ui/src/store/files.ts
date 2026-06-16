/**
 * PGN open/save via the File System Access API (download/upload fallback). Shared by the TopBar
 * buttons and the Cmd/Ctrl+S shortcut. The FileHandle is kept here so Save writes back to the
 * same file; Phase 6b will persist it in IndexedDB across sessions.
 */
import { actions, fileName } from "./game";

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

export function clearHandle() {
  handle = null;
}

export async function openFile() {
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    const [h] = await w.showOpenFilePicker({ types: PGN_TYPES });
    if (!h) return;
    handle = h;
    actions.loadPgn(await (await h.getFile()).text(), h.name);
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pgn";
  input.onchange = async () => {
    const f = input.files?.[0];
    if (f) actions.loadPgn(await f.text(), f.name);
  };
  input.click();
}

export async function saveFile() {
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
    handle = await w.showSaveFilePicker({ suggestedName: "repertoire.pgn", types: PGN_TYPES });
    const ws = await handle.createWritable();
    await ws.write(pgn);
    await ws.close();
    actions.markSaved();
    return;
  }
  const blob = new Blob([pgn], { type: "application/x-chess-pgn" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName() ?? "repertoire.pgn";
  a.click();
  URL.revokeObjectURL(a.href);
  actions.markSaved();
}
