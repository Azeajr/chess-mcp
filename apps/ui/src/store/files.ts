/**
 * PGN open/save via the File System Access API (download/upload fallback). The FileHandle is kept
 * in a module variable so Save writes back to the same file, and persisted to IndexedDB so the
 * last file can be re-opened across sessions (auto-loaded when permission is still granted,
 * otherwise via a user-gesture "Reopen" button). Shared by TopBar + the Cmd/Ctrl+S shortcut.
 */
import { createSignal } from "solid-js";
import { actions, fileName } from "./game";
import { idbGet, idbSet, idbDel } from "./idb";
import { send, loadRepertoireForCurrent } from "./chat";

type Perm = "granted" | "denied" | "prompt";
type FilePickerHandle = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  queryPermission?(opts?: { mode?: string }): Promise<Perm>;
  requestPermission?(opts?: { mode?: string }): Promise<Perm>;
};
type PickerWindow = Window & {
  showOpenFilePicker?: (opts?: unknown) => Promise<FilePickerHandle[]>;
  showSaveFilePicker?: (opts?: unknown) => Promise<FilePickerHandle>;
};

const HANDLE_KEY = "fileHandle";
let handle: FilePickerHandle | null = null;
const PGN_TYPES = [{ description: "PGN", accept: { "application/x-chess-pgn": [".pgn"] } }];

// Name of a persisted handle that hasn't been (re-)opened yet → drives the TopBar "Reopen" button.
const [storedFileName, setStoredFileName] = createSignal<string | null>(null);
export { storedFileName };

function remember(h: FilePickerHandle) {
  handle = h;
  void idbSet(HANDLE_KEY, h);
  setStoredFileName(null);
}

export function clearHandle() {
  handle = null;
  setStoredFileName(null);
  void idbDel(HANDLE_KEY);
}

const AUTO_ANALYZE_PROMPT =
  "Repertoire loaded. Give me an overview: what opening system is this, which color plays it, " +
  "and are there any questionable moves in the main line? Use get_position to see the PGN, " +
  "then evaluate_position on at most 2–3 critical positions.";

async function loadFromHandle(h: FilePickerHandle) {
  actions.loadPgn(await (await h.getFile()).text(), h.name);
  void loadRepertoireForCurrent();
  void send(AUTO_ANALYZE_PROMPT);
}

export async function openFile() {
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    const [h] = await w.showOpenFilePicker({ types: PGN_TYPES });
    if (!h) return;
    remember(h);
    await loadFromHandle(h);
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pgn";
  input.onchange = async () => {
    const f = input.files?.[0];
    if (f) {
      actions.loadPgn(await f.text(), f.name);
      void loadRepertoireForCurrent();
      void send(AUTO_ANALYZE_PROMPT);
    }
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
    const h = await w.showSaveFilePicker({ suggestedName: "repertoire.pgn", types: PGN_TYPES });
    remember(h);
    const ws = await h.createWritable();
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

/**
 * On startup: surface the last file as a "Reopen" affordance. We do NOT auto-load it — the
 * working repertoire is restored from autosave (store/persist), which holds the latest unsaved
 * edits; re-syncing to the on-disk file is an explicit user action (reopenLast).
 */
export async function restoreLastFile() {
  const h = await idbGet<FilePickerHandle>(HANDLE_KEY);
  if (h) setStoredFileName(h.name);
}

/** User-gesture re-open: request permission for the stored handle, then load it. */
export async function reopenLast() {
  const h = await idbGet<FilePickerHandle>(HANDLE_KEY);
  if (!h) return;
  let perm = await h.queryPermission?.({ mode: "readwrite" });
  if (perm !== "granted") perm = await h.requestPermission?.({ mode: "readwrite" });
  if (perm !== "granted") return;
  handle = h;
  await loadFromHandle(h);
  setStoredFileName(null);
}
