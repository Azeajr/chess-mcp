/**
 * PGN open/save via the File System Access API (download/upload fallback). The FileHandle is kept
 * in a module variable so Save writes back to the same file, and persisted to IndexedDB so the
 * last file can be re-opened across sessions (auto-loaded when permission is still granted,
 * otherwise via a user-gesture "Reopen" button). Shared by TopBar + the Cmd/Ctrl+S shortcut.
 */
import { createSignal } from "solid-js";
import { actions, fileName, dirty } from "./game";
import type { Color } from "./game";
import { idbGet, idbSet, idbDel } from "./idb";
import { GameTree } from "@chess-mcp/chess-tools";

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

// Pending PGN load waiting for color selection.
type PendingLoad = {
  pgn: string;
  name?: string;
  detectedColor: Color | null;
  sourceHandle?: FilePickerHandle;
};
const [pendingLoad, setPendingLoad] = createSignal<PendingLoad | null>(null);
export { pendingLoad };

// Shown in the color-picker modal when the chosen file fails to parse (illegal SAN, no game) —
// GameTree.fromPgn throws, and without catching it the Load click died silently in the console.
const [loadError, setLoadError] = createSignal<string | null>(null);
export { loadError };

export function resolvePendingLoad(color: Color) {
  const p = pendingLoad();
  if (!p) return;
  try {
    actions.loadPgn(p.pgn, p.name);
  } catch (e) {
    setLoadError(e instanceof Error ? e.message : String(e));
    return; // keep the modal open so the error is visible; Cancel dismisses
  }
  actions.setColor(color);
  if (p.sourceHandle) remember(p.sourceHandle);
  setLoadError(null);
  setPendingLoad(null);
}

export function cancelPendingLoad() {
  setPendingLoad(null);
  setLoadError(null);
}

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

async function loadFromHandle(h: FilePickerHandle) {
  const pgn = await (await h.getFile()).text();
  setPendingLoad({
    pgn,
    name: h.name,
    detectedColor: GameTree.detectColorFromPgn(pgn),
    sourceHandle: h,
  });
}

export async function openFile() {
  // Loading a file replaces the working tree; with unsaved edits and no file handle, the autosave
  // copy is the only copy and gets overwritten moments later — confirm before the picker opens.
  if (dirty() && !window.confirm("Discard unsaved changes and open a different PGN?")) return;
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    const [h] = await w.showOpenFilePicker({ types: PGN_TYPES });
    if (!h) return;
    await loadFromHandle(h);
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pgn";
  input.onchange = async () => {
    const f = input.files?.[0];
    if (f) {
      const pgn = await f.text();
      setPendingLoad({ pgn, name: f.name, detectedColor: GameTree.detectColorFromPgn(pgn) });
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
  await loadFromHandle(h);
}
